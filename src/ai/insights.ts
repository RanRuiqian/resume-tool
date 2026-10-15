import type { Bi, JobParse, Lang } from '../types';
import type { LayoutModel } from '../render/layout';
import { layoutToText } from './extras';

/** ATS 关键词覆盖：岗位关键词（含必备项）在该语言简历文本中出现的比例 */
export function atsCoverage(m: LayoutModel, job: JobParse, lang: Lang): { pct: number; covered: Bi[]; missing: Bi[] } {
  const text = layoutToText(m).toLowerCase();
  const seen = new Set<string>();
  const kws = [...job.mustHave, ...job.keywords].filter((k) => { const key = (k.zh + '|' + k.en).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return !!(k.zh || k.en); });
  const hit = (k: Bi) => { const w = (k[lang] || k.zh || k.en).toLowerCase(); return w.length > 0 && text.includes(w); };
  const covered = kws.filter(hit), missing = kws.filter((k) => !hit(k));
  return { pct: kws.length ? Math.round((covered.length / kws.length) * 100) : 0, covered, missing };
}
