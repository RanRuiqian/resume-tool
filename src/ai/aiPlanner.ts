import type { JobParse, Lang, ProfileDoc, Settings, TemplateConfig } from '../types';
import { other } from '../locale/text';
import { isOfficialDeepSeek } from '../storage/defaults';
import { analyzeJd, extractEvidence, rankEvidence } from './evidence';
import { chatJson, type ChatMsg } from './provider';
import { AI_PLAN_PROMPT, AI_PLAN_REPAIR_PROMPT, SYS_FACTS } from './prompts';
import type { PlanEntry, ResumePlan } from './relevance';
import { inferWorkKind } from '../render/classify';
import { isProfessionalWork, isCampusWork, pageBudget, type ContentCategory } from './contentStrategy';

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
  reserveEntries?: { entryId: string; bulletIds: string[]; reason?: string }[];
  omissions?: Partial<Record<ContentCategory, string>>;
  education?: { entryId: string; bulletIds: string[] }[];
  skills?: string[];
  certificates?: string[];
  awards?: string[];
  summaryFocus?: string;
  tradeoffs?: string;
}

export interface AiSelectionResult {
  plan: ResumePlan;
  reserves: PlanEntry[];
  omissions: Partial<Record<ContentCategory, string>>;
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

// 同一个 ID 不得同时指向两个条目；否则后续 textIndex 的 Map 可能覆盖真正的来源。
function checkLibraryIds(p: ProfileDoc) {
  const seen = new Set(['summary']);
  const ids = [...p.work, ...p.projects, ...p.education, ...p.skills, ...p.certificates, ...p.awards].map((x) => x.id);
  const facts = [...p.work, ...p.projects].flatMap((x) => x.bullets).concat(p.education.flatMap((x) => x.highlights));
  ids.push(...facts.flatMap((x) => x.id ? [x.id] : []));
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id))
      throw new Error(`资料证据 ID 缺失或重复，无法安全追溯：${id}（资料库未修改）`);
    seen.add(id);
  }
}

/** 只发送完成任务需要的专业素材；不发送照片、联系方式、证件、原始文档全文或 API Key。 */
export function selectionBrief(p: ProfileDoc, job: JobParse, lang: Lang, targetPages: number, template?: TemplateConfig) {
  checkLibraryIds(p);
  const evid = extractEvidence(p);
  const byEntry = (id: string, section: 'work' | 'projects' | 'education') => evid.filter((e) => e.entryId === id && e.section === section).map((e) => ({
    sourceId: e.id, text: textOf(e.text, lang), alternateText: textOf(e.text, other(lang)),
    qualifiers: e.qualifiers, flags: e.flags,
  })).filter((x) => x.text);
  const work = p.work.filter((x) => x.enabled).map((x) => ({
    entryId: x.id, company: textOf(x.company, lang), title: textOf(x.title, lang), kind: inferWorkKind(x),
    start: x.start, end: x.end, uncertain: x.uncertain ?? [], facts: byEntry(x.id, 'work'),
  })).filter((x) => x.facts.length);
  const projects = p.projects.filter((x) => x.enabled).map((x) => ({
    entryId: x.id, name: textOf(x.name, lang), role: textOf(x.role, lang), kind: x.kind ?? '', nature: x.nature ?? '',
    start: x.start, end: x.end, uncertain: x.uncertain ?? [], facts: byEntry(x.id, 'projects'),
  })).filter((x) => x.facts.length);
  const education = p.education.filter((x) => x.enabled).map((x) => ({
    entryId: x.id, school: textOf(x.school, lang), degree: textOf(x.degree, lang), major: textOf(x.major, lang),
    start: x.start, end: x.end, expectedConferralDate: x.expectedConferralDate, actualConferralDate: x.actualConferralDate,
    facts: byEntry(x.id, 'education').filter((f) => !unverifiedGpa(`${f.text} ${f.alternateText}`)),
  }));
  const skills = p.skills.filter((x) => x.enabled).map((x) => ({ id: x.id, name: textOf(x.name, lang),
    category: textOf(x.category ?? {}, lang), proficiency: x.proficiency ?? '', usedIn: x.usedIn ?? [], scenarios: x.scenarios ?? '' })).filter((x) => x.name);
  const named = (a: ProfileDoc['certificates']) => a.filter((x) => x.enabled).map((x) => ({ id: x.id, name: textOf(x.name, lang), issuer: textOf(x.issuer, lang), date: x.date })).filter((x) => x.name);
  const certificates = named(p.certificates), awards = named(p.awards);
  // 唯一白名单：只从实际发送的素材派生，校验与修复都使用同一结构。
  const entries = [...work.map((x) => ({ ...x, kind: 'work' as const })), ...projects.map((x) => ({ ...x, kind: 'projects' as const }))]
    .map((x) => ({ entryId: x.entryId, kind: x.kind, bulletIds: x.facts.map((f) => f.sourceId) }));
  const allowedIds = {
    entries, education: education.map((x) => ({ entryId: x.entryId, bulletIds: x.facts.map((f) => f.sourceId) })),
    // 教育主体本身包含学校、专业、学位及预计授予状态；无需杜撰一个 highlight 才能引用这些真实字段。
    educationEvidenceIds: education.map((x) => x.entryId),
    skills: skills.map((x) => x.id), certificates: certificates.map((x) => x.id), awards: awards.map((x) => x.id),
    evidenceIds: [...work, ...projects, ...education].flatMap((x) => x.facts.map((f) => f.sourceId))
      .concat(education.map((x) => x.entryId), skills.map((x) => x.id), certificates.map((x) => x.id), awards.map((x) => x.id)),
  };
  return {
    job: { title: job.title, rawText: job.rawText, responsibilities: job.responsibilities ?? [], mustHave: job.mustHave,
      niceToHave: job.niceToHave, keywords: job.keywords },
    candidate: { work, projects, education,
      skills, certificates, awards },
    allowedIds,
    constraints: { language: lang, layout: pageBudget(targetPages, lang, template, p),
      personalCompleteness: '先理解完整画像；直接相关 → 可迁移工程 → 职业/组织背景 → 低价值补充。工作与组织的详略随岗位及版面调整，不能只按关键词删除。' },
  };
}

