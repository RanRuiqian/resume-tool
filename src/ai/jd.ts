import type { Bi, JobParse, Settings } from '../types';
import { chat, chatJson } from './provider';
import { JD_PARSE_PROMPT, OCR_PROMPT } from './prompts';
import { KEYWORD_DICT } from './keywords';
import { guessRoleAbbr, shortCompanyName } from '../export/naming';
import { uid } from '../locale/text';

export async function ocrImage(s: Settings, dataUrl: string): Promise<string> {
  return (await chat(s, [{ role: 'user', content: [{ type: 'text', text: OCR_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }], { model: s.visionModel || s.model })).trim();
}

const detectLang = (t: string) => ((t.match(/[\u4e00-\u9fff]/g)?.length ?? 0) > t.length * 0.15 ? 'zh' : 'en');
const has = (text: string, k: Bi) => {
  const low = text.toLowerCase();
  const m = (w: string) => (/^[a-z0-9.+# -]+$/i.test(w) ? new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[.+]/g, '\\$&')}([^a-z]|$)`).test(low) : low.includes(w.toLowerCase()));
  return m(k.zh) || m(k.en);
};

/** 规则解析（演示模式 / AI 失败兜底） */
export function parseJdRules(text: string): JobParse {
  const lang = detectLang(text);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const compM = text.match(/([\u4e00-\u9fa5A-Za-z（）()]{2,30}?(?:股份有限公司|有限责任公司|有限公司|集团))/) || text.match(/(?:Company|公司)[:：]\s*(.+)/i) || text.match(/\b([A-Z][\w&]+(?:\s[A-Z][\w&]+)*,?\s(?:Inc\.?|Ltd\.?|LLC|Corp\.?))/);
  const full = compM ? compM[1].trim() : '';
  const titleLine = lines.find((l) => /工程师|经理|设计师|分析师|专家|负责人|engineer|manager|designer|analyst|developer|scientist/i.test(l)) ?? '';
  const title = titleLine.replace(full, '').replace(/^[\s—\-–|:：]+|[\s—\-–|:：]+$/g, '').slice(0, 40);
  const kws = KEYWORD_DICT.filter((k) => has(text, k));
  const niceLines = lines.filter((l) => /优先|加分|plus|preferred|nice to have|bonus/i.test(l)).join('\n');
  const nice = kws.filter((k) => has(niceLines, k));
  const must = kws.filter((k) => !nice.includes(k));
  const yrs = text.match(/(\d+)\s*年(?:以上)?/) || text.match(/(\d+)\+?\s*years/i);
  const respLines = lines.filter((l) => /^(?:[-•·*\d.、)）\s]*)(?:负责|参与|完成|主导|设计|编写|Design|Develop|Lead|Support|Prepare|Create|Work|Collaborate|Responsible)/i.test(l)).slice(0, 8);
  return normalizeJob({
    id: uid('job'), createdAt: new Date().toISOString(), rawText: text, jdLanguage: lang,
    responsibilities: respLines.map((l) => ({ zh: lang === 'zh' ? l.replace(/^[-•·*\d.、)）\s]+/, '') : '', en: lang === 'en' ? l.replace(/^[-•·*\d.、)）\s]+/, '') : '' })),
    company: { full, short: full ? shortCompanyName(full) : '' },
    roleAbbr: guessRoleAbbr(title || text.slice(0, 200)),
    title: { zh: lang === 'zh' ? title : '', en: lang === 'en' ? title : '' },
    mustHave: must, niceToHave: nice, yearsRequired: yrs ? parseInt(yrs[1], 10) : null,
    keywords: kws, summary: lines.slice(0, 2).join(' ').slice(0, 120),
  });
}

/** v1.10 JD 规范化文本哈希：忽略空白、全半角标点和大小写差异；用于复用分析结果与判断分析是否过期 */
export function normJd(text: string): string {
  const t = text.normalize('NFKC').replace(/[。．]/g, '.').replace(/[、，]/g, ',').replace(/[；]/g, ';').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
  // 只在两个英文 / 数字之间保留一个空格，其余空白全部忽略（截图识别常在中文、标点旁多出空格）
  return t.replace(/[\s\u3000]+/g, ' ').replace(/ (?![a-z0-9])|(?<![a-z0-9]) /g, '').trim();
}
export function jdHash(text: string): string {
  const s = normJd(text); let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return `${s.length.toString(36)}-${h1.toString(36)}${h2.toString(36)}`;
}
/** JD 原文是否明确写了加分 / 优先项 */
export const NICE_MARK = /优先|加分|更佳|为佳|者佳|有.{0,12}经验者|\bplus\b|preferred|nice[- ]to[- ]have|bonus|desirable|advantage|advantageous|ideally|is a plus|would be great/i;
const kwKey = (k: Bi) => (k.en || k.zh).toLowerCase().replace(/[\s\-_/]+/g, '');
/** 关键词规范化：去空白、去重（中英任一相同即视为同一词）、去过长短语；排序：必备项中出现的 > JD 原文出现次数 > 字母序 */
export function normalizeKeywords(kws: Bi[], job: Pick<JobParse, 'rawText' | 'mustHave'>): Bi[] {
  const raw = job.rawText.toLowerCase();
  const seen = new Map<string, Bi>();
  for (const k0 of kws) {
    const k = { zh: (k0.zh ?? '').trim().replace(/\s+/g, ' '), en: (k0.en ?? '').trim().replace(/\s+/g, ' ') };
    if (!k.zh && !k.en) continue;
    if ((k.en || k.zh).length > 40) continue;
    const key = kwKey(k); const zkey = k.zh.toLowerCase();
    const dup = [...seen.values()].find((x) => kwKey(x) === key || (!!zkey && x.zh.toLowerCase() === zkey));
    if (dup) { if (!dup.zh && k.zh) dup.zh = k.zh; if (!dup.en && k.en) dup.en = k.en; continue; }
    seen.set(key, k);
  }
  const must = job.mustHave.map((m) => `${m.zh} ${m.en}`.toLowerCase()).join(' | ');
  const count = (k: Bi) => [k.zh, k.en].filter(Boolean).reduce((n, w) => n + raw.split(w.toLowerCase()).length - 1, 0);
  const inMust = (k: Bi) => [k.zh, k.en].some((w) => w && must.includes(w.toLowerCase())) ? 1 : 0;
  return [...seen.values()].sort((a, b) => inMust(b) - inMust(a) || count(b) - count(a) || (a.en || a.zh).localeCompare(b.en || b.zh));
}
const dedupeBi = (a: Bi[]) => { const s = new Set<string>(); return a.filter((k) => { const key = kwKey(k); if (!key || s.has(key)) return false; s.add(key); return true; }); };
/** 解析结果后处理（AI 与规则共用）：没有明确加分字样时清空加分项（移入职责）；关键词规范化；记录 JD 哈希 */
export function normalizeJob(j: JobParse): JobParse {
  let nice = dedupeBi(j.niceToHave);
  let resp = dedupeBi(j.responsibilities ?? []);
  if (nice.length && !NICE_MARK.test(j.rawText)) { resp = dedupeBi([...resp, ...nice]); nice = []; }
  const mustHave = dedupeBi(j.mustHave);
  return { ...j, mustHave, niceToHave: nice, responsibilities: resp, keywords: normalizeKeywords(j.keywords, { rawText: j.rawText, mustHave }), textHash: jdHash(j.rawText) };
}
/** 分析是否已过期（JD 文本与分析时不同）。旧数据没有 textHash 时按 rawText 比较 */
export function isAnalysisStale(job: JobParse | null, text: string): boolean {
  if (!job) return false;
  return (job.textHash ?? jdHash(job.rawText)) !== jdHash(text);
}

/**
 * v1.10 分析稳定性（程序层面，不只靠温度）：
 * - 同一份未修改的 JD：直接复用当前分析（或历史中同一 JD 的分析），不调用 AI、不覆盖；
 * - force=true（用户点「重新分析」）才重新调用 AI。
 */
export async function analyzeJob(s: Settings, text: string, opts: { current: JobParse | null; history?: JobParse[]; force?: boolean; parse?: (s: Settings, t: string) => Promise<JobParse> }): Promise<{ job: JobParse; reused: 'current' | 'history' | null; aiError?: string }> {
  const h = jdHash(text);
  if (!opts.force) {
    if (opts.current && (opts.current.textHash ?? jdHash(opts.current.rawText)) === h) return { job: opts.current, reused: 'current' };
    const prev = (opts.history ?? []).filter((j) => (j.textHash ?? jdHash(j.rawText)) === h).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (prev) return { job: { ...structuredClone(prev), id: uid('job'), createdAt: new Date().toISOString(), screenshots: undefined, rawText: text, textHash: h }, reused: 'history' };
  }
  if (s.demoMode) return { job: parseJdRules(text), reused: null };
  try { return { job: await (opts.parse ?? parseJdAi)(s, text), reused: null }; }
  catch (e) { return { job: parseJdRules(text), reused: null, aiError: (e as Error).message }; }
}

export async function parseJdAi(s: Settings, text: string): Promise<JobParse> {
  const r = await chatJson<Partial<JobParse>>(s, [{ role: 'system', content: '你是招聘信息解析助手，只输出 JSON。' }, { role: 'user', content: `${JD_PARSE_PROMPT}\n\nJD：\n"""\n${text}\n"""` }]);
  const bi = (a: unknown): Bi[] => (Array.isArray(a) ? a.filter((x) => x && (x.zh || x.en)).map((x) => ({ zh: String(x.zh ?? ''), en: String(x.en ?? '') })) : []);
  return normalizeJob({
    id: uid('job'), createdAt: new Date().toISOString(), rawText: text,
    responsibilities: bi(r.responsibilities),
    jdLanguage: r.jdLanguage === 'en' ? 'en' : r.jdLanguage === 'zh' ? 'zh' : detectLang(text),
    company: { full: r.company?.full ?? '', short: r.company?.short ?? '' },
    roleAbbr: (r.roleAbbr ?? '').trim(),
    title: { zh: r.title?.zh ?? '', en: r.title?.en ?? '' },
    mustHave: bi(r.mustHave), niceToHave: bi(r.niceToHave), keywords: bi(r.keywords),
    yearsRequired: typeof r.yearsRequired === 'number' ? r.yearsRequired : null, summary: r.summary ?? '',
  });
}
