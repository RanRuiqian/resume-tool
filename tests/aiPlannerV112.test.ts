import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import type { ProfileDoc, Settings } from '../src/types';
import { fictionalEngineer, jobs } from './helpers/v110Fixture';
import { AiSelectionValidationError, decisionModel, planWithAi, selectionBrief, validateAiSelection } from '../src/ai/aiPlanner';
import { generateResume } from '../src/ai/generate';
import { generateCoverKit, generatePrep } from '../src/ai/extras';
import { generateRules } from '../src/ai/generate';
import { parseJdAi } from '../src/ai/jd';
import { resumeSkillCategory } from '../src/render/layout';

const api = chatJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => api.mockReset());
const J = jobs().A;
const S = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'MOCK-KEY', model: 'deepseek-flash', demoMode: false } as unknown as Settings;

const library = (): ProfileDoc => {
  const p = fictionalEngineer();
  p.projects.push({
    id: 'proj-hyd', enabled: true, kind: 'core', nature: '本科毕业设计',
    name: { zh: '虚构液压系统毕业设计', en: 'Fictional Hydraulic Capstone' },
    role: { zh: '本科学生', en: 'Undergraduate student' }, start: '2025-09', end: '2026-05', tags: [],
    bullets: [{ id: 'proj-hyd-b1', zh: '本科毕业设计中使用 AMESim 建立液压溢流阀仿真模型，分析不同弹簧刚度下的响应。',
      en: 'Used AMESim in an undergraduate capstone to model a hydraulic relief valve and analyse spring stiffness.' }],
    dossier: { methods: 'AMESim 仿真', technicalWork: '本科毕业设计的模型参数比较' },
  });
  p.work.push({ id: 'work-empty', enabled: true, company: { zh: '虚构兼职商店', en: 'Fictional Store' },
    title: { zh: '兼职', en: 'Part-time' }, start: '', end: '', bullets: [], tags: [] });
  return p;
};

const proposal = () => ({
  requirements: [
    { text: '机械建模与验证', tier: 'must', assessment: 'direct', evidenceIds: ['work-1-b1', 'proj-hyd-b1'] },
    { text: '特定软件 NX', tier: 'preferred', assessment: 'gap', evidenceIds: [] },
  ],
  entries: [
    { entryId: 'work-1', bulletIds: ['work-1-b1'], reason: '支架结构设计' },
    { entryId: 'proj-hyd', bulletIds: ['proj-hyd-b1'], reason: '仿真毕设' },
  ],
  education: [{ entryId: 'edu-1', bulletIds: [] }],
  skills: ['sk-1'], certificates: ['cert-1'], awards: [],
  summaryFocus: '结构设计、工程建模', tradeoffs: '不写无关课外活动',
});