export interface SelectionIssue {
  path: string;
  code: 'format' | 'invalid_id' | 'duplicate' | 'limit' | 'inconsistent';
  message: string;
  invalidIds?: string[];
  requirementText?: string;
}

export class AiSelectionValidationError extends Error {
  readonly issues: SelectionIssue[];
  constructor(issues: SelectionIssue[]) {
    super(issues.map((x) => `${x.path}：${x.message}`).join('；'));
    this.name = 'AiSelectionValidationError';
    this.issues = issues;
  }
}

type SelectionBrief = ReturnType<typeof selectionBrief>;

/** 校验只承认实际发给 AI 的素材。收集所有错误后一次反馈，避免逐项盲目重跑。 */
export function validateAiSelection(raw: AiSelectionOutput, p: ProfileDoc, job: JobParse, lang: Lang, targetPages: number, template?: TemplateConfig): AiSelectionResult {
  return validateSelection(raw, p, job, lang, targetPages, selectionBrief(p, job, lang, targetPages, template));
}

function validateSelection(raw: AiSelectionOutput, p: ProfileDoc, job: JobParse, lang: Lang, targetPages: number, brief: SelectionBrief): AiSelectionResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('AI 没有返回有效的经历选择方案');
  const issues: SelectionIssue[] = [];
  const issue = (path: string, code: SelectionIssue['code'], message: string, invalidIds?: string[], requirementText?: string) => {
    issues.push({ path, code, message, ...(invalidIds ? { invalidIds } : {}), ...(requirementText ? { requirementText } : {}) });
  };
  const idArray = (v: unknown, path: string, label: string): string[] => {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      issue(path, 'format', `${label} 应为 ID 数组`); return [];
    }
    if (new Set(v).size !== v.length) issue(path, 'duplicate', `${label} 包含重复 ID`);
    return v;
  };
  const allowed = brief.allowedIds;
  const visibleFacts = new Set([...allowed.entries, ...allowed.education].flatMap((x) => x.bulletIds));
  const ev = extractEvidence(p).filter((x) => visibleFacts.has(x.id));
  const byId = new Map(ev.map((x) => [x.id, x]));
  const entrySet = new Map(allowed.entries.map((x) => [x.entryId, x.kind]));
  const usedEntries = new Set<string>(), usedBullets = new Set<string>(), entries: PlanEntry[] = [], reserves: PlanEntry[] = [];
  const chosenReasons: string[] = [];
  if (!Array.isArray(raw.entries)) issue('/entries', 'format', 'AI 没有返回有效的经历选择方案');
  if (raw.reserveEntries !== undefined && !Array.isArray(raw.reserveEntries)) issue('/reserveEntries', 'format', '候补经历应为数组');
  const pool = [...(Array.isArray(raw.entries) ? raw.entries : []).map((e, i) => ({ e, i, reserve: false })),
    ...(Array.isArray(raw.reserveEntries) ? raw.reserveEntries : []).map((e, i) => ({ e, i, reserve: true }))];
  for (const { e, i, reserve } of pool) {
    const path = `/${reserve ? 'reserveEntries' : 'entries'}/${i}`;
    const kind = entrySet.get(e?.entryId);
    if (!kind) {
      issue(path, 'invalid_id', `无效或没有实际要点的经历 ID：${e?.entryId}`, [String(e?.entryId)]); continue;
    }
    if (usedEntries.has(e.entryId)) issue(path, 'duplicate', `重复的经历 ID：${e.entryId}`, [e.entryId]);
    const bulletIds = idArray(e.bulletIds, path, `${e.entryId}.bulletIds`);
    if (!bulletIds.length) issue(path, 'inconsistent', `没有实际要点的经历：${e.entryId}`);
    for (const id of bulletIds) {
      const source = byId.get(id);
      if (!source || source.entryId !== e.entryId || source.section !== kind)
        issue(path, 'invalid_id', `事实 ID ${id} 不属于经历 ${e.entryId}（实际来源：${source?.entryId ?? '不存在或未提供的事实'}）`, [id]);
      if (usedBullets.has(id)) issue(path, 'duplicate', `重复的事实 ID：${id}`, [id]);
      usedBullets.add(id);
    }
    usedEntries.add(e.entryId);
    (reserve ? reserves : entries).push({ kind, id: e.entryId, score: pool.length - i, core: !reserve, bulletIds });
    if (typeof e.reason === 'string' && e.reason.trim()) chosenReasons.push(`${e.entryId}：${e.reason.trim()}`);
  }
  if (Array.isArray(raw.entries) && !raw.entries.length && allowed.entries.length)
    issue('/entries', 'inconsistent', 'AI 未选择任何工作或项目事实');
  if (!Array.isArray(raw.education)) issue('/education', 'format', 'AI 未提供教育背景选择方案');
  const eduIds = new Set(allowed.education.map((x) => x.entryId));
  const seenEdu = new Set<string>();
  for (const [i, e] of (Array.isArray(raw.education) ? raw.education : []).entries()) {
    const path = `/education/${i}`;
    if (!eduIds.has(e?.entryId)) {
      issue(path, 'invalid_id', `AI 选择了无效教育经历：${e?.entryId}`, [String(e?.entryId)]); continue;
    }
    if (seenEdu.has(e.entryId)) issue(path, 'duplicate', `重复的教育经历：${e.entryId}`, [e.entryId]);
    seenEdu.add(e.entryId);
    const ids = idArray(e.bulletIds, path, `${e.entryId}.bulletIds`);
    for (const id of ids) {
      const b = byId.get(id);
      if (!b || b.section !== 'education' || b.entryId !== e.entryId)
        issue(path, 'invalid_id', `教育事实未经确认或来源无效：${id}（所属教育经历：${e.entryId}）`, [id]);
    }
    entries.push({ kind: 'education', id: e.entryId, score: 0, core: false, bulletIds: ids });
  }
  // 不选教育要点仍展示已启用学历主体，保持原有的预计学位状态处理。
  for (const id of eduIds) if (!seenEdu.has(id)) entries.push({ kind: 'education', id, score: 0, core: false, bulletIds: [] });
  const selectSide = (v: unknown, pool: string[], path: string, name: string) => {
    const ids = idArray(v, path, name), valid = new Set(pool);
    const invalid = ids.filter((id) => !valid.has(id));
    if (invalid.length) issue(path, 'invalid_id', `AI 选用了不存在、未启用或未提供的${name}：${invalid.join('、')}`, invalid);
    return ids;
  };
  const skills = selectSide(raw.skills, allowed.skills, '/skills', '技能');
  const certificates = selectSide(raw.certificates, allowed.certificates, '/certificates', '证书');
  const awards = selectSide(raw.awards, allowed.awards, '/awards', '奖项');

  const proof = new Set(allowed.evidenceIds);
  const allEntryIds = new Set([...allowed.entries, ...allowed.education].map((x) => x.entryId));
  if (!Array.isArray(raw.requirements)) issue('/requirements', 'format', 'AI 没有返回岗位要求与证据对应关系');
  const requirements: RequirementDecision[] = [];
  for (const [i, r] of (Array.isArray(raw.requirements) ? raw.requirements : []).entries()) {
    const path = `/requirements/${i}`;
    const text = typeof r?.text === 'string' ? r.text.trim() : '';
    const label = `岗位要求 #${i + 1}「${text || '未提供要求文本'}」`;
    if (!r || !text || !['must', 'responsibility', 'preferred'].includes(r.tier)
      || !['direct', 'transferable', 'gap'].includes(r.assessment)) {
      issue(path, 'format', `${label}：岗位匹配判断格式不正确`, undefined, text); continue;
    }
    const ids = idArray(r.evidenceIds, path, `${label}的证据`);
    const invalid = ids.filter((id) => !proof.has(id));
    if (invalid.length) {
      const details = invalid.map((id) => `${id}${allEntryIds.has(id) ? '（这是经历分组 ID，请引用其具体事实 sourceId）' : '（不存在或未提供的证据 ID）'}`);
      issue(path, 'invalid_id', `${label} 引用了无效资料证据：${details.join('、')}`, invalid, text);
    }
    if ((r.assessment === 'gap' && ids.length) || (r.assessment !== 'gap' && !ids.length))
      issue(path, 'inconsistent', `${label}：匹配结论 ${r.assessment} 与证据不一致`, ids, text);
    requirements.push({ text, tier: r.tier, assessment: r.assessment, evidenceIds: ids });
  }
  if (Array.isArray(raw.requirements) && !raw.requirements.length) issue('/requirements', 'format', 'AI 未分析任何岗位要求');
  const omissions: Partial<Record<ContentCategory, string>> = {};
  for (const key of ['education', 'professionalWork', 'campus', 'projects', 'skills', 'certificates'] as const) {
    const reason = raw.omissions?.[key];
    if (typeof reason === 'string' && reason.trim()) omissions[key] = reason.trim();
  }
  // 来源错误修复可能同时恢复职业背景，避免为同一根因再要求一次无意义的省略说明。
  for (const [key, predicate] of (issues.some((x) => /^\/(?:entries|reserveEntries)/.test(x.path)) ? [] : [['professionalWork', isProfessionalWork], ['campus', isCampusWork]]) as ['professionalWork' | 'campus', typeof isProfessionalWork][]) {
    const eligible = p.work.filter((x) => entrySet.has(x.id) && predicate(x));
    if (eligible.length && ![...entries, ...reserves].some((x) => eligible.some((w) => w.id === x.id)) && !omissions[key])
      issue('/entries', 'inconsistent', `${key === 'campus' ? '学生组织' : '工作 / 实习背景'}未纳入主要或候补选材，且没有明确的省略说明；请在主选经历中恢复有价值的真实背景，不得只因缺少 JD 关键词删除`);
  }
  if (issues.length) throw new AiSelectionValidationError(issues);
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
  return { plan, reserves, omissions, requirements, gaps: requirements.filter((r) => r.assessment === 'gap').map((r) => r.text).slice(0, 8),
    matchScore: total ? Math.round(100 * supported / total) : 0,
    summaryFocus: String(raw.summaryFocus ?? '').trim(), tradeoffs: String(raw.tradeoffs ?? '').trim(), chosenReasons };
}

