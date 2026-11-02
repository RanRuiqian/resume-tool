import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { ResumeDB, snapshotProfile } from '../src/storage/db';
import { seedDemo } from '../src/storage/demo';
import { DB_DEMO, DB_REAL, isDemoSearch } from '../src/storage/mode';
import { normalizeProfile, exportProfileJson } from '../src/storage/profileIO';

/** 模拟的个人资料（非真实用户） */
const mockUser = () => normalizeProfile({
  profile: { name: { zh: '测试用户甲', source: 'zh' } },
  work: [{ id: 'w1', company: { zh: '模拟科技' }, title: { zh: '算法工程师' }, start: '2022-07', end: 'present', bullets: [{ id: 'w1-b1', zh: '把检测准确率从 91% 提升到 97%' }], tags: ['Python'] }],
});

describe('demo isolation', () => {
  it('detects ?demo', () => {
    expect(isDemoSearch('?demo')).toBe(true);
    expect(isDemoSearch('?x=1&demo=1')).toBe(true);
    expect(isDemoSearch('')).toBe(false);
    expect(DB_DEMO).not.toBe(DB_REAL);
  });
  it('seeding demo never touches the real database', async () => {
    const real = new ResumeDB('iso-real'); const demo = new ResumeDB('iso-real-demo');
    const me = mockUser();
    await real.profile.put({ id: 'me', doc: me });
    await real.settings.put({ id: 'settings', demoMode: false, baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test-fake', model: 'deepseek-chat', visionModel: '', translateModel: '', uiLang: 'zh', provider: 'deepseek', ocrMode: 'local', setupDone: true });
    const r = await seedDemo(demo);
    expect(r.profile.profile.name.zh).not.toBe('测试用户甲');
    const after = (await real.profile.get('me'))!.doc;
    expect(after).toEqual(me);
    expect((await real.settings.get('settings'))!.apiKey).toBe('sk-test-fake');
    expect(await real.jobs.count()).toBe(0);
    expect(await real.resumes.count()).toBe(0);
    // 再次进入演示也不会影响真实库
    await seedDemo(demo);
    expect((await real.profile.get('me'))!.doc).toEqual(me);
  });
  it('refuses to seed demo data into a non-demo database', async () => {
    await expect(seedDemo(new ResumeDB('some-real'))).rejects.toThrow();
  });
});

describe('migration v1 → v2', () => {
  it('upgrades an old v1 database without losing data', async () => {
    const old = new Dexie('mig-test');
    old.version(1).stores({ profile: 'id', templates: 'id', jobs: 'id, createdAt', resumes: 'id, jobId, createdAt', exports: 'id, [company+roleAbbr+date]', settings: 'id', state: 'id' });
    // v1.0 时代的旧格式：纯字符串字段、无新字段
    await old.table('profile').put({ id: 'me', doc: { version: '1.0', profile: { name: '测试用户乙', contacts: { location: '上海' } },
      education: [{ id: 'e1', school: '模拟大学', degree: '硕士', major: '控制工程', start: '2023-09', end: '2026-06', highlights: ['GPA 3.8'] }],
      projects: [{ id: 'p1', name: '视觉检测平台', role: '负责人', bullets: ['漏检率降低 40%'], tags: ['OpenCV'] }],
      skills: [{ id: 's1', name: 'Python', level: '熟练' }] } });
    await old.table('jobs').put({ id: 'j1', createdAt: '2026-01-01' });
    // 旧历史简历：条目没有 syncStatus，也没有审查记录
    await old.table('resumes').put({ id: 'r-old', jobId: 'j1', createdAt: '2026-01-02', primaryLanguage: 'zh', items: [{ sourceId: 'p1-b1', zh: '漏检率降低 40%', en: 'Cut miss rate by 40%' }] });
    old.close();
    const db = new ResumeDB('mig-test');
    await db.open();
    expect(db.verno).toBe(6);
    const r = (await db.resumes.get('r-old'))!;
    expect(r.items[0]).toMatchObject({ sourceId: 'p1-b1', zh: '漏检率降低 40%', syncStatus: 'in-sync' });
    expect(r.audit).toBeUndefined();
    const doc = (await db.profile.get('me'))!.doc;
    expect(doc.profile.name.zh).toBe('测试用户乙');
    expect(doc.education[0].end).toBe('2026-06');
    expect(doc.education[0].highlights[0].en).toBe('GPA 3.8');
    expect(doc.projects[0].bullets[0].zh).toBe('漏检率降低 40%');
    expect(doc.skills[0].level).toBe('熟练');
    expect(await db.jobs.count()).toBe(1);
    // 升级前自动快照：旧版原始资料原样保存，恢复时再统一升级
    const bk = await db.backups.toArray();
    expect(bk.length).toBe(2);
    expect(bk[0].reason).toContain('升级前自动快照');
    expect((bk[0].doc as unknown as { profile: { name: string } }).profile.name).toBe('测试用户乙');
    expect(normalizeProfile(bk[0].doc)).toEqual(doc);
    db.close();
  });
});

describe('persistence & backups', () => {
  it('JSON export → import round-trip is lossless', () => {
    const me = mockUser();
    expect(normalizeProfile(JSON.parse(exportProfileJson(me)))).toEqual(me);
  });
  it('data persists after closing and reopening the database (simulated reload)', async () => {
    const a = new ResumeDB('reload-test'); await a.profile.put({ id: 'me', doc: mockUser() }); a.close();
    const b = new ResumeDB('reload-test');
    expect((await b.profile.get('me'))!.doc.profile.name.zh).toBe('测试用户甲');
  });
  it('snapshots before replace and keeps at most 20', async () => {
    const d = new ResumeDB('bk-test');
    for (let i = 0; i < 23; i++) await snapshotProfile(d, mockUser(), `r${i}`);
    expect(await d.backups.count()).toBe(20);
    expect(await snapshotProfile(d, normalizeProfile({}), 'empty')).toBeNull();
  });
});

describe('career profile v1.3 fields', () => {
  it('keeps education dates separate, skill dossier, project dossier and evidence through JSON round-trip', () => {
    const p = normalizeProfile({
      education: [{ id: 'e1', school: { zh: '模拟大学' }, degree: {}, major: { zh: '机械电子工程' }, start: '2023-09', end: '2026-06', highlights: [],
        courseCompletionDate: '2026-01', expectedConferralDate: '2026-06', actualConferralDate: '', availableFullTimeDate: '2026-03', degreeProofStatus: 'pending', courses: ['机器视觉', '运动控制'] }],
      projects: [{ id: 'p1', name: { zh: '焊缝检测' }, role: {}, bullets: [], tags: [], start: '', end: '', evidenceIds: ['ev1', 'ghost'],
        dossier: { background: '产线人工目检', tools: ['Halcon'], failedAttempts: [{ approach: '阈值分割', reason: '反光' }], phases: [{ name: '验证' }] } }],
      skills: [{ id: 's1', name: { zh: 'Halcon' }, proficiency: 'proficient', usedIn: ['p1', 'deleted'], lastUsed: '2026-05', evidenceIds: ['ev1'] },
        { id: 's2', name: { zh: 'PLC' } }, { id: 's3', name: { zh: 'X' }, proficiency: 'guru' }],
      evidence: [{ id: 'ev1', fileName: '论文.pdf', type: 'paper', location: 'D:/论文/论文.pdf', projectIds: ['p1'], skillIds: ['s1'], proves: '第一作者', confirmed: true }],
    });
    const e = p.education[0];
    expect([e.courseCompletionDate, e.expectedConferralDate, e.availableFullTimeDate, e.end]).toEqual(['2026-01', '2026-06', '2026-03', '2026-06']);
    expect(e.degreeProofStatus).toBe('pending');
    expect(p.projects[0].evidenceIds).toEqual(['ev1']);
    expect(p.projects[0].dossier!.failedAttempts![0].id).toBeTruthy();
    expect(p.skills[0].usedIn).toEqual(['p1']);
    // 没填掌握程度的技能保持“未填写”，不自动推断；非法值归零
    expect(p.skills[1].proficiency).toBe('');
    expect(p.skills[2].proficiency).toBe('');
    // 本地路径只是位置说明
    expect(p.evidence[0].locationKind).toBe('note');
    expect(p.evidence[0].publicOk).toBe(false);
    expect(normalizeProfile({ evidence: [{ location: 'https://arxiv.org/abs/1' }] }).evidence[0].locationKind).toBe('url');
    expect(normalizeProfile(JSON.parse(exportProfileJson(p)))).toEqual(p);
    expect(p.version).toBe('1.4');
  });
  it('old v1.2 JSON backups (no new fields) still import', () => {
    const old = { version: '1.2', primaryLanguage: 'zh', glossary: [], profile: { name: { zh: '旧备份' }, headline: {}, summary: {}, contacts: { location: {} }, personal: {} },
      education: [{ id: 'e1', enabled: true, school: { zh: 'A 大学' }, degree: {}, major: {}, start: '2019', end: '2023', highlights: [] }], work: [], projects: [], skills: [], certificates: [], awards: [] };
    const p = normalizeProfile(old);
    expect(p.evidence).toEqual([]);
    expect(p.education[0].end).toBe('2023');
    expect(p.education[0].expectedConferralDate).toBeUndefined();
  });
});

import sample from '../src/sample/sample-profile.json';
import { parseJdRules } from '../src/ai/jd';
import { generateRules, runConsistency } from '../src/ai/generate';
import { SAMPLE_JD } from '../src/sample/sampleJd';
import { forEachText } from '../src/locale/text';
describe('generation still traceable with v1.3 profile', () => {
  it('every generated item points to a real sourceId; CN & EN produced', () => {
    const p = normalizeProfile(structuredClone(sample));
    p.projects[0].dossier = { background: '模拟背景', tools: ['Vite'], phases: [{ id: 'ph1', name: '一期' }] };
    p.evidence.push({ id: 'ev-x', fileName: 'mock.pdf', type: 'paper', location: 'D:/x.pdf', locationKind: 'note', projectIds: [p.projects[0].id], skillIds: [], proves: 'x', confirmed: false, publicOk: false });
    const ids = new Set<string>(['summary']); forEachText(p, (t) => { if (t.id) ids.add(t.id); });
    for (const lang of ['zh', 'en'] as const) {
      const r = runConsistency(generateRules(p, parseJdRules(SAMPLE_JD), lang));
      expect(r.items.length).toBeGreaterThan(3);
      for (const it of r.items) expect(ids.has(it.sourceId) || it.sourceId.startsWith('summary')).toBe(true);
      expect(r.items.every((i) => i.zh && i.en)).toBe(true);
    }
  });
});

it('v1.12 optional provenance and readable-layout fields round-trip without rewriting existing resumes or profiles', async () => {
  const { exportLightJson, readArchive, restoreArchive } = await import('../src/tracker/backup');
  const { generateRules } = await import('../src/ai/generate');
  const { parseJdRules } = await import('../src/ai/jd');
  const d = new ResumeDB('v112-fictional-roundtrip-only');
  const me = mockUser();
  me.profile.summary = { zh: '测试用户甲的固定工程背景。', en: 'Fixed engineering background for Test User A.', status: { zh: 'confirmed', en: 'confirmed' } };
  me.work[0].bullets.push({ id: 'w1-b2', zh: '参与模拟项目测试。', en: 'Participated in fictional project testing.' });
  const job = parseJdRules('模拟科技招聘工程测试岗位');
  const r = generateRules(me, job, 'zh');
  r.layoutPolicy = 'readable';
  r.items = [{ sourceId: 'summary', zh: me.profile.summary.zh!, en: me.profile.summary.en!, syncStatus: 'in-sync' },
    { sourceId: 'w1-b1', sourceIds: ['w1-b1', 'w1-b2'], zh: '参与模拟项目测试。', en: 'Participated in fictional project testing.', syncStatus: 'in-sync' }];
  const saved = structuredClone(r);
  await d.profile.put({ id: 'me', doc: me }); await d.jobs.put(job); await d.resumes.put(r);
  const changed = structuredClone(me); changed.profile.summary.zh = '后续用户手动修改的简介。';
  await d.profile.put({ id: 'me', doc: changed });
  expect(await d.resumes.get(r.id)).toEqual(saved);
  const exported = JSON.parse(await exportLightJson(d));
  expect(exported.resumes[0]).toEqual(saved);
  expect(exported.profile).toEqual(changed);
  expect(exported.resumes[0].items[1].sourceIds).toEqual(['w1-b1', 'w1-b2']);
  const restored = new ResumeDB('v112-fictional-restored-only');
  const check = await readArchive(restored, JSON.stringify(exported));
  expect(check.errors).toEqual([]);
  await restoreArchive(restored, check, { sections: ['profile', 'jobs', 'resumes'], overwrite: false, replaceProfile: true });
  expect(await restored.resumes.get(r.id)).toEqual(saved);
  expect((await restored.profile.get('me'))!.doc.profile.summary).toEqual(changed.profile.summary);
  await restored.delete();
  await d.delete();
});

/** v4 fixture deliberately includes every store, plus opaque old fields and a fictional credential. */
async function makeV4(name: string) {
  const old = new Dexie(name);
  old.version(4).stores({ profile: 'id', templates: 'id', jobs: 'id, createdAt', resumes: 'id, jobId, createdAt', exports: 'id, [company+roleAbbr+date]', settings: 'id', state: 'id', backups: 'id, createdAt',
    postings: 'id, company, city, recruitType, priority, deadline, updatedAt, *importKeys', applications: 'id, postingId, status, updatedAt', appEvents: 'id, applicationId, at', artifacts: 'id, applicationId, createdAt', attachments: 'id, postingId, applicationId, sha256, uploadedAt', attachmentBlobs: 'id' });
  const profile = mockUser(); delete profile.courses; profile.version = '1.3';
  await old.table('profile').put({ id: 'me', doc: profile });
  const unchanged: Record<string, unknown[]> = {};
  for (const table of old.tables.filter((t) => !['profile', 'backups'].includes(t.name))) {
    const row = { id: `old-${table.name}`, opaque: { legacy: ['keep-all'], bytes: new Uint8Array([1, 2, 3]) }, ...(table.name === 'settings' ? { apiKey: 'fake-test-only-credential' } : {}) };
    await table.put(row); unchanged[table.name] = await table.toArray();
  }
  await old.table('backups').put({ id: 'old-manual-backup', doc: profile, createdAt: '2026-01-01', reason: 'old snapshot' });
  old.close(); return { profile, unchanged };
}
describe('v1.13 transactional migration v4 → v5 and protected rollback backups', () => {
  it('backs up raw v4 before appending courses, keeps every other store byte-for-byte and can restore raw profile', async () => {
    const name = 'v113-migrate-all-stores'; const { profile, unchanged } = await makeV4(name); const d = new ResumeDB(name);
    await d.open(); expect(d.verno).toBe(6);
    expect((await d.profile.get('me'))!.doc).toEqual({ ...profile, courses: [] });
    const snapshot = (await d.backups.get('bk-premigrate-v4-me'))!;
    expect(snapshot.doc).toEqual(profile); expect(snapshot.doc).not.toHaveProperty('courses');
    for (const [table, rows] of Object.entries(unchanged)) expect(await d.table(table).toArray()).toEqual(rows);
    expect(await d.backups.get('old-manual-backup')).toBeDefined();
    for (let i = 0; i < 22; i++) await snapshotProfile(d, normalizeProfile(profile), `fictional ${i}`);
    expect(await d.backups.get(snapshot.id)).toEqual(snapshot); expect(await d.backups.count()).toBe(21);
    await d.profile.put({ id: 'me', doc: normalizeProfile(snapshot.doc) });
    expect((await d.profile.get('me'))!.doc.work).toEqual(profile.work);
    await d.delete();
  });
  it('rolls back the entire upgrade when the backup write fails; v4 data remains readable and retry succeeds', async () => {
    const name = 'v113-forced-migration-failure'; const { profile, unchanged } = await makeV4(name); const d = new ResumeDB(name);
    const fail = () => { throw new Error('simulated backup quota failure'); };
    d.backups.hook('creating', fail);
    await expect(d.open()).rejects.toThrow(/simulated backup quota failure/);
    d.close();
    const old = new Dexie(name);
    await old.open(); expect(old.verno).toBe(4); expect((await old.table('profile').get('me')).doc).toEqual(profile);
    for (const [table, rows] of Object.entries(unchanged)) expect(await old.table(table).toArray()).toEqual(rows);
    expect(await old.table('backups').count()).toBe(1); old.close();
    const retry = new ResumeDB(name); await retry.open(); expect((await retry.profile.get('me'))!.doc.courses).toEqual([]); await retry.delete();
  });
});

it('v5 → v6 only adds empty joint tables; existing profile, credentials, history, drafts and all table rows remain identical', async () => {
  const schema = new ResumeDB('v6-schema-inspect-only');
  const stores = Object.fromEntries(schema.tables.filter((t) => !['jdGroups', 'resumeVersions'].includes(t.name)).map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(',')]));
  schema.close(); const name = 'v5-to-v6-safety', old = new Dexie(name); old.version(5).stores(stores);
  const before: Record<string, unknown[]> = {};
  for (const table of old.tables) {
    const row = table.name === 'profile' ? { id: 'me', doc: mockUser() } : { id: `sentinel-${table.name}`, content: ['保留', 1], ...(table.name === 'settings' ? { apiKey: 'FAKE-ONLY-KEEP' } : {}) };
    await table.put(row); before[table.name] = await table.toArray();
  }
  old.close(); const current = new ResumeDB(name); await current.open(); expect(current.verno).toBe(6);
  for (const [name, rows] of Object.entries(before)) expect(await current.table(name).toArray()).toEqual(rows);
  expect(await current.jdGroups.count()).toBe(0); expect(await current.resumeVersions.count()).toBe(0); await current.delete();
});
