import type { JobParse, Lang, ProfileDoc, Settings } from '../types';
import { other } from '../locale/text';
import { isOfficialDeepSeek } from '../storage/defaults';
import { analyzeJd, extractEvidence, rankEvidence } from './evidence';
import { chatJson } from './provider';
import { AI_PLAN_PROMPT, SYS_FACTS } from './prompts';
import type { PlanEntry, ResumePlan } from './relevance';

/** AI 对岗位要求作出的可追溯判断：非官方 ATS 分数。 */
export interface RequirementDecision {
  text: string;
  tier: 'must' | 'responsibility' | 'preferred';
  assessment: 'direct' | 'transferable' | 'gap';
  evidenceIds: string[];
}

export interface AiSelectionOutput {
  requirements?: RequirementDecision[];
  entries?: { entryId: string; bulletIds: string[]; reason?: string }[];
  education?: { entryId: string; bulletIds: string[] }[];
  skills?: string[];
  certificates?: string[];
  awards?: string[];
  summaryFocus?: string;
  tradeoffs?: string;
}

export interface AiSelectionResult {
  plan: ResumePlan;
  requirements: RequirementDecision[];
  gaps: string[];
  matchScore: number;
  summaryFocus: string;
  tradeoffs: string;
  chosenReasons: string[];
}

const textOf = (p: { zh?: string; en?: string }, lang: Lang) => (p[lang] || p[other(lang)] || '').trim();
const unverifiedGpa = (s: string) => /GPA|绩点|平均分|均分|grade point average/i.test(s)
  && /估算|估计|换算|非官方|自行|约记|约合|converted|estimat|unofficial|self[- ]?reported/i.test(s);

/** 官方 DeepSeek 的「判断与写作」用 Pro；其它 API 尊重用户启用的模型。翻译继续使用翻译模型配置。 */
export const decisionModel = (s: Settings) => isOfficialDeepSeek(s) ? 'deepseek-v4-pro' : s.model;

/** 只发送完成任务需要的专业素材；不发送照片、联系方式、证件、原始文档全文或 API Key。 */
export function selectionBrief(p: ProfileDoc, job: JobParse, lang: Lang, targetPages: number) {
  const evid = extractEvidence(p);
  const byEntry = (id: string) => evid.filter((e) => e.entryId === id).map((e) => ({
    sourceId: e.id, text: textOf(e.text, lang), alternateText: textOf(e.text, other(lang)),
    qualifiers: e.qualifiers, flags: e.flags,
  })).filter((x) => x.text);
  const work = p.work.filter((x) => x.enabled).map((x) => ({
    entryId: x.id, company: textOf(x.company, lang), title: textOf(x.title, lang), kind: x.kind ?? '',
    start: x.start, end: x.end, uncertain: x.uncertain ?? [], facts: byEntry(x.id),
  })).filter((x) => x.facts.length);
  const projects = p.projects.filter((x) => x.enabled).map((x) => ({
    entryId: x.id, name: textOf(x.name, lang), role: textOf(x.role, lang), kind: x.kind ?? '', nature: x.nature ?? '',
    start: x.start, end: x.end, uncertain: x.uncertain ?? [], facts: byEntry(x.id),
  })).filter((x) => x.facts.length);
  const education = p.education.filter((x) => x.enabled).map((x) => ({
    entryId: x.id, school: textOf(x.school, lang), degree: textOf(x.degree, lang), major: textOf(x.major, lang),
    start: x.start, end: x.end, expectedConferralDate: x.expectedConferralDate, actualConferralDate: x.actualConferralDate,
    facts: byEntry(x.id).filter((f) => !unverifiedGpa(`${f.text} ${f.alternateText}`)),
  }));
  const skills = p.skills.filter((x) => x.enabled).map((x) => ({ id: x.id, name: textOf(x.name, lang),
    category: textOf(x.category ?? {}, lang), proficiency: x.proficiency ?? '', usedIn: x.usedIn ?? [], scenarios: x.scenarios ?? '' }));
  const named = (a: ProfileDoc['certificates']) => a.filter((x) => x.enabled).map((x) => ({ id: x.id, name: textOf(x.name, lang), issuer: textOf(x.issuer, lang), date: x.date }));
  return {
    job: { title: job.title, rawText: job.rawText, responsibilities: job.responsibilities ?? [], mustHave: job.mustHave,
      niceToHave: job.niceToHave, keywords: job.keywords },
    candidate: { summaryOriginal: textOf(p.profile.summary, lang), work, projects, education,
      skills, certificates: named(p.certificates), awards: named(p.awards) },
    constraints: { language: lang, pages: targetPages > 1 ? 2 : 1, maxFacts: targetPages > 1 ? 14 : 8 },
  };
}

