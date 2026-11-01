// v1.9.1 AI 信息丢失回归测试：模拟 AI 的各种「看似润色、实际丢事实」的错误输出（全部虚构数据）
import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import { applyOrganize, planOrganize, type OrganizePlan } from '../src/quality/organize';
import { coverage, semanticFlags } from '../src/quality/factCheck';
import { emptyProfile } from '../src/storage/profileIO';
import type { Lang, ProfileDoc, Settings } from '../src/types';

const S = { demoMode: false, baseUrl: 'https://api.deepseek.com', apiKey: 'sk-FAKE-loss', model: 'deepseek-flash' } as unknown as Settings;
const mock = chatJson as unknown as ReturnType<typeof vi.fn>;
type Item = { key: string; zh: string; en: string };
/** AI 模拟：按原文查表返回错误改写；查不到时原样返回 */
function aiWith(map: Record<string, string>, extra?: (x: Item) => Record<string, unknown> | null) {
  mock.mockImplementation(async (...args: unknown[]) => {
    if (!args[1]) return { items: [] };
    const c = (args[1] as { content: string }[])[1].content; const items = JSON.parse(c.slice(c.lastIndexOf('{"items"'))).items as Item[];
    return { items: items.map((x) => { const e = extra?.(x); if (e) return e; const src = x.zh || x.en; const hit = Object.entries(map).find(([k]) => src.includes(k) || src.includes(k.replace(/^我|^I tested/, (m) => (m === '我' ? '' : 'Tested')))); const out = hit ? hit[1] : src; return x.zh ? { key: x.key, category: 'resume', zh: out, en: '' } : { key: x.key, category: 'resume', zh: '', en: out }; }) };
  });
}
const safe = (p: OrganizePlan) => new Set(p.proposals.filter((x) => x.risk === 'safe').map((x) => x.id));
function one(text: string, lang: Lang = 'zh', opts: { section?: 'work' | 'projects' | 'education'; kind?: string; nature?: string } = {}): ProfileDoc {
  const p = emptyProfile(); const sec = opts.section ?? 'work';
  const b = { id: 'x-b1', [lang]: text, ...(lang === 'en' ? { source: 'en' } : {}), status: { [lang]: 'manual' } };
  if (sec === 'work') p.work = [{ id: 'x', enabled: true, company: { zh: '示例测控公司' }, title: { zh: '测试实习生' }, kind: opts.kind ?? 'internship', start: '2024-07', end: '2024-09', link: 'https://example.com/w', bullets: [b] } as never];
  if (sec === 'projects') p.projects = [{ id: 'x', enabled: true, name: { zh: '机器人仿真' }, role: { zh: '组员' }, kind: 'auxiliary', nature: opts.nature ?? '课程实验', start: '', end: '', tags: [], link: 'https://example.com/p', bullets: [b] } as never];
  if (sec === 'education') p.education = [{ id: 'x', enabled: true, school: { zh: '示例理工大学' }, degree: { zh: '硕士' }, major: { zh: '机械工程' }, start: '2025-09', end: '2027-01', expectedConferralDate: '2027-01', highlights: [b] } as never];
  p.sourceTexts = [{ id: 'src1', name: '虚构原文.txt', text: `原始资料：${text}`, importedAt: '2026-10-01T00:00:00Z' }] as never;
  return p;
}
const textOf = (p: ProfileDoc, lang: Lang = 'zh') => { const e = (p.work[0] ?? p.projects[0] ?? p.education[0]) as unknown as { bullets?: Record<string, string>[]; highlights?: Record<string, string>[] }; return (e.bullets ?? e.highlights)![0][lang]; };

