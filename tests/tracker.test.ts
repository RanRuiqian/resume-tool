import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ResumeDB } from '../src/storage/db';
import { seedDemo } from '../src/storage/demo';
import { normalizeProfile } from '../src/storage/profileIO';
import { rawToProfile } from '../src/ai/importProfile';
import type { ResumeDoc } from '../src/types';
import { addAttachment, addPosting, addSubmittedResume, changeStatus, copyPosting, createApplication, deleteImpact, deletePosting, findDuplicates, linkResumeSnapshot, listEvents, MAX_ATTACHMENT_BYTES, StorageError, updatePosting, verifyAttachment } from '../src/tracker/repo';
import { applyImport, buildCandidates, csvToSource, guessMapping, jsonToSource, mapStatus, parseCsv, planImport } from '../src/tracker/importers';
import { exportArchiveZip, exportLightJson, readArchive, restoreArchive, SECTIONS } from '../src/tracker/backup';
import { computeStats } from '../src/tracker/stats';

// 全部为虚构资料
let n = 0; const fresh = () => new ResumeDB(`trk-${++n}-${Math.random().toString(36).slice(2)}`);
const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const mockProfile = () => normalizeProfile(rawToProfile({ name: '测试用户癸', work: [{ company: '模拟装备有限公司', title: '视觉实习生', start: '2025-03', end: '2025-08', tags: ['Python', 'OpenCV'], bullets: ['使用 OpenCV 开发缺陷检测程序，漏检率降低 30%'] }] }));
const mockResume = (p: ReturnType<typeof mockProfile>): ResumeDoc => ({ id: 'res-1', jobId: 'jp-1', templateId: 'classic', primaryLanguage: 'zh', createdAt: '2026-10-30T09:00:00.000Z', matchScore: 80, gaps: [], selection: { work: [p.work[0].id], projects: [], education: [], skills: [], certificates: [], awards: [] }, items: [{ sourceId: p.work[0].bullets[0].id!, zh: '使用 OpenCV 开发缺陷检测程序，漏检率降低 30%', en: 'Built an OpenCV defect detector, cutting misses by 30%', syncStatus: 'in-sync' }], consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai' });
const base = { company: '模拟视觉科技有限公司', title: '视觉算法工程师', city: '上海', applyUrl: 'https://example.com/jobs/1' };
const importCsv = async (d: ResumeDB, text: string, name = 'mock.csv', actions: Record<number, 'skip' | 'merge' | 'new'> = {}) => {
  const src = csvToSource(text, name); const plan = planImport(buildCandidates(src, guessMapping(src.keys)), await d.postings.toArray(), await d.applications.toArray());
  return { plan, res: await applyImport(d, plan, actions) };
};

describe('数据库升级 v3 → v4', () => {
  it('旧库升级后旧数据完整保留，新增投递相关表', async () => {
    const name = `mig-v3-${Math.random()}`; const old = new Dexie(name);
    old.version(1).stores({ profile: 'id', templates: 'id', jobs: 'id, createdAt', resumes: 'id, jobId, createdAt', exports: 'id, [company+roleAbbr+date]', settings: 'id', state: 'id' });
    old.version(2).stores({ backups: 'id, createdAt' }); old.version(3).stores({});
    const p = mockProfile(); const r = mockResume(p);
    await old.open(); await old.table('profile').put({ id: 'me', doc: p }); await old.table('resumes').put(r); await old.table('backups').put({ id: 'bk-1', createdAt: '2026-10-01', reason: 'x', doc: p }); old.close();
    const d = new ResumeDB(name); await d.open();
    expect(d.verno).toBe(6);
    expect((await d.profile.get('me'))!.doc).toEqual(p);
    expect(await d.resumes.get('res-1')).toEqual(r);
    expect(await d.backups.count()).toBe(2);
    expect(await d.backups.get('bk-premigrate-v4-me')).toBeDefined();
    for (const t of ['postings', 'applications', 'appEvents', 'artifacts', 'attachments', 'attachmentBlobs']) expect(d.tables.map((x) => x.name)).toContain(t);
    d.close();
  });
});

describe('岗位库与投递进度', () => {
  it('新建 / 编辑 / 复制岗位；岗位可以只在岗位库中而不建立申请', async () => {
    const d = fresh(); const { posting, application } = await addPosting(d, base);
    expect(application).toBeUndefined(); expect(await d.applications.count()).toBe(0);
    const e = await updatePosting(d, { ...posting, city: '杭州', notes: '虚构备注' });
    expect((await d.postings.get(posting.id))!.city).toBe('杭州'); expect(e.updatedAt >= posting.updatedAt).toBe(true);
    const c = await copyPosting(d, posting.id); expect(c.id).not.toBe(posting.id); expect(c.title).toContain('副本');
  });
  it('收藏 → 已投递 → 测评：每次变化都追加历史，不覆盖', async () => {
    const d = fresh(); const { posting } = await addPosting(d, base);
    const a = await createApplication(d, posting.id, 'saved', undefined, '2026-10-31T01:00:00.000Z');
    await changeStatus(d, a.id, 'applied', '官网投递', '2026-11-01T01:00:00.000Z');
    await changeStatus(d, a.id, 'assessment', '收到在线测评', '2026-11-04T01:00:00.000Z');
    const ev = await listEvents(d, a.id);
    expect(ev.map((x) => [x.from, x.to, x.at.slice(0, 10)])).toEqual([[null, 'saved', '2026-10-31'], ['saved', 'applied', '2026-11-01'], ['applied', 'assessment', '2026-11-04']]);
    const cur = (await d.applications.get(a.id))!; expect(cur.status).toBe('assessment'); expect(cur.appliedAt).toBe('2026-11-01T01:00:00.000Z');
    d.close(); const again = new ResumeDB(d.name); expect((await listEvents(again, a.id)).length).toBe(3); // 模拟刷新
  });
  it('检测可能重复的岗位（链接 / 公司+岗位+城市 / 相似）', async () => {
    const d = fresh(); await addPosting(d, base); const all = await d.postings.toArray();
    expect(findDuplicates(all, { ...base, company: 'x', applyUrl: 'https://www.example.com/jobs/1/?utm_source=abc#top' })[0].reason).toBe('url');
    expect(findDuplicates(all, { company: '模拟视觉科技', title: '视觉算法工程师', city: '上海' })[0].reason).toBe('same-key');
    expect(findDuplicates(all, { company: '模拟视觉科技有限公司', title: '视觉算法工程师', city: '杭州' })[0].reason).toBe('similar');
    expect(findDuplicates(all, { company: '另一家', title: '视觉算法工程师', city: '上海' })).toEqual([]);
  });
  it('删除岗位前能评估关联申请与附件，删除时级联清理', async () => {
    const d = fresh(); const { posting, application } = await addPosting(d, base, 'applied');
    await addAttachment(d, { name: 'jd.png', type: 'image/png', data: new Uint8Array([1, 2, 3]) }, { postingId: posting.id, kind: 'jd-screenshot' });
    await addSubmittedResume(d, application!.id, posting.id, { name: 'Mock_CN.pdf', type: 'application/pdf', data: new Uint8Array([4, 5]) }, ['zh']);
    const imp = await deleteImpact(d, posting.id);
    expect(imp).toMatchObject({ applications: 1, attachments: 2, artifacts: 1, events: 1 });
    await deletePosting(d, posting.id);
    for (const t of [d.postings, d.applications, d.appEvents, d.artifacts, d.attachments, d.attachmentBlobs]) expect(await t.count()).toBe(0);
  });
  it('统计只基于真实记录', async () => {
    const d = fresh(); expect(computeStats([], [])).toMatchObject({ postings: 0, applied: 0, offer: 0, upcoming: [] });
    const a = await addPosting(d, { ...base, deadline: '2026-11-05' }, 'saved'); await addPosting(d, { ...base, company: '虚构机器人', city: '杭州' }, 'applied'); await addPosting(d, { ...base, company: '仅收录' });
    const s = computeStats(await d.postings.toArray(), await d.applications.toArray(), new Date('2026-11-01T00:00:00Z'));
    expect(s).toMatchObject({ postings: 3, tracked: 2, untracked: 1, saved: 1, applied: 1, waiting: 1, offer: 0 });
    expect(s.byCity).toEqual({ 上海: 1, 杭州: 1 }); expect(s.upcoming[0]).toMatchObject({ date: '2026-11-05', postingId: a.posting.id });
  });
});

describe('简历关联与快照', () => {
  it('关联后修改资料 / 重新生成，快照不变；保留事实审查摘要', async () => {
    const d = fresh(); const p = mockProfile(); const r = mockResume(p);
    const { application } = await addPosting(d, base, 'preparing');
    const art = await linkResumeSnapshot(d, application!.id, { resume: r, profile: p, job: null });
    p.work[0].bullets[0].zh = '修改后的经历'; r.items[0].zh = '重新生成的文本';
    const saved = (await d.artifacts.get(art.id))!;
    expect(saved.resume!.items[0].zh).toBe('使用 OpenCV 开发缺陷检测程序，漏检率降低 30%');
    expect(saved.profile!.work[0].bullets[0].zh).toBe('使用 OpenCV 开发缺陷检测程序，漏检率降低 30%');
    expect(saved.audit).toMatchObject({ unconfirmedRed: 0 }); expect(saved.resumeCreatedAt).toBe('2026-10-30T09:00:00.000Z');
  });
  it('上传实际提交的简历：附件 + 实际提交版本，校验值可验证', async () => {
    const d = fresh(); const { posting, application } = await addPosting(d, base, 'applied');
    const { att, art } = await addSubmittedResume(d, application!.id, posting.id, { name: 'Mock_Process_Engineer_EN.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: new TextEncoder().encode('fake docx') }, ['en']);
    expect(art).toMatchObject({ kind: 'uploaded', submitted: true, attachmentId: att.id, languages: ['en'] });
    expect(att.sha256).toMatch(/^[0-9a-f]{64}$/); expect(await verifyAttachment(d, att.id)).toBe(true);
    await d.attachmentBlobs.put({ id: att.id, data: new Uint8Array([9]) }); expect(await verifyAttachment(d, att.id)).toBe(false);
  });
  it('超大附件给出明确错误且不留下半条记录', async () => {
    const d = fresh(); const big = { name: 'huge.pdf', type: 'application/pdf', data: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) };
    await expect(addAttachment(d, big, { kind: 'other' })).rejects.toBeInstanceOf(StorageError);
    expect(await d.attachments.count()).toBe(0); expect(await d.attachmentBlobs.count()).toBe(0);
  });
  it('存储配额不足时提示清楚并回滚', async () => {
    const d = fresh(); const orig = d.attachments.put.bind(d.attachments);
    d.attachments.put = (() => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }) as typeof d.attachments.put;
    await expect(addAttachment(d, { name: 'a.png', type: 'image/png', data: new Uint8Array([1]) }, { kind: 'other' })).rejects.toThrow('存储空间不足');
    d.attachments.put = orig; expect(await d.attachmentBlobs.count()).toBe(0);
  });
});

describe('导入：CSV / JSON / 导航工具', () => {
  it('CSV 解析：引号、逗号、换行、BOM', () => {
    const rows = parseCsv('\uFEFFa,b\r\n"x, y","多\n行"\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', '多\n行']]);
  });
  it('中英文列名自动映射；状态识别不会把未知状态猜成已投递', () => {
    expect(guessMapping(['企业', '岗位', '城市', '状态', '投递链接', '类别'])).toMatchObject({ company: '企业', title: '岗位', city: '城市', status: '状态', applyUrl: '投递链接', category: '类别' });
    expect(guessMapping(['Company', 'Position', 'Location', 'Status', 'URL'])).toMatchObject({ company: 'Company', title: 'Position', city: 'Location', status: 'Status', applyUrl: 'URL' });
    expect([mapStatus('已投递'), mapStatus('笔试'), mapStatus('二面'), mapStatus('Offer'), mapStatus('收藏'), mapStatus('神秘状态'), mapStatus('')]).toEqual(['applied', 'assessment', 'interviewing', 'offer', 'saved', null, null]);
  });
  it('CSV 导入：预览、导入、保留来源；同一文件再次导入全部识别为重复，不产生新记录', async () => {
    const d = fresh(); const csv = fx('applications-mock.csv');
    const { plan, res } = await importCsv(d, csv);
    expect(plan.map((r) => r.kind)).toEqual(['new', 'new', 'new', 'new', 'new', 'invalid']);
    expect(res).toMatchObject({ created: 5, applications: 4, skipped: 1 });
    const unk = (await d.postings.toArray()).find((p) => p.company === '模拟自动化公司')!;
    expect(unk.notes).toContain('原始状态：神秘状态'); expect(await d.applications.where('postingId').equals(unk.id).count()).toBe(0);
    const p3 = (await d.postings.toArray()).find((p) => p.city === '苏州')!; expect(p3.notes).toContain('第二行'); expect(p3.source).toMatchObject({ kind: 'csv', fileName: 'mock.csv' });
    const again = await importCsv(d, csv);
    expect(again.plan.filter((r) => r.kind !== 'invalid').every((r) => r.kind === 'duplicate')).toBe(true);
    expect(again.res).toMatchObject({ created: 0, merged: 0 }); expect(await d.postings.count()).toBe(5); expect(await d.applications.count()).toBe(4);
  });
  it('部分重复 + 冲突：预览显示差异，用户选择合并后追加状态历史、只补空字段', async () => {
    const d = fresh(); await importCsv(d, fx('applications-mock.csv'));
    const src = jsonToSource(fx('handoff-mock.json'), 'handoff.json');
    expect(src.kind).toBe('ran-application-handoff'); expect(src.warnings.join()).toContain('尚未有实际样本');
    const csv2 = '企业,岗位,城市,状态,投递链接\n虚构机器人股份有限公司,机器人软件工程师,杭州,面试中,https://example.com/jobs/102\n全新公司,全新岗位,上海,收藏,\n';
    const s2 = csvToSource(csv2, 'update.csv'); const plan = planImport(buildCandidates(s2, guessMapping(s2.keys)), await d.postings.toArray(), await d.applications.toArray());
    expect(plan.map((r) => r.kind)).toEqual(['conflict', 'new']); expect(plan[0].diffs.join()).toContain('状态');
    expect(plan[0].defaultAction).toBe('skip');
    const res = await applyImport(d, plan, { 0: 'merge' });
    expect(res).toMatchObject({ merged: 1, created: 1, events: 2 });
    const m = plan[0].match!; const app = (await d.applications.where('postingId').equals(m.id).toArray())[0];
    expect(app.status).toBe('interviewing');
    expect((await listEvents(d, app.id)).map((e) => e.to)).toEqual(['assessment', 'interviewing']);
  });
  it('导航工具 JSON：字段映射预览 + 适配；与已有 CSV 记录按链接去重', async () => {
    const d = fresh(); await importCsv(d, fx('applications-mock.csv'));
    const src = jsonToSource(fx('handoff-mock.json'), 'handoff.json'); const map = guessMapping(src.keys);
    expect(map).toMatchObject({ company: 'company', title: 'position', city: 'city', status: 'status', applyUrl: 'url', appliedAt: 'appliedAt', deadline: 'deadline' });
    const plan = planImport(buildCandidates(src, map), await d.postings.toArray(), await d.applications.toArray());
    expect(plan.map((r) => r.kind)).toEqual(['duplicate', 'new']);
    await applyImport(d, plan, {}); const p = (await d.postings.toArray()).find((x) => x.company === '虚构半导体')!;
    expect(p.deadline).toBe('2026-11-15'); expect(p.source.kind).toBe('ran-application-handoff');
  });
  it('通用 JSON（嵌套对象）与错误文件', () => {
    const s = jsonToSource(JSON.stringify({ data: { items: [{ job: { company: 'A 公司', title: 'B 岗' }, status: 'applied' }] } }), 'x.json');
    expect(s.records[0]).toMatchObject({ 'job.company': 'A 公司' }); expect(guessMapping(s.keys)).toMatchObject({ company: 'job.company', title: 'job.title' });
    expect(() => jsonToSource('{bad', 'x.json')).toThrow('不是有效的 JSON'); expect(() => jsonToSource('{"a":1}', 'x.json')).toThrow('没有在 JSON 里找到');
  });
  it('导入中途出错：整体回滚，数据库保持原状', async () => {
    const d = fresh(); await addPosting(d, { ...base, company: '已有公司' }, 'saved');
    const before = { p: await d.postings.toArray(), a: await d.applications.toArray(), e: await d.appEvents.toArray() };
    const src = csvToSource(fx('applications-mock.csv'), 'mock.csv'); const plan = planImport(buildCandidates(src, guessMapping(src.keys)), before.p, before.a);
    let k = 0; const orig = d.postings.add.bind(d.postings);
    d.postings.add = ((x: never) => { if (++k === 3) throw new Error('模拟写入失败'); return orig(x); }) as typeof d.postings.add;
    await expect(applyImport(d, plan, {})).rejects.toThrow('模拟写入失败');
    d.postings.add = orig;
    expect(await d.postings.toArray()).toEqual(before.p); expect(await d.applications.toArray()).toEqual(before.a); expect(await d.appEvents.toArray()).toEqual(before.e);
  });
});

