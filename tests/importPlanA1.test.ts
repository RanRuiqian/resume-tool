import { describe, expect, it } from 'vitest';
import { applyImportPlan, buildImportPlan, undecidedCount } from '../src/ai/importPlan';
import { mergeProfiles, rawToProfile, resolveUncertain, type Uncertain } from '../src/ai/importProfile';
import type { ProfileDoc } from '../src/types';

// 全部为模拟数据（A1 / A3）
const W = (company: string, title: string, start: string, end: string, bullets: string[] = []) => ({ company, title, start, end, bullets });
const item = (plan: ReturnType<typeof buildImportPlan>, sec: string) => plan.items.filter((x) => x.section === sec);

describe('A1 相似经历不自动合并', () => {
  it('同公司、同职位、不同时间：可能重复，需用户选择', () => {
    const b = rawToProfile({ work: [W('模拟科技有限公司', '测试工程师', '2021-01', '2021-12')] });
    const i = rawToProfile({ work: [W('模拟科技', '测试工程师', '2023-03', '2024-02')] });
    const [it] = item(buildImportPlan(b, i), 'work');
    expect(it.status).not.toBe('duplicate');
    expect(it.action).toBe('undecided');
    expect(it.uncertain.join()).toContain('时间段不重叠');
  });
  it('同公司、不同职位：视为不同经历（新增并关联）', () => {
    const b = rawToProfile({ work: [W('模拟科技有限公司', '测试工程师', '2021-01', '2021-12')] });
    const i = rawToProfile({ work: [W('模拟科技有限公司', '产品经理', '2022-01', '2023-12')] });
    const plan = buildImportPlan(b, i);
    const [it] = item(plan, 'work');
    expect(it.status).toBe('new'); expect(it.action).toBe('add');
    expect(it.relatedNote).toContain('不同职位');
    const out = applyImportPlan(b, i, plan);
    expect(out.work.length).toBe(2);
    expect(out.work[1].relatedIds).toEqual([b.work[0].id]);
    expect(out.work[0].relatedIds).toEqual([out.work[1].id]);
  });
  it('名称相似但不同的项目：可能重复时不默认合并', () => {
    const b = rawToProfile({ projects: [{ name: '焊缝视觉检测系统', bullets: ['搭建采集平台'] }] });
    const i = rawToProfile({ projects: [{ name: '焊缝缺陷检测平台', bullets: ['训练分类模型'] }] });
    const [it] = item(buildImportPlan(b, i), 'projects');
    if (it.status !== 'new') expect(it.action).toBe('undecided');
    expect(it.action).not.toBe('merge');
  });
  it('同一项目的不同阶段：保留独立条目并关联，不合并删除', () => {
    const b = rawToProfile({ projects: [{ name: 'AGV 调度系统一期', bullets: ['实现 A* 路径规划'] }] });
    const i = rawToProfile({ projects: [{ name: 'AGV 调度系统二期', bullets: ['接入多车冲突消解'] }] });
    const plan = buildImportPlan(b, i);
    const [it] = item(plan, 'projects');
    expect(it.status).toBe('new'); expect(it.relatedNote).toContain('不同阶段');
    const out = applyImportPlan(b, i, plan);
    expect(out.projects.length).toBe(2);
    expect(out.projects[0].bullets.map((x) => x.zh)).toEqual(['实现 A* 路径规划']);
    expect(out.projects[1].relatedIds).toContain(out.projects[0].id);
  });
  it('中英文项目名称：已有双语名称时可识别为同一项目', () => {
    const b = rawToProfile({ projects: [{ name: '焊缝视觉检测系统' }] });
    b.projects[0].name.en = 'Weld Vision Inspection System';
    const i = rawToProfile({ lang: 'en', projects: [{ name: 'Weld Vision Inspection System', bullets: ['Built capture rig'] }] });
    const [it] = item(buildImportPlan(b, i), 'projects');
    expect(it.matchId).toBe(b.projects[0].id);
    expect(it.status).toBe('duplicate');
  });
  it('两个相似记录分别包含不同证据：用户选择合并后两份证据都保留且关联', () => {
    const b = rawToProfile({ projects: [{ name: '仓储 AGV 调度' }], evidence: [{ fileName: '论文.pdf', type: 'paper', location: 'https://example.com/p', project: '仓储 AGV 调度' }] });
    b.projects[0].evidenceIds = [b.evidence[0].id];
    const i = rawToProfile({ projects: [{ name: '仓储AGV调度', role: '负责人' }], evidence: [{ fileName: '答辩视频', type: 'video', location: '本地硬盘', project: '仓储AGV调度' }] });
    const plan = buildImportPlan(b, i);
    for (const x of plan.items) if (x.action === 'undecided') x.action = 'merge';
    const out = applyImportPlan(b, i, plan);
    expect(out.projects.length).toBe(1);
    expect(out.evidence.length).toBe(2);
    expect(out.projects[0].evidenceIds?.length).toBe(2);
    // 来源 id 与合并记录可追溯
    expect(out.projects[0].id).toBe(b.projects[0].id);
    expect(out.projects[0].mergeHistory?.[0].incomingId).toBe(i.projects[0].id);
    expect(JSON.parse(out.projects[0].mergeHistory![0].incomingSnapshot).role.zh).toBe('负责人');
  });
  it('已确认的旧值不能被无提示覆盖', () => {
    const b = rawToProfile({ work: [W('模拟科技', '测试工程师', '2021-01', '2021-12')] });
    b.work[0].title.status = { zh: 'confirmed' };
    const i = rawToProfile({ work: [W('模拟科技', '高级测试工程师', '2021-01', '2021-12')] });
    const plan = buildImportPlan(b, i);
    const [it] = item(plan, 'work');
    it.action = 'merge';
    const c = it.conflicts.find((x) => x.field === 'title');
    if (c) { expect(c.oldConfirmed).toBe(true); c.useNew = true; expect(() => applyImportPlan(b, i, plan)).toThrow(/已确认/); }
    expect(undecidedCount(plan)).toBe(0);
  });
});

