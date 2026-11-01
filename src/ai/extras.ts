import type { Bi, JobParse, PrepDirection, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson } from './provider';
import { COVER_KIT_PROMPT, SYS_FACTS } from './prompts';
import { numberTokens } from './consistency';
import { buildKitContext, verifiedOnly, verifyKit, type SentenceTrace } from '../quality/kitVerify';
import { hasTerm, overlap } from './relevance';
import { decisionModel } from './aiPlanner';
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
  /** verified：逐句核对全部通过，可保存；blocked：两次生成仍有无法追溯的自述，不保存 */
  status: 'verified' | 'blocked';
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

export async function generateCoverKit(s: Settings, p: ProfileDoc, job: JobParse, r: ResumeDoc, opts: { maxAttempts?: number } = {}): Promise<{ coverLetter: Bi; selfIntro: Bi; quality: KitQuality }> {
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
  return { ...b.kit, quality: { attempts, status: b.v.passed ? 'verified' : 'blocked', issues: b.v.issues, warnings: b.w, trace: b.v.trace, safe: b.v.passed ? null : verifiedOnly(b.kit, ctx), caught } };
}

const norm = (t: string) => t.replace(/\s+/g, '').toLowerCase();
/** 备考方向是「要准备什么」，不能替候选人声称已经具备某项能力（v1.10.1） */
const PREP_CLAIM = /你已|您已|你有|您有|你具备|您具备|你熟悉|您熟悉|你掌握|已具备|已经具备|已有基础|你的(?:经历|项目|实习|背景)|候选人(?:已|具备|熟悉|有)|与你.{0,6}匹配|\byou (?:already|have|are (?:familiar|experienced|skilled))|\byour (?:experience|project|internship|background|skills?)\b|\bthe candidate (?:has|is)\b/i;
export const prepClaims = (x: PrepDirection) => PREP_CLAIM.test(`${x.area?.zh ?? ''} ${x.area?.en ?? ''} ${x.why?.zh ?? ''} ${x.why?.en ?? ''}`);
/** 备考大方向：只依据 JD 原文；每条必须给出 JD 原句，校验不在原文中的条目直接丢弃 */
export async function generatePrep(s: Settings, job: JobParse): Promise<PrepDirection[]> {
  const out = await chatJson<{ items?: PrepDirection[] }>(s, [{ role: 'system', content: '你是严谨的求职辅导顾问。只依据给出的岗位描述原文，不推测公司内部情况、面试流程或题目。只输出 JSON。' }, { role: 'user', content:
`阅读下面的岗位描述，归纳候选人应重点准备的知识/技能大方向（3–6 条，宁少勿滥）。
要求：
- 每条必须对应 JD 中明确写出的要求，source 字段逐字摘抄该要求所在的原句（不可改写、不可拼接）。
- area 是方向名称（如“SQL 与数据建模”），why 用一句话说明为什么要准备、准备到什么程度，只基于原句内容。
- 不要写具体面试题，不要写公司特定的猜测。
- 只写「岗位需要什么、要准备到什么程度」，不要评价候选人，不要写「你已具备 / 你熟悉 / 你有基础 / 与你的经历匹配」之类的话。
- 中英对应。
输出 JSON：{"items":[{"area":{"zh":"","en":""},"why":{"zh":"","en":""},"source":"JD 原句"}]}
岗位描述原文：
${job.rawText}` }], { model: decisionModel(s), thinking: 'enabled', timeoutMs: 240_000, maxTokens: 8_000 });
  const raw = norm(job.rawText);
  return (out.items ?? []).filter((x) => x?.area && x.source && norm(x.source).length >= 4 && raw.includes(norm(x.source)) && !prepClaims(x)).slice(0, 6);
}
