import type { GenItem, Lang, ProfileDoc, ResumeDoc } from '../types';
import { compareFacts, factTokens } from '../ai/consistency';
import { buildSourceIndex, originalOf, type FactSource } from './sourceIndex';
import { borrowedTerms, buildAllowlist, extractTechTerms, normTerm, unknownTerms, type Allowlist } from './techTerms';
import { lt } from '../locale/text';

/** 风险等级（B5）：green 事实一致 / yellow 需要关注 / red 高风险 / gray 无法判断 */
export type RiskLevel = 'green' | 'yellow' | 'red' | 'gray';
export const LEVEL_ORDER: Record<RiskLevel, number> = { red: 0, yellow: 1, gray: 2, green: 3 };
export const LEVEL_LABEL: Record<RiskLevel, string> = { red: '高风险', yellow: '需要关注', gray: '无法判断', green: '事实一致' };
export interface Finding { level: RiskLevel; code: string; reason: string; /** 引用的原文片段 */ quote?: string; terms?: string[] }
export interface LangAudit {
  lang: Lang; sourceId: string; original: string; originalLang: Lang; rewrite: string;
  level: RiskLevel; findings: Finding[]; newTerms: string[]; numberDiff: string[];
  checks: { sourceValid: boolean; coreKept: boolean; noNewTech: boolean; numbersKept: boolean; roleKept: boolean; needsUser: boolean };
}
export type Decision = 'pending' | 'accepted' | 'restored' | 'edited';
/** 持久化在 ResumeDoc.audit 中；不修改资料库 */
export interface AuditDecision { decision: Decision; at: string; /** 做决定时 AI 改写的文本（便于追溯） */ aiText: string; editedText?: string; /** 另一语言被修改，需要重新检查 */ recheck?: boolean; recheckReason?: string }
export interface AuditState { decisions: Record<string, Partial<Record<Lang, AuditDecision>>>; updatedAt: string }

const has = (s: string, re: RegExp) => re.test(s);
const TEAM = /团队|协助|参与|配合|协同|合作|小组|共同|assist|participat|contribut|team|collaborat|support(ed)? the|helped/i;
const SOLO = /独立(完成|开发|负责|设计|实现)?|独自|一人|单独|个人完成|single-?handed|independently|solely|on my own|by myself/i;
const LEAD = /主导|牵头|带领|领导|负责人|全面负责|\bled\b|\blead\b|spearhead|owned|headed|directed/i;
const PROTO = /原型|实验室|样机|仿真|demo|演示|课程|课设|毕设|毕业设计|prototype|lab\b|laboratory|simulation|proof[- ]of[- ]concept|poc\b|coursework|course project|thesis/i;
const COMMERCIAL = /量产|商业化|商用|上市|投产|客户|营收|销售|落地(到|于)?(工厂|产线|客户)|生产环境|大规模部署|commerciali|mass[- ]produc|in production|production[- ]grade|customers?|revenue|shipped|launched to market|deployed (at|to) scale/i;
const COURSE = /课程|课设|课堂|作业|选修|course|class project|coursework|homework/i;
const WORKEXP = /工作经验|工作经历|实习经验|项目经验|工业(界)?经验|企业项目|全职|professional experience|work experience|industry experience|years? of experience|industrial project/i;
const DEGREE_DONE = /已(获得|取得|获)|获得.{0,6}(学位|学历)|取得.{0,6}(学位|学历)|毕业于|holds?|earned|obtained|awarded|received (a|an|the)? ?(b\.?s|m\.?s|ph\.?d|bachelor|master|degree)|graduated/i;
const DEGREE_PENDING = /预计|在读|即将|待授予|expected|candidate|pursuing|in progress|anticipated/i;
const OUTCOME = /专利|论文|发表|获奖|奖项|一等奖|二等奖|冠军|patent|paper|publication|published|award|prize|champion/i;

