import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { coursesFixture } from './helpers/v113CoursesFixture';
import { applyCourseImport, COURSE_TXT_EXAMPLE, courseIdentity, normalizeCourse, parseCourseDraft, previewCourseImport, restoreDeletedCourse } from '../src/storage/courses';
import { emptyProfile, exportProfileJson, normalizeProfile } from '../src/storage/profileIO';
import { ResumeDB } from '../src/storage/db';
import { exportLightJson, readArchive, restoreArchive } from '../src/tracker/backup';
import { selectionBrief, validateAiSelection } from '../src/ai/aiPlanner';
import { personalPlan } from './helpers/v112PersonalFixture';
import { jobs } from './helpers/v110Fixture';
import { generateRules } from '../src/ai/generate';
import { buildLayout } from '../src/render/layout';
import { courseSelectionSnapshot, profileForGeneration } from '../src/privacy/resume';
import { applySummaryVariant, restoreSummaryBaseline } from '../src/ai/summaryVariant';
import { fixedSummaryItem, fixedSummaryNotes } from '../src/ai/fixedSummary';

const p = () => coursesFixture();
describe('v1.13 course identity, provenance and conservative import', () => {
  it('undoes only the deleted course while preserving later edits, and refuses to overwrite a recreated ID', () => {
    const profile = p(), deleted = profile.courses!.shift()!; profile.courses![0].synopsis.zh = '删除后人工修订';
    const restored = restoreDeletedCourse(profile, deleted, 0);
    expect(restored.courses![0]).toEqual(deleted); expect(restored.courses![1].synopsis.zh).toBe('删除后人工修订');
    expect(() => restoreDeletedCourse(restored, deleted, 0)).toThrow(/未覆盖/);
  });
  it('imports 76 bachelor + 6 masters with two credit units linked to one project; repeat imports add nothing', () => {
    const fixture = p(), raw = JSON.stringify({ courses: fixture.courses });
    const rows = parseCourseDraft(raw, 'fictional.json'); const preview = previewCourseImport([], rows);
    let profile = applyCourseImport({ ...fixture, courses: [] }, preview, Object.fromEntries(rows.map((c) => [c.id, 'add'])));
    expect(profile.courses!.filter((c) => c.level === 'bachelor' && c.kind === 'taught')).toHaveLength(76);
    expect(profile.courses!.filter((c) => c.level === 'master' && c.kind === 'taught')).toHaveLength(6);
    expect(profile.courses!.filter((c) => c.kind === 'project-credit').map((c) => c.projectIds)).toEqual([['core'], ['core']]);
    expect(profile.projects).toEqual(fixture.projects);
    expect(profile.courses!.every((c) => c.confirmation === 'pending' && c.defaultGradeVisible === false && c.sources.some((s) => s.label === 'fictional.json'))).toBe(true);
    const before = structuredClone(profile);
    profile = applyCourseImport(profile, previewCourseImport(profile.courses!, rows), {});
    expect(profile).toEqual(before);
  });
  it('merges complementary bilingual rows only with a shared identity and retains both official names', () => {
    const base = p().courses![0]; const a = { ...base, id: undefined, name: { zh: base.name.zh } }, b = { ...base, id: undefined, name: { en: base.name.en } };
    expect(courseIdentity(normalizeCourse(a))).toBe(courseIdentity(normalizeCourse(b)));
    const rows = parseCourseDraft(JSON.stringify([a, b]), 'bilingual.json');
    expect(rows).toHaveLength(1); expect(rows[0].name).toEqual(base.name);
    expect(() => parseCourseDraft(JSON.stringify([a, { ...b, credits: '5' }]), 'conflict.json')).toThrow(/冲突/);
  });
  it('blocks ambiguous cross-language records without common code or ID rather than creating duplicates', () => {
    const a = normalizeCourse({ school: '模拟大学', level: 'master', term: 'Mock S1', name: { zh: '模拟力学' } });
    const b = normalizeCourse({ school: '模拟大学', level: 'master', term: 'Mock S1', name: { en: 'Fictional Mechanics' } });
    const rows = previewCourseImport([a], [b]);
    expect(rows[0].ambiguousIds).toEqual([a.id]);
    expect(() => applyCourseImport({ ...emptyProfile(), courses: [a] }, rows, { [b.id]: 'add' })).toThrow(/可能重复/);
  });
  it('does not overwrite manual changes on fill; replacement requires explicit choice and returns pending', () => {
    const profile = p(), old = profile.courses![0]; old.synopsis.zh = '人工核对后的唯一概述。'; old.name.en = ''; old.grade.raw = '  MOCK-ORIGINAL  ';
    const incoming = normalizeCourse({ ...old, name: { ...old.name, en: 'Fictional Course Official Name' }, synopsis: { zh: '新的草稿概述。' }, grade: { raw: 'MOCK-CHANGED', status: 'recorded' } });
    const rows = previewCourseImport(profile.courses!, [incoming]); const before = structuredClone(profile);
    expect(rows[0].changes).toEqual(expect.arrayContaining(['name', 'synopsis', 'grade']));
    const filled = applyCourseImport(profile, rows, { [old.id]: 'fill' });
    expect(filled.courses![0].name.en).toBe('Fictional Course Official Name'); expect(filled.courses![0].synopsis.zh).toBe(old.synopsis.zh); expect(filled.courses![0].grade.raw).toBe('  MOCK-ORIGINAL  ');
    expect(profile).toEqual(before);
    const replaced = applyCourseImport(profile, rows, { [old.id]: 'replace' });
    expect(replaced.courses![0]).toMatchObject({ id: old.id, confirmation: 'pending', grade: { raw: 'MOCK-CHANGED' } });
  });
  it('accepts explicit TXT format, rejects unknown columns / malformed rows, never invents an English name', () => {
    const row = parseCourseDraft(COURSE_TXT_EXAMPLE, 'fictional.txt')[0]; expect(row.name.en || '').toBe(''); expect(row.grade.raw).toBe('示例原始等级');
    expect(() => parseCourseDraft('school|zh|unknown\n模拟大学|模拟课程|x', 'x')).toThrow(/无法识别/);
    expect(() => parseCourseDraft(JSON.stringify([{ school: '模拟大学', level: 'guess', name: '模拟课程' }]), 'x')).toThrow(/不能猜测/);
    expect(() => parseCourseDraft(JSON.stringify([{ school: '模拟大学', level: 'master', name: { en: 123 } }]), 'x')).toThrow(/字符串/);
    expect(() => parseCourseDraft('school|zh\n模拟大学', 'x')).toThrow(/列数/);
  });
  it('preserves courses, raw scores, links and missing grades in private JSON and full archive roundtrip', async () => {
    const profile = p(); expect(normalizeProfile(JSON.parse(exportProfileJson(profile)))).toEqual(profile);
    const d = new ResumeDB('v113-course-backup-test'), restored = new ResumeDB('v113-course-restore-test');
    await d.profile.put({ id: 'me', doc: profile });
    const archive = await exportLightJson(d), check = await readArchive(restored, archive);
    expect(check.errors).toEqual([]); await restoreArchive(restored, check, { sections: ['profile'], replaceProfile: true, overwrite: false });
    expect((await restored.profile.get('me'))!.doc).toEqual(profile);
    await d.delete(); await restored.delete();
  });
});

