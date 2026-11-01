import type { GenItem, JobParse, Lang, LocalizedText, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson } from './provider';
import { GENERATE_PROMPT, LOCALIZE_PROMPT, SYS_FACTS } from './prompts';
import { checkConsistency, compareFacts } from './consistency';
import { lt, other, uid } from '../locale/text';
import { mockTranslate } from './translate';
import { guardRewrite } from '../quality/resumeGuard';
import { buildKitContext, entityTokens, unsupportedEntities } from '../quality/kitVerify';
import { compactSummary, hasTerm, conciseBi, jobTerms, planResume, type PlanEntry, type ResumePlan, LANG_TEST } from './relevance';
import { capabilityBrief, coverage } from './evidence';
import { focusSummary, guardSummary } from './summary';

type Sel = ResumeDoc['selection'];
const NAME: Record<Lang, string> = { zh: '中文', en: '英文' };

/** 资料库中所有可改写文本（summary / bullet / highlight），按 sourceId 索引 */
export function textIndex(p: ProfileDoc): Map<string, { t: LocalizedText; parent: string }> {
  const m = new Map<string, { t: LocalizedText; parent: string }>();
  m.set('summary', { t: p.profile.summary, parent: 'profile' });
  p.work.forEach((e) => e.bullets.forEach((b) => b.id && m.set(b.id, { t: b, parent: e.id })));
  p.projects.forEach((e) => e.bullets.forEach((b) => b.id && m.set(b.id, { t: b, parent: e.id })));
  p.education.forEach((e) => e.highlights.forEach((b) => b.id && m.set(b.id, { t: b, parent: e.id })));
  return m;
}


/** v1.11：本简历选中技能的名称（简介里的工具清单只保留这些） */
const toolNames = (p: ProfileDoc, plan: ResumePlan) => p.skills.filter((k) => plan.skills.includes(k.id)).flatMap((k) => [k.name.zh, k.name.en]).filter((x): x is string => !!x);
/** v1.11：未选要点的原因（写进 notes，母库保留、可手动勾选） */
function dropNotes(p: ProfileDoc, plan: ResumePlan): string[] {
  const idx = textIndex(p);
  const name = (id: string) => { const e = [...p.work, ...p.projects].find((x) => x.id === id); if (e) return lt('name' in e ? e.name : e.title, 'zh') || id; const t = idx.get(id)?.t; return t ? `「${(lt(t, 'zh') || lt(t, 'en')).slice(0, 18)}…」` : id; };
  const ds = plan.dropped ?? [];
  return ds.length ? [`未放进本简历（资料库保留，可在左侧手动勾选）：${ds.slice(0, 12).map((d) => `${name(d.id)}：${d.reason}`).join('；')}`] : [];
}
/** v1.11：公司名称 / 工作日期与岗位记录不一致时只提示核对，不猜测、不改写 */
function conflictNotes(p: ProfileDoc, job: JobParse): string[] {
  const out: string[] = [];
  for (const w of p.work.filter((x) => x.enabled)) {
    if (!w.start) out.push(`${lt(w.company, 'zh') || w.id}：缺少开始日期，待用户核对（未自动补全）`);
    if (w.start && w.end && w.end !== 'present' && w.end < w.start) out.push(`${lt(w.company, 'zh') || w.id}：结束日期早于开始日期，待用户核对（保留原始数据）`);
  }
  void job;
  return out;
}

/**
 * 规则匹配（演示模式 / AI 失败降级，PRD 6.4）：v1.11 改为分阶段选材（planResume → evidence.ts），
 * 每段经历按价值和篇幅预算挑选要点，并按句精简（中英同步取舍）；不改写措辞，母库不变。
 */
