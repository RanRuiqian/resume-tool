import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import { DEFAULT_SETTINGS } from '../src/storage/defaults';
import { coursesFixture } from './helpers/v113CoursesFixture';
import { jobs } from './helpers/v110Fixture';
import { generateRules, localizeAi } from '../src/ai/generate';
import { editResumeItem } from '../src/ai/editResume';
import { reorderEntry, toggleBullet, toggleEntry, toggleSummary } from '../src/ai/selection';
import { sourceIdsOf } from '../src/ai/provenance';
import { buildLayout } from '../src/render/layout';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { ResumeDB } from '../src/storage/db';
import { linkJointApplications } from '../src/joint/versions';
import { jointFixture } from './helpers/v113JointFixture';

function fixture() {
  const p = coursesFixture(), r = generateRules(p, jobs().A, 'zh');
  r.layoutPolicy = 'readable';
  const entry = p.projects.find((e) => r.items.some((i) => e.bullets.some((b) => b.id === i.sourceId)))!;
  const item = r.items.find((i) => entry.bullets.some((b) => b.id === i.sourceId))!;
  return { p, r, entry, item };
}
const output = (p: ReturnType<typeof coursesFixture>, r: ReturnType<typeof generateRules>) => JSON.stringify(buildLayout(p, BUILTIN_TEMPLATES[0], 'zh', r));

describe('free, local resume workspace', () => {
  it('hides only the resume entry, restores the exact edited subset and leaves the library unchanged', () => {
    const { p, r, entry, item } = fixture(), original = structuredClone(p);
    const edited = editResumeItem(editResumeItem(r, item.sourceId, 'zh', '人工修改的虚构经历说明'), item.sourceId, 'en', 'Manually edited fictional experience');
    const off = toggleEntry(p, edited, 'projects', entry.id, false);
    expect(output(p, off)).not.toContain('人工修改的虚构经历说明');
    expect(off.items.some((i) => i.sourceId === item.sourceId)).toBe(false);
    const back = toggleEntry(p, off, 'projects', entry.id, true);
    expect(back.items.find((i) => i.sourceId === item.sourceId)).toEqual(edited.items.find((i) => i.sourceId === item.sourceId));
    expect(back.selection).toEqual(edited.selection);
    expect(back.items.map((i) => i.sourceId)).toEqual(edited.items.map((i) => i.sourceId));
    expect(output(p, back)).toContain('人工修改的虚构经历说明');
    expect(p).toEqual(original);
  });
  it('restores individual bullet edits and does not add previously unselected bullets when restoring the entry', () => {
    const { p, r, entry, item } = fixture(), b = entry.bullets.find((x) => x.id === item.sourceId)!;
    const edited = editResumeItem(r, item.sourceId, 'zh', '人工保留的课程实践说明');
    const off = toggleBullet(p, edited, 'projects', entry.id, b, false);
    const entryOff = toggleEntry(p, off, 'projects', entry.id, false);
    const entryOn = toggleEntry(p, entryOff, 'projects', entry.id, true);
    expect(entryOn.items.some((i) => i.sourceId === item.sourceId)).toBe(false);
    const back = toggleBullet(p, entryOn, 'projects', entry.id, b, true);
    expect(back.items.find((i) => i.sourceId === item.sourceId)?.zh).toBe('人工保留的课程实践说明');
  });
  it('restores edited summary, not its baseline or master text', () => {
    const { p, r } = fixture();
    const edited = editResumeItem(r, 'summary', 'zh', '测试用户X的简历专用简介');
    const off = toggleSummary(p, edited, false);
    expect(output(p, off)).not.toContain('测试用户X的简历专用简介');
    expect(toggleSummary(p, off, true).items.find((i) => i.sourceId === 'summary')?.zh).toBe('测试用户X的简历专用简介');
    expect(p.profile.summary.zh).not.toBe('测试用户X的简历专用简介');
  });
  it('keeps a merged sentence as one selection unit, without leaking a cancelled fact or losing edits', () => {
    const { p, r, entry } = fixture();
    const bs = entry.bullets.slice(0, 2); expect(bs).toHaveLength(2);
    r.items = r.items.filter((i) => !entry.bullets.some((b) => sourceIdsOf(i).includes(b.id!)));
    const grouped = { sourceId: bs[0].id!, sourceIds: bs.map((b) => b.id!), zh: '人工编辑的合并要点', en: 'Edited combined bullet', syncStatus: 'pending' as const };
    r.items.push(grouped);
    const off = toggleBullet(p, r, 'projects', entry.id, bs[1], false);
    expect(output(p, off)).not.toContain(grouped.zh);
    expect(off.items.flatMap(sourceIdsOf)).not.toContain(bs[0].id);
    const back = toggleBullet(p, off, 'projects', entry.id, bs[1], true);
    expect(back.items.find((i) => i.sourceId === grouped.sourceId)).toEqual({ ...grouped, manual: true });
    expect(back.items.flatMap(sourceIdsOf).filter((s) => s === bs[0].id)).toHaveLength(1);
  });
  it('preserves AI bullet ordering across toggles and manual entry ordering across hide / restore', () => {
    const { p, r, entry, item } = fixture(); r.items.reverse();
    const off = toggleBullet(p, r, 'projects', entry.id, entry.bullets.find((b) => b.id === item.sourceId)!, false);
    const back = toggleBullet(p, off, 'projects', entry.id, entry.bullets.find((b) => b.id === item.sourceId)!, true);
    expect(back.items.map((i) => i.sourceId)).toEqual(r.items.map((i) => i.sourceId));
    const other = { ...structuredClone(entry), id: 'simulated-second-project', bullets: [{ id: 'simulated-second-b1', zh: '虚构课程实践', en: 'Fictional course practice' }] };
    p.projects.push(other);
    const withOther = toggleEntry(p, r, 'projects', other.id, true);
    const moved = reorderEntry(withOther, 'projects', withOther.selection.projects[1], -1);
    const selectedId = moved.selection.projects[0];
    expect(toggleEntry(p, toggleEntry(p, moved, 'projects', selectedId, false), 'projects', selectedId, true).selection.projects).toEqual(moved.selection.projects);
  });
  it('rapid repeated toggles do not duplicate items and work without any saved cache in legacy resumes', () => {
    const { p, r, entry, item } = fixture();
    expect(r.deselectedItems).toBeUndefined(); let result = r;
    for (let n = 0; n < 20; n++) { result = toggleEntry(p, toggleEntry(p, result, 'projects', entry.id, false), 'projects', entry.id, true); }
    expect(result.items.filter((i) => i.sourceId === item.sourceId)).toHaveLength(1);
    expect(toggleEntry(p, result, 'projects', entry.id, true)).toBe(result);
  });
  it('links an edited joint resume without certification or translation gates, preserving version integrity', async () => {
    const { p, job } = jointFixture(), r = generateRules(p, job, 'zh');
    r.items[0].zh = '测试用户X人工编辑的简介';
    r.consistency.issues.push({ type: 'number', message: '示例差异提示' });
    const d = new ResumeDB('workspace-joint-test');
    try {
      const result = await linkJointApplications(d, { profile: p, job, resume: r, template: BUILTIN_TEMPLATES[0] });
      expect(result.applicationIds).toHaveLength(3);
      expect((await d.resumeVersions.get(result.versionId))?.resume.items[0].zh).toBe(r.items[0].zh);
      expect((await d.applications.toArray()).every((a) => a.status === 'pending' && !a.appliedAt)).toBe(true);
    } finally { await d.delete(); }
  });
});