describe('v1.13 privacy and source safety', () => {
  it('does not send any course score, transcript source or inferred knowledge as practiced work to planning', () => {
    const profile = p(), before = structuredClone(profile), brief = selectionBrief(profile, jobs().A, 'zh', 1), clean = profileForGeneration(profile);
    expect(JSON.stringify(brief)).not.toContain('MOCK-UG-GRADE'); expect(JSON.stringify(brief)).not.toContain('MOCK-PG-GRADE'); expect(JSON.stringify(brief)).not.toContain('GPA 3.6');
    expect(clean.courses![0].grade.raw).toBe(''); expect(clean.courses![0].sources).toEqual([]); expect(profile).toEqual(before);
    // P2 允许课程语义关联，但绝不能借课程 ID 绕过实践事实边界。
    const falsePractice = personalPlan(); falsePractice.requirements![0] = { text: '供应商开发 / PLC 编程经验', tier: 'must', assessment: 'direct', evidenceIds: [profile.courses![0].id] };
    expect(() => validateAiSelection(falsePractice, profile, jobs().A, 'zh', 1)).toThrow(/课程不能当作直接/);
  });
  it('retains unconfirmed imports in the master library but excludes them from automatic selection and rendered profile', () => {
    const profile = p(); profile.work[0].importedFrom = { importTag: 'fake-import', incomingId: 'incoming', at: '2026-01-01' };
    const brief = selectionBrief(profile, jobs().A, 'zh', 1);
    expect(brief.allowedIds.entries.some((e) => e.entryId === 'career')).toBe(false);
    expect(buildLayout(profile, { ...template() }, 'en').main.flatMap((s) => s.blocks).some((b) => b.title === profile.work[0].company.en)).toBe(false);
    expect(profile.work[0].enabled).toBe(true);
    profile.work[0].userConfirmedAt = '2026-01-02'; expect(selectionBrief(profile, jobs().A, 'zh', 1).allowedIds.entries.some((e) => e.entryId === 'career')).toBe(true);
  });
  it('keeps official degree and PTE source without inflating language claims, hides links individually', () => {
    const profile = p(), r = generateRules(profile, jobs().A, 'en'); r.layoutPolicy = 'readable';
    profile.skills = [{ id: 'pte', enabled: true, name: { zh: 'PTE Academic MOCK', en: 'PTE Academic MOCK' } }]; r.selection.skills = ['pte'];
    const m = buildLayout(profile, template(), 'en', r); const text = JSON.stringify(m);
    expect(text).toContain('Marine Engineering'); expect(text).not.toMatch(/IELTS|fluent|Mechanical Engineering|example.com\/resume-tool/);
    r.contactVisibility = { github: true }; expect(buildLayout(profile, template(), 'en', r).header.contacts).toContain(profile.profile.contacts.github);
    expect(buildLayout(profile, template(), 'en', r).header.contacts).not.toContain(profile.profile.contacts.website);
  });
  it('preserves selected names and explicitly chosen score snapshots; later master edits cannot change the saved version', () => {
    const profile = p(), r = generateRules(profile, jobs().A, 'zh'); const ids = profile.courses!.slice(0, 2).map((c) => c.id);
    r.courseSelection = courseSelectionSnapshot(profile, ids, []);
    expect(JSON.stringify(r)).not.toContain('MOCK-UG-GRADE'); expect(JSON.stringify(buildLayout(profile, template(), 'zh', r))).not.toContain('MOCK-UG-GRADE');
    r.courseSelection = courseSelectionSnapshot(profile, ids, [ids[1]]);
    const before = JSON.stringify(buildLayout(profile, template(), 'zh', r)); profile.courses![1].grade.raw = 'MUTATED'; profile.courses![1].name.zh = '后来修改';
    expect(JSON.stringify(buildLayout(profile, template(), 'zh', r))).toBe(before);
    expect(before).toContain('MOCK-UG-GRADE-2'); expect(before).not.toContain('MOCK-UG-GRADE-1'); expect(before).not.toContain('PLC 内容待核实');
  });
  it('does not print project credit, pending courses, unpublished or obscured grades even on explicit invalid request', () => {
    const profile = p(); profile.courses![0].confirmation = 'pending';
    const s = courseSelectionSnapshot(profile, profile.courses!.map((c) => c.id), profile.courses!.map((c) => c.id));
    expect(s.ids).toHaveLength(81); expect(s.snapshots!.some((c) => c.name.en?.includes('Industry-based'))).toBe(false);
    expect(s.gradeIds).not.toContain(profile.courses![74].id); expect(s.gradeIds).not.toContain(profile.courses![79].id); expect(s.ids).not.toContain(profile.courses![0].id);
  });
});
import { BUILTIN_TEMPLATES } from '../src/templates';
const template = () => structuredClone(BUILTIN_TEMPLATES[0]);

