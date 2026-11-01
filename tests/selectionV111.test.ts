import { describe, expect, it } from 'vitest';
import { otoscopeEngineer, jobs111 } from './helpers/v111Fixture';
import { generateRules } from '../src/ai/generate';
import { planResume } from '../src/ai/relevance';
import { analyzeJd, coverage } from '../src/ai/evidence';
import { focusSummary, guardSummary } from '../src/ai/summary';

const P = otoscopeEngineer();
const J = jobs111() as Record<'A' | 'B' | 'C', Parameters<typeof generateRules>[1]>;
const ids = (k: 'A' | 'B' | 'C', l: 'zh' | 'en' = 'zh') => planResume(P, J[k], l, 1).entries.flatMap((e) => e.bulletIds);
const text = (k: 'A' | 'B' | 'C', l: 'zh' | 'en') => { const r = generateRules(P, J[k], l, 1); return { r, all: r.items.map((i) => i[l]).join('\n'), summary: r.items.find((i) => i.sourceId === 'summary')?.[l] ?? '' }; };

describe('v1.11 staged selection (fictional fixture)', () => {
  it('ABB mechanical: design/prototype first, no imaging params, no author list, no 英文技术文档 in summary', () => {
    const b = ids('A');
    expect(b.slice(0, 2)).toEqual(['proj-oto-b1', 'proj-oto-b2']);
    expect(b).not.toContain('proj-oto-b4');
    expect(b).not.toContain('proj-oto-b3');
    for (const l of ['zh', 'en'] as const) { const t = text('A', l); expect(t.summary).not.toMatch(/英文技术文档|technical documentation/i); expect(t.all).not.toMatch(/MTF50 0\.32/); }
    const pl = planResume(P, J.A, 'en', 1);
    expect(pl.skills).toContain('sk-sw');
    expect(pl.skills).not.toContain('sk-doc');
  });
  it('Vision: imaging test + parameters high, mechanical design low', () => {
    const b = ids('B');
    const top = planResume(P, J.B, 'zh', 1).ranked!.filter((r) => r.section !== 'education');
    expect(top[0].id).toBe('proj-oto-b3');
    expect(top.findIndex((r) => r.id === 'proj-oto-b2')).toBeGreaterThan(3);
    expect(b).toContain('proj-oto-b4');
    expect(b).not.toContain('proj-hyd-b1');
    expect(b).not.toContain('proj-rob-b1');
  });
  it('Robotics: Visual Components / RobotStudio high, discussed-only idea dropped', () => {
    const pl = planResume(P, J.C, 'zh', 1);
    expect(pl.entries.find((e) => e.kind === 'projects')?.id).toBe('proj-rob');
    expect(pl.entries.flatMap((e) => e.bulletIds)).not.toContain('proj-rob-b3');
    expect(pl.dropped?.some((d) => d.id === 'proj-rob-b3' && /讨论/.test(d.reason))).toBe(true);
    expect(pl.skills).toEqual(expect.arrayContaining(['sk-vc', 'sk-rs']));
  });
  it('clerical, irrelevant electives and unconfirmed GPA are left out everywhere', () => {
    for (const k of ['A', 'B', 'C'] as const) { const b = ids(k); for (const x of ['proj-oto-b6', 'work-1-b2', 'proj-club-b1', 'edu-1-b1', 'edu-1-b3']) expect(b).not.toContain(x); }
  });
  it('JD-only tools never appear in the résumé; reported as gaps instead', () => {
    const { r, all } = text('A', 'en');
    expect(all).not.toMatch(/\bNX\b|ANSYS/);
    expect(r.gaps.join(' ')).toMatch(/NX/);
    expect(r.matchScore).toBeGreaterThan(0);
    expect(r.matchScore).toBeLessThanOrEqual(100);
  });
  it('focusSummary keeps facts and qualifiers of kept clauses; tool list limited to chosen skills', () => {
    const m = analyzeJd(J.B);
    const s = focusSummary(P.profile.summary.zh!, 'zh', m, ['SolidWorks', 'Python', 'MATLAB'])!;
    expect(s).toMatch(/成像测试/);
    expect(s).not.toMatch(/AMESim|英文技术文档/);
  });
  it('guardSummary rejects inflated or JD-only claims', () => {
    const o = P.profile.summary.zh!;
    expect(guardSummary(o, '精通 SolidWorks 结构设计。', 'zh', [], [])).not.toHaveLength(0);
    expect(guardSummary(o, '轮机工程本科在读，熟悉 NX 与 ANSYS。', 'zh', [], ['NX', 'ANSYS'])).not.toHaveLength(0);
    expect(guardSummary(o, '轮机工程专业本科在读，参与数字耳镜的结构设计与 3D 打印原型。', 'zh', [], [])).toHaveLength(0);
    expect(guardSummary(o, '轮机工程专业本科在读，完成机器人仿真与液压建模项目。', 'zh', [], []).join()).toMatch(/课程/);
  });
  it('coverage is local and deterministic', () => {
    const pl = planResume(P, J.C, 'zh', 1);
    expect(coverage(P, J.C, pl.model!, pl.ranked!, 'zh')).toEqual(coverage(P, J.C, pl.model!, pl.ranked!, 'zh'));
  });
});
