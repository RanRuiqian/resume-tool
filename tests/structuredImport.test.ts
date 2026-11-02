import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseStructuredLibrary, isStructuredLibrary } from '../src/ai/structuredImport';
import { importProfileDetailed } from '../src/ai/importProfile';
import { applyImportPlan, applyReplace, buildImportPlan, undecidedCount } from '../src/ai/importPlan';
import { emptyProfile, normalizeProfile } from '../src/storage/profileIO';
import { isUnconfirmedImport } from '../src/audit/techTerms';
import { DEFAULT_SETTINGS } from '../src/storage/defaults';
import { mockNumberedLibrary } from './fixtures/numberedLibrary';

const parse = (text = mockNumberedLibrary()) => parseStructuredLibrary(text)!;
const apply = () => { const r = parse(); return applyImportPlan(emptyProfile(), r.profile, buildImportPlan(emptyProfile(), r.profile), { id: 'mock-source', at: '2026-01-01', files: ['mock.txt'], text: mockNumberedLibrary(), integrity: r.integrity }); };
afterEach(() => vi.restoreAllMocks());
describe('numbered library (fictional structure, NOT the actual V7 attachment)', () => {
  it('retains every 76 bachelor and 6 master course including raw content/IDs/credits/grades beyond 21,600 characters', () => {
    const text = mockNumberedLibrary(); expect(text.length).toBeGreaterThan(10000);
    const r = parse(text.replace('虚构课程内容1', `虚构课程内容1${'虚构说明。'.repeat(4000)}`));
    expect(r.integrity.complete).toBe(true); expect(r.integrity.issues).toEqual([]);
    expect(r.profile.courses?.filter((c) => c.level === 'bachelor')).toHaveLength(76);
    expect(r.profile.courses?.filter((c) => c.level === 'master')).toHaveLength(6);
    for (const c of r.profile.courses!) { expect(c.sourceRecord?.id).toMatch(/^(BSC|MSC)-/); expect(c.credits).not.toBe(''); expect(c.sourceRecord?.raw).toContain(c.grade.raw); expect(c.sourceRecord!.raw).toContain(c.sourceRecord!.id); }
    expect(r.integrity.groups.slice(0, 3).map((g) => [g.expected.length, g.recognized.length, g.missing.length])).toEqual([[76, 76, 0], [6, 6, 0], [2, 2, 0]]);
  });
  it('preserves core projects, labs, Lean assignments, student union departments and tool identities separately', () => {
    const p = apply(); expect(p.education).toHaveLength(2);
    expect(p.projects.filter((p) => p.kind === 'core')).toHaveLength(2);
    expect(p.projects.filter((p) => p.sourceRecord?.id.startsWith('LRN-'))).toHaveLength(4);
    expect(p.work.filter((p) => p.kind === 'club')).toHaveLength(2);
    expect(p.skills.map((s) => s.name.en)).toEqual(['Python', 'Visual Components Python Commands', 'GitHub', 'GitHub Pages']);
    const python = p.skills.find((s) => s.sourceRecord?.id === 'SKL-01')!;
    expect(python.usedIn).toHaveLength(2);
    expect(python.usedIn!.every((id) => p.projects.some((p) => p.id === id))).toBe(true);
    const vc = p.skills.find((s) => s.sourceRecord?.id === 'SKL-02')!;
    expect(vc.usedIn).toEqual([p.projects.find((p) => p.sourceRecord?.id === 'LRN-02')!.id]);
    const master = p.education.find((e) => e.sourceRecord?.id === 'EDU-02')!;
    expect(p.courses!.filter((c) => c.level === 'master').every((c) => c.educationId === master.id)).toBe(true);
    for (const c of p.courses!.filter((c) => ['ENG5813', 'ENG5814'].includes(c.code))) {
      expect(c.kind).toBe('project-credit'); expect(c.projectIds).toEqual([p.projects.find((e) => e.sourceRecord?.id === 'PRO-01')!.id]);
    }
    expect(p.evidence).toHaveLength(0);
  });
  it('keeps obscured/unreleased grades and unknown dates without fabrication or mandatory evidence tasks', () => {
    const r = parse(), p = apply();
    expect(r.profile.courses!.find((c) => c.sourceRecord?.id === 'BSC-011')!.grade).toEqual({ raw: '成绩遮挡 **', status: 'unverified' });
    expect(r.profile.courses!.find((c) => c.sourceRecord?.id === 'MSC-06')!.grade).toEqual({ raw: '尚未公布', status: 'not-released' });
    expect(p.education[1].end).toBe(''); expect(p.education[1].actualConferralDate).toBeUndefined(); expect(p.certificates[0].date).toBe('');
    expect(buildImportPlan(emptyProfile(), r.profile).otherUncertain).toEqual([]);
    for (const e of [...p.projects, ...p.skills, ...p.work, ...p.education]) expect(isUnconfirmedImport(e)).toBe(false);
    expect(p.courses!.every((c) => c.confirmation === 'confirmed' && c.evidenceLevel === 'unverified' && !c.defaultGradeVisible)).toBe(true);
  });
  it('re-imports exactly the same library without duplicate records, lost associations or repeated raw source copies', () => {
    const p = apply(), r = parse(); const plan = buildImportPlan(p, r.profile);
    expect(undecidedCount(plan)).toBe(0); expect(plan.items.every((i) => i.action === 'merge')).toBe(true);
    const again = normalizeProfile(applyImportPlan(p, r.profile, plan, { id: 'mock-source-2', at: '2026-01-02', files: ['mock.txt'], text: mockNumberedLibrary() }));
    for (const key of ['education', 'work', 'projects', 'skills', 'courses', 'certificates', 'awards'] as const) expect(again[key]?.map((e) => e.id)).toEqual(p[key]?.map((e) => e.id));
    expect(again.sourceTexts).toHaveLength(1); expect(again.skills[0].usedIn).toEqual(p.skills[0].usedIn);
    expect(again.courses![0].educationId).toBe(p.courses![0].educationId);
    expect(again.projects.find((e) => e.sourceRecord?.id === 'PRO-01')!.courseIds).toEqual(p.projects.find((e) => e.sourceRecord?.id === 'PRO-01')!.courseIds);
    expect(again.projects.every((e) => !isUnconfirmedImport(e))).toBe(true);
  });
  it('exposes changed facts with the same ID as conflicts, preserves confirmed old values by default', () => {
    const p = apply(); const changed = parse(mockNumberedLibrary().replace('成绩：60', '成绩：99'));
    const plan = buildImportPlan(p, changed.profile); const item = plan.items.find((i) => i.incomingId === 'library-BSC-001')!;
    expect(item.status).toBe('conflict'); expect(item.action).toBe('undecided'); expect(item.conflicts.some((c) => c.field === 'grade')).toBe(true);
    expect(() => applyImportPlan(p, changed.profile, plan)).toThrow(/未选择/);
    item.action = 'merge'; const out = applyImportPlan(p, changed.profile, plan);
    expect(out.courses![6].grade).toEqual(p.courses![6].grade);
    expect(p.courses![6].grade.raw).toBe('60');
  });
  it('reports missing IDs, duplicate IDs with differing content, unknown entity types and missing course names honestly', () => {
    for (const [text, id] of [
      [mockNumberedLibrary().replace(/- \[x\] BSC-076[\s\S]*?(?=05 工作经历)/, ''), 'BSC-076'],
      [mockNumberedLibrary() + '\n- [x] BSC-001 不同的课程\n课程名称：冲突示例', 'BSC-001'],
      [mockNumberedLibrary() + '\n- [x] XYZ-01 未支持的事实', 'XYZ-01'],
      [mockNumberedLibrary().replace('BSC-001 示例本科课程1\n课程名称：示例本科课程1', 'BSC-001\n课程名称：'), 'BSC-001'],
    ]) { const r = parse(text); expect(r.integrity.complete).toBe(false); expect(r.integrity.issues.some((x) => x.id === id)).toBe(true); }
  });
  it('does not discard dangling references silently or invent an education to attach courses', () => {
    const r = parse(mockNumberedLibrary().replace('教育编号：EDU-01', '教育编号：EDU-99').replace('关联项目：LRN-02', '关联项目：LRN-99'));
    expect(r.integrity.complete).toBe(false); expect(r.integrity.issues.some((x) => x.id === 'BSC-001')).toBe(true); expect(r.integrity.issues.some((x) => x.reason.includes('LRN-99'))).toBe(true);
    expect(r.profile.education).toHaveLength(2); expect(r.profile.courses).toHaveLength(82);
  });
  it('supports explicit replacement with courses while leaving the supplied original profile unchanged', () => {
    const p = apply(), old = structuredClone(p), r = parse();
    const out = applyReplace(p, r.profile, buildImportPlan(p, r.profile));
    expect(out.courses).toHaveLength(82); expect(out.education).toHaveLength(2); expect(p).toEqual(old);
  });
  it('parses reviewed structured input without any API request or response/token truncation', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real API allowed'));
    const r = await importProfileDetailed(structuredClone(DEFAULT_SETTINGS), mockNumberedLibrary());
    expect(r.integrity?.complete).toBe(true); expect(fetch).not.toHaveBeenCalled();
    expect(isStructuredLibrary('普通非结构化资料')).toBe(false); expect(parseStructuredLibrary('普通非结构化资料')).toBeNull();
  });
});

