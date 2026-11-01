import type { Bi, GenItem, JobParse, Lang, LocalizedText, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson } from './provider';
import { GENERATE_PROMPT, LOCALIZE_PROMPT, SYS_FACTS } from './prompts';
import { checkConsistency, compareFacts, numberTokens } from './consistency';
import { lt, other, uid } from '../locale/text';
import { mockTranslate } from './translate';
import { isResumeSafe } from '../quality/contentQuality';
import { guardRewrite } from '../quality/resumeGuard';
import { compactSummary, conciseBi, jobTerms, overlap, planResume, relevance, type PlanEntry, LANG_TEST } from './relevance';
/** v1.9 最后一道防线：核验说明 / 写作建议等元信息要点不进入简历（资料库原文不改） */
const safeB = (bs: LocalizedText[]) => bs.filter((b) => isResumeSafe(b.zh || b.en || ''));

type Sel = ResumeDoc['selection'];
const NAME: Record<Lang, string> = { zh: '中文', en: '英文' };
const SEL_KEYS = ['work', 'projects', 'education', 'skills', 'certificates', 'awards'] as const;

/** 资料库中所有可改写文本（summary / bullet / highlight），按 sourceId 索引 */
export function textIndex(p: ProfileDoc): Map<string, { t: LocalizedText; parent: string }> {
  const m = new Map<string, { t: LocalizedText; parent: string }>();
  m.set('summary', { t: p.profile.summary, parent: 'profile' });
  p.work.forEach((e) => e.bullets.forEach((b) => b.id && m.set(b.id, { t: b, parent: e.id })));
  p.projects.forEach((e) => e.bullets.forEach((b) => b.id && m.set(b.id, { t: b, parent: e.id })));
  p.education.forEach((e) => e.highlights.forEach((b) => b.id && m.set(b.id, { t: b, parent: e.id })));
  return m;
}

const kwHit = (text: string, k: Bi) => { const l = text.toLowerCase(); return (!!k.zh && l.includes(k.zh.toLowerCase())) || (!!k.en && l.includes(k.en.toLowerCase())); };
const entryText = (p: ProfileDoc) => JSON.stringify({ w: p.work, pr: p.projects, s: p.skills, e: p.education, c: p.certificates }).toLowerCase();

/**
 * 规则匹配（演示模式 / AI 失败降级，PRD 6.4）：v1.10 改为按 JD 相关性挑选（planResume），
 * 每段经历只取最相关、互不重复的要点，并按句精简（中英同步取舍）；不改写措辞，母库不变。
 */
