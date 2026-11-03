import type { Bi, GenItem, JobParse, Lang, LocalizedText, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson } from './provider';
import { AI_WRITE_PROMPT, LOCALIZE_PROMPT, SYS_FACTS } from './prompts';
import { checkConsistency, compareFacts, numberTokens } from './consistency';
import { lt, other, uid } from '../locale/text';
import { mockTranslate } from './translate';
import { factGuard } from '../quality/resumeGuard';
import { buildKitContext, entityTokens, unsupportedEntities } from '../quality/kitVerify';
import { hasTerm, conciseBi, jobTerms, planResume, type PlanEntry, type ResumePlan } from './relevance';
import { coverage, stripAuthorList } from './evidence';
import { fixedSummaryItem, fixedSummaryNotes, fixedSummaryText } from './fixedSummary';
import { fitContent, pageBudget, type ContentOptions } from './contentStrategy';
import { sourceText } from './provenance';
import { isUnjudged } from '../joint/normalize';
import { decisionModel, planWithAi, type AiSelectionResult } from './aiPlanner';
import { createEvidenceReport, refreshReportSelection } from '../joint/report';
import { academicHighlight, courseSelectionSnapshot, profileForGeneration } from '../privacy/resume';

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
  p = profileForGeneration(p);
  const plan = planResume(p, job, primary, targetPages);
  const terms = jobTerms(job);
  const idx = textIndex(p);
  const items: GenItem[] = [];
  const en = <T extends { enabled: boolean }>(a: T[]) => a.filter((x) => x.enabled);
  const fixed = fixedSummaryItem(p);
  if (fixed) items.push(fixed);
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
    notes: [...fixedSummaryNotes(p), '规则匹配：按岗位能力分层挑选并精简要点（未改写措辞），资料库原文不变；未选中的经历和要点可在左侧清单手动勾选', ...dropNotes(p, plan), ...conflictNotes(p, job)],
  };
  return res;
}