// [原文, AI 错误输出, 本地安全版本（null = 原文不需要机械清洗）, 期望原因关键词, 语言, 场景]
const CASES: [string, string, string | null, RegExp, Lang, Parameters<typeof one>[2]?][] = [
  ['我在公司使用设备测试', '使用设备测试', '在公司使用设备测试', /公司/, 'zh'], // AI 收到的是本地清洗后的「在公司使用设备测试」
  ['在医院与导师讨论耳镜设计', '与导师讨论耳镜设计', null, /医院/, 'zh'],
  ['在医院与导师讨论耳镜设计', '在医院讨论耳镜设计', null, /导师/, 'zh'],
  ['协助维护自动化生产设备', '负责维护自动化生产设备', null, /参与程度/, 'zh'],
  ['协助维护自动化生产设备', '主导维护自动化生产设备', null, /参与程度/, 'zh'],
  ['在课程实验中完成机器人仿真', '完成商业机器人项目仿真', null, /商业|课程/, 'zh', { section: 'projects' }],
  ['仅在室温条件下进行测试', '进行测试', null, /限定条件|室温/, 'zh'],
  ['项目尚未完成', '项目已经完成', null, /时间状态|尚未/, 'zh', { section: 'projects', nature: '个人项目' }],
  ['完成软件开发及硬件装配', '完成软件开发', null, /并列|硬件装配/, 'zh'],
  ['参与三人团队完成设计', '独立完成设计', null, /独立|团队/, 'zh'],
  ['预计2027年1月授予学位', '已于2027年1月获得学位', null, /时间状态|已获得|学位/, 'zh', { section: 'education' }],
  ['参与开发数据采集软件', '独立开发数据采集软件', null, /参与程度|独立/, 'zh'],
  ['在示例测控公司实习期间参与设备测试', '作为全职工程师参与设备测试', null, /全职|实习/, 'zh'],
  ['I tested equipment at the company', 'Tested equipment', 'Tested equipment at the company', /company/, 'en'],
  ['Assisted in maintaining automated production equipment', 'Led maintenance of automated production equipment', null, /参与程度/, 'en'],
  ['Tests were only conducted at room temperature', 'Conducted tests', null, /限定条件|room|only/, 'en'],
  ['Participated in a three-person team to complete the design', 'Independently completed the design', null, /独立|团队|team/, 'en'],
  ['Master degree expected in January 2027', 'Master degree conferred in January 2027', null, /时间状态|expected|conferred/, 'en', { section: 'education' }],
];