export function generateRules(p: ProfileDoc, job: JobParse, primary: Lang, targetPages = 1): ResumeDoc {
  const plan = planResume(p, job, primary, targetPages);
  const terms = jobTerms(job);
  const idx = textIndex(p);
  const items: GenItem[] = [];
  const en = <T extends { enabled: boolean }>(a: T[]) => a.filter((x) => x.enabled);
  const sumZh = lt(p.profile.summary, 'zh', false), sumEn = lt(p.profile.summary, 'en', false);
  if (lt(p.profile.summary, primary)) items.push({ sourceId: 'summary', zh: sumZh ? compactSummary(sumZh, 'zh') : '', en: sumEn ? compactSummary(sumEn, 'en') : '', syncStatus: 'in-sync' });
  for (const e of plan.entries) for (const id of e.bulletIds) {
    const t = idx.get(id)?.t; if (!t) continue;
    const c = e.kind === 'education' ? { zh: lt(t, 'zh', false), en: lt(t, 'en', false) } : conciseBi(t, terms, primary);
    items.push({ sourceId: id, zh: c.zh, en: c.en, syncStatus: 'in-sync' });
  }
  const all = entryText(p);
  const reqs = job.mustHave.length ? job.mustHave : job.keywords;
  const covered = reqs.filter((k) => kwHit(all, k));
  const gaps = reqs.filter((k) => !kwHit(all, k)).map((k) => k[primary] || k.zh || k.en);
  const ids = (k: PlanEntry['kind']) => plan.entries.filter((e) => e.kind === k).map((e) => e.id);
  const res: ResumeDoc = {
    id: uid('resume'), jobId: job.id, templateId: '', primaryLanguage: primary, createdAt: new Date().toISOString(),
    matchScore: reqs.length ? Math.round((covered.length / reqs.length) * 100) : 0, gaps,
    selection: { work: ids('work'), projects: ids('projects'), education: ids('education').length ? ids('education') : en(p.education).map((x) => x.id), skills: plan.skills, certificates: plan.certificates, awards: plan.awards },
    items, consistency: { checkedAt: '', issues: [] }, generatedBy: 'rules',
    notes: ['规则匹配：按岗位相关性挑选并精简要点（未改写措辞），资料库原文不变；未选中的经历和要点可在左侧清单手动勾选'],
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

/** AI 生成主版本（F5.6 第一步） */
async function generatePrimaryAi(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number): Promise<ResumeDoc> {
  // v1.9.1：主语言译文已过期（另一语言改过）时，改用最新的另一语言原文交给 AI 重写，不静默使用过期译文
  const T = (t: LocalizedText) => (t?.status?.[primary] === 'stale' ? lt(t, other(primary)) : lt(t, primary));
  // 不发送照片、出生年月、性别、籍贯等敏感信息（PRD 8）
  const lib = {
    summary: T(p.profile.summary), headline: T(p.profile.headline),
    work: p.work.filter((x) => x.enabled).map((w) => ({ id: w.id, company: T(w.company), title: T(w.title), start: w.start, end: w.end, tags: w.tags, bullets: safeB(w.bullets).map((b) => ({ sourceId: b.id, text: T(b) })) })),
    projects: p.projects.filter((x) => x.enabled).map((w) => ({ id: w.id, name: T(w.name), role: T(w.role), tags: w.tags, bullets: safeB(w.bullets).map((b) => ({ sourceId: b.id, text: T(b) })) })),
    education: p.education.filter((x) => x.enabled).map((e) => ({ id: e.id, school: T(e.school), major: T(e.major), degree: T(e.degree), highlights: safeB(e.highlights).map((b) => ({ sourceId: b.id, text: T(b) })) })),
    skills: p.skills.filter((x) => x.enabled).map((k) => ({ id: k.id, name: T(k.name) })),
    certificates: p.certificates.filter((x) => x.enabled).map((k) => ({ id: k.id, name: T(k.name) })),
    awards: p.awards.filter((x) => x.enabled).map((k) => ({ id: k.id, name: T(k.name) })),
  };
  const jobBrief = { title: job.title, mustHave: job.mustHave.map((k) => k[primary]), responsibilities: (job.responsibilities ?? []).map((k) => k[primary] || k[other(primary)]), niceToHave: job.niceToHave.map((k) => k[primary]), yearsRequired: job.yearsRequired, keywords: job.keywords.map((k) => k[primary]), summary: job.summary };
  type Out = { selection?: Partial<Sel>; items?: { sourceId: string; text: string }[]; matchScore?: number; gaps?: string[]; reasons?: string };
  const out = await chatJson<Out>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content: `${GENERATE_PROMPT(NAME[primary], targetPages > 1 ? 5 : 4)}\n\n目标页数：${targetPages}\n岗位：${JSON.stringify(jobBrief)}\n资料库：${JSON.stringify(lib)}` }]);

  // 校验：只保留资料库中真实存在的 id（防编造，PRD 6.1）
  const idx = textIndex(p);
  const terms = jobTerms(job);
  const exists: Record<keyof Sel, Set<string>> = { work: new Set(p.work.map((x) => x.id)), projects: new Set(p.projects.map((x) => x.id)), education: new Set(p.education.map((x) => x.id)), skills: new Set(p.skills.map((x) => x.id)), certificates: new Set(p.certificates.map((x) => x.id)), awards: new Set(p.awards.map((x) => x.id)) };
  const selection = {} as Sel;
  for (const k of SEL_KEYS) selection[k] = [...new Set((out.selection?.[k] ?? []).filter((id) => exists[k].has(id)))];
  if (!selection.work.length) selection.work = p.work.filter((x) => x.enabled).map((x) => x.id);
  if (!selection.education.length) selection.education = p.education.filter((x) => x.enabled).map((x) => x.id);
  const notes: string[] = [];
  const seen = new Set<string>();
  const items: GenItem[] = [];
  for (const it of out.items ?? []) {
    const inSelection = Object.values(exists).some((set) => set.has(it.sourceId));
    if (!idx.has(it.sourceId) || seen.has(it.sourceId) || !it.text?.trim()) { if (it.sourceId && !idx.has(it.sourceId) && !inSelection) notes.push(`已丢弃无来源条目：${it.sourceId}`); continue; }
    const orig = lt(idx.get(it.sourceId)!.t, primary);
    let text: string;
    if (!orig) {
      // 资料库没有简介时允许 AI 依据资料撰写，但其中每个数字都必须在资料库中出现过
      const libNums = new Set(numberTokens(JSON.stringify(lib)));
      if (it.sourceId !== 'summary' || !numberTokens(it.text).every((n) => libNums.has(n))) { notes.push(`${it.sourceId} 原文为空且含资料库外的数字，已丢弃`); continue; }
      text = it.text.trim();
    } else {
      // v1.10：允许省略次要事实；不允许新增 / 改动数字、删除限定、抬高参与程度（guardRewrite）。
      // 未通过时不再回退整段原文，而是用确定性的精简原文（conciseBi，仍保证不丢限定）
      const bad = guardRewrite(orig, it.text, primary);
      if (bad.length) { text = conciseBi(idx.get(it.sourceId)!.t, terms, primary)[primary] || orig; notes.push(`${it.sourceId} 改写未通过事实护栏（${bad.join('；')}），已改用精简原文`); }
      else text = it.text.trim();
    }
    if (it.sourceId === 'summary') text = compactSummary(text, primary);
    seen.add(it.sourceId);
    items.push({ sourceId: it.sourceId, zh: primary === 'zh' ? text : '', en: primary === 'en' ? text : '', syncStatus: 'in-sync' });
  }
  // v1.10 密度控制：每段经历按岗位相关性设软上限，去掉同一段里表达同一件事的要点
  const plan = planResume(p, job, primary, targetPages);
  // 语言成绩（PTE / IELTS / CET…）几乎所有岗位都需要；AI 漏选时补回（排版时归入技能「语言」组）
  for (const id of p.certificates.filter((c) => c.enabled && LANG_TEST.test(`${c.name.zh} ${c.name.en}`)).map((c) => c.id)) if (!selection.certificates.includes(id)) selection.certificates.push(id);
  const planOf = new Map(plan.entries.map((e) => [e.id, e]));
  const byParent = new Map<string, GenItem[]>();
  for (const i of items) { const par = idx.get(i.sourceId)?.parent ?? ''; byParent.set(par, [...(byParent.get(par) ?? []), i]); }
  const drop = new Set<string>();
  for (const [par, list] of byParent) {
    if (par === 'profile') continue;
    const pe = planOf.get(par);
    const isEdu = p.education.some((e) => e.id === par);
    const cap = isEdu ? plan.caps.core : pe?.core ? plan.caps.core : plan.caps.minor + 1;
    const ranked = list.map((i, k) => ({ i, k, s: relevance(i[primary], terms) })).sort((a, b) => b.s - a.s || a.k - b.k);
    const keep: GenItem[] = [];
    for (const x of ranked) { if (keep.length >= cap || keep.some((y) => overlap(y[primary], x.i[primary]) > 0.45)) { drop.add(x.i.sourceId); continue; } keep.push(x.i); }
  }
  if (drop.size) notes.push(`按相关性与篇幅省略了 ${drop.size} 条次要或重复要点（资料库保留，可手动勾选）`);
  const kept = items.filter((i) => !drop.has(i.sourceId));
  items.length = 0; items.push(...kept);
  // 修复（v1.10 bug A）：选中的经历若 AI 没有返回任何要点，不再整段带上全部原始要点，
  // 只补入按相关性挑选的 1–2 条精简原文；与岗位无关的次要经历保持空要点（只显示标题），用户可手动勾选
  const withItems = new Set(items.map((i) => idx.get(i.sourceId)?.parent));
  const fill = (id: string, bullets: LocalizedText[], kind: PlanEntry['kind']) => {
    if (withItems.has(id)) return;
    const ids = planOf.get(id)?.bulletIds ?? [];
    const chosen = (ids.length ? ids.map((x) => bullets.find((b) => b.id === x)).filter((b): b is LocalizedText => !!b) : []).slice(0, kind === 'education' ? 3 : 2);
    for (const b of chosen) { const c = kind === 'education' ? { zh: lt(b, 'zh'), en: lt(b, 'en') } : conciseBi(b, terms, primary); items.push({ sourceId: b.id!, zh: primary === 'zh' ? c.zh : '', en: primary === 'en' ? c.en : '', syncStatus: 'in-sync' }); }
    if (chosen.length) notes.push(`${id} AI 未返回要点，已按相关性补入 ${chosen.length} 条精简原文`);
  };
  for (const e of p.work.filter((x) => selection.work.includes(x.id))) fill(e.id, e.bullets, 'work');
  for (const e of p.projects.filter((x) => selection.projects.includes(x.id))) fill(e.id, e.bullets, 'projects');
  for (const e of p.education.filter((x) => selection.education.includes(x.id))) fill(e.id, e.highlights, 'education');
  return {
    id: uid('resume'), jobId: job.id, templateId: '', primaryLanguage: primary, createdAt: new Date().toISOString(),
    matchScore: Math.max(0, Math.min(100, Math.round(out.matchScore ?? 0))), gaps: (out.gaps ?? []).map(String), selection, items,
    consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai', notes: [...(out.reasons ? [out.reasons] : []), ...notes],
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
  const best = new Map<string, string>(); const passed = new Set<string>();
  for (let attempt = 0; attempt < 2 && target.length; attempt++) {
    const out = await chatJson<{ items?: { sourceId: string; text: string }[] }>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content: `${LOCALIZE_PROMPT(NAME[pri], NAME[sec])}\n\n${JSON.stringify(payload)}` }], { model: s.translateModel || s.model });
    for (const x of out.items ?? []) {
      if (!x?.sourceId || !x.text?.trim() || passed.has(x.sourceId)) continue;
      const it = target.find((i) => i.sourceId === x.sourceId); if (!it) continue;
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