describe('v1.12 AI-owned semantic selection and provenance', () => {
  it('sends every eligible project (including capstone) to AI, without photos, contacts or empty jobs', () => {
    const brief = selectionBrief(library(), J, 'zh', 1);
    expect(brief.candidate.projects.map((x) => x.entryId)).toContain('proj-hyd');
    expect(brief.candidate.work.map((x) => x.entryId)).not.toContain('work-empty');
    expect(brief.candidate.education[0].facts.map((x) => x.sourceId)).not.toContain('edu-1-b1');
    expect(JSON.stringify(brief)).not.toContain('lin.xz@example.com');
  });

  it('accepts AI chosen semantic evidence and retains exact source IDs despite local keyword ranking', () => {
    const p = library();
    const r = validateAiSelection(proposal(), p, J, 'zh', 1);
    expect(r.plan.entries.filter((x) => x.kind === 'projects').map((x) => x.id)).toEqual(['proj-hyd']);
    expect(r.plan.entries.filter((x) => x.kind === 'work').map((x) => x.id)).toEqual(['work-1']);
    expect(r.plan.entries.some((x) => x.id === 'work-empty')).toBe(false);
    expect(r.gaps).toEqual(['特定软件 NX']);
    expect(r.matchScore).toBe(75);
    expect(r.plan.certificates).toContain('cert-1');
  });

  it('rejects fabricated / mismatched facts, zero-bullet roles and speculative GPA', () => {
    const p = library();
    const base = proposal();
    expect(() => validateAiSelection({ ...base, entries: [{ entryId: 'work-empty', bulletIds: [] }] }, p, J, 'zh', 1)).toThrow(/没有实际要点/);
    expect(() => validateAiSelection({ ...base, entries: [{ entryId: 'proj-hyd', bulletIds: ['work-1-b1'] }] }, p, J, 'zh', 1)).toThrow(/事实 ID/);
    expect(() => validateAiSelection({ ...base, education: [{ entryId: 'edu-1', bulletIds: ['edu-1-b1'] }] }, p, J, 'zh', 1)).toThrow(/未经确认/);
    expect(() => validateAiSelection({ ...base, skills: ['skill-NX-not-in-library'] }, p, J, 'zh', 1)).toThrow(/不存在/);
  });

  it('uses Pro + reasoning for decisive calls, with an explicit validation retry', async () => {
    api.mockResolvedValueOnce({ ...proposal(), entries: [{ entryId: 'missing', bulletIds: ['x'] }, proposal().entries[1]] });
    api.mockResolvedValueOnce({ repairs: [{ path: '/entries/0', value: proposal().entries[0] }] });
    const r = await planWithAi(S, library(), J, 'zh', 1);
    expect(r.plan.entries[1].id).toBe('proj-hyd');
    expect(api).toHaveBeenCalledTimes(2);
    for (const call of api.mock.calls) expect(call[2]).toMatchObject({ model: 'deepseek-v4-pro', thinking: 'enabled' });
    expect(decisionModel({ ...S, provider: 'custom', model: 'my-custom-model' })).toBe('my-custom-model');
  });

  it('builds the finished resume from AI-chosen entries, including a semantically relevant capstone', async () => {
    api.mockResolvedValueOnce(proposal());
    api.mockResolvedValueOnce({ items: [] });
    api.mockRejectedValueOnce(new Error('translation temporarily offline'));
    const r = await generateResume(S, library(), J, 'zh', 1);
    expect(r.generatedBy).toBe('ai');
    expect(r.selection.projects).toEqual(['proj-hyd']);
    expect(r.selection.work).toEqual(['work-1']);
    expect(r.items.some((it) => it.sourceId === 'proj-hyd-b1' && it.zh.includes('AMESim'))).toBe(true);
    expect(r.selection.work).not.toContain('work-empty');
    expect(r.matchScore).toBe(75);
    expect(api.mock.calls.slice(0, 2).every((call) => call[2].model === 'deepseek-v4-pro')).toBe(true);
  });

  it('never silently falls back to heuristic resume when AI planning fails', async () => {
    api.mockRejectedValueOnce(new Error('AI unavailable'));
    await expect(generateResume(S, library(), J, 'zh', 1)).rejects.toThrow('AI unavailable');
  });

  it('uses Pro for cover-letter decisions and the AI-selected resume evidence, not a new keyword shortlist', async () => {
    const p = library();
    const r = generateRules(p, J, 'zh');
    r.selection.work = [];
    r.selection.projects = ['proj-hyd'];
    r.items = [{ sourceId: 'proj-hyd-b1', zh: '使用 AMESim 分析液压系统。', en: '', syncStatus: 'needs-review' }];
    api.mockResolvedValueOnce({ coverLetter: { zh: '', en: '' }, selfIntro: { zh: '', en: '' } });
    await generateCoverKit(S, p, J, r, { maxAttempts: 1 });
    expect(api.mock.calls[0][2]).toMatchObject({ model: 'deepseek-v4-pro', thinking: 'enabled' });
    expect(api.mock.calls[0][1][1].content).toContain('重点经历（最多展开 1–2 段）：proj-hyd');
    expect(api.mock.calls[0][1][1].content).not.toContain('重点经历（最多展开 1–2 段）：work-1');
  });

  it('uses Pro reasoning for interview preparation while still requiring JD-verbatim citations', async () => {
    api.mockResolvedValueOnce({ items: [] });
    await generatePrep(S, J);
    expect(api.mock.calls[0][2]).toMatchObject({ model: 'deepseek-v4-pro', thinking: 'enabled' });
  });

  it('uses Pro reasoning to interpret the JD before resume matching', async () => {
    api.mockResolvedValueOnce({ company: { full: '虚构电机有限公司', short: '虚构电机' },
      title: { zh: '机械结构设计工程师', en: 'Mechanical Engineer' }, mustHave: [], niceToHave: [],
      keywords: [], responsibilities: [], summary: '机械结构设计' });
    const job = await parseJdAi(S, '虚构电机有限公司招聘机械结构设计工程师，负责结构设计');
    expect(job.title.zh).toBe('机械结构设计工程师');
    expect(api.mock.calls[0][2]).toMatchObject({ model: 'deepseek-v4-pro', thinking: 'enabled' });
  });

  it('keeps programming languages distinct from spoken language test results', () => {
    expect(resumeSkillCategory('语言', 'Python', 'zh')).toBe('编程 / 脚本');
    expect(resumeSkillCategory('Languages', 'C++', 'en')).toBe('Programming');
    expect(resumeSkillCategory('Languages', 'English', 'en')).toBe('Languages');
  });
});

