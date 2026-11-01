/** v1.11 P0-3：求职信 / 自我介绍逐句核对的句子分类（A 候选人事实 / B JD 事实 / C 学习意愿 / D 未来计划 / E 限定保留）回归 */
import { describe, expect, it } from 'vitest';
import { otoscopeEngineer, jobs111 } from './helpers/v111Fixture';
import { buildKitContext, verifiedOnly, verifyKit, verifySentence } from '../src/quality/kitVerify';

const P = otoscopeEngineer();
const J = jobs111();
const ctx = (k: 'A' | 'B' | 'C') => buildKitContext(P, J[k], new Date('2026-11-01'));
const check = (s: string, l: 'zh' | 'en', k: 'A' | 'B' | 'C' = 'A') => verifySentence(s, l, 'coverLetter', ctx(k));

describe('v1.11 kitVerify — 合理句子不再误杀（含 v1.10.1 真实运行里被误拦的句子）', () => {
  it.each([
    // C 类：坦白没做过 + 学习意愿
    ['I have not yet worked with these, but I am eager to learn them quickly.', 'en', 'learning'],
    ['I have not yet worked with NX or ANSYS, but I am eager to learn them.', 'en', 'learning'],
    ["I haven't used NX yet, and I would like to learn it after joining.", 'en', 'learning'],
    ['我还没有使用过 NX 和 ANSYS，希望入职后尽快学习。', 'zh', 'learning'],
    ['我求职方向是机械设计，入职后想学 NX、公差分析和有限元仿真。', 'zh', null],
    ['After joining, I am eager to learn NX, tolerance analysis and FEA to better meet the role\'s requirements.', 'en', null],
    // B 类：复述 JD 职责
    ['The role involves mechanical design of motor and generator components using 3D CAD, with NX preferred.', 'en', 'jd'],
    ['该岗位负责电机和发电机零部件的机械设计，并为装配和制造提供 DFM 反馈。', 'zh', 'jd'],
    ['The position also requires writing technical documentation in English and communicating with global teams.', 'en', 'jd'],
    // D 类：未来计划 / 兴趣
    ['I am particularly interested in the mechanical design of electric motors.', 'en', 'future'],
    ['我对电机和发电机的结构设计很感兴趣。', 'zh', 'future'],
    ['I hope to grow into a mechanical design engineer who can own a full component design.', 'en', 'future'],
    // A 类：v1.10.1 真实运行中被误拦、实际有资料支撑的句子
    ['我预计 2027 年 6 月获得轮机工程专业学士学位，能使用 SolidWorks、AMESim、Visual Components、RobotStudio、Python 和 MATLAB，并撰写英文技术文档。', 'zh', 'self'],
    ['In the Digital Otoscope Prototype student innovation project, I was a team member responsible for structural design.', 'en', 'self'],
    ['我最相关的经历是数字耳镜原型开发这个大学生创新项目，我是项目成员，负责结构设计。', 'zh', 'self'],
    ['I designed the handle, lens-module housing and snap-fit structure in SolidWorks, over 4 design iterations.', 'en', 'self'],
    ['在机器人仿真课程设计中，我用 RobotStudio 完成了搬运路径的离线编程与仿真（仅仿真）。', 'zh', 'self'],
  ] as const)('%s', (s, l, kind) => {
    const r = check(s, l);
    expect(r.reasons).toEqual([]);
    if (kind) expect(r.kind).toBe(kind);
    if (r.kind === 'self') expect(r.factIds.length).toBeGreaterThan(0);
  });
});