export function generateRules(p: ProfileDoc, job: JobParse, primary: Lang, targetPages = 1): ResumeDoc {
  const plan = planResume(p, job, primary, targetPages);
  const terms = jobTerms(job);
  const idx = textIndex(p);
  const items: GenItem[] = [];
  const en = <T extends { enabled: boolean }>(a: T[]) => a.filter((x) => x.enabled);
  const sumZh = lt(p.profile.summary, 'zh', false), sumEn = lt(p.profile.summary, 'en', false);
  const tools = toolNames(p, plan);
  const fs = (t: string, l: Lang) => (t ? (plan.model ? focusSummary(t, l, plan.model, tools) : null) ?? compactSummary(t, l) : '');
  if (lt(p.profile.summary, primary)) items.push({ sourceId: 'summary', zh: fs(sumZh, 'zh'), en: fs(sumEn, 'en'), syncStatus: 'in-sync' });
  for (const e of plan.entries) for (const id of e.bulletIds) {
    const t = idx.get(id)?.t; if (!t) continue;
    const c = e.kind === 'education' ? { zh: lt(t, 'zh', false), en: lt(t, 'en', false) } : conciseBi(t, terms, primary, plan.budgets?.[id]);
    items.push({ sourceId: id, zh: c.zh, en: c.en, syncStatus: 'in-sync' });
  }
  const cov = plan.model && plan.ranked ? coverage(p, job, plan.model, plan.ranked, primary) : { matchScore: 0, gaps: [] };
  const ids = (k: PlanEntry['kind']) => plan.entries.filter((e) => e.kind === k).map((e) => e.id);
  const res: ResumeDoc = {
    id: uid('resume'), jobId: job.id, templateId: '', primaryLanguage: primary, createdAt: new Date().toISOString(),
    matchScore: cov.matchScore, gaps: cov.gaps,
    selection: { work: ids('work'), projects: ids('projects'), education: ids('education').length ? ids('education') : en(p.education).map((x) => x.id), skills: plan.skills, certificates: plan.certificates, awards: plan.awards },
    items, consistency: { checkedAt: '', issues: [] }, generatedBy: 'rules',
    notes: ['规则匹配：按岗位能力分层挑选并精简要点（未改写措辞），资料库原文不变；未选中的经历和要点可在左侧清单手动勾选', ...dropNotes(p, plan), ...conflictNotes(p, job)],
  };
  return res;
}

/** 副版本缺失时用资料库译文；仍缺失时（演示模式）用演示机翻 */
function fillSecondaryFromProfile(p: ProfileDoc, r: ResumeDoc, demo: boolean) {
  const idx = textIndex(p), sec = other(r.primaryLanguage);
  for (const it of r.items) {
    if (it[sec].trim()) continue;
    const src = idx.get(it.sourceId)?.t;
    const v = src ? lt(src, sec, false) : '';
    it[sec] = v || (demo ? mockTranslate(it[r.primaryLanguage], sec, p.glossary) : '');
  }
}


export function runConsistency(r: ResumeDoc): ResumeDoc {
  // 兜底（A2）：两种语言关键事实不一致的条目，任何路径都不能保持 in-sync
  const items = r.items.map((i): GenItem => {
    if (i.syncStatus !== 'in-sync' || !i.zh.trim() || !i.en.trim()) return i;
    const f = compareFacts(i[r.primaryLanguage], i[other(r.primaryLanguage)]);
    return f.length ? { ...i, syncStatus: 'needs-review', translation: { source: i.translation?.source ?? 'profile', aiText: i.translation?.aiText, factIssues: f, checkedAt: new Date().toISOString() } } : i;
  });
  r = { ...r, items };
  return { ...r, consistency: { checkedAt: new Date().toISOString(), issues: checkConsistency(r.items) } };
}

/**
 * AI 生成主版本（F5.6 第一步）。v1.11 阶段 E：选材由本地分阶段算法确定（planResume），
 * AI 只对已选事实做排序内的精简 / 改写 / 合并措辞，不再挑选条目；随后逐条过事实护栏（guardRewrite + 实体检查），
 * 不通过的用按预算精简的原文。matchScore / gaps 由本地计算。
 */