describe('v1.13 fixed summary and per-resume variants', () => {
  it.each(['machine', 'stale', 'manual', undefined] as const)('keeps saved %s original visible and marks pending; does not forge approval', (status) => {
    const profile = p(); profile.profile.summary.status!.en = status;
    const item = fixedSummaryItem(profile)!;
    expect(item.en).toBe(profile.profile.summary.en); expect(item.syncStatus).toBe('needs-review'); expect(item.confirmedLangs).not.toContain('en');
    const r = generateRules(profile, jobs().A, 'en'); expect(JSON.stringify(buildLayout(profile, template(), 'en', r))).toContain(item.en);
    expect(fixedSummaryNotes(profile).join()).toContain('英文待确认');
  });
  it('applies only an explicit variant, leaves the fixed master untouched and restores exact baseline', () => {
    const profile = p(), before = structuredClone(profile), r = generateRules(profile, jobs().A, 'zh'), base = r.items.find((i) => i.sourceId === 'summary')!;
    const edited = applySummaryVariant(r, { zh: base.zh + ' ', en: base.en + ' ' });
    expect(edited.items.find((i) => i.sourceId === 'summary')!.syncStatus).toBe('needs-review'); expect(profile).toEqual(before);
    expect(restoreSummaryBaseline(edited).items.find((i) => i.sourceId === 'summary')).toEqual(base);
    expect(r.summaryBaseline).toBeUndefined();
    expect(() => applySummaryVariant(r, { zh: '', en: base.en })).toThrow(/清空/);
    expect(() => applySummaryVariant(r, { zh: base.zh + ' 已获得 IELTS 9。', en: base.en + ' IELTS 9.' })).toThrow();
  });
  it('does not duplicate a campus appointment into employment when selected twice', () => {
    const profile = p(), r = generateRules(profile, jobs().A, 'zh'); r.layoutPolicy = 'readable'; r.selection.work = ['career', 'student', 'student'];
    const m = buildLayout(profile, template(), 'zh', r), campus = m.main.concat(m.side).find((s) => s.key === 'campus')!;
    expect(campus.blocks).toHaveLength(1); expect(m.main.find((s) => s.key === 'work')!.blocks).toHaveLength(1);
  });
});
