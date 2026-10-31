import { describe, expect, it } from 'vitest';
import { applyImportPlan, buildImportPlan, similarity } from '../src/ai/importPlan';
import { mergeProfiles, rawToProfile } from '../src/ai/importProfile';
import { normalizeProfile } from '../src/storage/profileIO';

// 全部为模拟数据
const base = () => rawToProfile({ name: '测试用户丙', phone: '13800000000',
  work: [{ company: '模拟智能装备有限公司', title: '视觉算法实习生', start: '2025-03', end: '2025-08', bullets: ['负责缺陷检测模型训练，召回率提升到 95%'] }],
  projects: [{ name: '焊缝视觉检测系统', role: '负责人', start: '2024-09', bullets: ['搭建线扫相机采集平台'] }],
  skills: [{ name: 'Python' }] });

describe('semantic duplicate detection', () => {
  it('scores company name variants as similar', () => {
    expect(similarity('模拟智能装备有限公司', '模拟智能装备')).toBeGreaterThanOrEqual(0.8);
    expect(similarity('Foo Robotics Co., Ltd.', 'foo robotics')).toBe(1);
    expect(similarity('焊缝视觉检测系统', '焊缝检测系统')).toBeGreaterThan(0.55);
    expect(similarity('焊缝视觉检测系统', '仓储AGV调度')).toBeLessThan(0.3);
  });
});

describe('import plan', () => {
  const inc = () => rawToProfile({ name: '测试用户丙', phone: '13900000000', email: 'mock@example.com',
    work: [{ company: '模拟智能装备', title: '视觉算法实习生', start: '2025-03', end: '2025-09', bullets: ['负责缺陷检测模型训练，召回率提升到95%', '编写产线部署脚本'] }],
    projects: [{ name: '仓储 AGV 调度', bullets: ['实现 A* 路径规划'] }],
    skills: [{ name: 'python' }, { name: 'ROS2' }],
    evidence: [{ fileName: 'AGV 答辩视频', type: 'video', location: 'E:/毕设/答辩.mp4', proves: '系统现场演示', project: '仓储 AGV 调度' }] });
  it('previews duplicates, conflicts and new items without touching base', () => {
    const b = base(); const snap = JSON.stringify(b);
    const plan = buildImportPlan(b, inc(), [{ field: 'projects[0].start', note: '原文未写时间' }]);
    expect(JSON.stringify(b)).toBe(snap);
    const w = plan.items.find((x) => x.section === 'work')!;
    expect(w.status).toBe('conflict');
    expect(w.conflicts.map((c) => c.field)).toEqual(['end']);
    expect(w.conflicts[0].useNew).toBe(false);
    expect(w.newPoints).toEqual(['编写产线部署脚本']);
    expect(w.samePoints).toBe(1);
    expect(plan.items.find((x) => x.title === '仓储 AGV 调度')!.status).toBe('new');
    expect(plan.items.find((x) => x.title === '仓储 AGV 调度')!.uncertain[0]).toContain('原文未写时间');
    expect(plan.items.find((x) => x.title === 'python')!.status).toBe('duplicate');
    const phone = plan.basics.find((x) => x.path === 'contacts.phone')!;
    expect(phone.useNew).toBe(false); // 冲突默认保留旧值
    expect(plan.basics.find((x) => x.path === 'contacts.email')!.useNew).toBe(true); // 空白则填入
  });
  it('applies selective merge, keeps old values on conflict, links evidence, flags uncertain', () => {
    const b = base(); const i = inc();
    const plan = buildImportPlan(b, i, [{ field: 'projects[0].start', note: '原文未写时间' }]);
    plan.items.find((x) => x.title === 'ROS2')!.action = 'skip';
    const out = normalizeProfile(applyImportPlan(b, i, plan));
    expect(out.work.length).toBe(1);
    expect(out.work[0].end).toBe('2025-08');
    expect(out.work[0].bullets.length).toBe(2);
    expect(out.profile.contacts.phone).toBe('13800000000');
    expect(out.profile.contacts.email).toBe('mock@example.com');
    expect(out.skills.map((s) => s.name.zh || s.name.en)).toEqual(['Python']);
    const agv = out.projects.find((p) => p.name.zh === '仓储 AGV 调度')!;
    expect(agv.uncertain?.[0]).toContain('原文未写时间');
    expect(out.evidence.length).toBe(1);
    expect(out.evidence[0].projectIds).toEqual([agv.id]);
    expect(out.evidence[0].confirmed).toBe(false);
    expect(out.evidence[0].locationKind).toBe('note');
    expect(agv.evidenceIds).toEqual([out.evidence[0].id]);
    // 原有条目的 sourceId（要点 id）不变，可追溯
    expect(out.work[0].bullets[0].id).toBe(b.work[0].bullets[0].id);
    // 用户选择用新值
    plan.items.find((x) => x.section === 'work')!.conflicts[0].useNew = true;
    expect(applyImportPlan(b, i, plan).work[0].end).toBe('2025-09');
  });
  it('mergeProfiles keeps evidence across chunks', () => {
    const a = rawToProfile({ projects: [{ name: 'X 项目' }] });
    const c = rawToProfile({ projects: [{ name: 'X 项目' }], evidence: [{ fileName: '论文', type: 'paper', project: 'X 项目' }] });
    const m = mergeProfiles(a, c);
    expect(m.evidence.length).toBe(1);
    expect(m.evidence[0].projectIds).toEqual([m.projects[0].id]);
  });
});

describe('rollback', () => {
  it('a failing apply leaves the original profile untouched', () => {
    const b = base(); const snap = JSON.stringify(b);
    const bad = { items: [{ key: 'x', section: 'nope', incomingId: 'a', title: '', status: 'new', similarity: 0, conflicts: [], newPoints: [], samePoints: 0, uncertain: [], action: 'add' }], basics: [], otherUncertain: [] };
    expect(() => applyImportPlan(b, base(), bad as never)).toThrow();
    expect(JSON.stringify(b)).toBe(snap);
  });
});
