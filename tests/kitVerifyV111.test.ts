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

describe('v1.11 kitVerify — 本轮真实运行发现的误杀（exposure 只作用于本分句）', () => {
  it('passes a learning clause after an exposure clause about a profile-backed experience', () => {
    const v = check('In a digital otoscope prototype project, I took part in imaging tests, which gave me direct exposure to imaging-quality test workflows and motivated me to learn more about image acquisition and distortion analysis.', 'en', 'B');
    expect(v.reasons.filter((r) => /distortion|image acquisition/.test(r))).toEqual([]);
  });
  it('passes 希望有机会参与…并在工作中学习 X', () => {
    const v = check('希望有机会参与机器人工作站现场调试，并在工作中学习 ROS 与路径规划。', 'zh', 'C');
    expect(v.reasons.filter((r) => /ROS|路径规划|现场调试/.test(r))).toEqual([]);
  });
  it('still blocks a gap dressed up as basis, even when a learning phrase follows', () => {
    expect(check('I have basic knowledge of ROS and want to learn more about it.', 'en', 'C').ok).toBe(false);
    expect(check('I am familiar with and want to learn more about ROS.', 'en', 'C').ok).toBe(false);
    expect(check('我有 ROS 基础，希望入职后继续学习。', 'zh', 'C').ok).toBe(false);
  });
});

describe('v1.11 kitVerify — 第二轮真实运行的误杀', () => {
  it('「我了解岗位需要 X，希望入职后学习」不是伪装基础', () => {
    const v = check('我了解岗位需要Python自动化测试脚本与畸变等测试项目，希望入职后学习这些内容。', 'zh', 'B');
    expect(v.reasons.filter((r) => /畸变/.test(r))).toEqual([]);
  });
  it('公司简称（去掉「有限」）不算资料中没有的机构；编造的机构仍拦', () => {
    expect(check('此外，我在船舶修造公司做过轮机实习生，参与主机与辅机拆装检修。', 'zh', 'B').reasons.filter((r) => /船舶修造公司/.test(r))).toEqual([]);
    expect(check('此外，我在远洋航运公司做过轮机实习生，参与主机与辅机拆装检修。', 'zh', 'B').ok).toBe(false);
  });
});

describe('v1.11 kitVerify — 第三轮真实运行的误杀', () => {
  it('field of view 不是「现场」', () => {
    const v = check('I also took part in building the imaging test flow, measuring MTF50 and SNR per ISO 12233 to compare 2 lens modules, with a 70° field of view, 10–30 mm working distance, 500 lux illumination and 10 ms exposure.', 'en', 'B');
    expect(v.reasons.filter((r) => /现场/.test(r))).toEqual([]);
  });
  it('gain experience in X 是学习意愿；I have experience in X 仍拦', () => {
    expect(check('I am eager to learn ROS and gain experience in on-site commissioning of robot cells.', 'en', 'C').reasons.filter((r) => /commissioning|ROS/.test(r))).toEqual([]);
    expect(check('I have experience in ROS and want to learn more.', 'en', 'C').ok).toBe(false);
  });
});

describe('v1.11 kitVerify — 「which I have not yet worked with」不是声称具备', () => {
  it('passes the honest sentence, still blocks the possessive one', () => {
    expect(check('I understand the role also involves on-site commissioning and ROS, which I have not yet worked with; I am eager to learn them on the job.', 'en', 'C').ok).toBe(true);
    expect(check('The role requires ROS, which I already have.', 'en', 'C').ok).toBe(false);
  });
});
describe('v1.11 kitVerify — 被分号切开的诚实句', () => {
  it('「I understand the role also involves X and ROS, which I have not yet worked with;」通过', () => {
    expect(check('I understand the role also involves on-site commissioning and ROS, which I have not yet worked with;', 'en', 'C').ok).toBe(true);
    expect(check('I have used ROS and on-site commissioning tools in my projects.', 'en', 'C').ok).toBe(false);
  });
});
describe('v1.11 kitVerify — 第四轮真实运行的误杀', () => {
  it('一句合并两条事实时数字不误拦', () => {
    expect(check('同时，我参与搭建成像测试流程，按 ISO 12233 测量 MTF50 与 SNR，对比 2 款镜头模组的成像质量，测试条件为视场角 70°、工作距离 10–30 mm、照度 500 lux、曝光 10 ms，结果为 MTF50 0.32 cycles/pixel、SNR 38 dB。', 'zh', 'B').ok).toBe(true);
    expect(check('我参与搭建成像测试流程，按 ISO 12233 测量 MTF50 与 SNR，对比 5 款镜头模组。', 'zh', 'B').ok).toBe(false);
  });
  it('JD 复述被 together with 切开', () => {
    const v = check("The role's focus on building imaging-quality test flows for cameras and lens modules, together with image acquisition and test data analysis, connects directly with the imaging test work I took part in during a digital otoscope prototype project.", 'en', 'B');
    expect(v.reasons.filter((r) => /image acquisition/.test(r))).toEqual([]);
  });
  it('「我求职的方向是 X，希望入职后学习 Y」是学习意愿', () => {
    expect(check('我求职的方向是机器视觉测试，希望入职后学习图像采集、畸变测试和用Python写自动化测试脚本。', 'zh', 'B').ok).toBe(true);
    expect(check('我做过畸变测试，希望入职后学习图像采集。', 'zh', 'B').ok).toBe(false);
  });
});
describe('v1.11 kitVerify — 还没做过', () => {
  it('「X 这块我还没做过，希望入职后跟着学习」通过；「我做过 X」仍拦', () => {
    expect(check('我想往机器人应用方向发展，现场调试这块我还没做过，希望入职后跟着学习。', 'zh', 'C').ok).toBe(true);
    expect(check('我做过现场调试，希望入职后继续学习 ROS。', 'zh', 'C').ok).toBe(false);
  });
});
describe('v1.11 kitVerify — 第五轮真实运行的误杀', () => {
  it('「看到贵公司…岗位，需要 3D CAD…」是复述 JD', () => {
    expect(check('看到贵公司机械设计工程师岗位，需要3D CAD、原型制作与英文技术文档能力，这与我在结构设计和原型开发方面的经历方向一致，特此应聘。', 'zh', 'A').reasons.filter((r) => /CAD/.test(r))).toEqual([]);
  });
  it('学习对象里的「基础 / basic」不是伪装基础', () => {
    expect(check('我求职方向是机械设计，也希望入职后学习NX、公差分析和基础有限元仿真。', 'zh', 'A').ok).toBe(true);
    expect(check('I am eager to learn NX, tolerance analysis and basic FEA.', 'en', 'A').ok).toBe(true);
    expect(check('我有有限元仿真基础，也希望入职后学习NX。', 'zh', 'A').ok).toBe(false);
    expect(check('I have a basic foundation in FEA, and I am eager to learn NX.', 'en', 'A').ok).toBe(false);
  });
});
