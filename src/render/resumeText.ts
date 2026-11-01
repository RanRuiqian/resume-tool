import type { Lang } from '../types';

/** 仅修正项目/课程标题中相邻的完全相同英文词；不改学校、机构或证书专名。 */
export function tidyProjectTitle(text: string, lang: Lang): string {
  if (lang !== 'en') return text;
  return text.replace(/\b([A-Za-z]{3,})(\s+\1\b)+/gi, '$1');
}

const GPA = /GPA|绩点|均分|平均分|加权|WAM|\baverage\b|成绩(?!单)/i;
const VERIFY = /核实|核验|核对|以.{0,12}为准|成绩单|自行|换算|计算|折算|仅供参考|参考|待确认|证明|verify|verif|transcript|calculat|convert|self[- ]?reported|for reference|subject to|official|pending|confirm/i;
const EST = /估算|估计|约|换算|折算|自行计算|自算|\best\.|estimat|approx|calculat|convert/i;
const UNOFF = /非官方|并非官方|不是官方|unofficial|not (?:an |the )?official|non-official/i;

/**
 * v1.10 简历副本里 GPA 后面的冗长核验说明 → 只保留必要限定（估算 / 非官方），说明本身去掉。
 * 只在生成的简历中使用；资料库原文不变。没有 GPA 字样的句子原样返回。
 */
export function compactGpaNote(text: string, lang: Lang): string {
  if (!GPA.test(text)) return text;
  let est = false, unoff = false;
  const strip = (inner: string) => { if (!VERIFY.test(inner) && !UNOFF.test(inner) && !EST.test(inner)) return null; est ||= EST.test(inner); unoff ||= UNOFF.test(inner); return ''; };
  let s = text.replace(/\s*[（(]([^（）()]+)[）)]/g, (m, inner: string) => (strip(inner) === null ? m : ''));
  // 句末附加的核验说明句：「…，以学校出具的成绩单为准。」「; calculated by the candidate, subject to the official transcript.」
  const parts = s.split(lang === 'zh' ? /(?=[，,；;。])/ : /(?=[,;.](?:\s|$))/);
  const head: string[] = [];
  for (const [i, p] of parts.entries()) {
    const body = p.replace(/^[，,；;。.]\s*/, '');
    if (i > 0 && !GPA.test(body) && !/\d/.test(body) && strip(body) !== null) continue;
    head.push(p);
  }
  s = head.join('').replace(/[，,；;。.\s]+$/, '');
  const quals = [est ? (lang === 'zh' ? '估算' : 'est.') : '', unoff ? (lang === 'zh' ? '非官方' : 'unofficial') : ''].filter(Boolean);
  if (quals.length && !(est && EST.test(s)) && !(unoff && UNOFF.test(s))) s += lang === 'zh' ? `（${quals.join('，')}）` : ` (${quals.join(', ')})`;
  else if (quals.length) {
    const miss = quals.filter((q) => !(q === '估算' || q === 'est.' ? EST.test(s) : UNOFF.test(s)));
    if (miss.length) s += lang === 'zh' ? `（${miss.join('，')}）` : ` (${miss.join(', ')})`;
  }
  const end = text.trim().match(/[。.]$/)?.[0] ?? '';
  return (s.trim() + end) || text;
}