async function generatePrimaryAi(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number): Promise<ResumeDoc> {
  // v1.9.1：主语言译文已过期（另一语言改过）时，改用最新的另一语言原文交给 AI 重写，不静默使用过期译文
  const T = (t: LocalizedText) => (t?.status?.[primary] === 'stale' ? lt(t, other(primary)) : lt(t, primary));
  const plan = planResume(p, job, primary, targetPages);
  const idx = textIndex(p);
  const terms = jobTerms(job);
  const rankOf = new Map((plan.ranked ?? []).map((r, i) => [r.id, { r, i }]));
  const entryName = (id: string) => { const w = p.work.find((x) => x.id === id); if (w) return { entry: T(w.company), role: T(w.title) }; const pr = p.projects.find((x) => x.id === id); if (pr) return { entry: T(pr.name), role: T(pr.role) }; const ed = p.education.find((x) => x.id === id); return { entry: ed ? T(ed.school) : id, role: ed ? T(ed.major) : '' }; };
  // 不发送照片、出生年月、性别、籍贯等敏感信息（PRD 8）；只发送本简历选中的事实
  const facts = plan.entries.filter((e) => e.kind !== 'education').flatMap((e) => e.bulletIds.map((id) => ({ sourceId: id, ...entryName(e.id), text: T(idx.get(id)!.t), priority: (rankOf.get(id)?.i ?? 99) + 1, budget: plan.budgets?.[id], qualifiers: rankOf.get(id)?.r.qualifiers ?? [] }))).filter((f) => f.text);
  const summaryOrig = T(p.profile.summary);
  const tools = toolNames(p, plan);
  const model = plan.model!;
  const focus = capabilityBrief(model, primary).filter((x) => x.tier !== '一般协作' && x.tier !== '低价值补充');
  const avoid = capabilityBrief(model, primary).filter((x) => x.tier === '一般协作' || x.tier === '低价值补充').map((x) => x.capability);
  const brief = { title: job.title, focus, avoid, summaryOriginal: summaryOrig, summaryTools: tools, facts };
  type Out = { items?: { sourceId: string; text: string }[]; reasons?: string };
  const out = await chatJson<Out>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content: `${GENERATE_PROMPT(NAME[primary], targetPages > 1 ? 5 : 4)}\n\n${JSON.stringify(brief)}` }]);

  const notes: string[] = [];
  const kctx = buildKitContext(p, null);
  const entityIssues = (orig: string, text: string) => [
    ...(orig ? entityTokens(text, primary).filter((t) => !hasTerm(orig, t)).map((t) => `新增了原文没有的工具 / 专有名词：${t}`) : []),
    ...unsupportedEntities(text, primary, kctx.corpus, [], kctx.majors).map((t) => `出现了资料中没有的：${t}`),
  ];
  const aiText = new Map<string, string>();
  for (const it of out.items ?? []) if (it?.sourceId && it.text?.trim() && !aiText.has(it.sourceId)) aiText.set(it.sourceId, it.text.trim());
  const allowed = new Set(['summary', ...plan.entries.flatMap((e) => e.bulletIds)]);
  const extra = [...aiText.keys()].filter((k) => !allowed.has(k));
  if (extra.length) notes.push(`已丢弃 AI 返回的未选 / 无来源条目：${extra.join(', ')}`);
  const items: GenItem[] = [];
  let fallback = 0;
  // 简介：AI 版本须通过 guardSummary；否则用按岗位精简的原文
  if (summaryOrig || aiText.get('summary')) {
    const a = aiText.get('summary');
    const sources = facts.map((f) => f.text).concat(p.education.filter((e) => e.enabled).map((e) => `${T(e.school)} ${T(e.major)} ${T(e.degree)}`), tools);
    const bad = a ? [...guardSummary(summaryOrig, a, primary, sources, model.jdTools), ...unsupportedEntities(a, primary, kctx.corpus, [], kctx.majors).map((t) => `出现了资料中没有的：${t}`)] : ['AI 未返回简介'];
    const text = a && !bad.length ? a : (summaryOrig ? (focusSummary(summaryOrig, primary, model, tools) ?? compactSummary(summaryOrig, primary)) : '');
    if (a && bad.length) notes.push(`简介改写未通过事实护栏（${bad.join('；')}），已改用按岗位精简的原文`);
    if (text) items.push({ sourceId: 'summary', zh: primary === 'zh' ? text : '', en: primary === 'en' ? text : '', syncStatus: 'in-sync' });
  }
  for (const e of plan.entries) for (const id of e.bulletIds) {
    const t = idx.get(id)?.t; if (!t) continue;
    const orig = T(t);
    let text: string;
    if (e.kind === 'education') text = orig;
    else {
      const a = aiText.get(id);
      const bad = a ? [...guardRewrite(orig, a, primary), ...entityIssues(orig, a)] : ['AI 未返回'];
      if (!bad.length) text = a!;
      else { text = conciseBi(t, terms, primary, plan.budgets?.[id])[primary] || orig; fallback++; if (a) notes.push(`${id} 改写未通过事实护栏（${bad.join('；')}），已改用精简原文`); }
    }
    if (text) items.push({ sourceId: id, zh: primary === 'zh' ? text : '', en: primary === 'en' ? text : '', syncStatus: 'in-sync' });
  }
  if (fallback) notes.push(`${fallback} 条要点使用了精简原文（AI 未返回或未通过护栏）`);
  const cov = coverage(p, job, model, plan.ranked ?? [], primary);
  const ids = (k: PlanEntry['kind']) => plan.entries.filter((e) => e.kind === k).map((e) => e.id);
  const selection: Sel = { work: ids('work'), projects: ids('projects'), education: ids('education').length ? ids('education') : p.education.filter((x) => x.enabled).map((x) => x.id), skills: plan.skills, certificates: plan.certificates, awards: plan.awards };
  // 语言成绩（PTE / IELTS / CET…）几乎所有岗位都需要；排版时归入技能「语言」组
  for (const id of p.certificates.filter((c) => c.enabled && LANG_TEST.test(`${c.name.zh} ${c.name.en}`)).map((c) => c.id)) if (!selection.certificates.includes(id)) selection.certificates.push(id);
  return {
    id: uid('resume'), jobId: job.id, templateId: '', primaryLanguage: primary, createdAt: new Date().toISOString(),
    matchScore: cov.matchScore, gaps: cov.gaps, selection, items,
    consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai', notes: [...(out.reasons ? [String(out.reasons)] : []), ...notes, ...dropNotes(p, plan), ...conflictNotes(p, job)],
  };
}

