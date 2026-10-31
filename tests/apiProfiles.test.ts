import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumeDB } from '../src/storage/db';
import { DEFAULT_SETTINGS } from '../src/storage/defaults';
import { activateProfile, aiMode, applyActive, deleteProfile, maskKey, migrateToProfiles, presetFor, PROFILE_SNAPSHOT_ID, settingsForProfile, upsertProfile, validateDraft, type ProfileDraft } from '../src/storage/apiProfiles';
import { loadSettings } from '../src/storage/settingsLoad';
import { chat, testConnection } from '../src/ai/provider';
import { collect } from '../src/tracker/backup';
import { exportProfileJson, normalizeProfile } from '../src/storage/profileIO';
import type { ApiProvider, Settings } from '../src/types';

// 全部为模拟测试：Key 均为虚构（sk-fake-...），fetch 被替换，不访问网络
const K1 = 'sk-fake-deepseek-AAAA1111', K2 = 'sk-fake-deepseek-BBBB2222', KQ = 'sk-fake-qwen-CCCC3333', KO = 'sk-fake-openai-DDDD4444', KC = 'fake-custom-EEEE5555';
const base = (): Settings => ({ ...DEFAULT_SETTINGS, apiProfiles: [], activeProfileId: null, setupDone: false });
const draft = (p: ApiProvider, name: string, apiKey: string, o: Partial<ProfileDraft> = {}): ProfileDraft => ({ name, ...presetFor(p), apiKey, ...o });
const add = (s: Settings, d: ProfileDraft, activate = true) => upsertProfile(s, d, { activate });

describe('1-4 新增与切换', () => {
  it('1 新增第一个 API：保存、自动启用、退出演示、平铺字段同步', () => {
    const { settings: s, id } = add({ ...base(), demoMode: true }, draft('deepseek', 'DeepSeek 主力', K1));
    expect(s.apiProfiles).toHaveLength(1); expect(s.activeProfileId).toBe(id);
    expect(s.apiKey).toBe(K1); expect(s.model).toBe('deepseek-flash'); expect(s.baseUrl).toBe('https://api.deepseek.com');
    expect(s.demoMode).toBe(false); expect(s.setupDone).toBe(true);
    expect(aiMode(s)).toMatchObject({ kind: 'real' });
  });
  it('2 新增多个不同服务商；新增时启用新配置，其他配置原样保留', () => {
    let s = add(base(), draft('deepseek', 'DS', K1)).settings;
    s = add(s, draft('qwen', 'Qwen 备用', KQ)).settings;
    s = add(s, draft('openai', 'OpenAI', KO)).settings;
    s = add(s, draft('custom', '自建', KC, { baseUrl: 'https://llm.example.com/v1', model: 'my-model' })).settings;
    expect(s.apiProfiles!.map((p) => p.provider)).toEqual(['deepseek', 'qwen', 'openai', 'custom']);
    expect(s.apiProfiles!.map((p) => p.apiKey)).toEqual([K1, KQ, KO, KC]);
    expect(s.provider).toBe('custom'); expect(s.apiKey).toBe(KC);
  });
  it('3 同一服务商两个不同 Key：独立 id，互不覆盖', () => {
    let s = add(base(), draft('deepseek', 'DeepSeek 主力', K1)).settings;
    s = add(s, draft('deepseek', 'DeepSeek 备用', K2)).settings;
    const [a, b] = s.apiProfiles!;
    expect(a.id).not.toBe(b.id); expect(a.apiKey).toBe(K1); expect(b.apiKey).toBe(K2);
  });
  it('4 反复切换：使用中标识与请求参数同步，不删除/覆盖其他配置', () => {
    let s = add(base(), draft('deepseek', 'A', K1)).settings;
    s = add(s, draft('qwen', 'B', KQ)).settings;
    const [a, b] = s.apiProfiles!;
    const before = JSON.stringify(s.apiProfiles);
    for (let i = 0; i < 6; i++) {
      const target = i % 2 ? b : a; s = activateProfile(s, target.id);
      expect(s.activeProfileId).toBe(target.id); expect(s.apiKey).toBe(target.apiKey); expect(s.baseUrl).toBe(target.baseUrl); expect(s.model).toBe(target.model);
    }
    expect(JSON.stringify(s.apiProfiles)).toBe(before);
    expect(activateProfile(s, 'no-such-id')).toBe(s);
  });
  it('切换回演示模式后 aiMode = demo；启用配置会退出演示模式', () => {
    let s = add(base(), draft('deepseek', 'A', K1)).settings;
    s = { ...s, demoMode: true }; expect(aiMode(s).kind).toBe('demo');
    s = activateProfile(s, s.apiProfiles![0].id); expect(aiMode(s).kind).toBe('real');
  });
});