/** 副版本缺失时用资料库译文；仍缺失时（演示模式）用演示机翻 */
function fillSecondaryFromProfile(p: ProfileDoc, r: ResumeDoc, demo: boolean) {
  const sec = other(r.primaryLanguage);
  for (const it of r.items) {
    if (it.sourceId === 'summary') continue;
    if (it[sec].trim() || it.confirmedLangs?.includes(sec)) continue;
    const src = sourceText(p, it);
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
 * v1.12：AI 先阅读完整有效母库并决定选材、项目重点、技能和篇幅；再撰写。
 * 2026-11（Claude 接手）：
 * - 撰写一次同时产出中英文，各按本语言习惯写（不再由主版本机翻出副版本）；
 * - 简介与姓名下的求职方向按岗位定制（未通过检查时回退到资料库固定简介 / 求职方向）；
 * - 事实护栏只拦「原文没有的数字」和「原文没有的工具 / 专有名词」，不再因措辞限定词整条退回母库原文。
 */
type WriteOut = { headline?: Partial<Bi>; summary?: Partial<Bi>; items?: { sourceId: string; sourceIds?: string[]; zh?: string; en?: string; text?: string }[]; reasons?: string };

/** 选材要点数上限：AI 有时把一个项目的 20+ 条事实全选进来，撰写步骤输出会被截断。
 *  主选每段最多 8 条、候补每段最多 4 条；总数超过版面软参考约 1.5 倍时，先从候补、再从要点最多的主选末尾（最不重要）开始删。教育条目不动。 */
export function capPlanFacts(entries: PlanEntry[], softFactTarget: number): PlanEntry[] {
  const out = entries.map((e) => e.kind === 'education' ? e : { ...e, bulletIds: e.bulletIds.slice(0, e.core ? 8 : 4) });
  const maxTotal = Math.max(24, Math.round(softFactTarget * 1.5));
  const count = () => out.filter((e) => e.kind !== 'education').reduce((n, e) => n + e.bulletIds.length, 0);
  for (let guard = 0; count() > maxTotal && guard < 500; guard++) {
    const pool = (core: boolean) => out.filter((e) => e.kind !== 'education' && !!e.core === core && e.bulletIds.length > (core ? 2 : 1));
    const cand = pool(false).length ? pool(false) : pool(true);
    if (!cand.length) break;
    const e = cand.reduce((a, b) => (b.bulletIds.length >= a.bulletIds.length ? b : a));
    e.bulletIds = e.bulletIds.slice(0, -1);
  }
  return out;
}

/** 去掉含问题词的句子，保留其余句子；中英文任一语言保留下来即可用（另一语言稍后本地化补齐）。 */
export function salvageSummary(c: { value: Bi | null; bad: string[] }): Bi | null {
  if (!c.value) return null;
  const terms = c.bad.map((b) => b.replace(/^数字\s*/, '').trim().toLowerCase()).filter(Boolean);
  const clean = (t: string) => (t.match(/[^。！？.!?]+[。！？.!?]?/g) ?? []).filter((x) => !terms.some((w) => x.toLowerCase().includes(w))).join('').trim();
  const zh = clean(c.value.zh), en = clean(c.value.en);
  return zh.length >= 20 || en.length >= 40 ? { zh, en } : null;
}

async function generatePrimaryAi(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number, onStep?: (m: string) => void, options: ContentOptions = {}): Promise<{ resume: ResumeDoc; decision: AiSelectionResult }> {
  const sec = other(primary);
  // v1.9.1：主语言译文已过期（另一语言改过）时，改用最新的另一语言原文交给 AI 重写，不静默使用过期译文
  const T = (t: LocalizedText) => (t?.status?.[primary] === 'stale' ? lt(t, other(primary)) : lt(t, primary));
  const A = (t: LocalizedText) => (t?.status?.[sec] === 'stale' ? '' : (t?.[sec] ?? '').trim());
  const decision = await planWithAi(s, p, job, primary, targetPages, onStep, options.template);
  const plan = { ...decision.plan, entries: capPlanFacts([...decision.plan.entries, ...decision.reserves], pageBudget(targetPages, primary, options.template, p).softFactTarget) };
  const idx = textIndex(p);
  const terms = jobTerms(job);
  const rankOf = new Map((plan.ranked ?? []).map((r, i) => [r.id, { r, i }]));
  const entryName = (id: string) => { const w = p.work.find((x) => x.id === id); if (w) return { entry: T(w.company), role: T(w.title) }; const pr = p.projects.find((x) => x.id === id); if (pr) return { entry: T(pr.name), role: T(pr.role), nature: pr.nature ?? '' }; const ed = p.education.find((x) => x.id === id); return { entry: ed ? T(ed.school) : id, role: ed ? T(ed.major) : '' }; };
  // 不发送照片、出生年月、性别、籍贯等敏感信息（PRD 8）；只发送本简历选中的事实
  let aiPriority = 0;
  const facts = plan.entries.filter((e) => e.kind !== 'education').flatMap((e) => e.bulletIds.map((id) => ({ sourceId: id, entryId: e.id, ...entryName(e.id), text: T(idx.get(id)!.t), alt: A(idx.get(id)!.t), priority: ++aiPriority, qualifiers: rankOf.get(id)?.r.qualifiers ?? [] }))).filter((f) => f.text);
  const education = p.education.filter((e) => e.enabled).map((e) => ({ school: lt(e.school, 'zh'), schoolEn: lt(e.school, 'en'), degree: lt(e.degree, 'zh') || lt(e.degree, 'en'), major: lt(e.major, 'zh') || lt(e.major, 'en'), start: e.start, end: e.end, expectedConferralDate: e.expectedConferralDate ?? '', actualConferralDate: e.actualConferralDate ?? '' }));
  const fixedSummary = { zh: fixedSummaryText(p.profile.summary, 'zh'), en: fixedSummaryText(p.profile.summary, 'en') };
  const brief = {
    job: { title: job.title, company: job.company?.full || job.company?.short || '', responsibilities: job.responsibilities ?? [], mustHave: job.mustHave, niceToHave: job.niceToHave, keywords: job.keywords },
    candidate: { education, fixedSummary },
    requirements: decision.requirements.filter((r) => r.assessment === 'direct' || r.assessment === 'transferable').map(({ text, tier, assessment, evidenceIds }) => ({ text, tier, assessment, evidenceIds })),
    gaps: decision.requirements.filter((r) => (r.assessment === 'gap' || r.assessment === 'learning') && !isUnjudged(r)).map((r) => r.text),
    targets: job.joint?.targets.map((t) => ({ name: t.name, title: t.job.title })), layout: pageBudget(targetPages, primary, options.template, p), facts,
  };
  onStep?.('2/3 正在撰写：AI 按岗位同时撰写中英文简历、简介与求职方向…');
  const write = (b: typeof brief) => chatJson<WriteOut>(s, [{ role: 'system', content: SYS_FACTS },
    { role: 'user', content: `${AI_WRITE_PROMPT}\n\n${JSON.stringify(b)}` }],
  { model: decisionModel(s), thinking: 'enabled', timeoutMs: job.joint ? 600_000 : 360_000, maxTokens: 24_000 });
  // 输出被截断（finish_reason=length）时，只带前一半（优先级高的）事实重试一次；其余事实按资料库原文精简后进入简历。
  const out = await write(brief).catch((e: Error) => {
    if (!/finish_reason=length/.test(e.message)) throw e;
    onStep?.('2/3 内容较多，AI 输出被截断，正在减少一次处理的条数后重试…');
    return write({ ...brief, facts: brief.facts.slice(0, Math.max(8, Math.ceil(brief.facts.length / 2))) });
  });

  const notes: string[] = [];
  const kctx = buildKitContext(p, null);
  /** 只拦两类硬错误：原文没有的数字；原文（任一语言）与资料库都没有的工具 / 专有名词。 */
  const issuesOf = (orig: string, text: string, lang: Lang) => [
    ...factGuard(orig, text, lang),
    ...(orig ? entityTokens(text, lang).filter((t) => !hasTerm(orig, t) && !hasTerm(kctx.corpus, t)).map((t) => `出现了原文没有的工具 / 专有名词：${t}`) : []),
    ...unsupportedEntities(text, lang, kctx.corpus, [], kctx.majors).map((t) => `出现了资料中没有的：${t}`),
  ];
  const textOf = (it: NonNullable<WriteOut['items']>[number], lang: Lang) => String(it[lang] ?? (lang === primary ? it.text ?? '' : '')).trim();
  const aiText = new Map<string, Bi>(), provenance = new Map<string, string[]>();
  const claimed = new Set<string>();
  const allowed = new Map(facts.map((f) => [f.sourceId, f]));
  for (const it of out.items ?? []) {
    if (!it?.sourceId || !textOf(it, primary)) continue;
    const ids = it.sourceIds ?? [it.sourceId];
    if (!Array.isArray(ids) || !ids.length || !ids.includes(it.sourceId) || new Set(ids).size !== ids.length
      || ids.some((id) => typeof id !== 'string' || !allowed.has(id) || claimed.has(id))
      || !allowed.has(it.sourceId) || ids.some((id) => allowed.get(id)?.entryId !== allowed.get(it.sourceId)?.entryId)) {
      notes.push(`${it.sourceId} 的来源组无效、跨经历、未选或重复，已拒绝该改写并保留原始事实`); continue;
    }
    ids.forEach((id) => claimed.add(id));
    provenance.set(it.sourceId, ids);
    aiText.set(it.sourceId, { zh: textOf(it, 'zh'), en: textOf(it, 'en') } as Bi);
  }
  const original = (id: string) => (provenance.get(id) ?? [id]).map((sid) => allowed.get(sid)?.text ?? '').join('\n');
  // 两种语言的原文都可作为事实依据（英文要点常常引用中文原文里的英文工具名）
  const originalBoth = (id: string) => (provenance.get(id) ?? [id]).map((sid) => `${allowed.get(sid)?.text ?? ''}\n${allowed.get(sid)?.alt ?? ''}`).join('\n');
  const invalid = [...aiText.entries()].filter(([id, val]) => {
    const orig = original(id);
    return !!orig && !!issuesOf(originalBoth(id), val[primary], primary).length;
  });
  if (invalid.length) {
    // 只修复真正出现新数字 / 新工具的改写；通过同一检查才采用。
    try {
      onStep?.(`2/3 有 ${invalid.length} 条要点出现原文没有的数字或工具，正在让 AI 修正…`);
      const repairBrief = { job: job.title, selected: invalid.map(([sourceId, rejected]) => ({ sourceId, sourceIds: provenance.get(sourceId), original: original(sourceId), rejected: rejected[primary], issues: issuesOf(originalBoth(sourceId), rejected[primary], primary) })) };
      const repair = await chatJson<WriteOut>(s, [{ role: 'system', content: SYS_FACTS },
        { role: 'user', content: `下列简历要点出现了原文没有的数字或工具名。请去掉这些内容，保持自然、专业的写法，中英文都给出。输出 JSON {"items":[{"sourceId":"...","zh":"...","en":"..."}]}。\n${JSON.stringify(repairBrief)}` }],
      { model: decisionModel(s), thinking: 'enabled', timeoutMs: 240_000, maxTokens: 10_000 });
      for (const item of repair.items ?? []) {
        if (!item?.sourceId || !invalid.some(([id]) => id === item.sourceId)) continue;
        if (item.sourceIds && JSON.stringify(item.sourceIds) !== JSON.stringify(provenance.get(item.sourceId))) continue;
        const next = { zh: textOf(item, 'zh'), en: textOf(item, 'en') } as Bi;
        if (next[primary] && !issuesOf(originalBoth(item.sourceId), next[primary], primary).length) { aiText.set(item.sourceId, next); notes.push(`${item.sourceId}：已修正一条出现新数字 / 新工具的要点`); }
      }
    } catch (e) { notes.push(`AI 修正未完成，相关要点改用资料原文：${(e as Error).message}`); }
  }
  const items: GenItem[] = [];
  let fallback = 0, secondaryDropped = 0;
  // 简介：按岗位定制；未返回或未通过检查则回退到资料库固定简介。
  const summaryCorpus = [kctx.corpus, ...facts.flatMap((f) => [f.text, f.alt]), fixedSummary.zh, fixedSummary.en, JSON.stringify(education)].join('\n');
  const tailoredIssues = (v: Partial<Bi> | undefined): { value: Bi | null; bad: string[] } => {
    const zh = String(v?.zh ?? '').trim(), en = String(v?.en ?? '').trim();
    if (!zh && !en) return { value: null, bad: [] };
    const bad = (['zh', 'en'] as const).flatMap((l) => {
      const t = l === 'zh' ? zh : en;
      if (!t) return [];
      const extraNums = numberTokens(t).filter((n) => !numberTokens(summaryCorpus).includes(n));
      return [...extraNums.map((n) => `数字 ${n}`), ...entityTokens(t, l).filter((x) => !hasTerm(summaryCorpus, x)), ...unsupportedEntities(t, l, summaryCorpus, [], kctx.majors).filter((x) => !summaryCorpus.includes(x))];
    });
    return { value: { zh, en }, bad };
  };
  // 简介 / 求职方向：一次检查不过，先请 AI 去掉问题词重写一次；仍不过才回退资料库原文。
  let checkedSummary = tailoredIssues(out.summary), checkedHeadline = tailoredIssues(out.headline);
  if (checkedSummary.bad.length || checkedHeadline.bad.length) {
    try {
      onStep?.('2/3 简介中有资料里没有的词，正在让 AI 改写一次…');
      const fix = await chatJson<WriteOut>(s, [{ role: 'system', content: SYS_FACTS },
        { role: 'user', content: `下面是你为岗位「${job.title.zh || job.title.en}」写的个人简介和求职方向。其中这些词在候选人资料里找不到：${[...checkedSummary.bad, ...checkedHeadline.bad].join('、')}。请去掉或换成资料里真实存在的说法，保持按岗位定制、自然专业，中英文都给。只输出 JSON {"summary":{"zh":"","en":""},"headline":{"zh":"","en":""}}。\n${JSON.stringify({ summary: out.summary, headline: out.headline, candidate: brief.candidate, facts: facts.map((f) => f.text) })}` }],
      { model: decisionModel(s), thinking: 'enabled', timeoutMs: 240_000, maxTokens: 4_000 });
      if (checkedSummary.bad.length) checkedSummary = tailoredIssues(fix.summary);
      if (checkedHeadline.bad.length) checkedHeadline = tailoredIssues(fix.headline);
    } catch (e) { notes.push(`简介改写未完成：${(e as Error).message}`); }
  }
  const accept = (c: { value: Bi | null; bad: string[] }, label: string) => {
    if (c.value && c.bad.length) notes.push(`AI 定制${label}出现资料中没有的内容（${c.bad.slice(0, 4).join('、')}），已改用资料库原文`);
    return c.value && !c.bad.length ? c.value : null;
  };
  const summary = accept(checkedSummary, '简介');
  const fixed = fixedSummaryItem(p);
  if (summary) items.push({ sourceId: 'summary', zh: summary.zh || fixed?.zh || '', en: summary.en || fixed?.en || '', syncStatus: summary.zh && summary.en ? 'in-sync' : 'needs-review' });
  else if (fixed) {
    items.push(fixed);
    if (!out.summary) notes.push('AI 没有返回定制简介，已使用资料库固定简介');
  } else {
    // 2026-11：资料库没有固定简介时不能整段不放（负责人实测简历没有个人简介）。去掉含问题词的句子后仍有内容就用。
    const salvaged = salvageSummary(checkedSummary);
    if (salvaged) { items.push({ sourceId: 'summary', zh: salvaged.zh, en: salvaged.en, syncStatus: salvaged.zh && salvaged.en ? 'in-sync' : 'needs-review' }); notes.push('个人简介去掉了含资料外内容的句子；建议在「我的资料」保存一段固定简介作为兜底'); }
    else notes.push('没有可用的个人简介：AI 简介未通过检查，资料库也没有固定简介。请在「我的资料 → 个人简介」填写一段');
  }
  const headline = accept(checkedHeadline, '求职方向');
  const grouped = new Set([...provenance.entries()].flatMap(([main, ids]) => ids.filter((id) => id !== main)));
  for (const e of plan.entries) for (const id of e.bulletIds) {
    if (grouped.has(id)) continue;
    const t = idx.get(id)?.t; if (!t) continue;
    const orig = provenance.has(id) ? original(id) : T(t);
    let text: string, secondary = '';
    if (e.kind === 'education') text = orig;
    else {
      const a = aiText.get(id);
      const bad = a?.[primary] ? issuesOf(originalBoth(id), a[primary], primary) : ['AI 未返回'];
      if (!bad.length) {
        text = a![primary];
        // 副语言同样只做数字 / 工具检查；不通过则留空，稍后由本地化补齐。
        const sv = a![sec];
        if (sv && !issuesOf(originalBoth(id), sv, sec).length) secondary = sv; else if (sv) secondaryDropped++;
      } else { text = (provenance.get(id)?.length ?? 0) > 1 ? orig : conciseBi(t, terms, primary, plan.budgets?.[id])[primary] || orig; fallback++; if (a) notes.push(`${id} 改写未通过事实护栏（${bad.join('；')}），已改用资料原文`); }
    }
    if (text) items.push({ sourceId: id, ...(provenance.get(id)?.length ? { sourceIds: provenance.get(id) } : {}), zh: primary === 'zh' ? text : secondary, en: primary === 'en' ? text : secondary, syncStatus: secondary ? 'in-sync' : 'needs-review', ...(secondary ? { translation: { source: 'ai' as const, factIssues: [], checkedAt: new Date().toISOString() } } : {}) });
  }
  if (fallback) notes.push(`${fallback} 条要点使用了资料原文（AI 未返回或出现原文没有的数字 / 工具）`);
  if (secondaryDropped) notes.push(`${secondaryDropped} 条${NAME[sec]}要点出现原文没有的数字 / 工具，已改为重新本地化`);
  const ids = (k: PlanEntry['kind']) => plan.entries.filter((e) => e.kind === k).map((e) => e.id);
  const selection: Sel = { work: ids('work'), projects: ids('projects'), education: ids('education').length ? ids('education') : p.education.filter((x) => x.enabled).map((x) => x.id), skills: plan.skills, certificates: plan.certificates, awards: plan.awards };
  return { resume: {
    id: uid('resume'), jobId: job.id, templateId: '', primaryLanguage: primary, createdAt: new Date().toISOString(),
    matchScore: decision.matchScore, gaps: decision.gaps, selection, items, ...(headline ? { headline } : {}), ...(decision.skillGroups?.length ? { skillGroups: decision.skillGroups } : {}),
    courseSelection: courseSelectionSnapshot(p, decision.courses, []), evidenceReport: createEvidenceReport(p, job, decision.requirements, decision.chosenReasons, decision.jointSummary),
    consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai', layoutPolicy: 'readable',
    notes: [...(summary ? [] : fixedSummaryNotes(p)), `AI 选材：${decision.tradeoffs || '已比对完整岗位与候选经历'}`,
      ...decision.chosenReasons.slice(0, 8), ...(out.reasons ? [String(out.reasons)] : []), ...notes,
      ...dropNotes(p, plan), ...conflictNotes(p, job)],
  }, decision };
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
  const pri = r.primaryLanguage, sec = other(pri);
  // 新勾选素材可能仅有另一语言：按实际已有文字补齐主版本，不翻译空白、不重复处理。
  const missingPrimary = r.items.filter((i) => i.sourceId !== 'summary' && (!onlyIds || onlyIds.includes(i.sourceId)) && !i[pri].trim() && i[sec].trim() && !i.confirmedLangs?.includes(pri)).map((i) => i.sourceId);
  if (missingPrimary.length) {
    const completed = await localizeAi(s, p, job, { ...r, primaryLanguage: sec }, missingPrimary);
    r = { ...completed, primaryLanguage: pri };
  }
  const hiddenAcademicIds = new Set(p.education.flatMap((e) => e.highlights.filter(academicHighlight).map((b) => b.id)));
  p = profileForGeneration(p);
  r = { ...r, items: r.items.filter((i) => i.manual || !hiddenAcademicIds.has(i.sourceId)) };
  // 用户人工确认过的副版本优先保留，不再重译（B6）
  const target = r.items.filter((i) => i.sourceId !== 'summary' && !missingPrimary.includes(i.sourceId) && (!onlyIds || onlyIds.includes(i.sourceId)) && !i.confirmedLangs?.includes(sec) && !!i[pri].trim());
  const payload = {
    glossary: p.glossary, keywords: (job?.keywords ?? []).map((k) => ({ [pri]: k[pri], [sec]: k[sec] })),
    reference: target.map((i) => { const t = sourceText(p, i); return t && t.status?.[sec] === 'confirmed' ? { sourceId: i.sourceId, [pri]: lt(t, pri, false), [sec]: lt(t, sec, false) } : null; }).filter(Boolean),
    items: target.map((i) => ({ sourceId: i.sourceId, ...(i.sourceIds ? { sourceIds: i.sourceIds } : {}), text: i[pri] })),
  };
  // 两次尝试中，每条保留第一份通过事实校验的译文；都没通过时保留现有文字。
  const best = new Map<string, string>(); const passed = new Set<string>(); const rejected = new Map<string, string[]>(); const kctxL = buildKitContext(p, null);
  for (let attempt = 0; attempt < 2 && target.length; attempt++) {
    const out = await chatJson<{ items?: { sourceId: string; text: string }[] }>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content: `${LOCALIZE_PROMPT(NAME[pri], NAME[sec])}\n\n${JSON.stringify(payload)}` }], { model: s.translateModel || s.model });
    for (const x of out.items ?? []) {
      if (!x?.sourceId || !x.text?.trim() || passed.has(x.sourceId)) continue;
      const it = target.find((i) => i.sourceId === x.sourceId); if (!it) continue;
      // v1.10.1：译文里出现资料中没有的工具 / 专业名（如把「轮机工程」译成别的专业）直接不采用
      if (unsupportedEntities(x.text, sec, kctxL.corpus, [], kctxL.majors).length || entityTokens(x.text, sec).some((t) => !hasTerm(kctxL.corpus, t))) { rejected.set(x.sourceId, ['AI 译文引入资料外的名称或技能，已保留已有文字']); continue; }
      best.set(x.sourceId, x.text.trim());
      const issues = compareFacts(it[pri], x.text);
      if (!issues.length) passed.add(x.sourceId); else rejected.set(x.sourceId, issues);
    }
    if (target.every((i) => passed.has(i.sourceId))) break;
  }
  const targetIds = new Set(target.map((i) => i.sourceId));
  const items = r.items.map((i): GenItem => {
    if (!targetIds.has(i.sourceId)) return i;
    const t = sourceText(p, i);
    const confirmedPrior = t && t.status?.[sec] === 'confirmed' && lt(t, pri, false) === i[pri] ? lt(t, sec, false) : undefined;
    // AI 没有通过事实检查时保留当前文字；不能把错误译文写入可直接导出的正文。
    const d = decideTranslation(i[pri], passed.has(i.sourceId) ? best.get(i.sourceId) : undefined, confirmedPrior, i[sec] || (t ? lt(t, sec, false) || undefined : undefined));
    if (!passed.has(i.sourceId) && rejected.has(i.sourceId)) { d.syncStatus = 'needs-review'; d.translation.factIssues = rejected.get(i.sourceId)!; }
    return { ...i, [sec]: d.text, syncStatus: d.syncStatus, translation: d.translation };
  });
  const next = { ...r, items };
  fillSecondaryFromProfile(p, next, false);
  return runConsistency(next);
}