it('supports explicit columns and both source languages without losing an obscured grade', () => {
  const r = parse(`02 教育经历
- [x] EDU-01 模拟学校
学校：模拟学校
学位：学士
04 本科课程（1门）
| 来源编号 | 中文名称 | 英文名称 | 学分 | 成绩 | 课程代码 | 教育编号 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [x] BSC-001 | 示例课程 | Mock course | 2.5 | 遮挡 ** | MOCK-1 | EDU-01 | 虚构说明 |`);
  expect(r.integrity.complete).toBe(true); const c = r.profile.courses![0];
  expect(c.name.zh).toBe('示例课程'); expect(c.name.en).toBe('Mock course'); expect(c.name.status).toEqual({ zh: 'confirmed', en: 'confirmed' });
  expect(c.credits).toBe('2.5'); expect(c.grade.raw).toBe('遮挡 **'); expect(c.synopsis.zh).toBe('虚构说明');
});
it('surfaces contradictions inside a reviewed block and refuses an incomplete apply at the write boundary', () => {
  const r = parse(mockNumberedLibrary().replace('成绩：60', '成绩：60\n成绩：90'));
  expect(r.integrity.complete).toBe(false); expect(r.integrity.issues.some((i) => i.id === 'BSC-001' && i.reason.includes('成绩'))).toBe(true);
  expect(() => applyImportPlan(emptyProfile(), r.profile, buildImportPlan(emptyProfile(), r.profile), { id: 'fake', at: '', files: [], text: 'fake', integrity: r.integrity })).toThrow(/完整性/);
});
it('does not upgrade unchecked source records to confirmed or inferred knowledge to official course facts', () => {
  const r = parse(mockNumberedLibrary().replace('[x] LRN-01', '[ ] LRN-01').replace('[x] MSC-01', '[ ] MSC-01'));
  const p = applyImportPlan(emptyProfile(), r.profile, buildImportPlan(emptyProfile(), r.profile));
  expect(isUnconfirmedImport(p.projects.find((p) => p.sourceRecord?.id === 'LRN-01')!)).toBe(true);
  expect(p.courses!.find((c) => c.sourceRecord?.id === 'MSC-01')!.confirmation).toBe('pending');
});
it('avoids substring-based matches against legacy skills and distinguishes separate numbered labs despite identical software', () => {
  const r = parse(), base = emptyProfile();
  base.skills = [{ id: 'legacy-python', enabled: true, name: { en: 'Python' } }];
  const plan = buildImportPlan(base, r.profile);
  expect(plan.items.find((i) => i.incomingId === 'library-SKL-01')!.action).toBe('merge');
  expect(plan.items.find((i) => i.incomingId === 'library-SKL-02')!.action).toBe('add');
  expect(plan.items.filter((i) => i.incomingId.startsWith('library-LRN')).every((i) => i.action === 'add')).toBe(true);
});

