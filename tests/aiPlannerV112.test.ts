import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import type { ProfileDoc, Settings } from '../src/types';
import { fictionalEngineer, jobs } from './helpers/v110Fixture';
import { decisionModel, planWithAi, selectionBrief, validateAiSelection } from '../src/ai/aiPlanner';
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
    api.mockResolvedValueOnce({ ...proposal(), entries: [{ entryId: 'missing', bulletIds: ['x'] }] });
    api.mockResolvedValueOnce(proposal());
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