/**
 * 判定一条副版本（A2）：
 * 1) AI 译文与主版本关键事实一致 → in-sync；
 * 2) 否则若资料库有「已确认」历史译文且事实一致 → 用它，in-sync；
 * 3) 否则 needs-review：保留 AI 译文（或资料库译文）供人工核对，绝不标记为已同步，也不删除数字。
 */
export function decideTranslation(pri: string, aiText: string | undefined, confirmedPrior: string | undefined, profileText: string | undefined): { text: string; syncStatus: GenItem['syncStatus']; translation: NonNullable<GenItem['translation']> } {
  const checkedAt = new Date().toISOString();
  const ai = aiText?.trim() || undefined;
  const aiIssues = ai ? compareFacts(pri, ai) : ['AI 未返回译文'];
  if (ai && !aiIssues.length) return { text: ai, syncStatus: 'in-sync', translation: { source: 'ai', factIssues: [], checkedAt } };
  if (confirmedPrior && !compareFacts(pri, confirmedPrior).length) return { text: confirmedPrior, syncStatus: 'in-sync', translation: { source: 'confirmed', aiText: ai, factIssues: aiIssues, checkedAt } };
  if (ai) return { text: ai, syncStatus: 'needs-review', translation: { source: 'ai', aiText: ai, factIssues: aiIssues, checkedAt } };
  if (profileText) return { text: profileText, syncStatus: 'needs-review', translation: { source: 'profile', factIssues: [...aiIssues, ...compareFacts(pri, profileText)], checkedAt } };
  return { text: '', syncStatus: 'needs-review', translation: { source: 'none', factIssues: aiIssues, checkedAt } };
}