it('merges a proven same education supplement with an unknown end, keeps project credits attached to the single education', () => {
  const raw = mockNumberedLibrary().replace('03 硕士课程', `- [x] EDU-03 模拟马来西亚大学补充
学校：模拟马来西亚大学
学位：硕士
专业：示例工程
开始：2024-07
结束：未知
03 硕士课程`).replace('教育编号：EDU-02', '教育编号：EDU-03');
  const r = parse(raw), plan = buildImportPlan(emptyProfile(), r.profile);
  expect(r.integrity.complete).toBe(true); expect(plan.items.find((i) => i.incomingId === 'library-EDU-03')!.status).toBe('internal');
  const p = applyImportPlan(emptyProfile(), r.profile, plan);
  expect(p.education).toHaveLength(2); expect(p.courses!.filter((c) => c.level === 'master').every((c) => c.educationId === p.education[1].id)).toBe(true);
  expect(p.projects.filter((p) => p.kind === 'core')).toHaveLength(2);
});
it('does not invent a school from an education status fact, or silently accept unknown table columns as complete', () => {
  const r = parse(`02 教育经历\n- [x] EDU-01 学位授予时间\n日期：未知\n04 本科课程\n| BSC-001 | 示例课程 | 2 | 80 |`);
  expect(r.profile.education).toHaveLength(0); expect(r.integrity.complete).toBe(false);
  expect(r.integrity.issues.map((i) => i.id)).toEqual(expect.arrayContaining(['EDU-01', 'BSC-001']));
});

