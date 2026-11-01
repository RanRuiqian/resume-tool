import type { CourseEntry, Lang, ProfileDoc, ResumeDoc } from '../types';
import { LANG_TEST } from '../ai/relevance';
import { isUnconfirmedImport } from '../audit/techTerms';

/** 旧资料中的学术分数也默认隐藏；语言考试成绩保留原始证据，不换算。 */
export const academicGradeText = (text: string) => /\bGPA\b|绩点|均分|平均分|课程成绩|grade point average|course (?:grade|score)/i.test(text)
  || (!LANG_TEST.test(text) && /学术成绩|academic (?:grade|score)/i.test(text));
export const academicHighlight = (t: { zh?: string; en?: string }) => academicGradeText(`${t.zh ?? ''} ${t.en ?? ''}`);

/** 生成使用脱离母库的副本：课程成绩不进模型上下文；原始文档/证据位置也无需进入生成副本。 */
export function profileForGeneration(profile: ProfileDoc): ProfileDoc {
  const p = structuredClone(profile);
  delete p.sourceTexts;
  // 未审核的导入继续保存在母库，不能自动升级为正式履历或可靠技能。
  for (const list of [p.work, p.projects, p.skills, p.certificates, p.awards]) for (const e of list) if (isUnconfirmedImport(e)) e.enabled = false;
  p.courses = (p.courses ?? []).map((c) => ({ ...c, grade: { raw: '', status: c.grade.status }, sources: [], defaultGradeVisible: false }));
  p.education = p.education.map((e) => ({ ...e, highlights: e.highlights.filter((b) => !academicHighlight(b)) }));
  return p;
}
export const printableCourse = (p: ProfileDoc, c: CourseEntry) => c.enabled && c.confirmation === 'confirmed' && c.kind === 'taught'
  && !!p.education.find((e) => e.id === c.educationId && e.enabled);
export function courseSelectionSnapshot(p: ProfileDoc, ids: string[], gradeIds: string[]): NonNullable<ResumeDoc['courseSelection']> {
  const unique = [...new Set(ids)], eligible = unique.map((id) => p.courses?.find((c) => c.id === id)).filter((c): c is CourseEntry => !!c && printableCourse(p, c));
  const grades = new Set(gradeIds);
  const snapshots = eligible.map((c) => ({ id: c.id, educationId: c.educationId, school: c.school, name: structuredClone(c.name), code: c.code,
    ...(grades.has(c.id) && c.grade.status === 'recorded' && c.grade.raw.trim() ? { gradeRaw: c.grade.raw } : {}) }));
  return { ids: snapshots.map((c) => c.id), gradeIds: snapshots.filter((c) => c.gradeRaw !== undefined).map((c) => c.id), snapshots };
}
/** 只打印课程名（允许使用另一语言的官方原名），不复制概述、标签或推断为经验。 */
export function courseLines(p: ProfileDoc, r: ResumeDoc | null | undefined, educationId: string, lang: Lang): string[] {
  if (!r?.courseSelection) return [];
  const s = r.courseSelection;
  const rows = s.snapshots ?? courseSelectionSnapshot(p, s.ids, s.gradeIds).snapshots ?? [];
  const seen = new Set<string>();
  return rows.filter((c) => c.educationId === educationId && s.ids.includes(c.id) && !seen.has(c.id) && !!seen.add(c.id)).map((c) => {
    const name = c.name[lang] || c.name[lang === 'zh' ? 'en' : 'zh'] || c.code;
    const grade = s.gradeIds.includes(c.id) && c.gradeRaw ? ` (${c.gradeRaw})` : '';
    return `${name}${grade}`;
  });
}