beforeEach(() => mock.mockReset());
const DIRTY = { zh: '实际职责以本人核实为准。', en: ' For reference only.' };
const dirty = (t: string, l: Lang) => (l === 'zh' ? `${t}。${DIRTY.zh}` : `${t}.${DIRTY.en}`);
const localOnly = async (p: ProfileDoc, l: Lang) => { const pl = await planOrganize(S, p, { useAi: false }); return textOf(applyOrganize(p, pl, safe(pl)), l); };
describe('AI 信息丢失回归（v1.9.3：丢失 → 反馈重试 → 仍丢失则拒绝、保持原文）', () => {
  for (const [src, bad, , why, lang, opt] of CASES) it(`拦截：${src} → ${bad}`, async () => {
    const p = one(dirty(src, lang), lang, opt); const before = JSON.stringify(p); const expectText = await localOnly(p, lang);
    aiWith({ [src]: bad });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(mock, '首轮 + 1 次反馈重试').toHaveBeenCalledTimes(2);
    expect(plan.proposals.some((x) => x.source === 'ai'), '丢失事实的 AI 改写不会成为任何建议').toBe(false);
    expect(plan.stats?.rejected).toBe(1);
    expect(plan.rejectedItems?.[0].reasons.join('；')).toMatch(why);
    // 重试请求带上了具体丢失的事实
    const retryBody = (mock.mock.calls[1][1] as { content: string }[])[1].content; expect(retryBody).toContain('lostFacts');
    const out = applyOrganize(p, plan, safe(plan));
    expect(textOf(out, lang)).toBe(expectText); // 只有本地机械清洗写入
    expect(textOf(out, lang)).not.toContain(lang === 'zh' ? '实际职责' : 'reference only');
    const e0 = (out.work[0] ?? out.projects[0] ?? out.education[0]) as unknown as { id: string; link?: string };
    expect(e0.id).toBe('x'); expect(JSON.stringify(out.sourceTexts)).toBe(JSON.stringify(JSON.parse(before).sourceTexts));
    if (e0.link !== undefined) expect(e0.link).toMatch(/^https:\/\/example\.com/);
    if (opt?.section === 'education') { expect(out.education[0].expectedConferralDate).toBe('2027-01'); expect(out.education[0].actualConferralDate ?? '').toBe(''); }
    expect(JSON.stringify(p)).toBe(before);
  });
  it('真实 DeepSeek 丢失案例：「在公司」丢失被拒绝，本地清洗保留「在公司」', async () => {
    const p = one('我在公司使用设备进行第1轮测试。实际职责以本人核实为准。'); aiWith({ 第1轮: '使用设备进行第1轮测试' });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.rejectedItems?.[0].reasons.join()).toContain('在公司');
    const out = applyOrganize(p, plan, safe(plan));
    expect(textOf(out)).toBe('在公司使用设备进行第1轮测试。');
    expect(JSON.stringify(out.work[0])).toContain('实际职责以本人核实为准');
  });
  it('重试修好：首轮丢失、重试给出完整版本 → 不再丢失', async () => {
    const p = one('我负责搭建测试台，包括电源、示波器和数据采集卡。以上信息仅供参考。'); let call = 0;
    aiWith({}, (x) => { call++; return { key: x.key, category: 'resume', zh: call === 1 ? '负责搭建测试台。' : x.zh, en: '' }; });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.stats?.rejected).toBe(0); expect(mock).toHaveBeenCalledTimes(2);
    expect(textOf(applyOrganize(p, plan, safe(plan)))).toBe('负责搭建测试台，包括电源、示波器和数据采集卡。');
  });
  it('A 类：AI 输出与本地机械清洗等价（只差标点）→ 安全，采用本地版本', async () => {
    const p = one('我在公司使用设备测试。'); aiWith({ 设备: '在公司使用设备测试' });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.filter((x) => x.kind !== 'field').every((x) => x.risk === 'safe')).toBe(true);
    expect(textOf(applyOrganize(p, plan, safe(plan)))).toBe('在公司使用设备测试。');
  });
  it('AI 改写不会被标为 A 类（语序调整：丢片段 → 拒绝；不会冒充安全）', async () => {
    const p = one('我使用示波器完成电路测试'); aiWith({ 示波器: '完成电路测试，使用示波器' });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.some((x) => x.source === 'ai' && x.risk === 'safe')).toBe(false);
  });
  it('一条 AI 错误 / 一批失败不影响其它清洗结果', async () => {
    const p = emptyProfile();
    p.work = [{ id: 'w', enabled: true, company: { zh: '示例公司' }, title: { zh: '实习生' }, kind: 'internship', start: '', end: '', bullets: Array.from({ length: 25 }, (_, i) => ({ id: `w-b${i}`, zh: `我完成第${i}项测试。以上信息仅供参考。`, status: { zh: 'manual' } })) } as never];
    let call = 0;
    mock.mockImplementation(async (...args: unknown[]) => {
      if (!args[1]) return { items: [] };
      call++; if (call === 1) throw new Error('请求超时');
      const c = (args[1] as { content: string }[])[1].content; const items = JSON.parse(c.slice(c.lastIndexOf('{"items"'))).items as Item[];
      return { items: [{ key: items[0].key, zh: 12345 }, ...items.slice(1).map((x) => ({ key: x.key, category: 'resume', zh: x.zh.replace('完成', '独立完成') }))] };
    });
    const plan = await planOrganize(S, p, { useAi: true, batchSize: 20 });
    expect(plan.aiErrors?.length).toBe(1);
    const out = applyOrganize(p, plan, safe(plan));
    expect(out.work[0].bullets.map((b) => b.zh)).toEqual(Array.from({ length: 25 }, (_, i) => `完成第${i}项测试。`));
    expect(out.work[0].bullets.map((b) => b.id)).toEqual(Array.from({ length: 25 }, (_, i) => `w-b${i}`));
  });
  it('用户已确认的内容不被任何 AI 改写覆盖', async () => {
    const p = one('我协助维护自动化生产设备'); p.work[0].bullets[0].status = { zh: 'confirmed' }; aiWith({ 协助: '负责维护自动化生产设备' });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(textOf(applyOrganize(p, plan, new Set(plan.proposals.map((x) => x.id))))).not.toContain('负责');
  });
  it('规则版本 / 模型变化或「重新检查」时，以前处理过的文字可以再次送检', async () => {
    const p = one('我协助维护自动化生产设备'); aiWith({ 协助: '负责维护自动化生产设备' });
    const p1 = await planOrganize(S, p, { useAi: true });
    const o1 = applyOrganize(p, p1, new Set());
    mock.mockClear();
    const p2 = await planOrganize(S, o1, { useAi: true });
    expect(mock).not.toHaveBeenCalled(); expect(p2.stats?.rejected).toBe(0);
    const p3 = await planOrganize(S, o1, { useAi: true, force: true });
    expect(mock).toHaveBeenCalled(); expect(p3.stats?.rejected).toBe(1);
    mock.mockClear();
    const p4 = await planOrganize({ ...S, model: 'deepseek-other' } as Settings, o1, { useAi: true });
    expect(mock).toHaveBeenCalled(); expect(p4.stats?.rejected).toBe(1);
  });
});

