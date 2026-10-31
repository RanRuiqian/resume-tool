import type { EducationEntry, Lang } from '../types';

/**
 * 学位状态（v1.8）：就读 / 课程结束日期（end，缺省用 courseCompletionDate）、预计授位日期、实际授位日期三者分开，不互相推断。
 * - conferred：有实际授位日期，且证明状态没有写「未授 / 办理中」
 * - expected：没有实际授位记录、有预计授位日期（与今天无关：日期过去也不当作已授位）
 * - unknown：两者都没有（旧资料），按原样显示就读区间，不加任何学位状态
 * - conflict：资料互相矛盾，保留原始日期，不标注已授位，并提示人工确认
 */
export type DegreeStatus = 'conferred' | 'expected' | 'unknown' | 'conflict';

const ym = (d?: string) => (d || '').trim().slice(0, 7);

export function degreeStatus(e: Pick<EducationEntry, 'end' | 'courseCompletionDate' | 'expectedConferralDate' | 'actualConferralDate' | 'degreeProofStatus'>): DegreeStatus {
  const act = ym(e.actualConferralDate), exp = ym(e.expectedConferralDate), end = ym(e.end === 'present' ? '' : e.end || e.courseCompletionDate);
  if (act) {
    if (e.degreeProofStatus === 'not-yet' || e.degreeProofStatus === 'pending') return 'conflict';
    if (end && act < end) return 'conflict';
    return 'conferred';
  }
  if (e.degreeProofStatus === 'issued') return 'conflict'; // 写了已授位却没有日期
  if (exp) return end && exp < end ? 'conflict' : 'expected';
  return 'unknown';
}

/** 需要人工确认的学历日期提示（today 只用于提示，不影响简历上的显示） */
export function degreeWarnings(e: EducationEntry, today = new Date().toISOString().slice(0, 7)): string[] {
  const w: string[] = [];
  const act = ym(e.actualConferralDate), exp = ym(e.expectedConferralDate), end = ym(e.end === 'present' ? '' : e.end || e.courseCompletionDate);
  if (act && (e.degreeProofStatus === 'not-yet' || e.degreeProofStatus === 'pending')) w.push('填了实际授位日期，但学位证明状态为「未授 / 办理中」');
  if (act && end && act < end) w.push('实际授位日期早于就读结束日期');
  if (!act && e.degreeProofStatus === 'issued') w.push('学位证明状态为「已授」，但没有实际授位日期');
  if (!act && exp && end && exp < end) w.push('预计授位日期早于就读结束日期');
  if (!act && exp && exp < today) w.push(`预计授位日期 ${exp} 已过，但还没有实际授位记录：简历仍按「预计」显示，确认授位后请填写实际授位日期`);
  return w;
}

export interface DateFmt { range: (s: string, e: string) => string; date: (d: string) => string }

/** 教育条目日期显示：start – 就读结束，学位状态只来自上面的 degreeStatus */
export function eduDateText(e: EducationEntry, lang: Lang, f: DateFmt): string {
  const st = degreeStatus(e);
  const end = e.end || e.courseCompletionDate || '';
  const exp = ym(e.expectedConferralDate), act = ym(e.actualConferralDate);
  if (st === 'conferred') return f.range(e.start, end || act);
  if (st === 'expected') {
    if (!end || end === 'present' || ym(end) === exp) {
      const r = f.range(e.start, end === 'present' ? exp : end || exp);
      return r + (lang === 'zh' ? '（预计）' : ' (expected)');
    }
    // 就读结束与预计授位不同月：两者都写明，不合并
    const d = f.date(exp);
    return f.range(e.start, end) + (lang === 'zh' ? `（预计 ${d} 授予学位）` : ` (degree expected ${d})`);
  }
  // unknown / conflict：保留原始就读区间，不声称已获或预计
  return f.range(e.start, end);
}