/** 字符二元组相似度（内容覆盖程度的粗略估计） */
function overlap(a: string, b: string): number {
  const g = (s: string) => { const x = s.toLowerCase().replace(/\s+/g, ''); const m = new Map<string, number>(); for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const A = g(a), B = g(b); let inter = 0, tot = 0; for (const [k, n] of A) { inter += Math.min(n, B.get(k) ?? 0); tot += n; }
  return tot ? inter / tot : 1;
}
const crossLang = (a: string, b: string) => /[\u4e00-\u9fa5]/.test(a) !== /[\u4e00-\u9fa5]/.test(b);

export interface AuditContext { idx: Map<string, FactSource>; allow: Allowlist; profile: ProfileDoc }
export function makeContext(p: ProfileDoc): AuditContext { return { idx: buildSourceIndex(p), allow: buildAllowlist(p), profile: p }; }

/** 同一经历内的其它原文（同级要点、标签、档案工具），用于判断技术词是否来自本经历 */
function parentContext(ctx: AuditContext, s?: FactSource): string {
  if (!s?.parentId) return '';
  const p = ctx.profile;
  const e = [...p.work, ...p.projects].find((x) => x.id === s.parentId);
  if (!e) return '';
  const d = 'dossier' in e ? e.dossier : undefined;
  return [...e.bullets.map((b) => `${b.zh ?? ''} ${b.en ?? ''}`), e.tags.join(' '), (d?.tools ?? []).join(' '), (d?.keywords ?? []).join(' ')].join('\n');
}

/** 审查一条简历描述在某种语言下的改写（B3/B4/B5）。纯本地确定性规则 */
export function auditText(ctx: AuditContext, sourceId: string, lang: Lang, rewrite: string): LangAudit {
  const s = ctx.idx.get(sourceId);
  const { text: original, lang: originalLang } = originalOf(s, lang);
  const F: Finding[] = [];
  const base: LangAudit = { lang, sourceId, original, originalLang, rewrite, level: 'green', findings: F, newTerms: [], numberDiff: [], checks: { sourceValid: !!s, coreKept: true, noNewTech: true, numbersKept: true, roleKept: true, needsUser: false } };
  if (!s) { F.push({ level: 'gray', code: 'no-source', reason: `找不到来源 ${sourceId}，无法追溯到你的资料库` }); return finish(base); }
  if (!original.trim()) { F.push({ level: 'gray', code: 'empty-source', reason: '资料库中这一条没有原文（AI 根据其它资料撰写），来源不足，需要你人工确认', quote: s.sourcePath }); return finish(base); }
  if (!rewrite.trim()) { F.push({ level: 'gray', code: 'empty-rewrite', reason: '这一语言的内容为空' }); return finish(base); }
  if (originalLang !== lang) F.push({ level: 'green', code: 'cross-lang', reason: `（说明）资料库没有${lang === 'zh' ? '中文' : '英文'}原文，以下按${originalLang === 'zh' ? '中文' : '英文'}原文核对`, quote: original });

  // 数字 / 日期 / 百分比 / 金额
  const fx = factTokens(original), fy = factTokens(rewrite);
  const addedNums = fy.nums.filter((n) => !fx.nums.includes(n));
  const droppedNums = fx.nums.filter((n) => !fy.nums.includes(n));
  if (addedNums.length) { F.push({ level: 'red', code: 'number-changed', reason: `改写出现了原文没有的数字 / 日期：${addedNums.join('、')}${droppedNums.length ? `（原文为 ${droppedNums.join('、')}）` : ''}`, quote: original }); base.numberDiff.push(...addedNums.map((n) => `+${n}`), ...droppedNums.map((n) => `-${n}`)); }
  else if (droppedNums.length) { F.push({ level: 'yellow', code: 'number-dropped', reason: `改写省略了原文中的数字：${droppedNums.join('、')}`, quote: original }); base.numberDiff.push(...droppedNums.map((n) => `-${n}`)); }
  const facts = compareFacts(original, rewrite).filter((x) => !x.startsWith('数字'));
  for (const f of facts) F.push({ level: 'red', code: 'fact-changed', reason: f, quote: original });
  // 日期与经历时间段
  for (const d of (rewrite.match(/\b(19|20)\d{2}[-./年]\s?\d{1,2}/g) ?? [])) {
    const norm = d.replace(/[年./]\s?/, '-').replace(/-(\d)$/, '-0$1');
    if (s.dates?.length && !s.dates.some((x) => x.startsWith(norm.slice(0, 7))) && !original.includes(d)) F.push({ level: 'red', code: 'date-changed', reason: `改写中的日期 ${d} 与经历时间（${s.dates.join(' – ')}）不符`, quote: s.dates.join(' – ') });
  }

  // 技术词（B4）
  const ctxText = `${original}\n${parentContext(ctx, s)}`;
  const unk = unknownTerms(rewrite, ctxText, ctx.allow);
  if (unk.length) { base.newTerms = unk; F.push({ level: 'red', code: 'new-tech', reason: `以下技术尚未在你的资料库中找到对应使用记录，请确认是否真实使用过：${unk.join('、')}`, terms: unk, quote: original }); }
  const borrowed = borrowedTerms(rewrite, ctxText, ctx.allow);
  if (borrowed.length) F.push({ level: 'yellow', code: 'borrowed-tech', reason: `这些技术在你的资料库其它经历中出现过，但不在这一条的原文里：${borrowed.join('、')}（来源：${borrowed.map((t) => ctx.allow.terms.get(normTerm(t))?.[0]).join('；')}）`, terms: borrowed, quote: original });
  const origTerms = extractTechTerms(original).map(normTerm), newTermsAll = extractTechTerms(rewrite).map(normTerm);
  const lost = origTerms.filter((t) => !newTermsAll.includes(t));
  if (lost.length && (unk.length || borrowed.length) && !crossLang(original, rewrite)) F.push({ level: 'yellow', code: 'tech-replaced', reason: `原文的技术词被替换：${extractTechTerms(original).filter((t) => lost.includes(normTerm(t))).join('、')}`, quote: original });

  // 职责与性质（B5 红色项）
  if (has(rewrite, SOLO) && !has(original, SOLO)) F.push({ level: 'red', code: 'team-to-solo', reason: '改写把工作写成个人独立完成，原文没有这样的说法' + (has(original, TEAM) ? '（原文是团队 / 参与）' : ''), quote: original });
  else if (has(rewrite, LEAD) && !has(original, LEAD)) F.push({ level: has(original, TEAM) ? 'red' : 'yellow', code: 'role-expanded', reason: has(original, TEAM) ? '原文是参与 / 协助，改写成了主导 / 负责' : '改写使用了「主导 / 负责」类表述，原文没有，本人职责可能被扩大', quote: original });
  if (has(rewrite, COMMERCIAL) && !has(original, COMMERCIAL)) F.push({ level: 'red', code: 'proto-to-commercial', reason: has(original, PROTO) ? '原文是原型 / 实验室 / 仿真，改写成了商业化 / 量产 / 生产环境' : '改写声称商业化 / 量产 / 客户使用，原文没有', quote: original });
  const isCourse = s.sourceType.startsWith('education') || has(original, COURSE);
  if (isCourse && has(rewrite, WORKEXP) && !has(original, WORKEXP)) F.push({ level: 'red', code: 'course-to-work', reason: '原文是课程 / 学习经历，改写成了工作或项目经验', quote: original });
  if ((s.degreePending || has(original, DEGREE_PENDING)) && has(rewrite, DEGREE_DONE) && !has(original, DEGREE_DONE)) F.push({ level: 'red', code: 'degree-claimed', reason: '学位尚未授予（只有预计日期），改写写成了已获得', quote: original });
  else if (has(original, DEGREE_PENDING) && !has(rewrite, DEGREE_PENDING) && /学位|degree|毕业|graduat/i.test(rewrite)) F.push({ level: 'red', code: 'degree-claimed', reason: '原文说明学位为预计 / 在读，改写删掉了这一限定', quote: original });
  if (has(rewrite, OUTCOME) && !has(original, OUTCOME)) F.push({ level: 'red', code: 'new-outcome', reason: '改写新增了原文没有的成果（论文 / 专利 / 获奖等）', quote: original });

  // 概括范围变化（只在同语言时比较字面覆盖）
  if (!crossLang(original, rewrite)) {
    const cov = overlap(original, rewrite);
    if (cov < 0.3) F.push({ level: 'yellow', code: 'scope-changed', reason: `改写与原文字面重合度低（${Math.round(cov * 100)}%），概括范围可能变化`, quote: original });
  }
  if (s.confirmationStatus === 'machine' && originalLang === lang) F.push({ level: 'yellow', code: 'source-unconfirmed', reason: '对应原文是机翻 / AI 识别结果，尚未经你确认', quote: original });
  return finish(base);
}

function finish(a: LangAudit): LangAudit {
  const lv = a.findings.reduce<RiskLevel>((m, f) => (LEVEL_ORDER[f.level] < LEVEL_ORDER[m] ? f.level : m), 'green');
  a.level = lv;
  a.checks.coreKept = !a.findings.some((f) => ['scope-changed', 'number-dropped', 'number-changed'].includes(f.code));
  a.checks.noNewTech = !a.newTerms.length;
  a.checks.numbersKept = !a.findings.some((f) => f.code.startsWith('number') || f.code === 'fact-changed' || f.code === 'date-changed');
  a.checks.roleKept = !a.findings.some((f) => ['team-to-solo', 'role-expanded', 'course-to-work', 'proto-to-commercial', 'degree-claimed'].includes(f.code));
  a.checks.needsUser = lv !== 'green';
  return a;
}

export interface ItemAudit { sourceId: string; sourcePath: string; source?: FactSource; zh: LangAudit; en: LangAudit; /** 中英文之间的事实差异（B6） */ crossIssues: string[]; level: RiskLevel }
export interface ResumeAudit { items: ItemAudit[]; summary: AuditSummary }
export interface AuditSummary { total: number; reviewed: number; green: number; yellow: number; red: number; gray: number; unconfirmed: number; unconfirmedRed: number }

const worst = (...l: RiskLevel[]) => l.reduce((m, x) => (LEVEL_ORDER[x] < LEVEL_ORDER[m] ? x : m), 'green' as RiskLevel);

/** 审查整份简历的中英文两个版本；两种语言共用同一组 sourceId（B6） */
export function auditResume(p: ProfileDoc, r: ResumeDoc, ctx = makeContext(p)): ResumeAudit {
  const items = r.items.map((it): ItemAudit => {
    const zh = auditText(ctx, it.sourceId, 'zh', it.zh), en = auditText(ctx, it.sourceId, 'en', it.en);
    const crossIssues: string[] = [];
    if (it.zh.trim() && it.en.trim()) crossIssues.push(...compareFacts(it.zh, it.en).map((x) => `中英文${x}`));
    if (it.syncStatus === 'needs-review') crossIssues.push('译文未通过一致性验证，不能视为已同步');
    if (it.syncStatus === 'pending') crossIssues.push('主版本已修改，另一语言尚未同步');
    const dec = r.audit?.decisions[it.sourceId];
    if (crossIssues.length) {
      const lv: RiskLevel = crossIssues.some((x) => x.startsWith('中英文')) ? 'red' : 'yellow';
      for (const a of [zh, en]) { a.findings.push({ level: lv, code: 'cross-lang-mismatch', reason: crossIssues.join('；'), quote: a.lang === 'zh' ? it.en : it.zh }); finish(a); }
    }
    // 另一语言被修改：只提示需要重新检查的那一种语言
    for (const a of [zh, en]) if (dec?.[a.lang]?.recheck) {
      const why = `${a.lang === 'zh' ? '英文' : '中文'}版已修改，请重新检查${a.lang === 'zh' ? '中文' : '英文'}版：${dec[a.lang]!.recheckReason ?? ''}`;
      crossIssues.push(why); a.findings.push({ level: 'yellow', code: 'cross-lang-recheck', reason: why, quote: a.lang === 'zh' ? it.en : it.zh }); finish(a);
    }
    return { sourceId: it.sourceId, sourcePath: ctx.idx.get(it.sourceId)?.sourcePath ?? '（无来源）', source: ctx.idx.get(it.sourceId), zh, en, crossIssues, level: worst(zh.level, en.level) };
  });
  return { items, summary: summarize(items, r) };
}

export function isDecided(r: ResumeDoc, id: string, l: Lang): boolean {
  const d = r.audit?.decisions[id]?.[l];
  return !!d && d.decision !== 'pending' && !d.recheck;
}
export function summarize(items: ItemAudit[], r: ResumeDoc, langs: Lang[] = ['zh', 'en']): AuditSummary {
  const s: AuditSummary = { total: 0, reviewed: 0, green: 0, yellow: 0, red: 0, gray: 0, unconfirmed: 0, unconfirmedRed: 0 };
  for (const it of items) for (const l of langs) {
    const a = it[l]; s.total++; s[a.level]++;
    const done = isDecided(r, it.sourceId, l);
    if (done) s.reviewed++;
    else if (a.level !== 'green') { s.unconfirmed++; if (a.level === 'red') s.unconfirmedRed++; }
  }
  return s;
}

/** 审查操作（B3）：只改 ResumeDoc 的条目文本与审查记录，绝不修改资料库 */
export function applyDecision(p: ProfileDoc, r: ResumeDoc, sourceId: string, lang: Lang, decision: Exclude<Decision, 'pending'>, editedText?: string): ResumeDoc {
  const it = r.items.find((x) => x.sourceId === sourceId); if (!it) return r;
  const src = buildSourceIndex(p).get(sourceId);
  const aiText = r.audit?.decisions[sourceId]?.[lang]?.aiText ?? it[lang];
  let text = it[lang];
  if (decision === 'restored') { const o = src ? lt({ zh: src.originalText.zh, en: src.originalText.en }, lang, false) : ''; text = o || text; }
  if (decision === 'edited') text = (editedText ?? '').trim() || text;
  const changed = text !== it[lang];
  const oth: Lang = lang === 'zh' ? 'en' : 'zh';
  const items = r.items.map((x): GenItem => {
    if (x.sourceId !== sourceId) return x;
    const next: GenItem = { ...x, [lang]: text, confirmedLangs: [...new Set([...(x.confirmedLangs ?? []), lang])] };
    // 修改了主版本：副版本需要重新同步；改了副版本：重新校验事实一致
    if (changed) next.syncStatus = compareFacts(next.zh, next.en).length ? (lang === r.primaryLanguage ? 'pending' : 'needs-review') : x.syncStatus === 'pending' && lang !== r.primaryLanguage ? 'in-sync' : x.syncStatus;
    return next;
  });
  const prevDec = r.audit?.decisions ?? {};
  const mine: AuditDecision = { decision, at: new Date().toISOString(), aiText, ...(decision === 'edited' ? { editedText: text } : {}) };
  const otherDec = prevDec[sourceId]?.[oth];
  const factsMoved = changed && compareFacts(it[lang], text).length > 0;
  const nextOther = factsMoved ? { ...(otherDec ?? { decision: 'pending' as Decision, at: new Date().toISOString(), aiText: it[oth] }), recheck: true, recheckReason: `${lang === 'zh' ? '中文' : '英文'}版的数字或事实已修改` } : otherDec;
  const decisions = { ...prevDec, [sourceId]: { ...prevDec[sourceId], [lang]: mine, ...(nextOther ? { [oth]: nextOther } : {}) } };
  return { ...r, items, audit: { decisions, updatedAt: new Date().toISOString() } };
}

/** 文本差异（用于高亮）：中文按字，英文按词；返回 [类型, 片段] 序列 */
export function diffTokens(a: string, b: string): ['same' | 'add' | 'del', string][] {
  const split = (s: string) => (/[\u4e00-\u9fa5]/.test(s) ? Array.from(s) : s.split(/(\s+)/));
  const A = split(a), B = split(b);
  if (A.length * B.length > 250000) return [['del', a], ['add', b]];
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: ['same' | 'add' | 'del', string][] = [];
  const push = (t: 'same' | 'add' | 'del', s: string) => { const l = out[out.length - 1]; if (l && l[0] === t) l[1] += s; else out.push([t, s]); };
  let i = 0, j = 0;
  while (i < A.length && j < B.length) { if (A[i] === B[j]) { push('same', A[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; } else { push('add', B[j]); j++; } }
  while (i < A.length) push('del', A[i++]);
  while (j < B.length) push('add', B[j++]);
  return out;
}
