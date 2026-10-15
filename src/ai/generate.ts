import type { Bi, GenItem, JobParse, Lang, LocalizedText, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson } from './provider';
import { GENERATE_PROMPT, LOCALIZE_PROMPT, SYS_FACTS } from './prompts';
import { checkConsistency, numberTokens } from './consistency';
import { lt, other, uid } from '../locale/text';
import { mockTranslate } from './translate';

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

/** 规则匹配（演示模式 / AI 失败降级，PRD 6.4）：关键词重叠打分 + 原文经历，不改写 */
export function generateRules(p: ProfileDoc, job: JobParse, primary: Lang, maxBullets = 4): ResumeDoc {
  const kws = [...job.mustHave, ...job.keywords, ...job.niceToHave];
  const score = (t: string) => kws.reduce((s, k) => s + (kwHit(t, k) ? 1 : 0), 0);
  const en = <T extends { enabled: boolean }>(a: T[]) => a.filter((x) => x.enabled);
  const items: GenItem[] = [];
  const push = (id: string, t: LocalizedText) => items.push({ sourceId: id, zh: lt(t, 'zh', false), en: lt(t, 'en', false), syncStatus: 'in-sync' });
  if (lt(p.profile.summary, primary)) push('summary', p.profile.summary);
  const pickBullets = (bs: LocalizedText[], tags: string[]) => {
    const ranked = bs.map((b, i) => ({ b, i, s: score(lt(b, 'zh') + ' ' + lt(b, 'en') + ' ' + tags.join(' ')) })).sort((a, b) => b.s - a.s || a.i - b.i);
    return ranked.slice(0, maxBullets).sort((a, b) => a.i - b.i).map((x) => x.b);
  };
  const work = en(p.work);
  work.forEach((w) => pickBullets(w.bullets, w.tags).forEach((b) => b.id && push(b.id, b)));
  const projScored = en(p.projects).map((x) => ({ x, s: score(JSON.stringify(x)) })).sort((a, b) => b.s - a.s);
  const projects = projScored.filter((x, i) => x.s > 0 || i < 2).map((x) => x.x);
  projects.forEach((pr) => pickBullets(pr.bullets, pr.tags).forEach((b) => b.id && push(b.id, b)));
  const edu = en(p.education);
  edu.forEach((e) => e.highlights.forEach((b) => b.id && push(b.id, b)));
  const skills = en(p.skills).map((x) => ({ x, s: score(lt(x.name, 'zh') + ' ' + lt(x.name, 'en')) })).sort((a, b) => b.s - a.s).map((x) => x.x);
  const all = entryText(p);
  const reqs = job.mustHave.length ? job.mustHave : job.keywords;
  const covered = reqs.filter((k) => kwHit(all, k));
  const gaps = reqs.filter((k) => !kwHit(all, k)).map((k) => k[primary] || k.zh || k.en);
  const res: ResumeDoc = {
    id: uid('resume'), jobId: job.id, templateId: '', primaryLanguage: primary, createdAt: new Date().toISOString(),
    matchScore: reqs.length ? Math.round((covered.length / reqs.length) * 100) : 0, gaps,
    selection: { work: work.map((x) => x.id), projects: projects.map((x) => x.id), education: edu.map((x) => x.id), skills: skills.map((x) => x.id), certificates: en(p.certificates).map((x) => x.id), awards: en(p.awards).map((x) => x.id) },
    items, consistency: { checkedAt: '', issues: [] }, generatedBy: 'rules',
    notes: ['规则匹配：未改写措辞，副版本使用资料库已有译文'],
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

function validateNumbers(items: GenItem[]) { return items.filter((i) => numberTokens(i.zh).join() !== numberTokens(i.en).join()).map((i) => i.sourceId); }

export function runConsistency(r: ResumeDoc): ResumeDoc {
  return { ...r, consistency: { checkedAt: new Date().toISOString(), issues: checkConsistency(r.items) } };
}

/** AI 生成主版本（F5.6 第一步） */
async function generatePrimaryAi(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number): Promise<ResumeDoc> {
  const T = (t: LocalizedText) => lt(t, primary);
  // 不发送照片、出生年月、性别、籍贯等敏感信息（PRD 8）
  const lib = {
    summary: T(p.profile.summary), headline: T(p.profile.headline),
    work: p.work.filter((x) => x.enabled).map((w) => ({ id: w.id, company: T(w.company), title: T(w.title), start: w.start, end: w.end, tags: w.tags, bullets: w.bullets.map((b) => ({ sourceId: b.id, text: T(b) })) })),
    projects: p.projects.filter((x) => x.enabled).map((w) => ({ id: w.id, name: T(w.name), role: T(w.role), tags: w.tags, bullets: w.bullets.map((b) => ({ sourceId: b.id, text: T(b) })) })),
    education: p.education.filter((x) => x.enabled).map((e) => ({ id: e.id, school: T(e.school), major: T(e.major), degree: T(e.degree), highlights: e.highlights.map((b) => ({ sourceId: b.id, text: T(b) })) })),
    skills: p.skills.filter((x) => x.enabled).map((k) => ({ id: k.id, name: T(k.name) })),
    certificates: p.certificates.filter((x) => x.enabled).map((k) => ({ id: k.id, name: T(k.name) })),
    awards: p.awards.filter((x) => x.enabled).map((k) => ({ id: k.id, name: T(k.name) })),
  };
  const jobBrief = { title: job.title, mustHave: job.mustHave.map((k) => k[primary]), niceToHave: job.niceToHave.map((k) => k[primary]), yearsRequired: job.yearsRequired, keywords: job.keywords.map((k) => k[primary]), summary: job.summary };
  type Out = { selection?: Partial<Sel>; items?: { sourceId: string; text: string }[]; matchScore?: number; gaps?: string[]; reasons?: string };
  const out = await chatJson<Out>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content: `${GENERATE_PROMPT(NAME[primary], targetPages > 1 ? 5 : 4)}\n\n目标页数：${targetPages}\n岗位：${JSON.stringify(jobBrief)}\n资料库：${JSON.stringify(lib)}` }]);

  // 校验：只保留资料库中真实存在的 id（防编造，PRD 6.1）
  const idx = textIndex(p);
  const exists: Record<keyof Sel, Set<string>> = { work: new Set(p.work.map((x) => x.id)), projects: new Set(p.projects.map((x) => x.id)), education: new Set(p.education.map((x) => x.id)), skills: new Set(p.skills.map((x) => x.id)), certificates: new Set(p.certificates.map((x) => x.id)), awards: new Set(p.awards.map((x) => x.id)) };
  const selection = {} as Sel;
  for (const k of SEL_KEYS) selection[k] = [...new Set((out.selection?.[k] ?? []).filter((id) => exists[k].has(id)))];
  if (!selection.work.length) selection.work = p.work.filter((x) => x.enabled).map((x) => x.id);
  if (!selection.education.length) selection.education = p.education.filter((x) => x.enabled).map((x) => x.id);
  const notes: string[] = [];
  const seen = new Set<string>();
  const items: GenItem[] = [];
  for (const it of out.items ?? []) {
    if (!idx.has(it.sourceId) || seen.has(it.sourceId) || !it.text?.trim()) { if (it.sourceId && !idx.has(it.sourceId)) notes.push(`已丢弃无来源条目：${it.sourceId}`); continue; }
    // 数字不得被改写：与原文数字集合不同则回退原文
    const orig = lt(idx.get(it.sourceId)!.t, primary);
    const text = numberTokens(orig).join() === numberTokens(it.text).join() ? it.text.trim() : orig;
    if (text === orig && orig !== it.text.trim()) notes.push(`${it.sourceId} 改写改动了数字，已回退原文`);
    seen.add(it.sourceId);
    items.push({ sourceId: it.sourceId, zh: primary === 'zh' ? text : '', en: primary === 'en' ? text : '', syncStatus: 'in-sync' });
  }
  return {
    id: uid('resume'), jobId: job.id, templateId: '', primaryLanguage: primary, createdAt: new Date().toISOString(),
    matchScore: Math.max(0, Math.min(100, Math.round(out.matchScore ?? 0))), gaps: (out.gaps ?? []).map(String), selection, items,
    consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai', notes: [...(out.reasons ? [out.reasons] : []), ...notes],
  };
}

