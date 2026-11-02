import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import { selectionBrief, validateAiSelection, planWithAi } from '../src/ai/aiPlanner';
import { generateResume, generateRules } from '../src/ai/generate';
import { jointFixture } from './helpers/v113JointFixture';
import { makeJointJob, roleInputHash } from '../src/joint/jobs';
import { refreshReportSelection } from '../src/joint/report';
import { sourceText } from '../src/ai/provenance';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { buildLayout } from '../src/render/layout';
import { linkJointApplications, resolveArtifact, verifySharedVersion } from '../src/joint/versions';
import { exportLightJson, readArchive, restoreArchive, SECTIONS } from '../src/tracker/backup';
import { ResumeDB } from '../src/storage/db';
import type { Settings } from '../src/types';
const s = { demoMode: false, model: 'mock-model', provider: 'custom', apiKey: 'FAKE-ONLY' } as Settings;
const api = vi.mocked(chatJson); beforeEach(() => { api.mockReset(); });
function mockGeneration(f = jointFixture()) {
  let call = 0;
  api.mockImplementation(async (_s, messages) => {
    call++; const payload = JSON.parse(String(messages.at(-1)!.content).split('\n\n').at(-1)!);
    if (call === 1) return f.plan;
    if (payload.facts) return { items: payload.facts.map((x: { sourceId: string; text: string }) => ({ sourceId: x.sourceId, text: x.text })) };
    return { items: payload.items.map((x: { sourceId: string }) => ({ sourceId: x.sourceId, text: sourceText(f.p, x).en })) };
  });
}

describe('joint JD input/revisions and strict semantic decisions', () => {
  it.each([1, 2, 3])('%i roles preserve independent IDs and requirements, one coordinator and one content version', async (count) => {
    const f = jointFixture(count), before = structuredClone(f.p); mockGeneration(f);
    expect(f.job.joint!.targets).toHaveLength(count); expect(new Set(f.job.joint!.targets.map((t) => t.job.id)).size).toBe(count);
    const brief = selectionBrief(f.p, f.job, 'zh', 1); expect(brief.targets).toHaveLength(count);
    expect(brief.candidate.courses[0].synopsis.zh).toContain('供应链优化'); expect(JSON.stringify(brief)).not.toContain('MOCK-UG-GRADE');
    const r = await generateResume(s, f.p, f.job, 'zh', 1);
    expect(r.evidenceReport!.targets).toHaveLength(count); expect(api).toHaveBeenCalledTimes(3); expect(f.p).toEqual(before);
    expect(r.courseSelection!.ids).toEqual([f.p.courses![0].id]); expect(r.items.find((i) => i.sourceId === 'summary')!.zh).toBe(f.p.profile.summary.zh);
    expect(JSON.stringify(r.items)).not.toMatch(/熟练 PLC|供应商开发经验|proficient.*PLC/);
    if (count > 1) expect(r.evidenceReport!.targets[1].requirements[1]).toMatchObject({ assessment: 'learning', evidence: [expect.objectContaining({ category: 'course', level: 'inferred' })] });
    const writer = JSON.parse(String(api.mock.calls[1][1].at(-1)!.content).split('\n\n').at(-1)!);
    expect(writer.facts.every((x: { sourceId: string }) => !x.sourceId.startsWith('course-'))).toBe(true);
    expect(writer.requirements.every((q: { assessment: string }) => ['direct', 'transferable'].includes(q.assessment))).toBe(true);
    if (count === 3) expect(writer.gaps).toContain('PLC 编程实际经验');
    expect(JSON.stringify(buildLayout(f.p, BUILTIN_TEMPLATES[0], 'en', r))).not.toContain('MOCK-UG-GRADE');
  });
  it('rejects fourth role, stale input, company mismatch and missing analysis while preserving previous revisions', () => {
    const f = jointFixture(); const before = structuredClone(f.jobs);
    f.group.roles[0].text += '\n修改正文'; expect(() => makeJointJob(f.group, f.jobs)).toThrow(/过期/); expect(f.jobs).toEqual(before);
    f.group.roles[0].analyses.push({ ...f.group.roles[0].analyses[0], inputHash: roleInputHash(f.group, f.group.roles[0]), revision: 2 });
    const g = jointFixture(); g.jobs[0].company = { full: '另一家模拟企业', short: '另一模拟' }; expect(() => makeJointJob(g.group, g.jobs)).toThrow(/同一企业/);
    g.group.roles[0].companyConfirmed = true; expect(makeJointJob(g.group, g.jobs).joint!.targets).toHaveLength(3);
    g.group.roles.push(structuredClone(g.group.roles[0])); expect(() => makeJointJob(g.group, g.jobs)).toThrow(/1–3/);
  });
  it.each(['unknown-proof', 'wrong-requirement', 'missing-requirement', 'course-as-practice', 'false-aggregation', 'unknown-course'] as const)('rejects %s and never removes fact checks', (kind) => {
    const f = jointFixture();
    if (kind === 'unknown-proof') f.plan.requirements![0].evidenceIds = ['fake-proof'];
    if (kind === 'wrong-requirement') f.plan.requirements![0].requirementId = 'made-up-jd:must:0';
    if (kind === 'missing-requirement') f.plan.requirements!.pop();
    if (kind === 'course-as-practice') { f.plan.requirements![4].assessment = 'direct'; f.plan.requirements![4].evidenceIds = [f.p.courses![1].id]; }
    if (kind === 'false-aggregation') f.plan.jointSummary!.common[0].requirementIds = ['fictional-job-0:must:0'];
    if (kind === 'unknown-course') f.plan.courses = ['unconfirmed-or-fictional-course'];
    expect(() => validateAiSelection(f.plan, f.p, f.job, 'zh', 1)).toThrow();
  });
  it('repairs a course falsely cited as PLC practice locally, revalidates the same requirement and stops on failed repair', async () => {
    const f = jointFixture(), at = f.plan.requirements!.length - 1, original = structuredClone(f.plan);
    f.plan.requirements![at].assessment = 'direct'; f.plan.requirements![at].evidenceIds = [f.p.courses![1].id];
    api.mockResolvedValueOnce(f.plan).mockResolvedValueOnce({ repairs: [{ path: `/requirements/${at}`, value: original.requirements![at] }] });
    const result = await planWithAi(s, f.p, f.job, 'zh', 1); expect(result.requirements[at].assessment).toBe('gap'); expect(api).toHaveBeenCalledTimes(2);
    const repair = JSON.stringify(api.mock.calls[1][1]); expect(repair).toContain(f.p.courses![1].id); expect(repair).toContain('PLC 编程实际经验'); expect(repair).toContain('allowedIds');
    api.mockReset(); api.mockResolvedValueOnce(f.plan).mockResolvedValueOnce({ repairs: [{ path: `/requirements/${at}`, value: f.plan.requirements![at] }] });
    await expect(planWithAi(s, f.p, f.job, 'zh', 1)).rejects.toThrow(/局部修复失败/);
  });
  it('keeps report provenance after manual deselection and warns that source is no longer in current resume', async () => {
    const f = jointFixture(); mockGeneration(f); const r = await generateResume(s, f.p, f.job, 'zh', 1);
    const source = f.p.courses![0].id; r.courseSelection = { ids: [], gradeIds: [] };
    const evidence = refreshReportSelection(r)!.targets[1].requirements[1].evidence;
    expect(evidence[0]).toMatchObject({ id: source, selected: false }); expect(evidence[0].category).toBe('course');
  });
});

