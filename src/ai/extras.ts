import type { Bi, JobParse, PrepDirection, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson } from './provider';
import { COVER_KIT_PROMPT, SYS_FACTS } from './prompts';
import { numberTokens } from './consistency';
import { buildKitContext, verifiedOnly, verifyKit, type SentenceTrace } from '../quality/kitVerify';
export type { SentenceTrace };
import { profileForGeneration } from '../privacy/resume';
import { hasTerm, overlap } from './relevance';
import { decisionModel } from './aiPlanner';
import { jobRequirements } from '../joint/jobs';
import { buildLayout } from '../render/layout';
import { BUILTIN_TEMPLATES } from '../templates';
import type { LayoutModel } from '../render/layout';

/** 把简历版式模型压成纯文本（作为求职信/面试准备的唯一事实来源） */
export function layoutToText(m: LayoutModel): string {
  const out = [m.header.name, m.header.headline];
  for (const s of [...m.main, ...m.side]) {
    out.push(`## ${s.title}`);
    for (const b of s.blocks) out.push([b.title, b.subtitle, b.date].filter(Boolean).join(' | '), ...(b.text ? [b.text] : []), ...b.bullets.map((x) => `- ${x}`));
  }
  return out.filter(Boolean).join('\n');
}
export const resumeText = (p: ProfileDoc, r: ResumeDoc) => layoutToText(buildLayout(p, BUILTIN_TEMPLATES[0], 'zh', r)) + '\n\n' + layoutToText(buildLayout(p, BUILTIN_TEMPLATES[0], 'en', r));
const jobBrief = (j: JobParse) => JSON.stringify({ company: j.company.short || j.company.full, title: j.title, responsibilities: j.responsibilities ?? [], mustHave: j.mustHave, keywords: j.keywords, summary: j.summary });