describe('专项场景（虚构）', () => {
  it('本科专业「轮机工程」不会被改；硕士预计授予日期不冒充实际', async () => {
    const p = emptyProfile();
    p.education = [
      { id: 'b', enabled: true, school: { zh: '示例海事大学' }, degree: { zh: '学士' }, major: { zh: '轮机工程' }, start: '2019-09', end: '2023-06', actualConferralDate: '2023-06', highlights: [{ id: 'b-h1', zh: '轮机工程专业，主修船舶动力装置', status: { zh: 'manual' } }] },
      { id: 'm', enabled: true, school: { zh: '示例理工大学' }, degree: { zh: '硕士' }, major: { zh: '机器人工程' }, start: '2026-02', end: '2027-01', expectedConferralDate: '2027-01', highlights: [{ id: 'm-h1', zh: '预计2027年1月左右授予硕士学位', status: { zh: 'manual' } }] },
    ] as never;
    aiWith({ 轮机工程专业: '船舶与海洋工程专业，主修船舶动力装置', 预计: '2027年1月获得硕士学位' });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.filter((x) => x.source === 'ai').every((x) => x.risk === 'high')).toBe(true);
    const out = applyOrganize(p, plan, safe(plan));
    expect(out.education[0].major.zh).toBe('轮机工程');
    expect(out.education[0].highlights[0].zh).toContain('轮机工程');
    expect(out.education[1].expectedConferralDate).toBe('2027-01'); expect(out.education[1].actualConferralDate ?? '').toBe('');
    expect(out.education[1].highlights[0].zh).toContain('预计');
  });
  it('「实际职责以本人能核对的操作范围为准」→ notes，不作为简历要点', async () => {
    const p = one('参与产线设备巡检。实际职责以本人能核对的操作范围为准。');
    const plan = await planOrganize(S, p, { useAi: false });
    const out = applyOrganize(p, plan, safe(plan));
    expect(textOf(out)).toBe('参与产线设备巡检。');
    expect(JSON.stringify((out.work[0] as unknown as { notes: string[] }).notes)).toContain('实际职责以本人能核对的操作范围为准');
  });
  it('课程项目不变商业交付、实习不变全职、参与开发不变独立开发（本地规则 + AI 都不会默认写入）', async () => {
    const p = one('我在课程实验中参与开发机器人仿真程序', 'zh', { section: 'projects' });
    aiWith({ 课程实验: '独立开发商业机器人仿真程序并交付客户' });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.some((x) => x.source === 'ai')).toBe(false);
    const r = plan.rejectedItems![0]; expect(r.reasons.join()).toMatch(/商业/); expect(r.reasons.join()).toMatch(/参与程度|独立/);
    expect(textOf(applyOrganize(p, plan, safe(plan)))).toBe('在课程实验中参与开发机器人仿真程序');
  });
  it('工具函数：覆盖率与语义类别', () => {
    expect(coverage('在公司使用设备测试', '使用设备测试', 'zh').missing).toEqual(['在公司']);
    expect(coverage('在公司使用设备进行测试', '在公司使用设备测试', 'zh').missing).toEqual([]);
    expect(semanticFlags('协助维护设备', '负责维护设备', 'zh').join()).toMatch(/协助 → 负责/);
    expect(semanticFlags('参与三人团队完成设计', '独立完成设计', 'zh').join()).toMatch(/独立/);
  });
});