/** 基于主版本本地化副版本（F5.6 第二步）；校验失败重试 1 次，仍失败按 decideTranslation 回退 */
export async function localizeAi(s: Settings, p: ProfileDoc, job: JobParse | null, r: ResumeDoc, onlyIds?: string[]): Promise<ResumeDoc> {
  const pri = r.primaryLanguage, sec = other(pri), idx = textIndex(p);
  // 用户人工确认过的副版本优先保留，不再重译（B6）
  const target = r.items.filter((i) => (!onlyIds || onlyIds.includes(i.sourceId)) && !i.confirmedLangs?.includes(sec));
  const payload = {
    glossary: p.glossary, keywords: (job?.keywords ?? []).map((k) => ({ [pri]: k[pri], [sec]: k[sec] })),
    reference: target.map((i) => { const t = idx.get(i.sourceId)?.t; return t && t.status?.[sec] === 'confirmed' ? { sourceId: i.sourceId, [pri]: lt(t, pri, false), [sec]: lt(t, sec, false) } : null; }).filter(Boolean),
    items: target.map((i) => ({ sourceId: i.sourceId, text: i[pri] })),
  };
  // 两次尝试中，每条保留第一份通过事实校验的译文；都没通过时保留最后一份 AI 译文供核对
  const best = new Map<string, string>(); const passed = new Set<string>(); const kctxL = buildKitContext(p, null);
  for (let attempt = 0; attempt < 2 && target.length; attempt++) {
    const out = await chatJson<{ items?: { sourceId: string; text: string }[] }>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content: `${LOCALIZE_PROMPT(NAME[pri], NAME[sec])}\n\n${JSON.stringify(payload)}` }], { model: s.translateModel || s.model });
    for (const x of out.items ?? []) {
      if (!x?.sourceId || !x.text?.trim() || passed.has(x.sourceId)) continue;
      const it = target.find((i) => i.sourceId === x.sourceId); if (!it) continue;
      // v1.10.1：译文里出现资料中没有的工具 / 专业名（如把「轮机工程」译成别的专业）直接不采用
      if (unsupportedEntities(x.text, sec, kctxL.corpus, [], kctxL.majors).length || entityTokens(x.text, sec).some((t) => !hasTerm(kctxL.corpus, t))) continue;
      best.set(x.sourceId, x.text.trim());
      if (!compareFacts(it[pri], x.text).length) passed.add(x.sourceId);
    }
    if (target.every((i) => passed.has(i.sourceId))) break;
  }
  const targetIds = new Set(target.map((i) => i.sourceId));
  const items = r.items.map((i): GenItem => {
    if (!targetIds.has(i.sourceId)) return i;
    const t = idx.get(i.sourceId)?.t;
    const confirmedPrior = t && t.status?.[sec] === 'confirmed' && lt(t, pri, false) === i[pri] ? lt(t, sec, false) : undefined;
    const d = decideTranslation(i[pri], best.get(i.sourceId), confirmedPrior, t ? lt(t, sec, false) || undefined : undefined);
    return { ...i, [sec]: d.text, syncStatus: d.syncStatus, translation: d.translation };
  });
  const next = { ...r, items };
  fillSecondaryFromProfile(p, next, false);
  return runConsistency(next);
}

/** v1.9.1：简历条目若直接用了资料库里「已过期」的译文（另一语言修改后未重新翻译），标为需核对，不静默当作同步 */
export function flagStale(p: ProfileDoc, r: ResumeDoc): ResumeDoc {
  const idx = textIndex(p);
  const items = r.items.map((i): GenItem => {
    const t = idx.get(i.sourceId)?.t; if (!t) return i;
    const st = (['zh', 'en'] as Lang[]).filter((l) => t.status?.[l] === 'stale' && i[l].trim() && i[l].trim() === (t[l] ?? '').trim());
    if (!st.length) return i;
    const msg = st.map((l) => `资料库${l === 'zh' ? '中文' : '英文'}已过期（另一语言修改后尚未重新翻译），请重新补译或核对`);
    return { ...i, syncStatus: 'needs-review', translation: { source: 'profile', ...(i.translation ?? {}), factIssues: [...new Set([...(i.translation?.factIssues ?? []), ...msg])], checkedAt: new Date().toISOString() } };
  });
  return { ...r, items };
}

export async function generateResume(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number, onStep?: (m: string) => void): Promise<ResumeDoc> {
  return flagStale(p, await generateResumeInner(s, p, job, primary, targetPages, onStep));
}
async function generateResumeInner(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number, onStep?: (m: string) => void): Promise<ResumeDoc> {
  if (s.demoMode) {
    onStep?.('演示模式：规则匹配中…');
    const r = generateRules(p, job, primary, targetPages);
    fillSecondaryFromProfile(p, r, true);
    return runConsistency(r);
  }
  let r: ResumeDoc;
  try {
    onStep?.(`生成${NAME[primary]}主版本…`);
    r = await generatePrimaryAi(s, p, job, primary, targetPages);
  } catch (e) {
    onStep?.('AI 生成失败，降级为规则匹配');
    r = generateRules(p, job, primary, targetPages);
    r.notes = [...(r.notes ?? []), `AI 错误：${(e as Error).message}`];
    fillSecondaryFromProfile(p, r, false);
    return runConsistency(r);
  }
  try {
    onStep?.(`本地化${NAME[other(primary)]}副版本…`);
    return await localizeAi(s, p, job, r);
  } catch (e) {
    r.notes = [...(r.notes ?? []), `副版本本地化失败，使用资料库译文：${(e as Error).message}`];
    fillSecondaryFromProfile(p, r, false);
    return runConsistency(r);
  }
}