describe('one immutable resume version linked to multiple applications', () => {
  it('links all three to exactly the same snapshot, idempotently; changed content creates a new version without mutating the original', async () => {
    const f = jointFixture(), d = new ResumeDB('p2-joint-versions'); mockGeneration(f);
    const r = await generateResume(s, f.p, f.job, 'zh', 1), template = structuredClone(BUILTIN_TEMPLATES[0]);
    // Synthetic source text is unchanged; actual red-risk checks must pass, not be deleted for the fixture.
    const args = { profile: f.p, resume: r, job: f.job, template };
    const first = await linkJointApplications(d, args), v = (await d.resumeVersions.get(first.versionId))!;
    expect(first.applicationIds).toHaveLength(3); expect(await d.resumeVersions.count()).toBe(1); expect(await verifySharedVersion(v)).toBe(true);
    expect((await d.applications.toArray()).every((a) => a.resumeVersionId === v.id && a.status === 'pending' && !a.appliedAt)).toBe(true);
    expect((await d.artifacts.toArray()).every((a) => a.versionId === v.id && !a.resume && !a.submitted)).toBe(true);
    expect((await linkJointApplications(d, args)).versionId).toBe(v.id); expect(await d.postings.count()).toBe(3); expect(await d.artifacts.count()).toBe(3);
    const art = (await d.artifacts.toArray())[0], snapshot = await resolveArtifact(d, art); template.locales.en.typography.bodySizePt = 7;
    expect(snapshot.template!.locales.en.typography.bodySizePt).toBe(BUILTIN_TEMPLATES[0].locales.en.typography.bodySizePt);
    r.notes = [...(r.notes ?? []), '人工改动后的另一个内容版本']; await linkJointApplications(d, args);
    expect(await d.resumeVersions.count()).toBe(2); expect(await d.resumeVersions.get(v.id)).toEqual(v);
    f.p.courses![0].grade.raw = 'MUTATED'; expect(JSON.stringify(v)).not.toMatch(/MOCK-UG-GRADE|MUTATED/);
    const archive = await exportLightJson(d), restored = new ResumeDB('p2-joint-restored'), check = await readArchive(restored, archive);
    expect(check.errors).toEqual([]); await restoreArchive(restored, check, { sections: [...SECTIONS], overwrite: false, replaceProfile: false });
    expect(await restored.resumeVersions.toArray()).toEqual(await d.resumeVersions.toArray());
    const fake = JSON.parse(archive); fake.resumeVersions[0].resume.items[0].zh = '篡改'; expect((await readArchive(restored, JSON.stringify(fake))).errors.join()).toContain('校验失败');
    await d.delete(); await restored.delete();
  });
  it('refuses mismatched versions and rolls back all writes when an artifact fails', async () => {
    const f = jointFixture(), d = new ResumeDB('p2-atomic'); mockGeneration(f); const r = await generateResume(s, f.p, f.job, 'zh', 1), args = { profile: f.p, resume: r, job: f.job, template: BUILTIN_TEMPLATES[0] };
    await expect(linkJointApplications(d, { ...args, resume: { ...r, jobId: 'other' } })).rejects.toThrow(/不一致/);
    d.artifacts.hook('creating', () => { throw new Error('模拟写入失败'); }); await expect(linkJointApplications(d, args)).rejects.toThrow(/模拟写入失败/);
    expect(await d.resumeVersions.count()).toBe(0); expect(await d.postings.count()).toBe(0); expect(await d.applications.count()).toBe(0); await d.delete();
  });
  it('explicit demo mode never silently substitutes keyword rules for joint semantic reasoning', async () => {
    const f = jointFixture(); await expect(generateResume({ ...s, demoMode: true }, f.p, f.job, 'zh', 1)).rejects.toThrow(/不会以关键词/);
    expect(generateRules(f.p, f.jobs[0], 'zh')).toBeDefined(); expect(api).not.toHaveBeenCalled();
  });
});