/** 只接受失败位置的替换，防止修复时重排或覆盖已通过的选材。合并后仍做完整校验。 */
function applyRepairs(original: AiSelectionOutput, response: unknown, allowedPaths: string[]): AiSelectionOutput {
  const repairs = (response as { repairs?: unknown })?.repairs;
  if (!Array.isArray(repairs) || repairs.length !== allowedPaths.length)
    throw new Error('AI 局部修复格式错误：必须且只能替换列出的错误位置');
  const pending = new Set(allowedPaths);
  const updated = JSON.parse(JSON.stringify(original)) as AiSelectionOutput;
  const removals: { field: 'entries' | 'education' | 'reserveEntries'; index: number }[] = [];
  for (const repair of repairs) {
    if (!repair || typeof repair.path !== 'string' || !pending.delete(repair.path))
      throw new Error(`AI 局部修复包含未授权或重复的位置：${repair?.path}`);
    // path 只能由本地校验器产生，模型不能选择任意属性或嵌套路径。
    const [field, index] = repair.path.slice(1).split('/') as [keyof AiSelectionOutput, string | undefined];
    if (repair.op === 'remove' && index !== undefined && (field === 'entries' || field === 'education' || field === 'reserveEntries')) {
      removals.push({ field, index: Number(index) }); continue;
    }
    if ((repair.op !== undefined && repair.op !== 'replace') || !Object.hasOwn(repair, 'value'))
      throw new Error(`AI 局部修复操作无效或缺少替换值：${repair.path}`);
    if (field === 'requirements' && index !== undefined) {
      const previous = original.requirements?.[Number(index)];
      if ((typeof previous?.text === 'string' && previous.text.trim() && repair.value?.text !== previous.text)
        || (['must', 'responsibility', 'preferred'].includes(previous?.tier ?? '') && repair.value?.tier !== previous?.tier))
        throw new Error(`AI 局部修复不得通过改换岗位要求或层级来绕过证据检查：${repair.path}`);
    }
    if (index === undefined) Object.assign(updated, { [field]: repair.value });
    else (updated[field] as unknown[])[Number(index)] = repair.value;
  }
  // 同一数组从后向前删除，不改变其它修复位置的下标；岗位要求不能通过删除来逃避核验。
  removals.sort((a, b) => b.index - a.index).forEach(({ field, index }) => updated[field]!.splice(index, 1));
  return updated;
}

