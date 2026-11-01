import type { Bi, JobParse, PrepDirection, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson } from './provider';
import { COVER_KIT_PROMPT, SYS_FACTS } from './prompts';
import { numberTokens } from './consistency';
import { hasTerm, overlap, planResume } from './relevance';
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
const resumeText = (p: ProfileDoc, r: ResumeDoc) => layoutToText(buildLayout(p, BUILTIN_TEMPLATES[0], 'zh', r)) + '\n\n' + layoutToText(buildLayout(p, BUILTIN_TEMPLATES[0], 'en', r));
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

export interface KitQuality { attempts: number; degraded: string[]; issues: string[] }

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

export async function generateCoverKit(s: Settings, p: ProfileDoc, job: JobParse, r: ResumeDoc, opts: { maxAttempts?: number } = {}): Promise<{ coverLetter: Bi; selfIntro: Bi; quality: KitQuality }> {
  const src = resumeText(p, r);
  // 只把 1–2 段与岗位最相关的真实经历作为重点（其余简历内容仍作为背景事实来源）
  const plan = planResume(p, job, 'zh', 1);
  const focus = plan.entries.filter((e) => e.kind !== 'education' && e.score > 0).sort((a, b) => b.score - a.score).slice(0, 2).map((e) => {
    const x = [...p.work, ...p.projects].find((y) => y.id === e.id) as { company?: { zh?: string; en?: string }; name?: { zh?: string; en?: string } } | undefined;
    return (x?.name?.zh || x?.company?.zh || x?.name?.en || x?.company?.en || e.id);
  });
  const gapTerms = [...job.mustHave, ...job.keywords, ...job.niceToHave].flatMap((k) => [k.zh, k.en]).filter((t): t is string => !!t && t.length >= 2 && !hasTerm(src, t));
  const gapUnique = [...new Set(gapTerms)].filter((t) => !hasTerm(src, t)).slice(0, 20);
  const ctx = { sourceText: src + '\n' + JSON.stringify(job.title), gapTerms: gapUnique };
  const ask = (feedback: string) => chatJson<{ coverLetter?: Bi; selfIntro?: Bi }>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content: COVER_KIT_PROMPT + (feedback ? `\n\n上一版未通过检查，请修正：\n${feedback}` : '') + `\n重点经历（最多选 1–2 段来写）：${JSON.stringify(focus)}\n资料中没有体现的岗位要求（只能写「希望学习 / 有相关基础」，不得写成已有经验；拿不准就不提）：${JSON.stringify(gapUnique)}\n岗位：${jobBrief(job)}\n简历（唯一事实来源）：\n${src}` }]);
  const max = Math.max(1, Math.min(2, opts.maxAttempts ?? 2));
  let kit = { coverLetter: { zh: '', en: '' }, selfIntro: { zh: '', en: '' } };
  let issues: string[] = []; let attempts = 0;
  for (; attempts < max; ) {
    attempts++;
    const out = await ask(issues.join('\n'));
    kit = { coverLetter: { zh: (out.coverLetter?.zh ?? '').trim(), en: (out.coverLetter?.en ?? '').trim() }, selfIntro: { zh: (out.selfIntro?.zh ?? '').trim(), en: (out.selfIntro?.en ?? '').trim() } };
    issues = checkKit(kit, ctx);
    if (!issues.length) break;
  }
  const degraded: string[] = [];
  if (issues.length) {
    for (const l of ['zh', 'en'] as const) {
      const d1 = degradeText(kit.selfIntro[l], l, 'intro', ctx); if (d1 !== kit.selfIntro[l]) { kit.selfIntro[l] = d1; degraded.push(`selfIntro.${l}`); }
      const d2 = degradeText(kit.coverLetter[l], l, 'cover', ctx); if (d2 !== kit.coverLetter[l]) { kit.coverLetter[l] = d2; degraded.push(`coverLetter.${l}`); }
    }
    issues = checkKit(kit, ctx);
  }
  return { ...kit, quality: { attempts, degraded, issues } };
}

const norm = (t: string) => t.replace(/\s+/g, '').toLowerCase();
/** 备考大方向：只依据 JD 原文；每条必须给出 JD 原句，校验不在原文中的条目直接丢弃 */
export async function generatePrep(s: Settings, job: JobParse): Promise<PrepDirection[]> {
  const out = await chatJson<{ items?: PrepDirection[] }>(s, [{ role: 'system', content: '你是严谨的求职辅导顾问。只依据给出的岗位描述原文，不推测公司内部情况、面试流程或题目。只输出 JSON。' }, { role: 'user', content:
`阅读下面的岗位描述，归纳候选人应重点准备的知识/技能大方向（3–6 条，宁少勿滥）。
要求：
- 每条必须对应 JD 中明确写出的要求，source 字段逐字摘抄该要求所在的原句（不可改写、不可拼接）。
- area 是方向名称（如“SQL 与数据建模”），why 用一句话说明为什么要准备、准备到什么程度，只基于原句内容。
- 不要写具体面试题，不要写公司特定的猜测。
- 中英对应。
输出 JSON：{"items":[{"area":{"zh":"","en":""},"why":{"zh":"","en":""},"source":"JD 原句"}]}
岗位描述原文：
${job.rawText}` }]);
  const raw = norm(job.rawText);
  return (out.items ?? []).filter((x) => x?.area && x.source && norm(x.source).length >= 4 && raw.includes(norm(x.source))).slice(0, 6);
}