describe('v1.11 kitVerify — 无法核实的经历仍被拦下（原因清楚）', () => {
  it.each([
    ['I have hands-on experience with NX from my otoscope project.', 'en', 'A', /NX/],
    ['I have not yet worked with NX, but I am familiar with ANSYS.', 'en', 'A', /ANSYS/],
    ['我没有用过 NX，但对 ANSYS 已有一定基础。', 'zh', 'A', /ANSYS/],
    ['I hope to continue designing generator housings as I did in my internship.', 'en', 'A', /无法追溯|没有|找不到/],
    ['我在数字耳镜项目中独立完成了全部结构设计和量产导入。', 'zh', 'A', /参与程度|新增|部署|产线|找不到/],
    ['In the robot course, I deployed the pick-and-place path on a physical robot.', 'en', 'C', /部署|限定/],
    ['The role requires 5 years of NX experience, which I already have.', 'en', 'A', /NX|5/],
    ['我已经毕业并获得了轮机工程学士学位。', 'zh', 'A', /学位尚未授予/],
    ['The role involves Siemens Teamcenter PLM workflows.', 'en', 'A', /JD 里没有/],
    ['该岗位要求 8 年电机设计经验。', 'zh', 'A', /JD 里没有的数字/],
    ['I am interested in motor design and already have a solid foundation in NX.', 'en', 'A', /NX/],
  ] as const)('%s', (s, l, k, re) => {
    const r = check(s, l, k);
    expect(r.ok).toBe(false);
    expect(r.reasons.join('；')).toMatch(re);
  });

  it('E 类：限定词被删时仍然拦下（仿真写成实机）', () => {
    const r = check('我用 RobotStudio 完成了搬运路径的离线编程，并在实体机器人上运行。', 'zh', 'C');
    expect(r.ok).toBe(false);
  });
});

describe('v1.11 kitVerify — 整篇与精简版', () => {
  const kit = {
    coverLetter: {
      zh: '您好！我应聘贵公司机械设计工程师岗位。该岗位负责电机和发电机零部件的机械设计。在数字耳镜原型开发项目中，我用 SolidWorks 设计手柄、镜头模组外壳和卡扣结构，共迭代 4 版。我用光固化 3D 打印制作原型并完成装配，根据装配测试修正卡扣强度与线缆走线问题。我还没有使用过 NX，希望入职后尽快学习。谢谢！',
      en: 'Dear Hiring Manager, I am writing to apply for the Mechanical Design Engineer position. The role involves mechanical design of motor and generator components using 3D CAD. In the Digital Otoscope Prototype project, I designed the handle, lens-module housing and snap-fit structure in SolidWorks over 4 design iterations. I built prototypes by resin 3D printing and fixed snap-fit strength and cable-routing issues found in assembly tests. I have not yet worked with NX, but I am eager to learn it. Sincerely, Yifan Shen',
    },
    selfIntro: {
      zh: '我是沈一帆，虚构海事大学轮机工程专业本科在读。我在数字耳镜项目中用 SolidWorks 设计结构并迭代 4 版。我用光固化 3D 打印制作原型并完成装配。我对电机结构设计很感兴趣。',
      en: 'I am Yifan Shen, a Marine Engineering undergraduate at Fictional Maritime University. In the digital otoscope project I designed the structure in SolidWorks over 4 iterations. I built prototypes by resin 3D printing and assembled them. I am particularly interested in motor structural design.',
    },
  };
  it('合理整篇全部通过，且每句都有类型', () => {
    const v = verifyKit(kit, ctx('A'));
    expect(v.issues).toEqual([]);
    expect(v.trace.some((t) => t.kind === 'jd')).toBe(true);
    expect(v.trace.some((t) => t.kind === 'learning')).toBe(true);
    expect(v.trace.some((t) => t.kind === 'future')).toBe(true);
  });
  it('精简版只保留通过的句子；编造句不会出现在「通过」里', () => {
    const bad = { ...kit, coverLetter: { ...kit.coverLetter, en: kit.coverLetter.en + ' I also have 3 years of NX experience at a motor factory.' } };
    const v = verifyKit(bad, ctx('A'));
    expect(v.passed).toBe(false);
    const safe = verifiedOnly(bad as never, ctx('A'));
    expect(safe?.coverLetter.en).not.toMatch(/NX experience/);
  });
});