describe('完整备份 ZIP / 轻量 JSON / 恢复', () => {
  const seed = async (d: ResumeDB) => {
    const p = mockProfile(); await d.profile.put({ id: 'me', doc: p });
    await d.settings.put({ id: 'settings', demoMode: false, baseUrl: 'https://api.example.com', apiKey: 'sk-fake-should-never-export', model: 'm', visionModel: '', translateModel: '', uiLang: 'zh', provider: 'deepseek', ocrMode: 'local', setupDone: true });
    const { posting, application } = await addPosting(d, base, 'saved'); await changeStatus(d, application!.id, 'applied', '虚构');
    await linkResumeSnapshot(d, application!.id, { resume: mockResume(p), profile: p, job: null });
    const att = await addAttachment(d, { name: '投递成功截图.png', type: 'image/png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) }, { postingId: posting.id, applicationId: application!.id, kind: 'apply-proof' });
    return { p, posting, application: application!, att };
  };
  it('ZIP 导出 → 导入到空数据库：数据与附件完整、校验一致、不含 API Key', async () => {
    const a = fresh(); const s = await seed(a); const zip = await exportArchiveZip(a);
    const JSZip = (await import('jszip')).default; const z = await JSZip.loadAsync(zip);
    const all = (await Promise.all(Object.values(z.files).filter((f) => !f.dir && f.name.endsWith('.json')).map((f) => f.async('string')))).join('\n');
    expect(all).not.toContain('sk-fake-should-never-export'); expect(all).not.toMatch(/apiKey/i);
    const m = JSON.parse(await z.file('manifest.json')!.async('string')); expect(m).toMatchObject({ format: 'resume-tool-archive', dbVersion: 6, counts: { postings: 1, applications: 1, events: 2, artifacts: 1, attachments: 1, profile: 1 } });
    const b = fresh(); const chk = await readArchive(b, zip); expect(chk.errors).toEqual([]); expect(chk.warnings).toEqual([]);
    const r = await restoreArchive(b, chk, { sections: [...SECTIONS], overwrite: false, replaceProfile: false });
    expect(r.written).toMatchObject({ profile: 1, postings: 1, applications: 1, events: 2, artifacts: 1, attachments: 1 });
    expect((await b.profile.get('me'))!.doc).toEqual(s.p); expect(await b.settings.count()).toBe(0);
    expect(await verifyAttachment(b, s.att.id)).toBe(true); expect((await b.attachmentBlobs.get(s.att.id))!.data).toEqual(new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    expect((await listEvents(b, s.application.id)).map((e) => e.to)).toEqual(['saved', 'applied']);
    // 再次导入同一备份：全部识别为已存在并跳过
    const chk2 = await readArchive(b, zip); expect(chk2.existing.postings).toBe(1);
    const r2 = await restoreArchive(b, chk2, { sections: [...SECTIONS], overwrite: false, replaceProfile: false });
    expect(r2.written.postings).toBe(0); expect(await b.postings.count()).toBe(1);
  });
  it('部分导入；替换资料前自动快照', async () => {
    const a = fresh(); await seed(a); const zip = await exportArchiveZip(a);
    const b = fresh(); const other = mockProfile(); other.profile.name.zh = '另一虚构用户'; await b.profile.put({ id: 'me', doc: other });
    const r = await restoreArchive(b, await readArchive(b, zip), { sections: ['profile', 'postings'], overwrite: false, replaceProfile: true });
    expect(r.written).toMatchObject({ profile: 1, postings: 1, applications: 0 }); expect(r.profileSnapshotId).toBeTruthy();
    expect((await b.backups.get(r.profileSnapshotId!))!.doc.profile.name.zh).toBe('另一虚构用户'); expect(await b.applications.count()).toBe(0);
  });
  it('损坏 / 缺失附件给出警告；损坏文件拒绝写入', async () => {
    const a = fresh(); const s = await seed(a); const JSZip = (await import('jszip')).default;
    const z = await JSZip.loadAsync(await exportArchiveZip(a)); const path = Object.keys(z.files).find((f) => f.startsWith('attachments/') && !z.files[f].dir)!;
    z.file(path, new Uint8Array([0, 0, 0]));
    const b = fresh(); const chk = await readArchive(b, await z.generateAsync({ type: 'uint8array' }));
    expect(chk.warnings.join()).toContain('校验失败'); await restoreArchive(b, chk, { sections: [...SECTIONS], overwrite: false, replaceProfile: false });
    expect(await b.attachmentBlobs.get(s.att.id)).toBeUndefined();
    z.remove(path); const chk2 = await readArchive(fresh(), await z.generateAsync({ type: 'uint8array' })); expect(chk2.warnings.join()).toContain('附件缺失');
    await expect(readArchive(fresh(), new Uint8Array([80, 75, 3, 4, 0, 0]))).rejects.toThrow('损坏');
    await expect(readArchive(fresh(), '{"manifest":{"format":"other"}}')).rejects.toThrow('不是「完整求职档案」');
  });
  it('恢复中途失败整体回滚', async () => {
    const a = fresh(); await seed(a); const zip = await exportArchiveZip(a); const b = fresh(); const chk = await readArchive(b, zip);
    b.appEvents.bulkPut = (() => { throw new Error('模拟失败'); }) as typeof b.appEvents.bulkPut;
    await expect(restoreArchive(b, chk, { sections: [...SECTIONS], overwrite: false, replaceProfile: false })).rejects.toThrow('模拟失败');
    for (const t of [b.profile, b.postings, b.applications, b.attachments, b.attachmentBlobs]) expect(await t.count()).toBe(0);
  });
  it('轻量 JSON：不含附件本体与 API Key，可再导入', async () => {
    const a = fresh(); await seed(a); const json = await exportLightJson(a);
    expect(json).not.toContain('sk-fake-should-never-export'); expect(json).not.toContain('"data"');
    const b = fresh(); const chk = await readArchive(b, json); expect(chk.warnings.join()).toContain('不含附件文件');
    await restoreArchive(b, chk, { sections: [...SECTIONS], overwrite: false, replaceProfile: false }); expect(await b.postings.count()).toBe(1);
  });
});

describe('安全与隔离', () => {
  it('演示库写入投递数据不影响真实库', async () => {
    const real = new ResumeDB('iso-trk'); const demo = new ResumeDB('iso-trk-demo');
    await addPosting(real, base, 'applied'); const before = await real.postings.toArray();
    await seedDemo(demo); await addPosting(demo, { ...base, company: '演示公司' }, 'saved');
    expect(await real.postings.toArray()).toEqual(before); expect(await real.applications.count()).toBe(1);
  });
  it('投递模块不调用任何 AI / 网络接口', () => {
    for (const f of ['repo', 'importers', 'backup', 'stats', 'types', 'useTracker']) {
      const src = readFileSync(new URL(`../src/tracker/${f}.ts`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/fetch\(|\/ai\/|provider|XMLHttpRequest/);
    }
  });
  it('仓库内测试样本只含虚构资料（example.com 链接，无真实手机号 / 邮箱）', () => {
    for (const f of ['applications-mock.csv', 'handoff-mock.json']) {
      const t = fx(f); expect(t).not.toMatch(/1[3-9]\d{9}/); expect(t).not.toMatch(/@(?!example\.com)[\w-]+\.\w+/);
      for (const u of t.match(/https?:\/\/[^\s",]+/g) ?? []) expect(u).toMatch(/^https:\/\/example\.com\//);
    }
  });
});
