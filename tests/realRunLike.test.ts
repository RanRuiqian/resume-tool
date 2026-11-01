// v1.9.3 整理可用性回归：模仿真实整理（约 65 条），模拟 AI 的各种坏习惯；统计五类结果并检查事实完整性
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import { applyOrganize, planOrganize } from '../src/quality/organize';
import { crossCheck, lossReport } from '../src/quality/factCheck';
import { realRunLike, badAi, KEY_FACTS, CASE_A, CASE_B, CASE_C, CASE_D, KFC } from './helpers/realRunLike';
import type { Settings } from '../src/types';

const S = { demoMode: false, baseUrl: 'https://api.deepseek.com', apiKey: 'sk-FAKE-rrl', model: 'deepseek-flash' } as unknown as Settings;
const mock = chatJson as unknown as ReturnType<typeof vi.fn>;
mock.mockImplementation(async (...args: unknown[]) => { if (!args[1]) return { items: [] }; const c = (args[1] as { content: string }[])[1].content; return { items: badAi(JSON.parse(c.slice(c.lastIndexOf('{"items"'))).items) }; });
const all = (p: ProfileDoc0) => p.projects.flatMap((e) => e.bullets);
type ProfileDoc0 = ReturnType<typeof realRunLike>;

describe('真实整理相似数据集（虚构）', () => {
  it('统计、事实完整性、中英一致', async () => {
    const p = realRunLike(); const before = all(p);
    const plan = await planOrganize(S, p, { useAi: true });
    const st = plan.stats!; const high = plan.proposals.filter((x) => x.risk === 'high').length;
    console.log('v1.9.3 统计', JSON.stringify({ ...st, aiCalls: plan.aiCalls, aiItems: plan.aiItems, safeProposals: plan.proposals.filter((x) => x.risk === 'safe').length, highProposals: high }));
    expect(st.total).toBe(65);
    expect(st.unchanged).toBeGreaterThanOrEqual(30); // 干净条目一律不动
    expect(st.metaCleaned).toBe(15); expect(st.review).toBeLessThanOrEqual(2);
    expect(st.rejected).toBeGreaterThanOrEqual(2); // 重试后仍丢事实 → 拒绝
    const out = applyOrganize(p, plan, new Set(plan.proposals.filter((x) => x.risk === 'safe').map((x) => x.id)));
    const after = all(out); const txt = after.map((x) => x.zh).join('\n');
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id)); // 没有删除任何条目
    for (const k of KEY_FACTS) expect(txt, `关键事实「${k}」必须保留`).toContain(k);
    expect(txt).not.toMatch(/实际职责以本人核实为准|产品成本仅|实现了可变焦/);
    for (const x of [CASE_A, CASE_B, CASE_C, CASE_D]) expect(after.filter((y) => y.zh === x).length, x).toBe(2); // 干净版不动 + 脏版只去说明句
    expect(after.filter((y) => y.zh === KFC).length).toBe(1);
    // 信息完整性：每条整理后的中文覆盖原文全部非说明内容
    after.forEach((y, i) => { const loc = before[i].zh.replace('实际职责以本人核实为准。', '').replace(/^我/, ''); expect(lossReport(loc, y.zh, 'zh'), y.zh).toEqual([]); });
    // 中英一致：所有新写入的英文都通过交叉核对；错误译文（协助 → Led）没有写入
    for (const y of after) if (y.en && y.status?.en === 'machine' && !/^(Machine|Old) translation/.test(y.en)) expect(crossCheck(y.zh, y.en), `${y.zh} ↔ ${y.en}`).toEqual([]);
    expect(after.some((y) => /^Led /.test(y.en ?? ''))).toBe(false);
    // 重试：首轮丢事实的条目被反馈重试（请求里带 lostFacts）
    expect(mock.mock.calls.some((c) => (c[1] as { content: string }[])[1].content.includes('lostFacts'))).toBe(true);
  });
});

describe('案例 A–D 与「曾」（中英文）', () => {
  const zh: [string, string, RegExp][] = [
    [CASE_A, '完成项目交付成果：硬件原型、Windows 软件和技术报告。', /并列成果|展示照片/],
    [CASE_B, '产品成本仅22美元。', /估算|不代表|仅/],
    [CASE_C, '历史平均分约77/100，GPA约2.7/4.0。', /估算|非官方|并非/],
    [CASE_D, '与示例医院医生实现可变焦功能。', /讨论|实现/],
  ];
  for (const [a, bad, why] of zh) it(`中文：${a.slice(0, 12)}… → ${bad}`, () => expect(lossReport(a, bad, 'zh').join()).toMatch(why));
  const en: [string, string, RegExp][] = [
    ['Delivered a hardware prototype, Windows software, demo photos, a video, a full demo, a GitHub repository and a technical report.', 'Delivered a hardware prototype, Windows software and a technical report.', /并列成果|photos|video/],
    ['The estimated core material cost of the prototype was about USD 22, which does not represent a validated mass-production cost or retail price.', 'Product cost was only USD 22.', /估算|only|estimated/],
    ['Historical average about 77/100 and GPA about 2.7/4.0, a historical estimate and not an official transcript calculation.', 'Average 77/100, GPA 2.7/4.0.', /估算|about|official/],
    ['Discussed variable-focus requirements with doctors; not yet implemented.', 'Implemented variable-focus function.', /讨论|implement/],
  ];
  for (const [a, bad, why] of en) it(`英文：${a.slice(0, 20)}… → ${bad}`, () => expect(lossReport(a, bad, 'en').join()).toMatch(why));
  it('中英交叉：估算 / 非官方 / 讨论 vs 实现', () => {
    expect(crossCheck(CASE_B, 'Product cost was USD 22.').join()).toMatch(/估算|不代表/);
    expect(crossCheck(CASE_C, 'Average 77/100, GPA 2.7/4.0.').join()).toMatch(/估算|非官方/);
    expect(crossCheck(CASE_D, 'Implemented variable focus with hospital doctors.').join()).toMatch(/讨论|未完成|否定/);
    expect(crossCheck(CASE_B, 'Estimated core material cost of the prototype was about USD 22; this does not represent a validated mass-production cost or retail price.')).toEqual([]);
  });
  it('只删「曾」：不产生任何建议（无需修改），也不送 AI', async () => {
    const p = realRunLike(); p.projects = [{ ...p.projects[0], bullets: [{ id: 'k', zh: KFC, en: 'Worked part-time at KFC during undergraduate studies.', status: { zh: 'manual', en: 'machine' } }] }] as never; mock.mockClear();
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.length).toBe(0); expect(mock).not.toHaveBeenCalled(); expect(plan.stats?.unchanged).toBe(1);
  });
  it('带说明句的「曾」条目：AI 只删了「曾」→ 视为无价值，不产生 B，只做本地清洗', async () => {
    const p = realRunLike(); p.projects = [{ ...p.projects[0], bullets: [{ id: 'k', zh: `${KFC}以上信息仅供参考。`, status: { zh: 'manual' } }] }] as never;
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.filter((x) => x.risk === 'high').length).toBe(0);
    expect(applyOrganize(p, plan, new Set(plan.proposals.map((x) => x.id))).projects[0].bullets[0].zh).toBe(KFC);
  });
  it('限定句是事实，不会被当作说明移入备注', async () => {
    const p = realRunLike(); p.projects = [{ ...p.projects[0], bullets: [CASE_B, CASE_C, CASE_D].map((zh, i) => ({ id: `q${i}`, zh, status: { zh: 'manual' } })) }] as never;
    const plan = await planOrganize(S, p, { useAi: false }); expect(plan.proposals.length).toBe(0);
  });
});