/** 基于主版本本地化副版本（F5.6 第二步）；校验失败重试 1 次，仍失败用资料库译文 */
export async function localizeAi(s: Settings, p: ProfileDoc, job: JobParse | null, r: ResumeDoc, onlyIds?: string[]): Promise<ResumeDoc> {
  const pri = r.primaryLanguage, sec = other(pri), idx = textIndex(p);
  const target = r.items.filter((i) => !onlyIds || onlyIds.includes(i.sourceId));
  const payload = {
    glossary: p.glossary, keywords: (job?.keywords ?? []).map((k) => ({ [pri]: k[pri], [sec]: k[sec] })),
    reference: target.map((i) => { const t = idx.get(i.sourceId)?.t; return t && t.status?.[sec] === 'confirmed' ? { sourceId: i.sourceId, [pri]: lt(t, pri, false), [sec]: lt(t, sec, false) } : null; }).filter(Boolean),
    items: target.map((i) => ({ sourceId: i.sourceId, text: i[pri] })),
  };
  let got = new Map<string, string>();
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await chatJson<{ items?: { sourceId: string; text: string }[] }>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content: `${LOCALIZE_PROMPT(NAME[pri], NAME[sec])}\n\n${JSON.stringify(payload)}` }], { model: s.translateModel || s.model });
    got = new Map((out.items ?? []).filter((x) => x.sourceId && x.text).map((x) => [x.sourceId, x.text.trim()]));
    const trial = target.map((i) => ({ ...i, [sec]: got.get(i.sourceId) ?? '' }));
    const okIds = target.every((i) => got.has(i.sourceId)) && got.size === target.length;
    if (okIds && validateNumbers(trial).length === 0) break;
  }
  const items = r.items.map((i) => {
    if (onlyIds && !onlyIds.includes(i.sourceId)) return i;
    const v = got.get(i.sourceId);
    const ok = v && numberTokens(v).join() === numberTokens(i[pri]).join();
    return { ...i, [sec]: ok ? v : (v || ''), syncStatus: 'in-sync' as const };
  });
  const next = { ...r, items };
  fillSecondaryFromProfile(p, next, false);
  return runConsistency(next);
}

export async function generateResume(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number, onStep?: (m: string) => void): Promise<ResumeDoc> {
  if (s.demoMode) {
    onStep?.('演示模式：规则匹配中…');
    const r = generateRules(p, job, primary);
    fillSecondaryFromProfile(p, r, true);
    return runConsistency(r);
  }
  let r: ResumeDoc;
  try {
    onStep?.(`生成${NAME[primary]}主版本…`);
    r = await generatePrimaryAi(s, p, job, primary, targetPages);
  } catch (e) {
    onStep?.('AI 生成失败，降级为规则匹配');
    r = generateRules(p, job, primary);
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