const idArray = (v: unknown, label: string): string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`AI 选材输出异常：${label} 应为 ID 数组`);
  if (new Set(v).size !== v.length) throw new Error(`AI 选材重复选择了 ${label}`);
  return v;
};

/** 程序不代替 AI 选内容，但必须拒绝任何来源错误、空条目、重复项或超出篇幅的方案。 */
export function validateAiSelection(raw: AiSelectionOutput, p: ProfileDoc, job: JobParse, lang: Lang, targetPages: number): AiSelectionResult {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) throw new Error('AI 没有返回有效的经历选择方案');
  const max = targetPages > 1 ? 14 : 8;
  const ev = extractEvidence(p);
  const byId = new Map(ev.map((x) => [x.id, x]));
  const entrySet = new Map<string, 'work' | 'projects'>([
    ...p.work.filter((x) => x.enabled).map((x) => [x.id, 'work'] as const),
    ...p.projects.filter((x) => x.enabled).map((x) => [x.id, 'projects'] as const),
  ]);
  const usedEntries = new Set<string>(), usedBullets = new Set<string>(), entries: PlanEntry[] = [];
  const chosenReasons: string[] = [];
  for (const [i, e] of raw.entries.entries()) {
    const kind = entrySet.get(e?.entryId);
    if (!kind || usedEntries.has(e.entryId)) throw new Error(`AI 选材包含无效或重复的经历 ID：${e?.entryId}`);
    const bulletIds = idArray(e.bulletIds, `${e.entryId}.bulletIds`);
    if (!bulletIds.length) throw new Error(`AI 试图加入没有实际要点的经历：${e.entryId}`);
    if (bulletIds.length > (targetPages > 1 ? 5 : 3)) throw new Error(`经历 ${e.entryId} 的要点过多`);
    for (const id of bulletIds) {
      const source = byId.get(id);
      if (!source || source.entryId !== e.entryId || source.section !== kind || usedBullets.has(id))
        throw new Error(`AI 引用了错误或重复的事实 ID：${id}`);
      usedBullets.add(id);
    }
    usedEntries.add(e.entryId);
    entries.push({ kind, id: e.entryId, score: raw.entries.length - i, core: i < (targetPages > 1 ? 3 : 2), bulletIds });
    if (typeof e.reason === 'string' && e.reason.trim()) chosenReasons.push(`${e.entryId}：${e.reason.trim()}`);
  }
  if (usedBullets.size > max) throw new Error(`AI 选择了 ${usedBullets.size} 条要点，超过目标页数允许的 ${max} 条`);
  if (!usedBullets.size && ev.some((x) => x.section !== 'education')) throw new Error('AI 未选择任何工作或项目事实，请重新生成');
  if (!Array.isArray(raw.education)) throw new Error('AI 未提供教育背景选择方案');
  const eduIds = new Set(p.education.filter((x) => x.enabled).map((x) => x.id));
  const seenEdu = new Set<string>();
  for (const e of raw.education) {
    if (!eduIds.has(e?.entryId) || seenEdu.has(e.entryId)) throw new Error(`AI 选择了无效教育经历：${e?.entryId}`);
    seenEdu.add(e.entryId);
    const ids = idArray(e.bulletIds, `${e.entryId}.bulletIds`);
    if (ids.length > 3) throw new Error('教育高亮信息过多');
    for (const id of ids) {
      const b = byId.get(id);
      if (!b || b.section !== 'education' || b.entryId !== e.entryId || unverifiedGpa(`${b.text.zh} ${b.text.en}`))
        throw new Error(`教育事实未经确认或来源无效：${id}`);
    }
    entries.push({ kind: 'education', id: e.entryId, score: 0, core: false, bulletIds: ids });
  }
  // AI 可不选教育要点，但已启用的学历主体仍应显示（预计学位状态由渲染层处理）。
  for (const id of eduIds) if (!seenEdu.has(id)) entries.push({ kind: 'education', id, score: 0, core: false, bulletIds: [] });
  const selectSide = (v: unknown, pool: { id: string; enabled: boolean }[], name: string) => {
    const ids = idArray(v, name), valid = new Set(pool.filter((x) => x.enabled).map((x) => x.id));
    for (const id of ids) if (!valid.has(id)) throw new Error(`AI 选用了资料库中不存在或未启用的${name}：${id}`);
    return ids;
  };
  const skills = selectSide(raw.skills, p.skills, '技能');
  const certificates = selectSide(raw.certificates, p.certificates, '证书');
  const awards = selectSide(raw.awards, p.awards, '奖项');
  if (skills.length > (targetPages > 1 ? 14 : 9) || certificates.length > 6 || awards.length > 5)
    throw new Error('AI 选择的技能或证书过多，请控制一页简历篇幅');

  const proof = new Set([...byId.keys(), ...p.skills.filter((x) => x.enabled).map((x) => x.id),
    ...p.certificates.filter((x) => x.enabled).map((x) => x.id)]);
  if (!Array.isArray(raw.requirements)) throw new Error('AI 没有返回岗位要求与证据对应关系');
  const requirements: RequirementDecision[] = [];
  for (const r of raw.requirements) {
    if (!r || typeof r.text !== 'string' || !r.text.trim() || !['must', 'responsibility', 'preferred'].includes(r.tier)
      || !['direct', 'transferable', 'gap'].includes(r.assessment)) throw new Error('AI 的岗位匹配判断格式不正确');
    const ids = idArray(r.evidenceIds, '岗位要求的证据');
    if (ids.some((id) => !proof.has(id))) throw new Error('AI 的岗位判断引用了不存在的资料证据');
    if ((r.assessment === 'gap' && ids.length) || (r.assessment !== 'gap' && !ids.length))
      throw new Error('AI 岗位要求的匹配结论与证据不一致');
    requirements.push({ text: r.text.trim(), tier: r.tier, assessment: r.assessment, evidenceIds: ids });
  }
  if (!requirements.length) throw new Error('AI 未分析任何岗位要求');
  const weight = { must: 3, responsibility: 2, preferred: 1 };
  const total = requirements.reduce((n, r) => n + weight[r.tier], 0);
  const supported = requirements.reduce((n, r) => n + weight[r.tier] * (r.assessment === 'direct' ? 1 : r.assessment === 'transferable' ? 0.5 : 0), 0);
  const model = analyzeJd(job), ranked = rankEvidence(ev, model);
  const budgets: Record<string, number> = {};
  let n = 0;
  entries.forEach((e) => { if (e.kind === 'education') return; e.bulletIds.forEach((id) => {
    budgets[id] = n++ < 4 ? (lang === 'zh' ? 70 : 38) : (lang === 'zh' ? 56 : 30);
  }); });
  const dropped = ev.filter((e) => e.section !== 'education' && !usedBullets.has(e.id))
    .map((e) => ({ id: e.id, reason: 'AI 比较完整资料和岗位要求后认为优先级较低（母库保留）' }));
  const plan: ResumePlan = { entries, skills, certificates, awards, caps: { core: targetPages > 1 ? 4 : 3, minor: targetPages > 1 ? 2 : 1 },
    budgets, dropped, model, ranked };
  return { plan, requirements, gaps: requirements.filter((r) => r.assessment === 'gap').map((r) => r.text).slice(0, 8),
    matchScore: total ? Math.round(100 * supported / total) : 0,
    summaryFocus: String(raw.summaryFocus ?? '').trim(), tradeoffs: String(raw.tradeoffs ?? '').trim(), chosenReasons };
}

export async function planWithAi(s: Settings, p: ProfileDoc, job: JobParse, lang: Lang, targetPages: number): Promise<AiSelectionResult> {
  const brief = selectionBrief(p, job, lang, targetPages);
  const messages = [{ role: 'system' as const, content: SYS_FACTS },
    { role: 'user' as const, content: `${AI_PLAN_PROMPT}\n\n${JSON.stringify(brief)}` }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await chatJson<AiSelectionOutput>(s, messages, { model: decisionModel(s),
      thinking: 'enabled', timeoutMs: 240_000, maxTokens: 16_000 });
    try { return validateAiSelection(out, p, job, lang, targetPages); }
    catch (e) {
      if (attempt) throw e;
      messages.push({ role: 'user', content: `你返回的 JSON 选择方案不符合事实 ID 或篇幅约束：${(e as Error).message}。请重新检查原始资料，仅输出修正的完整 JSON。` });
    }
  }
  throw new Error('AI 简历选材失败');
}