describe('v1.12 evidence catalog and bounded local correction', () => {
  const requirementRepair = (evidenceIds: string[]) => ({ repairs: [{
    path: '/requirements/0', value: { ...proposal().requirements[0], evidenceIds },
  }] });
  const invalidProposal = () => ({ ...proposal(), requirements: [
    { ...proposal().requirements[0], evidenceIds: ['invented-fact', 'work-1'] },
    proposal().requirements[1],
  ] });

  it('derives the exact evidence whitelist from visible facts, skills, certificates and awards', () => {
    const p = library();
    p.projects[0].enabled = false;
    p.skills[1].enabled = false;
    p.certificates[1].enabled = false;
    p.awards[1].enabled = false;
    p.work[0].bullets.push({ id: 'blank-fact', zh: '  ', en: '' });
    const { candidate: c, allowedIds: a } = selectionBrief(p, J, 'zh', 1);
    const visible = [...c.work, ...c.projects, ...c.education].flatMap((x) => x.facts.map((f) => f.sourceId))
      .concat(c.education.map((x) => x.entryId), c.skills.map((x) => x.id), c.certificates.map((x) => x.id), c.awards.map((x) => x.id));
    expect(a.evidenceIds).toEqual(visible);
    for (const x of [...a.entries, ...a.education]) {
      expect(a.evidenceIds.includes(x.entryId)).toBe(a.educationEvidenceIds.includes(x.entryId));
      const source = [...c.work, ...c.projects, ...c.education].find((e) => e.entryId === x.entryId)!;
      expect(x.bulletIds).toEqual(source.facts.map((f) => f.sourceId));
    }
    // Every advertised evidence ID can actually be used by the validator.
    for (const id of a.evidenceIds) {
      const plan = proposal();
      plan.requirements[0].evidenceIds = [id];
      expect(() => validateAiSelection(plan, p, J, 'zh', 1)).not.toThrow();
    }
    for (const id of ['edu-1-b1', 'proj-1-b1', 'blank-fact', 'sk-2', 'cert-2', 'award-2', 'work-1', 'summary']) {
      expect(a.evidenceIds).not.toContain(id);
      const plan = proposal(); plan.requirements[0].evidenceIds = [id];
      expect(() => validateAiSelection(plan, p, J, 'zh', 1)).toThrow(id);
    }
  });

  it('reports all invalid evidence IDs with their exact requirement and grouping-ID hint', () => {
    const raw = invalidProposal();
    raw.requirements.push({ text: '虚构第二项要求', tier: 'must', assessment: 'direct', evidenceIds: ['missing-skill'] });
    try {
      validateAiSelection(raw, library(), J, 'zh', 1);
      expect.fail('invalid references must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(AiSelectionValidationError);
      const issues = (error as AiSelectionValidationError).issues;
      expect(issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '/requirements/0', requirementText: '机械建模与验证', invalidIds: ['invented-fact', 'work-1'] }),
        expect.objectContaining({ path: '/requirements/2', requirementText: '虚构第二项要求', invalidIds: ['missing-skill'] }),
      ]));
      expect((error as Error).message).toContain('经历分组 ID');
      expect((error as Error).message).toContain('missing-skill');
    }
  });

  it('sends the first plan, exact errors and same legal catalog for a single local repair', async () => {
    const p = library(), before = structuredClone(p), original = invalidProposal();
    api.mockResolvedValueOnce(original).mockResolvedValueOnce(requirementRepair(['proj-hyd-b1']));
    const progress: string[] = [];
    const result = await planWithAi(S, p, J, 'zh', 1, (x) => progress.push(x));
    expect(api).toHaveBeenCalledTimes(2);
    const first = api.mock.calls[0][1];
    expect(first[1].content).toContain('allowedIds.evidenceIds');
    const retry = api.mock.calls[1][1];
    expect(retry[2]).toEqual({ role: 'assistant', content: JSON.stringify(original) });
    const feedback = JSON.parse(retry[3].content.split('\n\n').at(-1));
    expect(feedback.allowedPaths).toEqual(['/requirements/0']);
    expect(feedback.allowedIds).toEqual(selectionBrief(p, J, 'zh', 1).allowedIds);
    expect(feedback.issues[0]).toMatchObject({ invalidIds: ['invented-fact', 'work-1'], requirementText: '机械建模与验证' });
    expect(result.requirements[0].evidenceIds).toEqual(['proj-hyd-b1']);
    expect(result.requirements[1]).toEqual(original.requirements[1]);
    expect(result.plan.entries.filter((x) => x.kind !== 'education').map((x) => [x.id, x.bulletIds]))
      .toEqual(original.entries.map((x) => [x.entryId, x.bulletIds]));
    expect(result.summaryFocus).toBe(original.summaryFocus);
    expect(original).toEqual(invalidProposal());
    expect(p).toEqual(before);
    expect(progress.some((x) => x.includes('正在选材'))).toBe(true);
    expect(progress.some((x) => x.includes('正在局部修复'))).toBe(true);
    expect(progress.at(-1)).toContain('整个方案已重新通过');
  });

  it('makes only one planning call when the initial plan is valid', async () => {
    api.mockResolvedValueOnce(proposal());
    await planWithAi(S, library(), J, 'zh', 1);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('repairs multiple invalid fields in one correction rather than paying for serial retries', async () => {
    const original = invalidProposal();
    original.skills = ['nonexistent-skill'];
    original.entries[1].bulletIds = ['proj-2-b1'];
    api.mockResolvedValueOnce(original).mockResolvedValueOnce({ repairs: [
      { path: '/skills', value: proposal().skills },
      { path: '/entries/1', value: proposal().entries[1] },
      requirementRepair(['proj-hyd-b1']).repairs[0],
    ] });
    const result = await planWithAi(S, library(), J, 'zh', 1);
    expect(result.plan.skills).toEqual(['sk-1']);
    expect(result.plan.entries[1].bulletIds).toEqual(['proj-hyd-b1']);
    expect(result.requirements[0].evidenceIds).toEqual(['proj-hyd-b1']);
    expect(api).toHaveBeenCalledTimes(2);
    const feedback = JSON.parse(api.mock.calls[1][1][3].content.split('\n\n').at(-1));
    expect(feedback.allowedPaths.sort()).toEqual(['/entries/1', '/requirements/0', '/skills']);
  });

  it('supports degree evidence through explicit education metadata, not invented highlight IDs', () => {
    const p = library(); p.education[0].highlights = [];
    const raw = proposal();
    raw.requirements[0] = { text: '相关专业本科学历（按预计授予状态）', tier: 'must', assessment: 'direct', evidenceIds: ['edu-1'] };
    const brief = selectionBrief(p, J, 'zh', 1);
    expect(brief.allowedIds.educationEvidenceIds).toEqual(['edu-1']);
    expect(brief.candidate.education[0].expectedConferralDate).toBe('2026-12');
    expect(validateAiSelection(raw, p, J, 'zh', 1).requirements[0].evidenceIds).toEqual(['edu-1']);
    raw.requirements[0].evidenceIds = ['edu-1-degree'];
    expect(() => validateAiSelection(raw, p, J, 'zh', 1)).toThrow('edu-1-degree');
  });

  it('lets AI remove an invalid duplicate without replacing it with an unrelated experience', async () => {
    const original = proposal(); original.entries.push({ ...original.entries[0] });
    api.mockResolvedValueOnce(original).mockResolvedValueOnce({ repairs: [{ path: '/entries/2', op: 'remove' }] });
    const result = await planWithAi(S, library(), J, 'zh', 1);
    expect(result.plan.entries.filter((x) => x.kind !== 'education').map((x) => x.id)).toEqual(['work-1', 'proj-hyd']);
    expect(original.entries).toHaveLength(3);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('applies multiple removals using original indices so valid choices stay intact', async () => {
    const original = proposal(); original.entries.push({ ...original.entries[0] }, { ...original.entries[1] });
    api.mockResolvedValueOnce(original).mockResolvedValueOnce({ repairs: [
      { path: '/entries/2', op: 'remove' }, { path: '/entries/3', op: 'remove' },
    ] });
    const result = await planWithAi(S, library(), J, 'zh', 1);
    expect(result.plan.entries.filter((x) => x.kind !== 'education').map((x) => x.id)).toEqual(['work-1', 'proj-hyd']);
  });

  it('rechecks the entire merged plan for newly duplicated entries', async () => {
    const original = proposal(); original.entries[1].bulletIds = ['missing-fact'];
    api.mockResolvedValueOnce(original).mockResolvedValueOnce({ repairs: [{ path: '/entries/1', value: proposal().entries[0] }] });
    await expect(planWithAi(S, library(), J, 'zh', 1)).rejects.toThrow(/重复的经历 ID/);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it.each(['text', 'tier'] as const)('forbids swapping the %s of a valid requirement to evade its evidence check', async (field) => {
    const response = requirementRepair(['proj-hyd-b1']);
    Object.assign(response.repairs[0].value, { [field]: field === 'text' ? '替换成容易满足的要求' : 'preferred' });
    api.mockResolvedValueOnce(invalidProposal()).mockResolvedValueOnce(response);
    await expect(planWithAi(S, library(), J, 'zh', 1)).rejects.toThrow('改换岗位要求或层级');
  });

  it('keeps per-entry and overall fact budgets enforced after a repair', async () => {
    const p = library(), raw = proposal();
    raw.entries = [{ entryId: 'work-1', bulletIds: p.work[0].bullets.map((x) => x.id!), reason: '' },
      ...p.projects.slice(0, 3).map((x) => ({ entryId: x.id, bulletIds: x.bullets.map((b) => b.id!), reason: '' }))];
    expect(() => validateAiSelection(raw, p, J, 'zh', 1)).toThrow('超过目标页数允许的 8 条');
    api.mockResolvedValueOnce(raw).mockResolvedValueOnce({ repairs: [{ path: '/entries', value: raw.entries }] });
    await expect(planWithAi(S, p, J, 'zh', 1)).rejects.toThrow('超过目标页数允许的 8 条');
    const perEntry = proposal();
    p.work[0].bullets.push({ id: 'work-1-b4', zh: '协助设计模拟支架。', en: '' });
    perEntry.entries[0].bulletIds = p.work[0].bullets.map((x) => x.id!);
    expect(() => validateAiSelection(perEntry, p, J, 'zh', 1)).toThrow('要点过多');
  });

  it('corrects a wrong-parent fact without replacing another valid entry', async () => {
    const original = proposal();
    original.entries[1].bulletIds = ['proj-2-b1'];
    api.mockResolvedValueOnce(original).mockResolvedValueOnce({ repairs: [{ path: '/entries/1', value: proposal().entries[1] }] });
    const result = await planWithAi(S, library(), J, 'zh', 1);
    expect(result.plan.entries[0].bulletIds).toEqual(original.entries[0].bulletIds);
    expect(result.plan.entries[1].bulletIds).toEqual(['proj-hyd-b1']);
    const feedback = JSON.parse(api.mock.calls[1][1][3].content.split('\n\n').at(-1));
    expect(feedback.allowedPaths).toEqual(['/entries/1']);
    expect(feedback.issues[0].message).toContain('实际来源：proj-2');
  });

  it('rejects a still-fabricated repaired ID with no third attempt or rule fallback', async () => {
    api.mockResolvedValueOnce(invalidProposal()).mockResolvedValueOnce(requirementRepair(['still-missing']));
    await expect(generateResume(S, library(), J, 'zh', 1)).rejects.toThrow(/局部修复失败.*机械建模与验证.*still-missing/);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('revalidates repaired source ownership rather than accepting any existing fact', async () => {
    const original = proposal(); original.entries[1].bulletIds = ['missing-fact'];
    api.mockResolvedValueOnce(original).mockResolvedValueOnce({ repairs: [{ path: '/entries/1', value: {
      ...proposal().entries[1], bulletIds: ['proj-2-b1'],
    } }] });
    await expect(planWithAi(S, library(), J, 'zh', 1)).rejects.toThrow(/不属于经历 proj-hyd/);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['duplicate evidence', ['work-1-b1', 'work-1-b1']],
    ['withheld GPA', ['edu-1-b1']],
    ['empty direct evidence', []],
  ])('retains strict checks after repair: %s', async (_label, ids) => {
    api.mockResolvedValueOnce(invalidProposal()).mockResolvedValueOnce(requirementRepair(ids));
    await expect(planWithAi(S, library(), J, 'zh', 1)).rejects.toThrow('局部修复失败');
    expect(api).toHaveBeenCalledTimes(2);
  });

  it.each([
    { repairs: [] },
    { repairs: [{ path: '/skills', value: [] }] },
    { repairs: [{ path: '/__proto__', value: { polluted: true } }] },
    { repairs: [{ path: '/requirements/0' }] },
    { repairs: [{ path: '/requirements/0', value: {} }, { path: '/requirements/0', value: {} }] },
    proposal(),
  ])('rejects incomplete, overbroad or malformed repair responses without changing the original', async (response) => {
    const original = invalidProposal();
    api.mockResolvedValueOnce(original).mockResolvedValueOnce(response);
    await expect(planWithAi(S, library(), J, 'zh', 1)).rejects.toThrow('局部修复失败');
    expect(original).toEqual(invalidProposal());
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('reports transport failure during correction without restarting the full planner', async () => {
    api.mockResolvedValueOnce(invalidProposal()).mockRejectedValueOnce(new Error('mock repair timeout'));
    await expect(planWithAi(S, library(), J, 'zh', 1)).rejects.toThrow(/局部修复失败.*mock repair timeout/);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('rejects ambiguous library IDs before any API call and never rewrites the library', async () => {
    const p = library();
    // Disabled facts can also overwrite textIndex; collisions must fail before planning.
    p.projects[0].enabled = false;
    p.projects[0].bullets[0].id = 'work-1-b1';
    const before = structuredClone(p);
    await expect(planWithAi(S, p, J, 'zh', 1)).rejects.toThrow('ID 缺失或重复');
    expect(api).not.toHaveBeenCalled();
    expect(p).toEqual(before);
  });

  it('exposes selection, correction, writing and localization stages through the existing callback', async () => {
    api.mockResolvedValueOnce(invalidProposal())
      .mockResolvedValueOnce(requirementRepair(['proj-hyd-b1']))
      .mockResolvedValueOnce({ items: [] })
      .mockRejectedValueOnce(new Error('mock translation offline'));
    const stages: string[] = [];
    const result = await generateResume(S, library(), J, 'zh', 1, (x) => stages.push(x));
    expect(result.generatedBy).toBe('ai');
    const selection = stages.findIndex((x) => x.includes('正在选材'));
    const repair = stages.findIndex((x) => x.includes('正在局部修复'));
    const writing = stages.findIndex((x) => x.includes('正在撰写'));
    const translation = stages.findIndex((x) => x.includes('3/3'));
    expect(selection).toBeGreaterThanOrEqual(0);
    expect(repair).toBeGreaterThan(selection);
    expect(writing).toBeGreaterThan(repair);
    expect(translation).toBeGreaterThan(writing);
    expect(api).toHaveBeenCalledTimes(4);
  });
});
