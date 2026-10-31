import type { LocalizedText, WorkEntry, WorkKind } from '../types';

/** 经历分类（v1.8）：显式 kind 优先；旧资料没有 kind（或为「其它」）时按名称谨慎推断 */
const VOLUNTEER = /志愿|支教|义工|公益|volunteer|charity|non-?profit\s+service/i;
const CLUB = /社团|协会|学生会|研究生会|团委|团支部|班委|班长|学生干部|学生会|俱乐部|兴趣小组|(?:^|[^\w])(?:club|society|student\s+(?:union|association|council|government)|association|student\s+chapter|class\s+(?:monitor|president))(?:[^\w]|$)/i;
const INTERN = /实习|intern(?:ship)?\b/i;

const txt = (t?: LocalizedText) => `${t?.zh ?? ''} ${t?.en ?? ''}`;

export function inferWorkKind(e: Pick<WorkEntry, 'kind' | 'company' | 'title'>): WorkKind {
  if (e.kind && e.kind !== 'other') return e.kind;
  const s = `${txt(e.company)} ${txt(e.title)}`;
  // 顺序：志愿 > 社团/学生干部 > 实习；企业名里带「协会」的行业协会全职岗也会被判成社团——宁可放校园经历，也不把社团冒充职业经历
  if (VOLUNTEER.test(s)) return 'volunteer';
  if (CLUB.test(s)) return 'club';
  if (INTERN.test(s)) return 'internship';
  return e.kind ?? '';
}

export const isCampusKind = (k: WorkKind) => k === 'club' || k === 'volunteer';
