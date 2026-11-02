import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ResumeDB, snapshotProfile } from '../src/storage/db';
import { assertProfileEpoch, clearPersonalData, persistProfile, profileEpoch, PROFILE_EPOCH_KEY } from '../src/storage/clearProfile';
import { emptyProfile } from '../src/storage/profileIO';
import { coursesFixture } from './helpers/v113CoursesFixture';
import { generateRules } from '../src/ai/generate';
import { jobs } from './helpers/v110Fixture';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { seedDemo } from '../src/storage/demo';

if (process.env.CLEAR_OUT) { mkdirSync(process.env.CLEAR_OUT, { recursive: true }); writeFileSync(resolve(process.env.CLEAR_OUT, 'fictional-clear-fixture.json'), JSON.stringify({ p: coursesFixture(), jobs: [jobs().A] })); }

const preservedTables = ['settings', 'templates', 'jobs', 'jdGroups', 'postings', 'applications', 'appEvents', 'artifacts', 'resumeVersions', 'attachments', 'attachmentBlobs'] as const;
async function fixture(name: string) {
  const d = new ResumeDB(name), p = coursesFixture(), job = jobs().A, r = generateRules(p, job, 'zh');
  p.sourceTexts = [{ id: 'fictional-import', at: '2026-01-01', files: ['fictional.txt'], text: '虚构原始资料与来源记录' }];
  await d.profile.put({ id: 'me', doc: p }); await snapshotProfile(d, p, '虚构测试快照');
  await d.backups.put({ id: 'bk-premigrate-v4-me', doc: p, createdAt: '2026-01-01', reason: 'protected old backup' });
  await d.resumes.put(r); await d.exports.put({ id: 'ex-test', resumeId: r.id, company: '模拟公司', roleAbbr: 'MOCK', date: '2026-01-01', seq: 1, zipName: 'mock.zip', files: ['fictional.pdf'], exportedAt: '2026-01-01', zip: new Uint8Array([1, 2]), blobs: { pdf: new Uint8Array([3, 4]) } });
  await d.settings.put({ id: 'settings', apiKey: 'FAKE-TEST-ONLY', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', demoMode: false, uiLang: 'en', translateModel: 'mock-translate', visionModel: 'mock-vision', ocrMode: 'local', setupDone: true, apiProfiles: [{ id: 'fake-api', label: '模拟 API', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'FAKE-TEST-ONLY', model: 'deepseek-v4-pro', translateModel: '', visionModel: '', ocrMode: 'local', updatedAt: '2026-01-01' }], activeProfileId: 'fake-api' });
  await d.templates.put(structuredClone(BUILTIN_TEMPLATES[0])); await d.jobs.put(job);
  // Preserve application-bound personal snapshots exactly. They cannot restore the editable profile automatically.
  for (const table of ['jdGroups', 'postings', 'applications', 'appEvents', 'artifacts', 'resumeVersions', 'attachments', 'attachmentBlobs'] as const) await d.table(table).put({ id: `sentinel-${table}`, profile: structuredClone(p), payload: new Uint8Array([7, 8]) });
  await d.state.bulkPut([{ id: 'resumeId', value: r.id }, { id: 'jobId', value: job.id }, { id: 'templateId', value: BUILTIN_TEMPLATES[0].id }, { id: 'jointGroupId', value: 'keep-group' }, { id: 'unrelated', value: 'keep-value' }]);
  const kept = Object.fromEntries(await Promise.all(preservedTables.map(async (table) => [table, await d.table(table).toArray()])));
  return { d, p, kept };
}

describe('explicit personal-data clear, never full-database deletion', () => {
  it('permanently clears every profile field, translation, source, backup and generated cache while preserving unrelated tables byte-for-byte', async () => {
    const { d, p, kept } = await fixture('clear-profile-all-fields'); expect(p.courses).toHaveLength(84); expect(await d.backups.count()).toBe(2);
    const cleared = await clearPersonalData(d);
    expect(cleared.doc).toEqual(emptyProfile()); expect((await d.profile.get('me'))!.doc).toEqual(emptyProfile());
    expect(await d.backups.count()).toBe(0); expect(await d.resumes.count()).toBe(0); expect(await d.exports.count()).toBe(0);
    for (const table of preservedTables) expect(await d.table(table).toArray()).toEqual(kept[table]);
    expect((await d.state.get('resumeId'))!.value).toBe('');
    for (const key of ['jobId', 'templateId', 'jointGroupId', 'unrelated']) expect((await d.state.get(key))!.value).toBeTruthy();
    expect((await d.state.get(PROFILE_EPOCH_KEY))!.value).toBe(cleared.epoch);
    const name = d.name; d.close(); const reloaded = new ResumeDB(name);
    expect((await reloaded.profile.get('me'))!.doc).toEqual(emptyProfile()); expect(await reloaded.backups.count()).toBe(0);
    expect((await reloaded.settings.get('settings'))!.apiKey).toBe('FAKE-TEST-ONLY'); await reloaded.delete();
  });
  it('rolls back the entire clear if any delete fails, preserving the pre-clear profile and all records', async () => {
    const { d, p, kept } = await fixture('clear-profile-failure');
    d.resumes.hook('deleting', () => { throw new Error('simulated deletion failure'); });
    await expect(clearPersonalData(d)).rejects.toThrow(/simulated deletion failure/);
    expect((await d.profile.get('me'))!.doc).toEqual(p); expect(await d.backups.count()).toBe(2); expect(await d.exports.count()).toBe(1); expect(await d.resumes.count()).toBe(1);
    expect(await profileEpoch(d)).toBe(''); for (const table of preservedTables) expect(await d.table(table).toArray()).toEqual(kept[table]); await d.delete();
  });
  it('rejects delayed profile writes, old snapshot creation and stale generated resumes from another session after a clear', async () => {
    const { d, p } = await fixture('clear-profile-stale-session'), oldEpoch = await profileEpoch(d);
    await clearPersonalData(d);
    await expect(persistProfile(d, p, oldEpoch)).rejects.toThrow(/已清空/);
    await expect(snapshotProfile(d, p, 'stale backup', oldEpoch)).rejects.toThrow(/已清空/);
    await expect(d.transaction('rw', d.state, d.resumes, async () => { await assertProfileEpoch(d, oldEpoch); await d.resumes.put(generateRules(p, jobs().A, 'zh')); })).rejects.toThrow(/已清空/);
    await expect(d.transaction('rw', d.state, d.exports, async () => { await assertProfileEpoch(d, oldEpoch); await d.exports.put({ id: 'stale-export' } as never); })).rejects.toThrow(/已清空/);
    expect((await d.profile.get('me'))!.doc).toEqual(emptyProfile()); expect(await d.backups.count()).toBe(0); expect(await d.resumes.count()).toBe(0); expect(await d.exports.count()).toBe(0); await d.delete();
  });
  it('accepts fresh imports after a clear and allows normal editing/backup without resurrecting the old import', async () => {
    const { d } = await fixture('clear-profile-fresh-import'); const result = await clearPersonalData(d), fresh = emptyProfile();
    fresh.profile.name = { zh: '测试用户新', en: 'Test User New' }; fresh.sourceTexts = [{ id: 'fresh', at: '2026-01-02', files: ['new.txt'], text: '全新虚构原文' }];
    await persistProfile(d, fresh, result.epoch); expect((await d.profile.get('me'))!.doc).toEqual(fresh);
    await snapshotProfile(d, fresh, 'new import only', result.epoch); expect((await d.backups.toArray())[0].doc.profile.name.zh).toBe('测试用户新');
    expect(JSON.stringify(await d.profile.toArray())).not.toContain('虚构原始资料与来源记录'); await d.delete();
  });
  it('never reseeds cleared demo data on reload, keeps demo API settings and does not touch a separate real database', async () => {
    const real = new ResumeDB('clear-isolated-real'), demo = new ResumeDB('clear-isolated-demo');
    await real.profile.put({ id: 'me', doc: coursesFixture() }); const before = await real.profile.toArray();
    await seedDemo(demo); const settings = (await demo.settings.get('settings'))!; settings.apiKey = 'FAKE-DEMO-ONLY'; await demo.settings.put(settings);
    await clearPersonalData(demo); const reload = await seedDemo(demo);
    expect(reload.profile).toEqual(emptyProfile()); expect(reload.resume).toBeNull(); expect(reload.settings.apiKey).toBe('FAKE-DEMO-ONLY'); expect(await demo.backups.count()).toBe(0);
    expect(await real.profile.toArray()).toEqual(before); await real.delete(); await demo.delete();
  });
});