import { flagStale } from '../src/ai/generate';
describe('过期译文不静默用于生成', () => {
  it('资料库英文为 stale 时，生成条目标为需核对', () => {
    const p = one('在公司使用设备测试'); p.work[0].bullets[0] = { id: 'x-b1', zh: '在公司使用设备测试', en: 'Tested equipment', status: { zh: 'manual', en: 'stale' } } as never;
    const r = flagStale(p, { id: 'r', jobId: 'j', templateId: 't', primaryLanguage: 'zh', items: [{ sourceId: 'x-b1', zh: '在公司使用设备测试', en: 'Tested equipment', syncStatus: 'in-sync' }] } as never);
    expect(r.items[0].syncStatus).toBe('needs-review');
    expect(r.items[0].translation?.factIssues.join()).toContain('已过期');
  });
});

import { numberTokens } from '../src/ai/consistency';
it('版本号 v1 与「第1版」视为同一数字', () => { expect(numberTokens('Designed fixture v1')).toEqual(numberTokens('第1版')); });

import { crossCheck } from '../src/quality/factCheck';
// v1.9.2 英文译文交叉核对：AI 重新机翻英文时，数字一致不代表事实一致
function trans(zh: string, oldEn: string, opt?: Parameters<typeof one>[2]) {
  const p = one(zh, 'zh', opt); const e = (p.work[0] ?? p.projects[0] ?? p.education[0]) as unknown as { bullets?: Record<string, unknown>[]; highlights?: Record<string, unknown>[] };
  const b = (e.bullets ?? e.highlights)![0]; b.en = oldEn; b.status = { zh: 'manual', en: 'stale' }; return p;
}
const enAi = (en: string) => aiWith({}, (x) => ({ key: x.key, category: 'resume', zh: x.zh, en }));
const TRANS: [string, string, RegExp, Parameters<typeof one>[2]?][] = [
  ['协助维护自动化生产设备', 'Led the maintenance of automated production equipment', /参与程度/],
  ['参与开发数据采集软件', 'Independently developed data acquisition software', /参与程度|独立/],
  ['预计2027年1月授予硕士学位', "Master's degree awarded in January 2027", /预计|已授予/, { section: 'education' }],
  ['在公司使用设备测试', 'Tested equipment', /公司/],
  ['在示例测控公司实习期间参与设备测试', 'Participated in equipment testing during full-time employment at the company', /实习|全职/],
  ['项目尚未完成', 'Completed the project', /否定|未完成/, { section: 'projects', nature: '个人项目' }],
];
describe('英文译文交叉核对', () => {
  for (const [zh, bad, why, opt] of TRANS) it(`译文待核对：${zh} → ${bad}`, async () => {
    const p = trans(zh, 'old machine text', opt); enAi(bad);
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.some((x) => x.source === 'ai' && (x.after as Record<string, string>).en === bad)).toBe(false);
    const r = plan.rejectedItems![0].reasons.join(); expect(r).toMatch(/译文待核对/); expect(r).toMatch(why);
    const out = applyOrganize(p, plan, safe(plan)); expect(textOf(out, 'en')).toBe('old machine text'); expect(textOf(out)).toBe(zh);
  });
  it('正确译文仍为 A 类', async () => {
    const p = trans('协助维护自动化生产设备', ''); enAi('Assisted in maintaining automated production equipment');
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.filter((x) => x.kind !== 'field').every((x) => x.risk === 'safe')).toBe(true);
    expect(textOf(applyOrganize(p, plan, safe(plan)), 'en')).toBe('Assisted in maintaining automated production equipment');
    expect(crossCheck('预计2027年1月授予硕士学位', "Master's degree expected in January 2027")).toEqual([]);
    expect(crossCheck('在公司使用设备进行第1轮测试', 'Used equipment for test round 1 at the company')).toEqual([]);
  });
  it('英文有风险时中文安全清洗照常写入', async () => {
    const p = trans('我协助维护自动化生产设备。实际职责以本人核实为准。', 'old machine text'); enAi('Led the maintenance of automated production equipment');
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.stats?.rejected).toBe(1);
    const out = applyOrganize(p, plan, safe(plan));
    expect(textOf(out)).toBe('协助维护自动化生产设备。'); expect(textOf(out, 'en')).toBe('old machine text');
    expect(JSON.stringify(out.work[0].notes)).toContain('以本人核实为准');
  });
});
