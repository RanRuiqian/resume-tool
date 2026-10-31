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
    old.close();
    const db = new ResumeDB('mig-test');
    await db.open();
    expect(db.verno).toBe(2);
    const doc = (await db.profile.get('me'))!.doc;
    expect(doc.profile.name.zh).toBe('测试用户乙');
    expect(doc.education[0].end).toBe('2026-06');
    expect(doc.education[0].highlights[0].en).toBe('GPA 3.8');
    expect(doc.projects[0].bullets[0].zh).toBe('漏检率降低 40%');
    expect(doc.skills[0].level).toBe('熟练');
    expect(await db.jobs.count()).toBe(1);
    expect(await db.backups.count()).toBe(0);
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