/** v1.10 求职信 / 自我介绍的长度目标（中文按字、英文按词；含适度弹性） */
export const KIT_LIMITS = {
  intro: { zh: [180, 220, 160, 240], en: [100, 130, 90, 145] },
  cover: { zh: [250, 380, 220, 450], en: [170, 260, 150, 300] },
} as const;
export const zhLen = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').replace(/[A-Za-z0-9.+#-]+/g, 'x').length;
export const enWords = (s: string) => (s.match(/[A-Za-z0-9][A-Za-z0-9'’.+#/-]*/g) ?? []).length;
const size = (s: string, l: 'zh' | 'en') => (l === 'zh' ? zhLen(s) : enWords(s));
const sentences = (s: string, l: 'zh' | 'en') => s.split(l === 'zh' ? /(?<=[。！？!?])/ : /(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const CLICHE = /热爱|激情|深耕|赋能|助力|极大地|全面提升|无限|梦寐以求|不可多得|完美契合|passionate|passion for|dream (?:job|company)|perfect fit|synerg|go-getter|think outside the box|world-class|cutting-edge/i;
const CLAIM_ZH = /熟练|精通|掌握|丰富|擅长|多年|具备.{0,6}经验|有.{0,6}经验|负责过|主导过|正在从事|目前从事/;
const CLAIM_EN = /\b(?:proficient|expert|experienced|extensive|skilled|mastered|hands-on experience|track record|currently (?:work|design)\w*|have (?:designed|worked|led|built))\b/i;
const LEARN = /学习|了解|接触|基础|希望|愿意|计划|准备|learn|familiar|exposure|basic|eager|plan to|looking forward|keen to/i;


/** 自动质量检查：长度、数字可追溯、重复句、套话、把资料中没有的岗位技能写成已有经验 */
export function checkKit(kit: { coverLetter: Bi; selfIntro: Bi }, ctx: { sourceText: string; gapTerms: string[] }): string[] {
  const issues: string[] = [];
  const srcNums = new Set(numberTokens(ctx.sourceText));
  for (const l of ['zh', 'en'] as const) {
    for (const k of ['intro', 'cover'] as const) {
      const t = (k === 'intro' ? kit.selfIntro : kit.coverLetter)[l] ?? '';
      const name = `${k === 'intro' ? '自我介绍' : '求职信'}（${l === 'zh' ? '中文' : '英文'}）`;
      if (!t.trim()) { issues.push(`${name}为空`); continue; }
      const [, , lo, hi] = KIT_LIMITS[k][l]; const n = size(t, l);
      if (n > hi) issues.push(`${name}过长：${n}${l === 'zh' ? ' 字' : ' 词'}（上限约 ${hi}）`);
      if (n < lo) issues.push(`${name}过短：${n}${l === 'zh' ? ' 字' : ' 词'}（下限约 ${lo}）`);
      const bad = numberTokens(t).filter((x) => !srcNums.has(x)); if (bad.length) issues.push(`${name}含简历中没有的数字：${[...new Set(bad)].join(', ')}`);
      const ss = sentences(t, l);
      for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) if (overlap(ss[i], ss[j]) > 0.6) issues.push(`${name}有重复句：「${ss[j].slice(0, 30)}」`);
      if (CLICHE.test(t)) issues.push(`${name}含空泛套话：${t.match(CLICHE)![0]}`);
      for (const s of ss) for (const g of ctx.gapTerms) if (hasTerm(s, g) && (l === 'zh' ? CLAIM_ZH : CLAIM_EN).test(s) && !LEARN.test(s)) issues.push(`${name}把资料中没有的「${g}」写成了已有能力：「${s.slice(0, 40)}」`);
    }
  }
  return [...new Set(issues)];
}

/** 安全降级（确定性）：删掉含无来源数字 / 夸大缺口技能 / 套话的句子，再按句截到上限；不调用 AI */
export function degradeText(t: string, l: 'zh' | 'en', k: 'intro' | 'cover', ctx: { sourceText: string; gapTerms: string[] }): string {
  const srcNums = new Set(numberTokens(ctx.sourceText));
  let ss = sentences(t, l).filter((s) => numberTokens(s).every((x) => srcNums.has(x)) && !CLICHE.test(s) && !ctx.gapTerms.some((g) => hasTerm(s, g) && (l === 'zh' ? CLAIM_ZH : CLAIM_EN).test(s) && !LEARN.test(s)));
  ss = ss.filter((s, i) => !ss.slice(0, i).some((x) => overlap(x, s) > 0.6));
  const hi = KIT_LIMITS[k][l][1];
  const out: string[] = [];
  for (const s of ss) { if (out.length && size([...out, s].join(' '), l) > hi) { if (k === 'intro' && ss.indexOf(s) === ss.length - 1 && size([...out, s].join(' '), l) <= KIT_LIMITS[k][l][3]) out.push(s); continue; } out.push(s); }
  return out.join(l === 'zh' ? '' : ' ');
}

export interface KitQuality {
  attempts: number;
  /**
   * verified：逐句核对全部通过；
   * review（2026-11-03）：已自动删掉「硬问题」句子（新数字、抬高参与程度、把 JD 技能写成已有、学位状态、实机部署、删限定、编造的工具名），
   *   剩下的「软问题」句子（找不到对应条目、中文机构 / 专业名对不上等，常是换了说法）保留并标出，由用户核对；文本已可保存；
   * blocked：删掉硬问题后内容太少，不保存。
   */
  status: 'verified' | 'review' | 'blocked';
  /** review：被自动删掉的句子及原因 */
  removed?: string[];
  /** review：保留但需人工核对的句子 */
  flagged?: { text: string; reasons: string[] }[];
  /** 阻断性的事实问题（逐句：哪句、为什么） */
  issues: string[];
  /** 非阻断提示：长度、重复、套话 */
  warnings: string[];
  trace: SentenceTrace[];
  /** 只保留已核实句子的版本（不改写、不调 AI）；不足以成文时为 null */
  safe: { coverLetter: Bi; selfIntro: Bi } | null;
  /** 每次尝试被拦下的句子（用于记录 AI 误写） */
  caught: string[][];
}
const STYLE_ONLY = /过长|过短|重复句|套话|为空/;
/** 硬问题：明确违反负责人定的事实边界（新数字 / 抬高 / 把 JD 技能写成已有 / 学位 / 部署 / 删限定）。其余（找不到对应条目、名词对不上）多为换了说法，只提示核对。 */
const HARD = /数字|参与程度|学位尚未授予|实机部署|产线|删去了|已有能力|基础 \/ 了解|声称已经具备|已具备/;
export function isHard(t: SentenceTrace): boolean {
  return t.reasons.some((r) => HARD.test(r) || (/^提到了资料/.test(r) && /[A-Za-z]{2,}/.test(r.replace(/^[^：]*：/, ''))));
}
/** 从原文里删掉指定句子，保留段落换行 */
function dropSentences(t: string, bad: string[]): string {
  let out = t; for (const b of bad) out = out.replace(b, '');
  return out.split('\n').map((x) => x.replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function generateCoverKit(s: Settings, p: ProfileDoc, job: JobParse, r: ResumeDoc, opts: { maxAttempts?: number } = {}): Promise<{ coverLetter: Bi; selfIntro: Bi; quality: KitQuality }> {
  p = profileForGeneration(p);
  // 重点由已经完成深度语义选材的简历决定；核实证据仍可引用整个启用母库。
  const ctx = buildKitContext(p, job);
  const chosen = new Set([...r.selection.work, ...r.selection.projects]);
  const sourceToEntry = new Map([...p.work, ...p.projects].flatMap((e) => e.bullets.filter((b) => !!b.id).map((b) => [b.id!, e.id] as const)));
  const focus = [...new Set(r.items.map((it) => sourceToEntry.get(it.sourceId)).filter((id): id is string => !!id && chosen.has(id)))].slice(0, 2);
  for (const id of [...r.selection.work, ...r.selection.projects]) {
    if (focus.length >= 2) break;
    if (!focus.includes(id)) focus.push(id);
  }
  const factBlock = ctx.facts.map((f) => `[${f.id}] ${f.zh}${f.en && f.en !== f.zh ? `\n      ${f.en}` : ''}`).join('\n');
  const degree = ctx.degreePending ? `\n学位状态：尚未授予，预计 ${ctx.degreePending}（只能写「预计」）。` : '';
  const gaps = ctx.gapTerms.slice(0, 30);
  const ask = (feedback: string) => chatJson<{ coverLetter?: Bi; selfIntro?: Bi }>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content:
`${COVER_KIT_PROMPT}${feedback ? `\n\n上一版有句子未通过核对，请改正（不要再写这些内容）：\n${feedback}` : ''}

【A 候选人事实——唯一可以支撑「我做过 / 会 / 有」的来源】${degree}
重点经历（最多展开 1–2 段）：${focus.join('、') || '（自选）'}
${factBlock}

【B 岗位需求——只用于岗位需要什么、动机和学习方向，不是你的经历】
${jobBrief(job)}

【C A 中没有、只出现在 B 的技能 / 工具——不得写成已有能力或基础，只能写「希望学习」或不提】
${JSON.stringify(gaps)}` }], { model: decisionModel(s), thinking: 'enabled', timeoutMs: 240_000, maxTokens: 12_000 });
  const max = Math.max(1, Math.min(2, opts.maxAttempts ?? 2));
  type Kit = { coverLetter: Bi; selfIntro: Bi };
  let best: { kit: Kit; v: ReturnType<typeof verifyKit>; w: string[] } | null = null;
  const caught: string[][] = []; let feedback = ''; let attempts = 0;
  const src = ctx.corpus + '\n' + JSON.stringify(job.title);
  while (attempts < max) {
    attempts++;
    const out = await ask(feedback);
    const kit: Kit = { coverLetter: { zh: (out.coverLetter?.zh ?? '').trim(), en: (out.coverLetter?.en ?? '').trim() }, selfIntro: { zh: (out.selfIntro?.zh ?? '').trim(), en: (out.selfIntro?.en ?? '').trim() } };
    const v = verifyKit(kit, ctx);
    const w = checkKit(kit, { sourceText: src, gapTerms: [] }).filter((x) => STYLE_ONLY.test(x));
    const empty = w.filter((x) => /为空/.test(x));
    if (empty.length) { v.issues.push(...empty); v.passed = false; }
    caught.push(v.issues);
    if (!best || (v.passed && !best.v.passed) || (v.passed === best.v.passed && v.issues.length + w.length * 0.1 < best.v.issues.length + best.w.length * 0.1)) best = { kit, v, w };
    if (v.passed && !w.length) break;
    feedback = [...v.issues, ...w].map((x, i) => `${i + 1}. ${x}`).join('\n');
  }
  const b = best!;
  if (b.v.passed) return { ...b.kit, quality: { attempts, status: 'verified', issues: [], warnings: b.w, trace: b.v.trace, safe: null, caught } };
  // 删掉硬问题句子，软问题保留并标出
  const hard = b.v.trace.filter((t) => !t.ok && isHard(t));
  const cleaned: Kit = { coverLetter: { ...b.kit.coverLetter }, selfIntro: { ...b.kit.selfIntro } };
  for (const f of ['coverLetter', 'selfIntro'] as const) for (const l of ['zh', 'en'] as const) cleaned[f][l] = dropSentences(b.kit[f][l], hard.filter((t) => t.field === f && t.lang === l).map((t) => t.text));
  const v2 = verifyKit(cleaned, ctx);
  const enough = (['coverLetter', 'selfIntro'] as const).every((f) => (['zh', 'en'] as const).every((l) => v2.trace.filter((t) => t.field === f && t.lang === l && (t.kind === 'self' || t.kind === 'other')).length >= 2));
  if (!enough) return { ...b.kit, quality: { attempts, status: 'blocked', issues: b.v.issues, warnings: b.w, trace: b.v.trace, safe: verifiedOnly(b.kit, ctx), caught } };
  const FIELD = { coverLetter: '求职信', selfIntro: '自我介绍' } as const;
  const removed = hard.map((t) => `${FIELD[t.field]}（${t.lang === 'zh' ? '中文' : '英文'}）「${t.text}」：${t.reasons.join('；')}`);
  const flagged = v2.trace.filter((t) => !t.ok).map((t) => ({ text: t.text, reasons: t.reasons }));
  return { ...cleaned, quality: { attempts, status: flagged.length || removed.length ? 'review' : 'verified', issues: v2.issues, warnings: b.w, trace: v2.trace, safe: null, caught, removed, flagged } };
}

/** 备考方向是「要准备什么」，不能替候选人声称已经具备某项能力（v1.10.1） */
const PREP_CLAIM = /你已|您已|你有|您有|你具备|您具备|你熟悉|您熟悉|你掌握|已具备|已经具备|已有基础|你的(?:经历|项目|实习|背景)|候选人(?:已|具备|熟悉|有)|与你.{0,6}匹配|\byou (?:already|have|are (?:familiar|experienced|skilled))|\byour (?:experience|project|internship|background|skills?)\b|\bthe candidate (?:has|is)\b/i;
export const prepClaims = (x: PrepDirection) => PREP_CLAIM.test(`${x.area?.zh ?? ''} ${x.area?.en ?? ''} ${x.why?.zh ?? ''} ${x.why?.en ?? ''} ${(x.points ?? []).map((p) => `${p.zh} ${p.en}`).join(' ')}`);
const normQ = (t: string) => t.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const bigramSet = (t: string) => { const x = normQ(t); const b = new Set<string>(); for (let i = 0; i < x.length - 1; i++) b.add(x.slice(i, i + 2)); return b; };
/** 摘录是否来自原文：规范化后（全半角、空格、换行、标点）为子串，或 ≥80% 的二字组出现在原文里（OCR 断行 / 少字） */
export function quotedFrom(quote: string, source: string): boolean {
  const q = normQ(quote), src = normQ(source); if (q.length < 4) return false;
  if (src.includes(q)) return true;
  const qb = bigramSet(quote), sb = bigramSet(source); if (qb.size < 3) return false;
  let n = 0; for (const x of qb) if (sb.has(x)) n++; return n / qb.size >= 0.8;
}
/**
 * 备考大方向（2026-11-03 重做）：
 * - 以前要求 AI 逐字摘抄 JD 原句并做精确子串匹配；截图识别的原文有断行 / 全半角差异，AI 又常摘抄解析后的要求，导致全部被丢弃、界面只显示错误。
 * - 现在把解析出的岗位要求编号发给 AI，每条方向引用编号（refs）；没给编号时，摘录按规范化 / 二字组覆盖率对照原文与要求。
 * - 每条方向给 2–4 个要复习的知识点（points），说明准备到什么程度。仍然不评价候选人（prepClaims）。
 */
export async function generatePrep(s: Settings, job: JobParse): Promise<PrepDirection[]> {
  const reqs = jobRequirements(job);
  const tierName = { must: '必备', responsibility: '职责', preferred: '加分' } as const;
  const names = new Map((job.joint?.targets ?? []).map((t) => [t.job.id, t.name]));
  const list = reqs.slice(0, 60).map((r, i) => ({ ref: `R${i + 1}`, r }));
  const lines = list.map(({ ref, r }) => `${ref}｜${names.get(r.jobId) ? `${names.get(r.jobId)}｜` : ''}${tierName[r.tier as keyof typeof tierName] ?? r.tier}｜${r.text.zh.trim() || r.text.en.trim()}`).join('\n');
  const title = job.joint ? job.joint.targets.map((t) => t.name).join(' / ') : (job.title.zh || job.title.en);
  const out = await chatJson<{ items?: { area?: Bi; why?: Bi; points?: Bi[]; refs?: string[]; source?: string }[] }>(s, [{ role: 'system', content: '你是严谨的工科求职辅导顾问。只依据给出的岗位要求，结合行业常识说明面试 / 笔试通常会考察到什么程度；不推测公司内部情况、面试流程或具体题目。只输出 JSON。' }, { role: 'user', content:
`岗位：${title}
请把下面的岗位要求归纳成候选人应重点准备的知识 / 技能大方向，3–6 条，按重要性排序（必备、职责优先于加分）。相近的要求合并成一个方向。
每条：
- area：方向名称（如「机械设计基础与公差配合」），中英文。
- why：一句话说明岗位为什么需要它、面试通常考到什么深度，中英文。
- points：2–4 个具体要复习 / 准备的知识点或技能动作（如「常用配合与公差等级的选用」「能讲清一个零件从受力到选材的设计思路」），中英文，每个不超过 30 字 / 15 words。
- refs：对应的岗位要求编号（如 ["R1","R4"]），必须来自下面的列表。
不要写具体面试题，不要评价候选人，不要写「你已具备 / 你熟悉 / 与你的经历匹配」之类的话。
输出 JSON：{"items":[{"area":{"zh":"","en":""},"why":{"zh":"","en":""},"points":[{"zh":"","en":""}],"refs":["R1"]}]}

岗位要求（编号｜${job.joint ? '岗位｜' : ''}类别｜原文）：
${lines || '（未解析出要求，请直接依据下面的岗位原文；此时每条用 source 字段摘抄对应原句）'}
${lines ? '' : `\n岗位原文：\n${job.rawText}`}` }], { model: decisionModel(s), thinking: 'enabled', timeoutMs: 240_000, maxTokens: 8_000 });
  const byRef = new Map(list.map((x) => [x.ref.toLowerCase(), x.r]));
  const sources = [job.rawText ?? '', ...reqs.flatMap((r) => [r.text.zh, r.text.en])].join('\n');
  const res: PrepDirection[] = [];
  for (const x of out.items ?? []) {
    if (!x?.area || !(x.area.zh || x.area.en)) continue;
    const hit = (x.refs ?? []).map((r) => byRef.get(String(r).trim().toLowerCase())).filter((r): r is NonNullable<typeof r> => !!r);
    const src = hit.length ? hit.map((r) => r.text.zh.trim() || r.text.en.trim()).join('；') : (x.source && quotedFrom(x.source, sources) ? x.source.trim() : '');
    if (!src) continue;
    const item: PrepDirection = { area: { zh: x.area.zh ?? '', en: x.area.en ?? '' }, why: { zh: x.why?.zh ?? '', en: x.why?.en ?? '' }, source: src, points: (x.points ?? []).filter((p) => p && (p.zh || p.en)).slice(0, 4).map((p) => ({ zh: p.zh ?? '', en: p.en ?? '' })) };
    if (prepClaims(item)) continue;
    res.push(item);
  }
  return res.slice(0, 6);
}