it('edits titles, skill names and dates per resume, keeps them when deselected, and never changes master facts', () => {
  const { p, r, entry } = fixture(), before = structuredClone(p);
  const skill = p.skills[0]; r.selection.skills = [skill.id];
  r.entryEdits = { [entry.id]: { texts: { name: { zh: '模拟简历项目名称', en: 'Fictional edited project title' } }, start: '2020-01' }, [skill.id]: { texts: { name: { zh: '模拟人工技能表述', en: 'Fictional skill wording' } } } };
  expect(output(p, r)).toContain('模拟简历项目名称'); expect(output(p, r)).toContain('模拟人工技能表述');
  const off = toggleEntry(p, r, 'projects', entry.id, false);
  expect(output(p, off)).not.toContain('模拟简历项目名称');
  const back = toggleEntry(p, off, 'projects', entry.id, true);
  expect(output(p, back)).toContain('模拟简历项目名称'); expect(back.entryEdits).toEqual(r.entryEdits);
  expect(p).toEqual(before);
});
it('does not replace deliberately cleared human text with the master original', () => {
  const { p, r, item } = fixture(), edited = editResumeItem(r, item.sourceId, 'zh', '');
  const m = buildLayout(p, BUILTIN_TEMPLATES[0], 'zh', edited);
  expect(m.main.concat(m.side).flatMap((s) => s.blocks.flatMap((b) => b.bullets))).not.toContain(item.zh);
  expect(p.projects.flatMap((e) => e.bullets).some((b) => b.id === item.sourceId && b.zh === item.zh)).toBe(true);
});
it('keeps entry ordering when several entries are unchecked and restored in either order', () => {
  const { p, r, entry } = fixture();
  const second = { ...structuredClone(entry), id: 'simulated-second', bullets: [{ id: 'simulated-second-fact', zh: '虚构要点' }] };
  p.projects.push(second); const chosen = toggleEntry(p, r, 'projects', second.id, true), ids = chosen.selection.projects;
  const off = toggleEntry(p, toggleEntry(p, chosen, 'projects', ids[0], false), 'projects', ids[1], false);
  for (const order of [ids, [...ids].reverse()]) {
    let result = off;
    for (const id of order) result = toggleEntry(p, result, 'projects', id, true);
    expect(result.selection.projects).toEqual(ids);
  }
});
it('hides academic grades by default but honors explicit human bullet choices and edits', () => {
  const { p, r } = fixture(), education = p.education[0];
  const bullet = { id: 'manual-grade-highlight', zh: 'GPA: MOCK-ACADEMIC-GRADE', en: 'GPA: MOCK-ACADEMIC-GRADE' };
  education.highlights.push(bullet); r.selection.education = [education.id];
  r.items.push({ sourceId: bullet.id, zh: bullet.zh, en: bullet.en, syncStatus: 'in-sync' });
  expect(output(p, r)).not.toContain('MOCK-ACADEMIC-GRADE');
  const changed = editResumeItem(r, bullet.id, 'zh', 'GPA: MOCK-MANUAL-EDIT');
  expect(output(p, changed)).toContain('MOCK-MANUAL-EDIT');
  const off = toggleBullet(p, r, 'education', education.id, bullet, false);
  // 首次明确单独选择与恢复人工编辑均为用户决定，不等同于 AI 默认公开成绩。
  const selected = toggleBullet(p, off, 'education', education.id, bullet, true);
  expect(output(p, selected)).toContain('MOCK-ACADEMIC-GRADE');
  expect(output(p, toggleBullet(p, changed, 'education', education.id, bullet, false))).not.toContain('MOCK-MANUAL-EDIT');
});
it('shows one-language material in either preview and marks translation as optional pending work', () => {
  const { p, r, entry, item } = fixture(), bullet = entry.bullets.find((b) => b.id === item.sourceId)!;
  bullet.zh = '只有中文的虚构课程实践'; bullet.en = ''; r.items = [];
  r.primaryLanguage = 'en';
  const selected = toggleBullet(p, r, 'projects', entry.id, bullet, true);
  expect(selected.items[0].syncStatus).toBe('pending');
  expect(JSON.stringify(buildLayout(p, BUILTIN_TEMPLATES[0], 'en', selected))).toContain(bullet.zh);
});
it('explicitly fills a missing primary language from the existing language with one checked AI request', async () => {
  const { p, r, item } = fixture(), api = vi.mocked(chatJson); api.mockReset();
  r.primaryLanguage = 'en'; r.items = [{ sourceId: item.sourceId, zh: '完成测试。', en: '', syncStatus: 'pending' }];
  api.mockResolvedValue({ items: [{ sourceId: item.sourceId, text: 'completed testing.' }] });
  const translated = await localizeAi({ ...DEFAULT_SETTINGS, demoMode: false }, p, null, r, [item.sourceId]);
  expect(translated.primaryLanguage).toBe('en'); expect(translated.items[0].en).toBe('completed testing.'); expect(translated.items[0].zh).toBe('完成测试。');
  expect(api).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(api.mock.calls[0][1].at(-1)!.content).split('\n\n').at(-1)!).items[0].text).toBe('完成测试。');
});
it('preserves an intentionally cleared human translation and a manually selected academic bullet during sync', async () => {
  const { p, r, item } = fixture(), api = vi.mocked(chatJson); api.mockReset();
  const edited = editResumeItem(r, item.sourceId, 'en', '');
  const grade = { id: 'keep-manual-grade', zh: 'GPA: MOCK-GRADE', en: 'GPA: MOCK-GRADE' };
  p.education[0].highlights.push(grade);
  edited.items.push({ sourceId: grade.id, zh: grade.zh, en: grade.en, manual: true, confirmedLangs: ['zh', 'en'], syncStatus: 'in-sync' });
  const translated = await localizeAi({ ...DEFAULT_SETTINGS, demoMode: false }, p, null, edited, [item.sourceId, grade.id]);
  expect(api).not.toHaveBeenCalled(); expect(translated.items.find((i) => i.sourceId === item.sourceId)?.en).toBe('');
  expect(translated.items.find((i) => i.sourceId === grade.id)?.en).toBe(grade.en);
});
it('rejects fabricated translation numbers after repair and keeps current wording without blocking editing or export', async () => {
  const { p, r, item } = fixture(), api = vi.mocked(chatJson); api.mockReset();
  r.items = [{ sourceId: item.sourceId, zh: '完成 2 次测试。', en: 'completed 2 tests.', syncStatus: 'pending' }];
  api.mockResolvedValue({ items: [{ sourceId: item.sourceId, text: 'completed 200 tests.' }] });
  const translated = await localizeAi({ ...DEFAULT_SETTINGS, demoMode: false }, p, null, r, [item.sourceId]);
  expect(api).toHaveBeenCalledTimes(2); expect(translated.items[0].en).toBe('completed 2 tests.');
  expect(translated.items[0].syncStatus).toBe('needs-review'); expect(translated.items[0].translation?.factIssues.length).toBeGreaterThan(0);
  expect(JSON.stringify(buildLayout(p, BUILTIN_TEMPLATES[0], 'en', translated))).not.toContain('200 tests');
});