it('locally appends a missing requirement without re-generating valid decisions and rejects changing a valid target ID during repair', async () => {
  const f = jointFixture(), correct = f.plan.requirements!.pop()!, at = f.plan.requirements!.length;
  api.mockResolvedValueOnce(f.plan).mockResolvedValueOnce({ repairs: [{ path: `/requirements/${at}`, value: correct }] });
  expect((await planWithAi(s, f.p, f.job, 'zh', 1)).requirements.at(-1)).toEqual(correct); expect(api).toHaveBeenCalledTimes(2);
  api.mockReset(); const g = jointFixture(); g.plan.requirements![0].evidenceIds = ['ghost'];
  api.mockResolvedValueOnce(g.plan).mockResolvedValueOnce({ repairs: [{ path: '/requirements/0', value: { ...g.plan.requirements![0], evidenceIds: ['edu-1'], requirementId: g.plan.requirements![3].requirementId } }] });
  await expect(planWithAi(s, g.p, g.job, 'zh', 1)).rejects.toThrow(/不得挪用/);
});
it('malformed semantic explanations produce actionable validation paths instead of crashing or bypassing checks', () => {
  const f = jointFixture(); (f.plan.requirements![4] as unknown as { reason: unknown }).reason = 42;
  (f.plan.jointSummary!.common[0] as unknown as { reason: unknown }).reason = {};
  try { validateAiSelection(f.plan, f.p, f.job, 'zh', 1); throw new Error('must fail'); }
  catch (e) { expect((e as Error).name).toBe('AiSelectionValidationError'); expect((e as Error).message).toContain('/jointSummary'); expect((e as Error).message).toContain('/requirements/4'); }
});
it('requires the canonical versions section when restoring linked records, preventing orphan pointers', async () => {
  const f = jointFixture(), d = new ResumeDB('joint-restore-source'), target = new ResumeDB('joint-restore-target'); mockGeneration(f);
  const resume = await generateResume(s, f.p, f.job, 'zh', 1); await linkJointApplications(d, { profile: f.p, resume, job: f.job, template: BUILTIN_TEMPLATES[0] });
  const archive = await readArchive(target, await exportLightJson(d));
  await expect(restoreArchive(target, archive, { sections: ['applications', 'artifacts'], overwrite: false, replaceProfile: false })).rejects.toThrow(/同时恢复/);
  expect(await target.applications.count()).toBe(0); await d.delete(); await target.delete();
});
