import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import type { GenItem, Settings } from '../src/types';
import { generateResume, generateRules, localizeAi } from '../src/ai/generate';
import { personalFixture, personalPlan } from './helpers/v112PersonalFixture';
import { jobs } from './helpers/v110Fixture';
import { fixedSummaryItem } from '../src/ai/fixedSummary';
import { planWithAi, selectionBrief, validateAiSelection } from '../src/ai/aiPlanner';
import { fitContent, estimateUsage, pageBudget } from '../src/ai/contentStrategy';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { buildLayout } from '../src/render/layout';
import { inferWorkKind } from '../src/render/classify';
import { sourceText } from '../src/ai/provenance';
import { auditResume, applyDecision } from '../src/audit/factAudit';
import { toggleBullet, toggleEntry, toggleSummary } from '../src/ai/selection';
import { translateProfile } from '../src/ai/translate';
import { fitTemplate } from '../src/export/fit';
import { tidyProjectTitle } from '../src/render/resumeText';
import { crossCheck } from '../src/quality/factCheck';

const api = vi.mocked(chatJson);
const settings = { demoMode: false, model: 'mock-model', provider: 'custom', apiKey: 'FAKE-TEST-ONLY' } as Settings;
beforeEach(() => { api.mockReset(); });

function mockGeneration(plan = personalPlan(), writing?: { items: { sourceId: string; sourceIds?: string[]; text: string }[] }) {
  const p = personalFixture();
  let call = 0;
  api.mockImplementation(async (_s, msgs) => {
    call++;
    if (call === 1) return plan;
    const payload = JSON.parse(String(msgs.at(-1)!.content).split('\n\n').at(-1)!);
    if (call === 2) return writing ?? { items: payload.facts.map((x: { sourceId: string; text: string }) => ({ sourceId: x.sourceId, text: x.text })) };
    return { items: payload.items.map((x: { sourceId: string; sourceIds?: string[] }) => ({ sourceId: x.sourceId, text: sourceText(p, x)[String(msgs.at(-1)!.content).includes('为中文副版本') ? 'zh' : 'en'] })) };
  });
}
const template = () => structuredClone(BUILTIN_TEMPLATES[0]);
const summaryOf = (items: GenItem[]) => items.find((i) => i.sourceId === 'summary');

describe('A: fixed bilingual personal introduction', () => {
  it('uses exactly the same approved text across two JDs, ignores AI summary and never sends it for rewriting', async () => {
    const p = personalFixture(), before = structuredClone(p);
    mockGeneration(undefined, { items: [{ sourceId: 'summary', text: 'AI should never replace the identity' }] });
    const a = await generateResume(settings, p, jobs().A, 'zh', 1);
    mockGeneration();
    const b = await generateResume(settings, p, jobs().B, 'en', 1);
    for (const r of [a, b]) {
      expect(summaryOf(r.items)).toMatchObject({ zh: p.profile.summary.zh, en: p.profile.summary.en });
      expect(buildLayout(p, template(), 'en', r).main.concat(buildLayout(p, template(), 'en', r).side).find((x) => x.key === 'summary')!.blocks[0].text).toBe(p.profile.summary.en);
    }
    const sent = JSON.stringify(api.mock.calls);
    expect(sent).not.toContain(p.profile.summary.zh);
    const planningPayload = JSON.parse(String(api.mock.calls[0][1][1].content).split('\n\n').at(-1)!);
    expect(planningPayload.candidate).not.toHaveProperty('summaryOriginal');
    const writingPayload = JSON.parse(String(api.mock.calls[1][1][1].content).split('\n\n').at(-1)!);
    expect(writingPayload).not.toHaveProperty('summaryOriginal');
    expect(writingPayload).not.toHaveProperty('summaryFocus');
    expect(p).toEqual(before);
  });

  it('does not modify stored summaries when the profile changes or planning fails', async () => {
    const p = personalFixture(), old = generateRules(p, jobs().A, 'zh');
    const saved = structuredClone(old);
    p.profile.summary.zh = '用户后续手动修改的新简介。';
    api.mockRejectedValue(new Error('mock planner failure'));
    await expect(generateResume(settings, p, jobs().B, 'zh', 1)).rejects.toThrow('mock planner failure');
    expect(old).toEqual(saved);
    expect(summaryOf(old.items)!.zh).not.toBe(p.profile.summary.zh);
    expect(buildLayout(p, template(), 'zh', old).main.find((x) => x.key === 'summary')!.blocks[0].text).toBe(saved.items[0].zh);
    expect(fixedSummaryItem(p)!.zh).toBe(p.profile.summary.zh);
  });

  it('preserves saved unconfirmed summary text with review status and never silently retranslates it', async () => {
    const p = personalFixture(); p.profile.summary.status!.en = 'machine';
    const r = generateRules(p, jobs().A, 'zh');
    expect(summaryOf(r.items)!.en).toBe(p.profile.summary.en);
    expect(summaryOf(r.items)!.syncStatus).toBe('needs-review');
    expect(buildLayout(p, template(), 'en', r).main.some((x) => x.key === 'summary')).toBe(true);
    api.mockResolvedValue({ items: [] });
    const localized = await localizeAi(settings, p, jobs().A, r);
    expect(summaryOf(localized.items)!.en).toBe(p.profile.summary.en);
    expect(JSON.stringify(api.mock.calls)).not.toContain('"sourceId":"summary"');
    expect(r.notes!.join()).toContain('固定简介英文待确认');
  });

  it('bulk profile translation excludes the fixed summary; only explicit review can save a suggestion', async () => {
    const p = personalFixture(); p.profile.summary.en = ''; const before = structuredClone(p.profile.summary);
    api.mockResolvedValue({ items: [] });
    const result = await translateProfile(settings, p, 'en');
    expect(result.profile.profile.summary).toEqual(before);
    expect(JSON.stringify(api.mock.calls)).not.toContain(p.profile.summary.zh);
  });

  it('recognizes 大学 / University as the same school concept while still flagging a one-sided school claim', () => {
    expect(crossCheck('目前就读于虚构工程大学。', 'Currently studying at Fictional Engineering University.')).toEqual([]);
    expect(crossCheck('目前具有工程实践背景。', 'Currently studying at Fictional Engineering University.').join()).toContain('学校 / 校内');
    expect(crossCheck('已完成测试。', 'Currently testing.').join()).toContain('进行中');
  });
});

