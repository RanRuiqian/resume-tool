import type { CourseEntry, LocalizedText, ProfileDoc } from '../types';

const str = (x: unknown): string => typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '';
const strings = (x: unknown): string[] => Array.isArray(x) ? x.map(str).filter(Boolean) : str(x).split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
const localized = (x: unknown): LocalizedText => typeof x === 'string' ? { [/[\u3400-\u9fff]/.test(x) ? 'zh' : 'en']: x } : x && typeof x === 'object' ? structuredClone(x) as LocalizedText : {};
const key = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const hash = (s: string) => { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(36); };
/** 名称不参与有代码课程的身份：中英名称不会造成两项。无代码且只有异语名称时保守提示，不能猜测合并。 */
export const courseIdentity = (c: Pick<CourseEntry, 'educationId' | 'school' | 'level' | 'term' | 'code' | 'name'>) =>
  [c.educationId || key(c.school), c.level, key(c.term), key(c.code || c.name.en || c.name.zh || '')].join('|');

export function normalizeCourse(raw: unknown): CourseEntry {
  const r = raw && typeof raw === 'object' ? raw as Partial<CourseEntry> : {};
  const c: CourseEntry = {
    ...structuredClone(r), id: str(r.id), enabled: r.enabled !== false, educationId: str(r.educationId), school: str(r.school),
    level: r.level === 'master' ? 'master' : 'bachelor', term: str(r.term), kind: r.kind === 'project-credit' ? 'project-credit' : 'taught',
    name: localized(r.name), code: str(r.code), credits: str(r.credits),
    grade: { raw: typeof r.grade?.raw === 'string' ? r.grade.raw : str(r.grade?.raw), status: r.grade?.status === 'not-released' || r.grade?.status === 'unverified' ? r.grade.status : 'recorded' },
    synopsis: localized(r.synopsis), knowledgeTags: strings(r.knowledgeTags),
    evidenceLevel: ['official', 'inferred', 'recalled'].includes(r.evidenceLevel ?? '') ? r.evidenceLevel! : 'unverified',
    sources: Array.isArray(r.sources) ? structuredClone(r.sources) : [], confirmation: r.confirmation === 'confirmed' ? 'confirmed' : 'pending',
    defaultGradeVisible: false, projectIds: strings(r.projectIds), aliases: strings(r.aliases),
  };
  if (/^ENG581[34]$/i.test(c.code) || /industry[- ]based project\s+[ab]\b/i.test(`${c.name.en ?? ''} ${c.name.zh ?? ''}`)) c.kind = 'project-credit';
  if (!c.id) c.id = `course-${hash(courseIdentity(c))}`;
  return c;
}
export const normalizeCourses = (rows: unknown): CourseEntry[] => Array.isArray(rows) ? rows.map(normalizeCourse) : [];

