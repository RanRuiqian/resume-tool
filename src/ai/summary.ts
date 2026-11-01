import type { Lang } from '../types';
import { guardRewrite, rewriteSafe } from '../quality/resumeGuard';
import { entityTokens } from '../quality/kitVerify';
import { numberTokens } from './consistency';
import { hasTerm } from './relevance';
import { familiesOf, isGeneralFamily, weightOf, type CapabilityModel } from './evidence';

/**
 * v1.11 旧简介工具，保留供旧版本回归检查；v1.12 生成路径使用 fixedSummary.ts，绝不按岗位调用这些精简函数。
 * - 没有能力词的身份分句（专业 / 在读）保留；
 * - 只涉及低价值能力（岗位不看重的「英文技术文档」等）的分句删掉；
 * - 工具清单只保留本岗位选中的技能。
 */
const BANNED = /精通|专家|卓越|顶尖|资深|\bexpert\b|\bmaster(?:ed|y)? (?:of|in)\b|world-class|outstanding/i;
const LIM = { zh: 90, en: 50 } as const;
const size = (s: string, l: Lang) => (l === 'zh' ? s.replace(/\s/g, '').length : s.split(/\s+/).filter(Boolean).length);
const sentences = (t: string, l: Lang) => t.trim().split(l === 'zh' ? /(?<=[。！？])/ : /(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const clauses = (s: string, l: Lang) => (l === 'zh' ? s.split(/(?<=[，；])/) : s.split(/(?<=[,;])\s+(?=(?:and |also )?[a-z]+(?:ed|ing|s)?\b)/));

const TOOL_LIST = { zh: /^(.*?(?:能使用|熟练使用|使用|熟悉|掌握|会用))(.+?)([，。；]?)$/, en: /^(.*?\b(?:use|using|uses|with|familiar with|proficient in|skilled in))\s+(.+?)([,.;]?)$/i };

function clauseValue(c: string, m: CapabilityModel): number | null {
  const fs = familiesOf(c); if (!fs.length) return null;
  return Math.max(...fs.map((f) => (isGeneralFamily(f) ? (weightOf(m, f) >= 1 ? weightOf(m, f) : 0) : weightOf(m, f))));
}

function trimToolList(c: string, l: Lang, keepTools: string[]): string | null {
  const mt = c.match(TOOL_LIST[l]); if (!mt) return c;
  const parts = mt[2].split(l === 'zh' ? /、|和|及|与|以及/ : /,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return c;
  const keep = parts.filter((x) => keepTools.some((t) => hasTerm(t, x) || hasTerm(x, t)));
  if (!keep.length) return null;
  if (keep.length === parts.length) return c;
  const join = l === 'zh' ? (keep.length > 1 ? `${keep.slice(0, -1).join('、')}${/[A-Za-z0-9]$/.test(keep[keep.length - 2]) || /^[A-Za-z]/.test(keep[keep.length - 1]) ? ' 和 ' : '和'}${keep[keep.length - 1]}` : keep[0]) : (keep.length > 1 ? `${keep.slice(0, -1).join(', ')} and ${keep[keep.length - 1]}` : keep[0]);
  return `${mt[1].trimEnd()} ${join}${mt[3]}`;
}

const tidy = (s: string, l: Lang) => (l === 'zh'
  ? s.replace(/[，；、]\s*(?=[。]|$)/g, '').replace(/^[，；\s]+/, '').replace(/([^。！？])$/, '$1。').replace(/，并(?=[^，。]*。$)/, '，并')
  : s.replace(/[,;]\s*(?=\.|$)/g, '').replace(/^[,;\s]+/, '').replace(/([^.!?])$/, '$1.').replace(/^([a-z])/, (x) => x.toUpperCase()));

/** 规则模式 / 兜底：按能力模型精简简介；每个保留分句都要通过护栏（整句删除允许），否则返回 null（调用方回退） */
export function focusSummary(text: string, l: Lang, m: CapabilityModel, keepTools: string[]): string | null {
  if (!text.trim()) return '';
  const out: string[] = [];
  let ok = true;
  for (const s of sentences(text, l)) {
    const kept: string[] = [];
    let skipped = false;
    clauses(s, l).forEach((c, i) => {
      let x = trimToolList(c, l, keepTools);
      if (x == null) { skipped = true; return; }
      const v = clauseValue(x, m);
      if (i > 0 && v !== null && v < 1) { skipped = true; return; } // 首个分句（身份 / 方向）保留
      if (skipped && kept.length) { x = x.replace(/^并(?=[\u4e00-\u9fa5])/, ''); }
      if (x !== c && !rewriteSafe(c, x, l)) ok = false;
      kept.push(x);
    });
    if (kept.length) out.push(tidy(kept.join(l === 'zh' ? '' : ' ').replace(/^(?:并|and)\s*/i, ''), l));
  }
  let r = out.join(l === 'zh' ? '' : ' ');
  while (size(r, l) > LIM[l] && out.length > 1) { out.pop(); r = out.join(l === 'zh' ? '' : ' '); }
  if (!ok || !r) return null;
  // 删除整句 / 分句可以；但不能凭空多出完成 / 商业等事实或抬高参与度
  return guardRewrite(text, r, l).some((x) => /新增了|参与程度被抬高|数字|百分比|币种/.test(x)) ? null : r;
}

/**
 * AI 写的简介护栏：只能使用简介原文和本简历已选要点里的事实。
 * 数字 / 工具 / 专有名词必须出现在这些来源；不能新增完成 / 商业 / 团队等事实、不能抬高参与程度、不能用「精通 / 专家」；
 * 原简介的限定（课程 / 仿真 / 预计…）不能删掉。
 */
export function guardSummary(orig: string, out: string, l: Lang, sources: string[], gapTerms: string[]): string[] {
  const r: string[] = [];
  if (!out.trim()) return ['简介为空'];
  if (size(out, l) > LIM[l] * 1.15) r.push('简介过长');
  if (BANNED.test(out)) r.push('使用了「精通 / 专家」类夸大措辞');
  const pool = [orig, ...sources].join('\n');
  const nums = new Set(numberTokens(pool));
  const exN = numberTokens(out).filter((n) => !nums.has(n)); if (exN.length) r.push(`使用了来源中没有的数字：${exN.join(', ')}`);
  const ent = entityTokens(out, l).filter((t) => !hasTerm(pool, t)); if (ent.length) r.push(`新增了来源中没有的工具 / 专有名词：${ent.join(', ')}`);
  const gap = gapTerms.filter((t) => hasTerm(out, t) && !hasTerm(pool, t)); if (gap.length) r.push(`写入了只在 JD 中出现的要求：${gap.join(', ')}`);
  // 新增事实 / 抬高参与度：对整个来源池判断；删除限定：只对简介原文判断
  for (const x of guardRewrite(pool, out, l)) if (/新增了原文没有的事实|参与程度被抬高/.test(x)) r.push(x);
  // 删除整句可以；但写到了某个原句的内容（双字组覆盖 ≥ 50%）就必须保留该句的限定
  const bg = (x: string) => { const n = x.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''); const st = new Set<string>(); for (let i = 0; i < n.length - 1; i++) st.add(n.slice(i, i + 2)); return st; };
  const ob = bg(out);
  for (const c of sentences(orig, l).flatMap((x) => clauses(x, l))) {
    const cb = bg(c); if (!cb.size) continue;
    let hit = 0; cb.forEach((v) => { if (ob.has(v)) hit++; });
    if (hit / cb.size >= 0.5) for (const x of guardRewrite(c, out, l)) if (/删除了限定/.test(x)) r.push(x);
  }
  return [...new Set(r)];
}
