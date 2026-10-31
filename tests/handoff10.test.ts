import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ResumeDB } from '../src/storage/db';
import { applyImport, buildCandidates, HANDOFF_STATUS, jsonToSource, parseImportFile, planImport } from '../src/tracker/importers';
import { listEvents } from '../src/tracker/repo';

// ran-application-handoff 1.0：按用户描述的结构构造的虚构样本（40 校招 + 8 实习 + 21 招聘网站）。不是真实导出文件。
const text = readFileSync(new URL('./fixtures/handoff-1.0-mock.json', import.meta.url), 'utf8');
const raw = JSON.parse(text);
let n = 0; const fresh = () => new ResumeDB(`ho-${++n}-${Math.random().toString(36).slice(2)}`);
const run = async (d: ResumeDB, t = text) => {
  const src = parseImportFile(t, 'navigator-export.json');
  const plan = planImport(buildCandidates(src, src.presetMapping!), await d.postings.toArray(), await d.applications.toArray());
  return { src, plan, res: await applyImport(d, plan, {}) };
};

describe('ran-application-handoff 1.0 适配器', () => {
  it('识别结构：jobs + internships 为岗位，portals 不是岗位', () => {
    const src = jsonToSource(text, 'x.json');
    expect(src.adapter).toBe('handoff-1.0'); expect(src.kind).toBe('ran-application-handoff');
    expect(src.records).toHaveLength(48); expect(src.portals).toHaveLength(21);
    expect(src.meta).toMatchObject({ schemaVersion: '1.0', jobs: 40, internships: 8, portals: 21, exportedAt: raw.exportedAt });
    expect(src.records.some((r) => String(r.id).startsWith('portal-'))).toBe(false);
    expect(src.warnings.join()).toContain('尚未用真实导出文件核对');
  });
  it('无法映射的字段在预览警告中列出', () => {
    const src = jsonToSource(text, 'x.json');
    expect(src.unmapped).toEqual(['tags']); expect(src.warnings.join()).toContain('tags');
  });
  it('字段映射：网址、备注、来源、优先级、报名条件、依据、原始 ID 均保留；招聘类型正确', () => {
    const src = jsonToSource(text, 'x.json'); const c = buildCandidates(src, src.presetMapping!);
    const j1 = c.find((x) => x.posting.source.externalId === 'job-001')!; const r = raw.jobs[0];
    expect(j1.posting).toMatchObject({ company: r.company, title: r.title, city: r.city, applyUrl: r.url, sourcePlatform: r.source, deadline: r.deadline, jdText: r.description, recruitType: 'campus', priority: 2 });
    for (const s of [r.notes, `报名条件：${r.elig}`, `依据：${r.evidence}`, `原优先级：${r.priority}`, '导航工具 ID：job-001']) expect(j1.posting.notes).toContain(s);
    expect(j1.posting.source.raw).toMatchObject({ id: 'job-001', kind: 'job', tags: ['示例标签'] });
    expect(c.find((x) => x.posting.source.externalId === 'job-003')!.posting.priority).toBe(1);
    expect(c.find((x) => x.posting.source.externalId === 'job-007')!.posting.recruitType).toBe('social'); // type=社招
    expect(c.filter((x) => String(x.posting.source.externalId).startsWith('intern-')).every((x) => x.posting.recruitType === 'intern')).toBe(true);
    expect(c.filter((x) => x.posting.recruitType === 'campus')).toHaveLength(35);
  });
  it('状态转换：未投不建申请；等待反馈 → 已投递 + 备注；笔试/面试 → 在线测评并保留原文；已结束 → 已结束', () => {
    expect(HANDOFF_STATUS['未投'].status).toBeNull();
    const src = jsonToSource(text, 'x.json'); const c = buildCandidates(src, src.presetMapping!);
    const by = (s: string) => c.filter((x) => x.statusRaw === s);
    expect(by('未投').every((x) => x.status === null && x.problems.length === 0)).toBe(true);
    expect(by('已投递').every((x) => x.status === 'applied')).toBe(true);
    expect(by('等待反馈').every((x) => x.status === 'applied' && x.posting.notes!.includes('等待反馈'))).toBe(true);
    expect(by('笔试/面试').every((x) => x.status === 'assessment' && x.posting.notes!.includes('笔试/面试'))).toBe(true);
    expect(by('已结束').every((x) => x.status === 'closed')).toBe(true);
  });
  it('导入：48 个岗位，未投的岗位没有申请记录、没有虚假投递时间', async () => {
    const d = fresh(); const { res } = await run(d);
    const notApplied = [...raw.jobs, ...raw.internships].filter((r: { status: string }) => r.status === '未投').length;
    expect(res.created).toBe(48); expect(res.applications).toBe(48 - notApplied);
    expect(await d.postings.count()).toBe(48); expect(await d.applications.count()).toBe(48 - notApplied);
    const apps = await d.applications.toArray();
    expect(apps.every((a) => !a.appliedAt)).toBe(true);
    const p = (await d.postings.toArray()).find((x) => x.source.externalId === 'job-005')!; // 未投
    expect(await d.applications.where('postingId').equals(p.id).count()).toBe(0);
    const p2 = (await d.postings.toArray()).find((x) => x.source.externalId === 'job-002')!; // 等待反馈
    const a2 = (await d.applications.where('postingId').equals(p2.id).toArray())[0];
    expect(a2.status).toBe('applied'); expect((await listEvents(d, a2.id))[0].note).toContain('原始状态「等待反馈」');
  });
  it('重复导入同一文件：按原始 ID 识别，不新增岗位或申请', async () => {
    const d = fresh(); await run(d);
    const again = await run(d);
    expect(again.plan.every((r) => r.kind === 'duplicate')).toBe(true);
    expect(again.res).toMatchObject({ created: 0, merged: 0, applications: 0, events: 0 });
    expect(await d.postings.count()).toBe(48);
  });
  it('导航工具里状态更新后再次导入：同一 ID 显示为冲突，合并后追加历史', async () => {
    const d = fresh(); await run(d);
    const upd = structuredClone(raw); upd.jobs[1].status = '笔试/面试'; // job-002：已投递 → 笔试/面试
    const src = jsonToSource(JSON.stringify(upd), 'x2.json');
    const plan = planImport(buildCandidates(src, src.presetMapping!), await d.postings.toArray(), await d.applications.toArray());
    const row = plan.find((r) => r.cand.posting.source.externalId === 'job-002')!;
    expect(row.kind).toBe('conflict'); expect(plan.filter((r) => r.kind === 'conflict')).toHaveLength(1);
    await applyImport(d, plan, { [row.cand.index]: 'merge' });
    const a = (await d.applications.where('postingId').equals(row.match!.id).toArray())[0];
    expect((await listEvents(d, a.id)).map((e) => e.to)).toEqual(['applied', 'assessment']);
    expect(await d.postings.count()).toBe(48);
  });
  it('未知状态不猜测', () => {
    const t = JSON.stringify({ format: 'ran-application-handoff', schemaVersion: '1.0', jobs: [{ id: 'x1', company: '虚构公司', title: '岗位', status: '神秘状态' }], internships: [], portals: [] });
    const src = jsonToSource(t, 'x.json'); const [c] = buildCandidates(src, src.presetMapping!);
    expect(c.status).toBeNull(); expect(c.problems.join()).toContain('神秘状态');
  });
});