/** 确定性草稿解析，不调用模型。TXT 为带表头的 TSV/竖线表，JSON 为课程数组或 {courses:[]}。 */
export function parseCourseDraft(text: string, sourceLabel: string): CourseEntry[] {
  let rows: unknown[];
  if (text.trimStart().startsWith('[') || text.trimStart().startsWith('{')) {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : parsed.courses;
    if (!Array.isArray(rows)) throw new Error('JSON 需要课程数组或 {"courses": [...]}');
  } else {
    const lines = text.split(/\r?\n/).filter((s) => s.trim() && !s.trim().startsWith('#'));
    if (lines.length < 2) throw new Error('TXT 需包含表头和课程行；可下载格式示例');
    const delimiter = lines[0].includes('\t') ? '\t' : '|';
    const headers = lines[0].split(delimiter).map((s) => s.trim());
    const known = ['id', 'educationId', 'school', 'level', 'term', 'kind', 'zh', 'en', 'code', 'credits', 'grade', 'gradeStatus', 'synopsisZh', 'synopsisEn', 'knowledgeTags', 'evidenceLevel', 'aliases', 'projectIds'];
    if (!headers.includes('zh') && !headers.includes('en')) throw new Error('TXT 表头需有 zh 或 en 正式课程名列');
    const unknown = headers.filter((h) => !known.includes(h));
    if (unknown.length) throw new Error(`无法识别的列：${unknown.join('、')}；未导入任何课程`);
    rows = lines.slice(1).map((line, i) => {
      const cells = line.split(delimiter).map((s) => s.trim());
      if (cells.length !== headers.length) throw new Error(`第 ${i + 2} 行列数不一致；未导入任何课程`);
      const r = Object.fromEntries(headers.map((h, n) => [h, cells[n]]));
      return { ...r, name: { zh: r.zh, en: r.en }, synopsis: { zh: r.synopsisZh, en: r.synopsisEn }, grade: { raw: r.grade, status: r.gradeStatus } };
    });
  }
  const courses = rows.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(`第 ${i + 1} 项不是课程对象`);
    const source = r as Record<string, unknown>;
    if (!['bachelor', 'master'].includes(String(source.level))) throw new Error(`第 ${i + 1} 项须明确 level 为 bachelor 或 master，不能猜测学历层次`);
    if (source.kind !== undefined && !['taught', 'project-credit'].includes(String(source.kind))) throw new Error(`第 ${i + 1} 项 kind 不合法`);
    if (source.evidenceLevel !== undefined && !['official', 'inferred', 'recalled', 'unverified'].includes(String(source.evidenceLevel))) throw new Error(`第 ${i + 1} 项 evidenceLevel 不合法`);
    for (const field of ['name', 'synopsis']) {
      const v = source[field];
      if (v !== undefined && typeof v !== 'string' && (!v || typeof v !== 'object' || Array.isArray(v))) throw new Error(`第 ${i + 1} 项 ${field} 应为双语文本或原文字符串`);
      if (v && typeof v === 'object') for (const lang of ['zh', 'en']) if ((v as Record<string, unknown>)[lang] !== undefined && typeof (v as Record<string, unknown>)[lang] !== 'string') throw new Error(`第 ${i + 1} 项 ${field}.${lang} 应为字符串`);
    }
    const grade = typeof source.grade === 'string' ? { raw: source.grade, status: 'recorded' } : source.grade;
    if (grade !== undefined && (!grade || typeof grade !== 'object' || Array.isArray(grade))) throw new Error(`第 ${i + 1} 项 grade 不是成绩原文或对象`);
    const status = (grade as Record<string, unknown> | undefined)?.status;
    if (status !== undefined && !['recorded', 'not-released', 'unverified'].includes(String(status))) throw new Error(`第 ${i + 1} 项 grade.status 不合法`);
    const c = normalizeCourse({ ...source, grade });
    if (!c.name.zh?.trim() && !c.name.en?.trim()) throw new Error(`第 ${i + 1} 项没有正式课程名`);
    if (!c.educationId && !c.school) throw new Error(`第 ${i + 1} 项缺少学校或教育 ID`);
    // 新导入永远是待人工确认草稿，不能信任文件自报的 confirmed。
    c.confirmation = 'pending'; delete c.userConfirmedAt;
    const label = sourceLabel.trim() || '课程导入草稿';
    const provenance = { id: `course-source-${hash(label)}`, label };
    if (!c.sources.some((s) => s.id === provenance.id)) c.sources.push(provenance);
    return c;
  });
  const seen = new Map<string, CourseEntry>();
  for (const c of courses) {
    const previous = [...seen.values()].find((e) => e.id === c.id || courseIdentity(e) === courseIdentity(c));
    if (!previous) { seen.set(c.id, c); continue; }
    for (const field of COMPARE) {
      if (field === 'name' || field === 'synopsis') {
        for (const lang of ['zh', 'en'] as const) {
          if (previous[field][lang] && c[field][lang] && previous[field][lang] !== c[field][lang]) throw new Error(`课程 ${c.code || c.id} 的 ${field}.${lang} 冲突，请先核对草稿`);
          if (!previous[field][lang] && c[field][lang]) previous[field][lang] = c[field][lang];
        }
      } else if (isEmpty(previous[field])) Object.assign(previous, { [field]: c[field] });
      else if (!isEmpty(c[field]) && JSON.stringify(previous[field]) !== JSON.stringify(c[field])) throw new Error(`课程 ${c.code || c.id} 的 ${field} 冲突，请先核对草稿`);
    }
    previous.sources = [...new Map([...previous.sources, ...c.sources].map((s) => [s.id, s])).values()];
  }
  return [...seen.values()];
}