export async function planWithAi(s: Settings, p: ProfileDoc, job: JobParse, lang: Lang, targetPages: number, onStep?: (m: string) => void, template?: TemplateConfig): Promise<AiSelectionResult> {
  const brief = selectionBrief(p, job, lang, targetPages, template);
  const messages: ChatMsg[] = [{ role: 'system', content: SYS_FACTS },
    { role: 'user', content: `${AI_PLAN_PROMPT}\n\n${JSON.stringify(brief)}` }];
  const options = { model: decisionModel(s), thinking: 'enabled' as const, timeoutMs: 240_000, maxTokens: 16_000 };
  onStep?.('1/3 正在选材：AI 阅读岗位与全部有效经历，规划简历重点；深度思考可能需要数分钟…');
  const original = await chatJson<AiSelectionOutput>(s, messages, options);
  try { return validateSelection(original, p, job, lang, targetPages, brief); }
  catch (error) {
    if (!(error instanceof AiSelectionValidationError)) throw error;
    const paths = [...new Set(error.issues.map((x) => x.path))];
    const allowedPaths = paths.filter((path) => !paths.some((parent) => parent !== path && path.startsWith(`${parent}/`)));
    onStep?.(`1/3 选材校验发现 ${error.issues.length} 处问题，正在局部修复（最多一次），保留其余选材…`);
    // 把真实的首次方案作为 assistant 消息带回，不再让模型凭空猜测“上次返回了什么”。
    const repairMessages: ChatMsg[] = [...messages, { role: 'assistant', content: JSON.stringify(original) },
      { role: 'user', content: `${AI_PLAN_REPAIR_PROMPT}\n\n${JSON.stringify({
        issues: error.issues, allowedPaths, allowedIds: brief.allowedIds,
      })}` }];
    try {
      const repair = await chatJson<unknown>(s, repairMessages, options);
      const fixed = applyRepairs(original, repair, allowedPaths);
      const result = validateSelection(fixed, p, job, lang, targetPages, brief);
      onStep?.('1/3 选材局部修复完成，整个方案已重新通过事实来源与篇幅校验');
      return result;
    } catch (repairError) {
      throw new Error(`AI 选材局部修复失败，未采用该方案。首次问题：${error.message}。修复结果：${(repairError as Error).message}`);
    }
  }
}