/** v1.9.1：简历条目若直接用了资料库里「已过期」的译文（另一语言修改后未重新翻译），标为需核对，不静默当作同步 */
export function flagStale(p: ProfileDoc, r: ResumeDoc): ResumeDoc {
  const items = r.items.map((i): GenItem => {
    const t = sourceText(p, i); if (!t) return i;
    const st = (['zh', 'en'] as Lang[]).filter((l) => t.status?.[l] === 'stale' && i[l].trim() && i[l].trim() === (t[l] ?? '').trim());
    if (!st.length) return i;
    const msg = st.map((l) => `资料库${l === 'zh' ? '中文' : '英文'}已过期（另一语言修改后尚未重新翻译），请重新补译或核对`);
    return { ...i, syncStatus: 'needs-review', translation: { source: 'profile', ...(i.translation ?? {}), factIssues: [...new Set([...(i.translation?.factIssues ?? []), ...msg])], checkedAt: new Date().toISOString() } };
  });
  return { ...r, items };
}

export async function generateResume(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number, onStep?: (m: string) => void, options: ContentOptions = {}): Promise<ResumeDoc> {
  p = profileForGeneration(p);
  const r = await generateResumeInner(s, p, job, primary, targetPages, onStep, options);
  let cut = 0;
  r.items = r.items.map((i) => { if (i.sourceId === 'summary') return i; const zh = stripAuthorList(i.zh), en = stripAuthorList(i.en); if (zh !== i.zh || en !== i.en) cut++; return zh !== i.zh || en !== i.en ? { ...i, zh, en } : i; });
  if (cut) r.notes = [...(r.notes ?? []), `已在简历中省略论文作者名单（${cut} 条；资料库原文未改）`];
  return runConsistency(flagStale(p, { ...r, courseSelection: r.courseSelection ?? { ids: [], gradeIds: [], snapshots: [] }, evidenceReport: refreshReportSelection(r), contactVisibility: { ...p.profile.contacts.visibility }, ...(r.items.find((i) => i.sourceId === 'summary') ? { summaryBaseline: structuredClone(r.items.find((i) => i.sourceId === 'summary')!) } : {}) }));
}
async function generateResumeInner(s: Settings, p: ProfileDoc, job: JobParse, primary: Lang, targetPages: number, onStep?: (m: string) => void, options: ContentOptions = {}): Promise<ResumeDoc> {
  if (s.demoMode) {
    if (job.joint) throw new Error('联合岗位需要 AI 语义选材；演示模式不会以关键词规则假装联合分析成功');
    onStep?.('演示模式：规则匹配中…');
    const r = generateRules(p, job, primary, targetPages);
    fillSecondaryFromProfile(p, r, true);
    return runConsistency(r);
  }
  // 用户明确要求 AI 主导选材：失败时直接报错，不在真实模式下悄悄退回关键词规则。
  // 不用通用提示覆盖进度文字：界面用最后一条进度显示「出错步骤」。
  onStep?.(`准备生成${NAME[primary]}岗位定制主版本…`);
  const generated = await generatePrimaryAi(s, p, job, primary, targetPages, onStep, options);
  let r: ResumeDoc = generated.resume;
  const decision: AiSelectionResult = generated.decision;
  try {
    // 撰写阶段已同时给出另一语言；只补齐缺失或未通过检查的条目（教育要点等）。
    const sec = other(primary);
    const missing = r.items.filter((i) => i.sourceId !== 'summary' && !i[sec].trim()).map((i) => i.sourceId);
    if (missing.length) {
      onStep?.(`3/3 正在补齐 ${missing.length} 条${NAME[sec]}内容并核对双语事实…`);
      r = await localizeAi(s, p, job, r, missing);
    }
  } catch (e) {
    r.notes = [...(r.notes ?? []), `副版本本地化失败，使用资料库译文：${(e as Error).message}`];
    fillSecondaryFromProfile(p, r, false);
    r = runConsistency(r);
  }
  onStep?.('3/3 正在核对双语内容完整度与版面空间，不再调用 AI…');
  return fitContent(p, r, decision.reserves.map((x) => x.id), decision.omissions, { ...options, targetPages });
}