export interface CourseImportRow { incoming: CourseEntry; existingId?: string; changes: string[]; ambiguousIds: string[] }
const COMPARE = ['educationId', 'school', 'level', 'term', 'kind', 'name', 'code', 'credits', 'grade', 'synopsis', 'knowledgeTags', 'evidenceLevel', 'aliases', 'projectIds'] as const;
const isEmpty = (x: unknown) => x === undefined || x === '' || (Array.isArray(x) && !x.length);
export function previewCourseImport(existing: CourseEntry[], incoming: CourseEntry[]): CourseImportRow[] {
  return incoming.map((c) => {
    const matches = existing.filter((e) => e.id === c.id || courseIdentity(e) === courseIdentity(c));
    const old = matches.length === 1 ? matches[0] : undefined;
    const changes = old ? COMPARE.filter((k) => JSON.stringify(old[k]) !== JSON.stringify(c[k])) : [];
    // 没有共同代码/ID 的异语课程不能自动认定相同，要求用户指定稳定 ID 再导入。
    const possible = !old && !c.code ? existing.filter((e) => !e.code && e.level === c.level && e.term === c.term && (e.educationId || key(e.school)) === (c.educationId || key(c.school))
      && ((!!e.name.zh && !e.name.en && !c.name.zh && !!c.name.en) || (!!e.name.en && !e.name.zh && !c.name.en && !!c.name.zh))) : [];
    return { incoming: c, existingId: old?.id, changes, ambiguousIds: matches.length > 1 ? matches.map((e) => e.id) : possible.map((e) => e.id) };
  });
}
export type CourseImportChoice = 'skip' | 'add' | 'fill' | 'replace';
/** 撤销删除只还原该课程，不能回滚删除后其它课程的手动编辑。 */
export function restoreDeletedCourse(profile: ProfileDoc, deleted: CourseEntry, index: number): ProfileDoc {
  const next = structuredClone(profile), list = next.courses ??= [];
  if (list.some((c) => c.id === deleted.id)) throw new Error('同 ID 课程已存在，请人工核对，未覆盖任何内容');
  list.splice(Math.min(Math.max(0, index), list.length), 0, structuredClone(deleted)); return next;
}
/** UI 显式选择后才应用；fill 只补缺失，replace 会标回待审核；不会改动任何项目或其他资料。 */
export function applyCourseImport(profile: ProfileDoc, preview: CourseImportRow[], choices: Record<string, CourseImportChoice>): ProfileDoc {
  const next = structuredClone(profile), list = next.courses ??= [];
  for (const row of preview) {
    const choice = choices[row.incoming.id] ?? 'skip';
    if (choice === 'skip') continue;
    if (row.ambiguousIds.length) throw new Error('存在可能重复的课程，请指定相同稳定 ID 后重新预览');
    const c = structuredClone(row.incoming), i = list.findIndex((e) => e.id === row.existingId);
    if (choice === 'add') {
      if (i >= 0 || list.some((e) => e.id === c.id || courseIdentity(e) === courseIdentity(c))) throw new Error('课程已存在，请重新预览差异');
      list.push(c); continue;
    }
    if (i < 0) throw new Error('原课程已改变，请重新预览');
    const old = list[i];
    if (choice === 'replace') list[i] = { ...c, id: old.id, enabled: old.enabled, confirmation: 'pending' };
    else {
      for (const field of COMPARE) {
        if (field === 'name' || field === 'synopsis') {
          for (const lang of ['zh', 'en'] as const) if (!old[field][lang] && c[field][lang]) {
            old[field][lang] = c[field][lang]; old[field].status = { ...old[field].status, [lang]: 'manual' }; old.confirmation = 'pending';
          }
        } else if (isEmpty(old[field]) && !isEmpty(c[field])) { Object.assign(old, { [field]: c[field] }); old.confirmation = 'pending'; }
      }
      // 成绩是嵌套对象，必须单独补缺；不填补「未公布」或待核实的占位。
      if (!old.grade.raw && old.grade.status === 'recorded' && c.grade.raw) { old.grade = c.grade; old.confirmation = 'pending'; }
    }
    const merged = list[i];
    merged.sources = [...new Map([...old.sources, ...c.sources].map((s) => [s.id, s])).values()];
    merged.defaultGradeVisible = false;
  }
  return next;
}

export const COURSE_TXT_EXAMPLE = 'school|level|term|code|zh|en|credits|grade|gradeStatus|synopsisZh|knowledgeTags|evidenceLevel|kind|projectIds\n模拟大学|bachelor|示例第一学期|MOCK101|示例热过程基础||3|示例原始等级|recorded|介绍热过程与传热的基础理论及常见工程分析方法。|热过程,传热|inferred|taught|';