describe('5 刷新后保持（IndexedDB 往返）', () => {
  it('保存到 settings 表 → 重新读取：列表与当前选择不变', async () => {
    const d = new ResumeDB('p5-reload');
    let s = add(base(), draft('deepseek', 'A', K1)).settings;
    s = add(s, draft('openai', 'B', KO)).settings;
    s = activateProfile(s, s.apiProfiles![0].id);
    await d.settings.put(s);
    const r = (await loadSettings(d))!;
    expect(r.apiProfiles).toEqual(s.apiProfiles); expect(r.activeProfileId).toBe(s.activeProfileId); expect(r.apiKey).toBe(K1);
    expect(await d.settings.get(PROFILE_SNAPSHOT_ID)).toBeUndefined(); // 已是新格式：不迁移、不快照
  });
});

describe('6-7 编辑', () => {
  it('6 编辑时 Key 留空 → 保留原 Key；其他配置不变', () => {
    let s = add(base(), draft('deepseek', 'A', K1)).settings;
    s = add(s, draft('qwen', 'B', KQ)).settings;
    const a = s.apiProfiles![0];
    s = upsertProfile(s, { ...a, name: 'A 改名', apiKey: '', model: 'deepseek-v4-pro' }).settings;
    expect(s.apiProfiles![0]).toMatchObject({ id: a.id, name: 'A 改名', apiKey: K1, model: 'deepseek-v4-pro' });
    expect(s.apiProfiles![1].apiKey).toBe(KQ); expect(s.apiProfiles).toHaveLength(2);
    expect(validateDraft({ ...a, name: 'x', apiKey: '' }, false)).toEqual([]);
  });
  it('7 修改当前启用配置后立即生效（平铺字段 = 新值），填新 Key 则替换', () => {
    let s = add(base(), draft('deepseek', 'A', K1)).settings;
    const a = s.apiProfiles![0];
    s = upsertProfile(s, { ...a, apiKey: K2, model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com/' }).settings;
    expect(s.apiKey).toBe(K2); expect(s.model).toBe('deepseek-v4-pro'); expect(s.baseUrl).toBe('https://api.deepseek.com');
    expect(s.activeProfileId).toBe(a.id);
  });
});

describe('8-10 删除', () => {
  const three = () => { let s = add(base(), draft('deepseek', 'A', K1)).settings; s = add(s, draft('qwen', 'B', KQ)).settings; s = add(s, draft('openai', 'C', KO)).settings; return activateProfile(s, s.apiProfiles![0].id); };
  it('8 删除普通配置：Key 随之移除，当前配置与其他配置不变', () => {
    let s = three(); const [a, b, c] = s.apiProfiles!;
    s = deleteProfile(s, b.id);
    expect(s.apiProfiles!.map((p) => p.id)).toEqual([a.id, c.id]); expect(JSON.stringify(s)).not.toContain(KQ);
    expect(s.activeProfileId).toBe(a.id); expect(s.apiKey).toBe(K1);
  });
  it('9 删除当前配置：不自动切换到其他收费配置，进入未启用状态，已删 Key 不再可用', async () => {
    let s = three(); const a = s.apiProfiles![0];
    s = deleteProfile(s, a.id);
    expect(s.activeProfileId).toBeNull(); expect(s.apiKey).toBe(''); expect(JSON.stringify(s)).not.toContain(K1);
    expect(s.apiProfiles).toHaveLength(2); expect(aiMode(s).kind).toBe('none');
    await expect(chat(s, [{ role: 'user', content: 'x' }])).rejects.toMatchObject({ kind: 'nokey' });
  });
  it('10 删除最后一个配置 → 空列表、尚未配置 API', () => {
    let s = add(base(), draft('deepseek', 'A', K1)).settings;
    s = deleteProfile(s, s.apiProfiles![0].id);
    expect(s.apiProfiles).toEqual([]); expect(s.apiKey).toBe(''); expect(aiMode(s).kind).toBe('none');
  });
});

describe('11 旧版设置迁移', () => {
  const OLD = { id: 'settings', demoMode: false, baseUrl: 'https://api.deepseek.com', apiKey: K1, model: 'deepseek-chat', visionModel: '', translateModel: 'deepseek-chat', uiLang: 'zh', provider: 'deepseek', ocrMode: 'local', setupDone: true } as Settings;
  it('单套旧配置 → 一条记录，Key / Base URL 不丢，deepseek-chat 仍迁移为 deepseek-flash，并先做快照', async () => {
    const d = new ResumeDB('p11-old'); await d.settings.put(OLD);
    const r = (await loadSettings(d))!;
    expect(r.apiProfiles).toHaveLength(1);
    expect(r.apiProfiles![0]).toMatchObject({ provider: 'deepseek', apiKey: K1, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', translateModel: 'deepseek-flash' });
    expect(r.activeProfileId).toBe(r.apiProfiles![0].id); expect(r.apiKey).toBe(K1); expect(r.model).toBe('deepseek-flash');
    const snap = await d.settings.get(PROFILE_SNAPSHOT_ID);
    expect(snap).toMatchObject({ apiKey: K1, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' });
    // 幂等：再次加载不新增记录、不改 id、不覆盖快照
    const r2 = (await loadSettings(d))!;
    expect(r2.apiProfiles).toEqual(r.apiProfiles); expect(await d.settings.get(PROFILE_SNAPSHOT_ID)).toEqual(snap);
  });
  it('自定义服务商 / 自定义模型原样迁移（不改模型名）', () => {
    const r = migrateToProfiles({ ...OLD, provider: 'custom', baseUrl: 'https://proxy.example.com/v1', model: 'deepseek-chat', translateModel: '' }).settings;
    expect(r.apiProfiles![0]).toMatchObject({ provider: 'custom', baseUrl: 'https://proxy.example.com/v1', model: 'deepseek-chat', apiKey: K1 });
    const q = migrateToProfiles({ ...OLD, provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max', visionModel: 'qwen-vl-plus' }).settings;
    expect(q.apiProfiles![0]).toMatchObject({ provider: 'qwen', model: 'qwen-max', visionModel: 'qwen-vl-plus' });
  });
  it('从未配置过 Key → 空列表，未启用', () => {
    const r = migrateToProfiles({ ...DEFAULT_SETTINGS }).settings;
    expect(r.apiProfiles).toEqual([]); expect(r.activeProfileId).toBeNull();
  });
  it('新格式里遗留的 deepseek-chat 也按原规则迁移；其他服务商不动', () => {
    const s = upsertProfile(base(), draft('deepseek', 'A', K1, { model: 'deepseek-chat' }), { activate: true }).settings;
    const s2 = upsertProfile(s, draft('custom', 'B', KC, { baseUrl: 'https://p.example.com', model: 'deepseek-chat' })).settings;
    const r = migrateToProfiles(s2).settings;
    expect(r.apiProfiles![0].model).toBe('deepseek-flash'); expect(r.apiProfiles![1].model).toBe('deepseek-chat');
  });
  it('applyActive 指向不存在的 id → 未启用，不会挑选别的配置', () => {
    const s = upsertProfile(base(), draft('deepseek', 'A', K1)).settings;
    const r = applyActive({ ...s, activeProfileId: 'gone', apiKey: K1 });
    expect(r.activeProfileId).toBeNull(); expect(r.apiKey).toBe('');
  });
});

describe('12 连接测试（模拟 fetch）', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const prof = () => { let s = add(base(), draft('deepseek', 'A', K1)).settings; s = add(s, draft('qwen', 'B', KQ)).settings; return activateProfile(s, s.apiProfiles![0].id); };
  const reply = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
  it('成功：只用被测配置（Qwen），不改变当前启用（DeepSeek）', async () => {
    const s = prof(); const calls: { url: string; auth: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }); }));
    const r = await testConnection(settingsForProfile(s, s.apiProfiles![1]));
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'); expect(calls[0].auth).toBe(`Bearer ${KQ}`);
    expect(calls[0].body).toMatchObject({ model: 'qwen-plus', max_tokens: 8 }); expect(calls[0].body.thinking).toBeUndefined();
    expect(calls[0].url).not.toContain(KQ);
    expect(s.activeProfileId).toBe(s.apiProfiles![0].id); expect(s.apiKey).toBe(K1);
  });
  it.each([
    [401, { error: { message: 'Authentication Fails' } }, 'auth', /Key 无效/],
    [402, { error: { message: 'Insufficient Balance' } }, 'balance', /余额不足/],
    [429, { error: { message: 'rate' } }, 'rate', /频繁/],
    [404, { error: { message: 'not found' } }, 'model', /模型名称/],
    [400, { error: { message: 'Model Not Exist' } }, 'model', /模型名称/],
    [503, { error: { message: 'busy' } }, 'server', /暂时不可用/],
  ])('HTTP %i → %s', async (status, body, kind, re) => {
    reply(status, body);
    const r = await testConnection(settingsForProfile(prof(), prof().apiProfiles![0]));
    expect(r).toMatchObject({ ok: false, kind }); if (!r.ok) expect(r.message).toMatch(re);
  });
  it('网络故障 → network（不当作 Key 无效）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const r = await testConnection(settingsForProfile(prof(), prof().apiProfiles![0]));
    expect(r).toMatchObject({ ok: false, kind: 'network' }); if (!r.ok) expect(r.message).not.toMatch(/Key/);
  });
  it('超时 → timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))));
    vi.useFakeTimers();
    const p = testConnection(settingsForProfile(prof(), prof().apiProfiles![0]));
    await vi.advanceTimersByTimeAsync(20_001);
    expect(await p).toMatchObject({ ok: false, kind: 'timeout' });
  });
  it('错误信息中即使服务商回显了 Key 也会被抹掉', async () => {
    reply(400, { error: { message: `bad key ${K1}` } });
    const r = await testConnection(settingsForProfile(prof(), prof().apiProfiles![0]));
    expect(JSON.stringify(r)).not.toContain(K1);
  });
  it('请求进行中切换配置：该请求仍使用开始时的配置', async () => {
    let s = prof(); let release!: () => void; const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { seen.push(`${url}|${(init.headers as Record<string, string>).Authorization}`); await new Promise<void>((r) => { release = r; }); return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 }); }));
    const snap = s; const p = chat(snap, [{ role: 'user', content: 'x' }]);
    s = activateProfile(s, s.apiProfiles![1].id); // 中途切换
    await Promise.resolve(); release(); await p;
    expect(seen[0]).toBe(`https://api.deepseek.com/chat/completions|Bearer ${K1}`);
    expect(s.apiKey).toBe(KQ);
  });
});

