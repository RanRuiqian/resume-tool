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
  it('ABB mechanical: design/prototype first, no imaging params, no author list, fixed full personal summary', () => {
    const b = ids('A');
    expect(b.slice(0, 2)).toEqual(['proj-oto-b1', 'proj-oto-b2']);
    expect(b).not.toContain('proj-oto-b4');
    expect(b).not.toContain('proj-oto-b3');
    for (const l of ['zh', 'en'] as const) { const t = text('A', l); expect(t.summary).toBe(P.profile.summary[l]); expect(t.all).not.toMatch(/MTF50 0\.32/); }
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

import { stripAuthorList } from '../src/ai/evidence';
describe('v1.11 author list', () => {
  it('strips the full author list from a bullet but keeps 第一作者 / first author', () => {
    expect(stripAuthorList('以第一作者撰写会议论文《X》，已被会议录用（作者：沈一帆、赵明、钱晓、孙立）。')).toBe('以第一作者撰写会议论文《X》，已被会议录用。');
    expect(stripAuthorList('First author of the paper "X", accepted (authors: Yifan Shen, Ming Zhao, Xiao Qian, Li Sun).')).toBe('First author of the paper "X", accepted.');
  });
});

import { guardRewrite, truncatedNames } from '../src/quality/resumeGuard';
describe('v1.11 机构 / 会议名称不得被缩写', () => {
  it('flags 虚构国际医学工程会议 → 国际医学工程会议 and the English equivalent', () => {
    const zh = '以第一作者撰写会议论文《X》，已被虚构国际医学工程会议录用。';
    expect(guardRewrite(zh, '以第一作者撰写会议论文《X》，已被国际医学工程会议录用。', 'zh').some((r) => /名称被缩写/.test(r))).toBe(true);
    expect(truncatedNames(zh, '以第一作者撰写会议论文《X》，已被虚构国际医学工程会议录用。')).toEqual([]);
    const en = 'First author of the paper "X", accepted by the Fictional International Conference on Medical Engineering.';
    expect(truncatedNames(en, 'First author of "X", accepted by the International Conference on Medical Engineering.')).toEqual(['Fictional International Conference on Medical Engineering']);
    expect(truncatedNames(en, en)).toEqual([]);
    expect(truncatedNames('在虚构船舶修造有限公司参与主机检修。', '于虚构船舶修造有限公司参与主机检修。')).toEqual([]);
  });
});