describe('A3 跨段不确定字段定位', () => {
  it('多段同名项目 / 下标重复时，标记落在正确条目，无法定位的进入未分配', () => {
    // 第 1 段：项目 A、B；第 2 段：项目 C（本段下标 0），且再次提到项目 A（下标 1）
    const s1 = rawToProfile({ projects: [{ name: '项目甲' }, { name: '项目乙' }] });
    const s2 = rawToProfile({ projects: [{ name: '项目丙' }, { name: '项目甲' }] });
    const u1 = [resolveUncertain({ field: 'projects[1].start', note: '乙缺时间' }, s1, 1)];
    const u2 = [resolveUncertain({ field: 'projects[0].end', note: '丙缺结束' }, s2, 2), resolveUncertain({ field: 'projects[1].role', note: '甲角色不明' }, s2, 2), resolveUncertain({ field: 'projects[9].end', note: '越界' }, s2, 2)];
    const idMap = new Map<string, string>();
    const acc = mergeProfiles(s1, s2, idMap);
    // s1 作为空资料首段直接采用，id 不变
    const all: Uncertain[] = [...u1, ...u2.map((u) => (u.entryId ? { ...u, entryId: idMap.get(u.entryId) ?? u.entryId } : u))];
    const base: ProfileDoc = rawToProfile({ name: '测试用户' });
    base.profile.name = { zh: '测试用户' };
    const plan = buildImportPlan(base, acc, all);
    const by = (n: string) => plan.items.find((x) => x.title === n)!.uncertain.join('|');
    expect(acc.projects.map((p) => p.name.zh)).toEqual(['项目甲', '项目乙', '项目丙']);
    expect(by('项目乙')).toContain('乙缺时间');
    expect(by('项目丙')).toContain('丙缺结束');
    expect(by('项目甲')).toContain('甲角色不明');
    expect(by('项目甲')).not.toContain('丙缺结束');
    expect(plan.otherUncertain.map((x) => x.note)).toContain('越界');
  });
});
