import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumeDB, snapshotProfile } from '../src/storage/db';
import { baseUrlProblem } from '../src/storage/defaults';
import { deleteProfile, PROFILE_SNAPSHOT_ID, presetFor, upsertProfile, validateDraft } from '../src/storage/apiProfiles';
import { loadSettings } from '../src/storage/settingsLoad';
import { chat, testConnection } from '../src/ai/provider';
import { normalizeProfile } from '../src/storage/profileIO';
import type { Settings } from '../src/types';

// 模拟测试：全部虚构 Key，不访问网络
const OLD_KEY = 'sk-FAKE-legacy-key-1111', NEW_KEY = 'sk-FAKE-new-key-2222';
const LEGACY = { id: 'settings', demoMode: false, baseUrl: 'https://api.deepseek.com', apiKey: OLD_KEY, model: 'deepseek-chat', visionModel: '', translateModel: '', uiLang: 'zh', provider: 'deepseek', ocrMode: 'local', setupDone: true } as Settings;

/** 扫描所有相关本地存储：IndexedDB 全部表 + localStorage + sessionStorage */
async function dumpAll(d: ResumeDB): Promise<string> {
  const parts: unknown[] = [];
  for (const t of d.tables) parts.push(await t.toArray());
  const ls: Record<string, string | null> = {};
  for (const st of [globalThis.localStorage, globalThis.sessionStorage]) if (st) for (let i = 0; i < st.length; i++) { const k = st.key(i)!; ls[k] = st.getItem(k); }
  return JSON.stringify([parts, ls], (_k, v) => (v instanceof Uint8Array ? `[bytes ${v.length}]` : v));
}
async function seedBusiness(d: ResumeDB) {
  const doc = normalizeProfile({ profile: { name: { zh: '测试用户丙', source: 'zh' } } });
  await d.profile.put({ id: 'me', doc });
  await snapshotProfile(d, doc, '测试快照');
  await d.state.put({ id: 'templateId', value: 'tpl-compact' });
}

describe('问题一：迁移快照不保留明文 Key', () => {
  it('旧配置迁移 → 新增 API → 删除旧 API → 全部本地存储都不含已删除的 Key，当前 Key 仍在，业务数据不受影响', async () => {
    const d = new ResumeDB('fix1-flow'); await d.settings.put(LEGACY); await seedBusiness(d);
    globalThis.localStorage?.setItem('wizardStep', '2');
    let s = (await loadSettings(d))!;
    const snap = await d.settings.get(PROFILE_SNAPSHOT_ID) as unknown as Record<string, unknown>;
    expect(snap).toMatchObject({ sanitized: true, provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', keyMasked: 'sk-••••••1111' });
    expect(snap.apiKey).toBeUndefined();
    s = upsertProfile(s, { name: '新', ...presetFor('deepseek'), apiKey: NEW_KEY }, { activate: true }).settings;
    s = deleteProfile(s, s.apiProfiles![0].id); await d.settings.put(s);
    await loadSettings(d); // 模拟刷新
    const all = await dumpAll(d);
    expect(all).not.toContain(OLD_KEY);
    expect(all).toContain(NEW_KEY);
    expect((await d.settings.get('settings'))!.apiKey).toBe(NEW_KEY);
    expect((await d.profile.get('me'))!.doc.profile.name.zh).toBe('测试用户丙');
    expect(await d.backups.count()).toBe(1); expect(await d.state.get('templateId')).toEqual({ id: 'templateId', value: 'tpl-compact' });
  });
  it('兼容旧版本已写入的含明文 Key 快照：加载时清理，主记录（当前在用）Key 不动', async () => {
    const d = new ResumeDB('fix1-oldsnap');
    const cur = upsertProfile({ ...LEGACY, apiKey: '', apiProfiles: [], activeProfileId: null }, { name: '在用', ...presetFor('deepseek'), apiKey: NEW_KEY }, { activate: true }).settings;
    await d.settings.put(cur);
    await d.settings.put({ ...LEGACY, id: PROFILE_SNAPSHOT_ID } as unknown as Settings); // 旧版 PR #5 写入的原样快照
    await d.settings.put({ ...cur, id: 'settings-other-copy' } as unknown as Settings);    // 任何其他含 Key 的副本
    await seedBusiness(d);
    const r = (await loadSettings(d))!;
    const all = await dumpAll(d);
    expect(all).not.toContain(OLD_KEY);
    const rows = (await d.settings.toArray()) as unknown as Record<string, unknown>[];
    expect(rows.filter((x) => x.id !== 'settings').every((x) => !x.apiKey && !x.apiProfiles)).toBe(true);
    expect(r.apiKey).toBe(NEW_KEY); expect((await d.settings.get('settings'))!.apiProfiles![0].apiKey).toBe(NEW_KEY);
    expect(await d.settings.get(PROFILE_SNAPSHOT_ID)).toMatchObject({ keyMasked: 'sk-••••••1111', model: 'deepseek-chat' });
    expect((await d.profile.get('me'))!.doc.profile.name.zh).toBe('测试用户丙'); expect(await d.backups.count()).toBe(1);
  });
  it('清理幂等：再次加载不改动', async () => {
    const d = new ResumeDB('fix1-idem'); await d.settings.put(LEGACY);
    await loadSettings(d); const a = await d.settings.toArray(); await loadSettings(d);
    expect(await d.settings.toArray()).toEqual(a);
  });
});

describe('问题二：只允许 HTTPS（本机回环例外）', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ['https://api.example.com/v1', true], ['http://localhost:8080/v1', true], ['http://127.0.0.1:11434/v1', true], ['http://[::1]:8000/v1', true], ['HTTP://LOCALHOST/v1', true],
    ['http://api.example.com/v1', false], ['http://localhost.evil.com/v1', false], ['http://127.0.0.1.example.com/v1', false], ['http://192.168.1.10/v1', false],
    ['http://evil.com#@localhost/v1', false], ['ftp://api.example.com', false], ['not a url', false],
  ])('%s → %s', (u, ok) => {
    expect(baseUrlProblem(u) === null).toBe(ok);
    const e = validateDraft({ name: 'x', provider: 'custom', baseUrl: u, apiKey: 'sk-FAKE-0000', model: 'm', translateModel: '', visionModel: '' }, true);
    expect(e.length === 0).toBe(ok);
  });
  it('非本机 http 的提示清楚易懂', () => {
    expect(baseUrlProblem('http://api.example.com/v1')).toMatch(/只能使用 https:\/\//);
  });
  it('请求时再次检查：旧版保存的 http 配置不会发出带 Key 的请求，并给出友好提示', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const s = { ...LEGACY, provider: 'custom', baseUrl: 'http://api.example.com/v1', apiKey: OLD_KEY, model: 'm' } as Settings;
    await expect(chat(s, [{ role: 'user', content: 'x' }])).rejects.toThrow(/已阻止发送请求.*https/);
    const r = await testConnection(s); expect(r.ok).toBe(false); if (!r.ok) expect(r.message).toMatch(/https/);
    expect(f).not.toHaveBeenCalled();
  });
  it('本机回环 http 允许发请求', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 })); vi.stubGlobal('fetch', f);
    await chat({ ...LEGACY, provider: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', model: 'm' } as Settings, [{ role: 'user', content: 'x' }]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