it('remaps an explicitly approved education reassignment to a real persisted ID, with confirmed fields still protected', () => {
  const base = apply(), r = parse(), edu = structuredClone(r.profile.education[0]);
  edu.id = 'library-EDU-03'; edu.school = { zh: '模拟新学校' }; edu.sourceRecord = { ...edu.sourceRecord!, id: 'EDU-03', raw: '虚构新教育记录' }; r.profile.education.push(edu);
  const c = r.profile.courses!.find((c) => c.sourceRecord?.id === 'BSC-001')!;
  c.educationId = edu.id; c.school = '模拟新学校'; c.sourceRecord!.raw += '\n教育归属调整：EDU-03';
  const plan = buildImportPlan(base, r.profile), item = plan.items.find((i) => i.incomingId === c.id)!;
  expect(item.status).toBe('conflict'); item.action = 'merge';
  for (const field of item.conflicts) if (['educationId', 'school'].includes(field.field)) field.useNew = true;
  expect(() => applyImportPlan(base, r.profile, plan)).toThrow(/已确认/);
  for (const field of item.conflicts) (field as typeof field & { overrideConfirmed: boolean }).overrideConfirmed = true;
  const out = applyImportPlan(base, r.profile, plan), moved = out.courses!.find((c) => c.sourceRecord?.id === 'BSC-001')!;
  expect(moved.educationId).toBe(out.education.find((e) => e.sourceRecord?.id === 'EDU-03')!.id); expect(moved.school).toBe('模拟新学校');
});

it('retains alphanumeric source IDs without silently appending separate facts to their neighbors', () => {
  const r = parse(mockNumberedLibrary().replaceAll('LRN-01', 'LRN-ROB-2A').replaceAll('SKL-01', 'SKL-PYTHON'));
  expect(r.integrity.complete).toBe(true);
  expect(r.profile.projects.find((p) => p.sourceRecord?.id === 'LRN-ROB-2A')).toBeDefined();
  expect(r.profile.skills.find((p) => p.sourceRecord?.id === 'SKL-PYTHON')!.usedIn).toContain('library-LRN-ROB-2A');
  expect(r.integrity.groups.find((g) => g.label === '其他编号事实')!.recognized).toContain('LRN-ROB-2A');
});

it('still fills blank localized fields when a legacy education is supplemented by an import', () => {
  const r = parse(), base = emptyProfile(), e = structuredClone(r.profile.education[0]);
  delete e.sourceRecord; delete e.userConfirmedAt; e.degree = {}; base.education = [e];
  const plan = buildImportPlan(base, r.profile), item = plan.items.find((i) => i.incomingId === e.id)!;
  // With one missing attribute, identity is conservative: the user explicitly approves this merge.
  item.action = 'merge';
  const out = applyImportPlan(base, r.profile, plan);
  expect(out.education[0].degree.zh).toBe('学士'); expect(base.education[0].degree).toEqual({});
});