describe('B/C: professional and student background, no keyword exclusion', () => {
  it('keeps production work and adds a useful student organization when there is space, leaving a generic retail job out', async () => {
    const p = personalFixture(), before = structuredClone(p);
    mockGeneration();
    const r = await generateResume(settings, p, jobs().B, 'zh', 1, undefined, { template: template() });
    expect(r.selection.work).toContain('career');
    expect(r.selection.work).toContain('student');
    expect(r.selection.work).not.toContain('shop');
    expect(r.items.filter((i) => i.sourceId.startsWith('student'))).toHaveLength(1);
    const all = r.items.map((i) => i.zh).join('\n');
    expect(all).not.toMatch(/BOM|机械臂维修|设备调试|生产线设计|100 人/);
    expect(p).toEqual(before);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('requires a reason rather than silently dropping all professional background', () => {
    const plan = personalPlan(); plan.entries = plan.entries!.filter((e) => e.entryId !== 'career');
    expect(() => validateAiSelection(plan, personalFixture(), jobs().A, 'zh', 1)).toThrow('工作');
    plan.omissions = { professionalWork: '此次岗位材料限制较严，优先展示对应技术项目；用户可补选生产实践' };
    const result = validateAiSelection(plan, personalFixture(), jobs().A, 'zh', 1);
    expect(result.omissions.professionalWork).toContain('生产实践');
  });

  it('can restore an omitted professional background through the existing one-round local repair', async () => {
    const original = personalPlan(); original.entries = original.entries!.filter((x) => x.entryId !== 'career');
    api.mockResolvedValueOnce(original).mockResolvedValueOnce({ repairs: [{ path: '/entries', value: personalPlan().entries }] });
    const result = await planWithAi(settings, personalFixture(), jobs().B, 'zh', 1);
    expect(result.plan.entries.some((x) => x.id === 'career')).toBe(true);
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[1][1][2]).toEqual({ role: 'assistant', content: JSON.stringify(original) });
  });

  it('never changes old unspecified work kinds or includes disabled experiences', () => {
    const p = personalFixture(); delete p.work[1].kind;
    expect(inferWorkKind(p.work[1])).toBe('club');
    expect(selectionBrief(p, jobs().A, 'zh', 1).candidate.work.find((x) => x.entryId === 'student')!.kind).toBe('club');
    expect(p.work[1].kind).toBeUndefined();
    p.work[0].enabled = false;
    expect(() => validateAiSelection(personalPlan(), p, jobs().A, 'zh', 1)).toThrow('career');
  });

  it('validates reserve sources with the same exact ID and parent checks', () => {
    const plan = personalPlan(); plan.reserveEntries![0].bulletIds = ['core-b1'];
    expect(() => validateAiSelection(plan, personalFixture(), jobs().A, 'zh', 1)).toThrow('不属于经历 student');
  });

  it('rolls back background reserves on measured overflow, keeps fixed summary and core work, and makes no extra model call', async () => {
    const p = personalFixture(); mockGeneration();
    const measure = vi.fn().mockResolvedValueOnce({ zh: { pages: 2 }, en: { pages: 2 } }).mockResolvedValueOnce({ zh: { pages: 1 }, en: { pages: 1 } });
    const r = await generateResume(settings, p, jobs().A, 'zh', 1, undefined, { template: template(), measure });
    expect(r.selection.work).toContain('career'); expect(r.selection.work).not.toContain('student');
    expect(summaryOf(r.items)!.zh).toBe(p.profile.summary.zh);
    expect(r.notes!.join()).toContain('撤回候补');
    expect(measure).toHaveBeenCalledTimes(2); expect(api).toHaveBeenCalledTimes(3);
  });
});

describe('D/F: professional expression with complete source tracing', () => {
  const expression = '课程项目中参与光学探头模块化结构设计、尺寸测量与原型装配，完成成像测试。';
  it('allows a grounded same-project synthesis, audits both originals and restores both', async () => {
    const p = personalFixture(); mockGeneration(undefined, { items: [{ sourceId: 'core-b1', sourceIds: ['core-b1', 'core-b2'], text: expression }] });
    const r = await generateResume(settings, p, jobs().A, 'zh', 1);
    const item = r.items.find((x) => x.sourceId === 'core-b1')!;
    expect(item.zh).toBe(expression); expect(item.sourceIds).toEqual(['core-b1', 'core-b2']);
    expect(r.items.some((x) => x.sourceId === 'core-b2')).toBe(false);
    const audit = auditResume(p, r).items.find((x) => x.sourceId === item.sourceId)!;
    expect(audit.zh.original).toContain(p.projects[0].bullets[0].zh);
    expect(audit.zh.original).toContain(p.projects[0].bullets[1].zh);
    const restored = applyDecision(p, r, item.sourceId, 'zh', 'restored');
    expect(restored.items.find((x) => x.sourceId === item.sourceId)!.zh).toBe(p.projects[0].bullets.map((x) => x.zh).join('\n'));
    const off = toggleBullet(p, r, 'projects', 'core', p.projects[0].bullets[1], false);
    expect(off.items.find((x) => x.sourceId === 'core-b1')!.zh).toBe(p.projects[0].bullets[0].zh);
    expect(off.items.some((x) => x.sourceId === 'core-b2')).toBe(false);
    expect(toggleEntry(p, r, 'projects', 'core', false).items.some((x) => x.sourceId.startsWith('core'))).toBe(false);
  });

  it.each([
    ['跨经历', ['core-b1', 'career-b1']],
    ['伪造来源', ['core-b1', 'invented-fact']],
    ['未选来源', ['core-b1', 'shop-b1']],
    ['重复来源', ['core-b1', 'core-b1']],
    ['主来源缺失', ['core-b2']],
  ])('rejects %s rather than approving a professional-sounding false attribution', async (_label, sourceIds) => {
    mockGeneration(undefined, { items: [{ sourceId: 'core-b1', sourceIds, text: '主导企业生产部署，效率提升 50%。' }] });
    const r = await generateResume(settings, personalFixture(), jobs().A, 'zh', 1);
    expect(r.items.map((x) => x.zh).join()).not.toContain('50%');
    expect(r.items.find((x) => x.sourceId === 'core-b1')!.zh).toContain('参与');
    expect(r.notes!.join()).toContain('来源组无效');
  });

  it('rejects role inflation and invented results even with valid source IDs, then safely repairs or falls back', async () => {
    const p = personalFixture(); let count = 0;
    api.mockImplementation(async (_s, msgs) => {
      count++;
      if (count === 1) return personalPlan();
      if (count <= 3) return { items: [{ sourceId: 'core-b1', sourceIds: ['core-b1', 'core-b2'], text: '独立主导商业产品开发并部署到工厂，效率提升 50%。' }] };
      const payload = JSON.parse(String(msgs.at(-1)!.content).split('\n\n').at(-1)!);
      return { items: payload.items.map((x: { sourceId: string; sourceIds?: string[] }) => ({ sourceId: x.sourceId, text: sourceText(p, x)[String(msgs.at(-1)!.content).includes('为中文副版本') ? 'zh' : 'en'] })) };
    });
    const r = await generateResume(settings, p, jobs().A, 'zh', 1);
    expect(r.items.map((x) => x.zh).join()).not.toMatch(/独立主导|50%|商业产品/);
    expect(r.items.find((x) => x.sourceId === 'core-b1')!.zh).toContain('课程项目中参与');
    expect(r.notes!.join()).toContain('事实护栏');
  });

  it('lets the same facts emphasize mechanical design or vision testing without inventing technologies', async () => {
    const p = personalFixture();
    mockGeneration(undefined, { items: [{ sourceId: 'core-b1', sourceIds: ['core-b1', 'core-b2'], text: expression }] });
    const mechanical = await generateResume(settings, p, jobs().A, 'zh', 1);
    const visualText = '课程项目中参与成像测试相关的原型装配及模块化外壳设计，完成成像测试。';
    mockGeneration(undefined, { items: [{ sourceId: 'core-b1', sourceIds: ['core-b1', 'core-b2'], text: visualText }] });
    const visual = await generateResume(settings, p, jobs().B, 'zh', 1);
    expect(mechanical.items.find((x) => x.sourceId === 'core-b1')!.zh).toBe(expression);
    expect(visual.items.find((x) => x.sourceId === 'core-b1')!.zh).toBe(visualText);
    expect(visual.items.map((x) => x.zh).join()).not.toMatch(/NX|ROS|50%/);
  });

  it('keeps demo and manual summary toggles usable without changing the master profile', async () => {
    const p = personalFixture(), before = structuredClone(p);
    const r = await generateResume({ ...settings, demoMode: true }, p, jobs().A, 'zh', 1);
    const off = toggleSummary(p, r, false), on = toggleSummary(p, off, true);
    expect(summaryOf(on.items)!.zh).toBe(p.profile.summary.zh);
    expect(r.generatedBy).toBe('rules'); expect(p).toEqual(before); expect(api).not.toHaveBeenCalled();
  });
});

describe('E: layout advice, readability and English cleanup', () => {
  it('preserves legacy bullet order while new resumes follow AI-selected order', () => {
    const p = personalFixture(), r = generateRules(p, jobs().A, 'zh');
    r.selection.projects = ['core'];
    r.items = [...p.projects[0].bullets].reverse().map((b) => ({ sourceId: b.id!, zh: b.zh!, en: b.en!, syncStatus: 'in-sync' }));
    const bullets = () => buildLayout(p, template(), 'zh', r).main.find((s) => s.key === 'projects')!.blocks[0].bullets;
    expect(bullets()).toEqual(p.projects[0].bullets.map((b) => b.zh));
    r.layoutPolicy = 'readable';
    expect(bullets()).toEqual([...p.projects[0].bullets].reverse().map((b) => b.zh));
  });

  it('derives advice from page/font/spacing settings instead of enforcing eight bullets', () => {
    const t = template(), one = pageBudget(1, 'zh', t);
    t.locales.zh.typography.bodySizePt += 3;
    expect(pageBudget(1, 'zh', t).availableLines).toBeLessThan(one.availableLines);
    expect(pageBudget(2, 'zh', t).softFactTarget).toBeGreaterThan(pageBudget(1, 'zh', t).softFactTarget);
    const fitted = fitTemplate(t, 'zh', 6, true);
    expect(fitted.locales.zh.typography.bodySizePt).toBe(t.locales.zh.typography.bodySizePt);
    expect(fitted.locales.zh.typography.lineHeight).toBe(t.locales.zh.typography.lineHeight);
  });

  it('uses larger layouts for richer content, reports sparse and missing sections without filler', async () => {
    const p = personalFixture(), sparse = generateRules(p, jobs().A, 'zh');
    sparse.items = sparse.items.filter((x) => x.sourceId === 'summary');
    sparse.selection = { work: [], projects: [], education: ['edu-1'], skills: [], certificates: [], awards: [] };
    const result = await fitContent(p, sparse, [], {}, { template: template() });
    expect(result.notes!.join()).toContain('内容较少');
    expect(result.notes!.join()).toContain('专业工作 / 实习未展示');
    expect(result.items).toEqual(sparse.items);
    expect(estimateUsage(p, template(), sparse)).toBeGreaterThan(0);
  });

  it('removes only adjacent identical project-title words and never changes master data', () => {
    const t = 'Advanced Robotics in Manufacturing Manufacturing Simulation Course Practice';
    expect(tidyProjectTitle(t, 'en')).toBe('Advanced Robotics in Manufacturing Simulation Course Practice');
    expect(tidyProjectTitle('Measurement and Manufacturing Simulation', 'en')).toBe('Measurement and Manufacturing Simulation');
    expect(tidyProjectTitle('模拟 模拟', 'zh')).toBe('模拟 模拟');
  });
});