describe('13 Key 不进入备份、导出和网址', () => {
  it('求职数据备份 collect() 与资料 JSON 导出均不含任何 Key', async () => {
    const d = new ResumeDB('p13-backup');
    let s = add(base(), draft('deepseek', 'A', K1)).settings; s = add(s, draft('qwen', 'B', KQ)).settings;
    await d.settings.put(s);
    await d.profile.put({ id: 'me', doc: normalizeProfile({ profile: { name: { zh: '测试用户乙', source: 'zh' } } }) });
    const all = JSON.stringify(await collect(d)) + exportProfileJson((await d.profile.get('me'))!.doc);
    for (const k of [K1, KQ]) expect(all).not.toContain(k);
  });
  it('脱敏显示', () => {
    expect(maskKey('sk-abcdef1234567890wxyz')).toBe('sk-••••••wxyz');
    expect(maskKey('abcdefghijkl9876')).toBe('••••••9876');
    expect(maskKey('short')).toBe('••••••');
    expect(maskKey('')).toBe('（未填写）');
  });
  it('校验：必填、URL 格式、Key 不得放进网址', () => {
    expect(validateDraft(draft('deepseek', '', ''), true)).toEqual(expect.arrayContaining(['请填写配置名称', '请粘贴 API Key']));
    expect(validateDraft(draft('custom', 'x', K1, { baseUrl: 'not a url', model: 'm' }), true).join()).toMatch(/Base URL/);
    expect(validateDraft(draft('custom', 'x', K1, { baseUrl: `https://a.example.com/v1?key=${K1}`, model: 'm' }), true).join()).toMatch(/不能带参数/);
    expect(validateDraft(draft('custom', 'x', K1, { baseUrl: 'https://a.example.com/v1', model: '' }), true)).toContain('请填写模型名称');
  });
});

describe('14 各服务商预设参数', () => {
  it.each([
    ['deepseek', 'https://api.deepseek.com', 'deepseek-flash'],
    ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'],
    ['openai', 'https://api.openai.com/v1', 'gpt-4o-mini'],
    ['custom', '', ''],
  ] as const)('%s → %s / %s；切换后请求参数正确', async (p, url, model) => {
    expect(presetFor(p)).toMatchObject({ baseUrl: url, model });
    if (p === 'custom') return;
    let s = add(base(), draft(p, p, K1)).settings;
    s = add(s, draft('custom', 'c', KC, { baseUrl: 'https://llm.example.com/v1', model: 'm' })).settings;
    s = activateProfile(s, s.apiProfiles![0].id);
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit) => { calls.push({ url: u, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 }); }));
    await chat(s, [{ role: 'user', content: 'x' }]);
    expect(calls[0].url).toBe(`${url}/chat/completions`); expect(calls[0].body.model).toBe(model);
    expect('thinking' in calls[0].body).toBe(p === 'deepseek');
    vi.unstubAllGlobals();
  });
});
