import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import type { ProfileDoc, ResumeDoc, Settings } from '../src/types';
import { fictionalEngineer, jobs } from './helpers/v110Fixture';
import { buildKitContext, kitExportState, kitHash, makeKitReview, verifiedOnly, verifyKit, verifySentence } from '../src/quality/kitVerify';
import { generateCoverKit, generatePrep, layoutToText } from '../src/ai/extras';
import { generateResume, generateRules } from '../src/ai/generate';
import { buildLayout } from '../src/render/layout';
import { BUILTIN_TEMPLATES } from '../src/templates';

const S = { demoMode: false, baseUrl: 'https://api.deepseek.com', apiKey: 'sk-FAKE-test', model: 'deepseek-flash' } as unknown as Settings;
const mock = chatJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mock.mockReset());
const P = fictionalEngineer();
const J = jobs();
const ctx = (k: 'A' | 'B' | 'C') => buildKitContext(P, J[k], new Date('2026-11-01'));
const check = (s: string, l: 'zh' | 'en', k: 'A' | 'B' | 'C') => verifySentence(s, l, 'coverLetter', ctx(k));

describe('v1.10.1 sentence-level fact verification — counter-examples are caught', () => {
  it.each([
    ['我熟悉 SolidWorks 和 NX，能完成结构建模。', 'zh', 'A', /NX/],
    ['我对 NX 有一定基础。', 'zh', 'A', /NX/],
    ['I am familiar with NX and SolidWorks.', 'en', 'A', /NX/],
    ['我有 ROS 的相关基础。', 'zh', 'C', /ROS/],
    ['I have a solid foundation in ROS.', 'en', 'C', /ROS/],
    ['我了解 ROS，也希望入职后继续学习。', 'zh', 'C', /ROS/],
    ['我在 RobotStudio 中参与完成了六轴机械臂抓取路径的离线编程，并在产线上完成现场调试。', 'zh', 'C', /实机部署|限定|现场/],
    ['I deployed the six-axis arm grasping path from RobotStudio on a real robot.', 'en', 'C', /部署|限定/],
    ['我在 RobotStudio 中负责六轴机械臂抓取路径的离线编程与仿真。', 'zh', 'C', /参与程度/],
    ['I led the offline programming and simulation of a six-axis arm grasping path in RobotStudio.', 'en', 'C', /参与程度/],
    ['在虚构动力设备公司实习期间，我主导了发电机支架的 SolidWorks 结构设计。', 'zh', 'A', /参与程度/],
    ['我已毕业于虚构海事大学轮机工程专业。', 'zh', 'A', /学位尚未授予/],
    ['I graduated from Fictional Maritime University with a degree in Marine Engineering.', 'en', 'A', /学位尚未授予/],
    ['我是船舶与海洋工程专业的应届生。', 'zh', 'A', /船舶与海洋工程/],
    ['I study Mechanical Engineering at Fictional Maritime University.', 'en', 'A', /Mechanical Engineering/],
    ['我在虚构重工集团实习时完成了 5 轮样机测试。', 'zh', 'A', /虚构重工集团|数字|找不到/],
    ['I improved assembly efficiency by 30% during my internship at Fictional Power Equipment Co.', 'en', 'A', /数字|30/],
    ['我比较擅长把复杂问题拆开逐项核对。', 'zh', 'A', /无法追溯/],
    ['这段经历让我掌握了 ROS 的基本用法。', 'zh', 'C', /ROS/],
    ['该岗位需要 ROS，我在项目中已经用 ROS 做过运动学验证。', 'zh', 'C', /ROS/],
    ['The role asks for kinematics, and I have hands-on experience with kinematic verification in ROS.', 'en', 'C', /ROS/],
    ['与我做过的六轴机械臂实机调试经验相关。', 'zh', 'C', /部署|现场|找不到|限定/],
  ] as const)('%s', (s, l, k, re) => {
    const r = check(s, l, k);
    expect(r.ok).toBe(false);
    expect(r.reasons.join('；')).toMatch(re);
  });
});

describe('v1.10.1 sentence-level fact verification — supported sentences pass with a trace', () => {
  it.each([
    ['您好！', 'zh', 'A'],
    ['我是林小舟，虚构海事大学轮机工程专业本科生，预计 2026 年 12 月获得学位。', 'zh', 'A'],
    ['在虚构动力设备公司实习期间，我协助完成了发电机支架的 SolidWorks 结构设计，并参与了 2 轮原型验证。', 'zh', 'A'],
    ['NX 我目前还没有用过，希望入职后尽快学习。', 'zh', 'A'],
    ['我在 RobotStudio 中参与了六轴机械臂抓取路径的离线编程与仿真，仅在仿真中验证，未上实机。', 'zh', 'C'],
    ['贵岗位要求熟悉机器人运动学和 ROS，这正是我希望在工作中系统学习的方向。', 'zh', 'C'],
    ['I am eager to learn ROS on the job.', 'en', 'C'],
    ['In a camera module project, I took part in building an image-quality test flow and measured MTF50 and SNR per ISO 12233.', 'en', 'B'],
    ['I wrote calibration and distortion-analysis scripts in Python and OpenCV and completed 30 test runs at room temperature.', 'en', 'B'],
    ['I am a Marine Engineering student at Fictional Maritime University, with my degree expected in December 2026.', 'en', 'A'],
    ['Sincerely,', 'en', 'A'],
    // 真实 DeepSeek 第 1 轮里被旧规则误拦的正常句子（回归用例）
    ['希望有机会进一步了解岗位，并愿意学习 NX 等工具。', 'zh', 'A'],
    ['我应聘机械结构设计工程师岗位。', 'zh', 'A'],
    ['该岗位涉及发电机结构设计与 CAD 建模、原型样机装配与验证，与我在结构设计和原型制作方面的实践方向相关。', 'zh', 'A'],
    ['I study Marine Engineering at Fictional Maritime University and expect my degree in December 2026.', 'en', 'A'],
    ['I am writing to apply for the Machine Vision Test Engineer position.', 'en', 'B'],
    ["This gave me practical involvement in the steps of image-quality testing, which connects to the role's requirements for Python, OpenCV and image quality testing.", 'en', 'B'],
    ['I understand the role requires robot offline programming, RobotStudio, kinematics and ROS.', 'en', 'C'],
    ['我了解到该岗位需要机器人离线编程、RobotStudio、运动学和ROS等能力，其中RobotStudio我在项目中使用过，运动学和ROS则是我希望入职后重点学习的方向。', 'zh', 'C'],
    ['希望能有机会参加面试，进一步介绍我的项目经历。', 'zh', 'C'],
  ] as const)('%s', (s, l, k) => {
    const r = check(s, l, k);
    expect(r.reasons).toEqual([]);
    if (r.kind === 'self') expect(r.factIds.length).toBeGreaterThan(0);
  });
  it('trace links self-claims to concrete profile entries', () => {
    const r = check('在虚构动力设备公司实习期间，我协助完成了发电机支架的 SolidWorks 结构设计，并参与了 2 轮原型验证。', 'zh', 'A');
    expect(r.kind).toBe('self'); expect(r.factIds[0]).toMatch(/^work-1/);
  });
  it('JD-only skills are listed as gaps; profile skills are not', () => {
    expect(ctx('C').gapTerms).toContain('ROS'); expect(ctx('A').gapTerms).toContain('NX');
    expect(ctx('A').gapTerms).not.toContain('SolidWorks'); expect(ctx('C').gapTerms).not.toContain('RobotStudio');
  });
});

export const goodKit = {
  coverLetter: {
    zh: '您好！我是林小舟，虚构海事大学轮机工程专业本科生，预计 2026 年 12 月获得学位。在虚构动力设备公司实习期间，我协助完成了发电机支架的 SolidWorks 结构设计，并参与了 2 轮原型验证。课程项目中我用 SolidWorks 设计模块化夹具，迭代 3 版原型并用 3D 打印验证装配。NX 我目前还没有用过，希望入职后尽快学习。期待有机会与您进一步沟通。',
    en: 'Dear Hiring Manager, I am a Marine Engineering student at Fictional Maritime University, with my degree expected in December 2026. As an intern, I assisted with SolidWorks structural design of a generator bracket and took part in 2 rounds of prototype validation. In a course project, I designed a modular fixture in SolidWorks and iterated 3 prototypes. I am eager to learn NX on the job. Sincerely,',
  },
  selfIntro: {
    zh: '您好，我是林小舟，虚构海事大学轮机工程专业本科生，预计 2026 年 12 月获得学位。实习期间我协助完成发电机支架的 SolidWorks 结构设计，并参与了 2 轮原型验证。课程项目中我用 SolidWorks 设计模块化夹具，迭代 3 版原型。谢谢！',
    en: 'Hello, I am a Marine Engineering student at Fictional Maritime University, with my degree expected in December 2026. As an intern, I assisted with SolidWorks structural design of a generator bracket. In a course project, I designed a modular fixture in SolidWorks and iterated 3 prototypes. Thank you.',
  },
};
const badKit = {
  coverLetter: { zh: goodKit.coverLetter.zh.replace('NX 我目前还没有用过，希望入职后尽快学习。', '我熟悉 NX，并已毕业于虚构海事大学。'), en: goodKit.coverLetter.en.replace('I am eager to learn NX on the job.', 'I have a solid foundation in NX.') },
  selfIntro: goodKit.selfIntro,
};

describe('v1.10.1 generateCoverKit — retry with feedback, block, never claim 100%', () => {
  it('good draft is verified on the first call; prompt separates facts / JD / gaps', async () => {
    mock.mockResolvedValue(goodKit);
    const k = await generateCoverKit(S, P, J.A, generateRules(P, J.A, 'zh'));
    expect(verifyKit(goodKit, ctx('A')).issues).toEqual([]);
    expect(k.quality.status).toBe('verified');
    const prompt = mock.mock.calls[0][1][1].content as string;
    expect(prompt).toContain('【A 候选人事实'); expect(prompt).toContain('【B 岗位需求'); expect(prompt).toMatch(/【C[^\n]*\n[^\n]*"NX"/);
    expect(prompt.indexOf('【A')).toBeLessThan(prompt.indexOf('【B'));
  });
  it('bad → good: second call gets sentence-level feedback, result verified', async () => {
    mock.mockResolvedValueOnce(badKit).mockResolvedValueOnce(goodKit);
    const k = await generateCoverKit(S, P, J.A, generateRules(P, J.A, 'zh'));
    expect(mock).toHaveBeenCalledTimes(2);
    expect(k.quality.status).toBe('verified');
    const fb = mock.mock.calls[1][1][1].content as string;
    expect(fb).toContain('上一版有句子未通过核对'); expect(fb).toContain('我熟悉 NX'); expect(fb).toContain('学位尚未授予');
    expect(k.quality.caught[0].length).toBeGreaterThan(0);
  });
  it('bad twice: blocked, reasons name the sentence, safe version keeps verified sentences only', async () => {
    mock.mockResolvedValue(badKit);
    const k = await generateCoverKit(S, P, J.A, generateRules(P, J.A, 'zh'));
    expect(mock).toHaveBeenCalledTimes(2);
    expect(k.quality.status).toBe('blocked');
    expect(k.quality.issues.some((x) => x.includes('我熟悉 NX') && x.includes('NX'))).toBe(true);
    expect(k.quality.issues.some((x) => x.includes('foundation in NX'))).toBe(true);
    expect(k.quality.trace.filter((t) => !t.ok).length).toBeGreaterThanOrEqual(2);
    const safe = k.quality.safe!;
    expect(safe).not.toBeNull();
    expect(safe.coverLetter.zh).not.toContain('NX'); expect(safe.coverLetter.en).not.toContain('NX');
    expect(verifyKit(safe, ctx('A')).passed).toBe(true);
  });
  it.each([
    ['C', '我在 RobotStudio 中参与了六轴机械臂抓取路径的离线编程与仿真，并有 ROS 相关基础。'],
    ['C', '我在 RobotStudio 中主导完成了六轴机械臂抓取路径的离线编程，并在实机上完成部署。'],
    ['B', '在相机模组项目中，我带领团队把测试系统部署到了生产线上。'],
  ] as const)('injected miswrite for %s is intercepted: %s', async (k, bad) => {
    const kit = { coverLetter: { zh: goodKit.coverLetter.zh.replace('NX 我目前还没有用过，希望入职后尽快学习。', bad), en: goodKit.coverLetter.en }, selfIntro: goodKit.selfIntro };
    mock.mockResolvedValue(kit);
    const out = await generateCoverKit(S, P, J[k], generateRules(P, J[k], 'zh'));
    expect(out.quality.status).toBe('blocked');
    expect(out.quality.issues.join('\n')).toContain(bad.slice(0, 20));
  });
  it('verifiedOnly returns null when too little verified content remains', () => {
    const k = { coverLetter: { zh: '我熟悉 NX。我有 ROS 基础。', en: 'I know NX.' }, selfIntro: { zh: '您好。', en: 'Hi.' } };
    expect(verifiedOnly(k, ctx('A'))).toBeNull();
  });
});

describe('v1.10.1 export gating and old data', () => {
  const R = { id: 'resume-1', createdAt: '2026-11-01T00:00:00Z', generatedBy: 'ai' as const };
  const ex = (k: typeof goodKit) => ({ coverLetter: { ...k.coverLetter }, selfIntro: { ...k.selfIntro } });
  it('verified text is exportable; old extras without kitReview are re-checked locally', () => {
    expect(kitExportState(P, J.A, ex(goodKit)).exportable).toBe(true);
    expect(kitExportState(P, J.A, undefined).hasText).toBe(false);
  });
  it('unverified text is blocked until a manual override for that exact text', () => {
    const e = ex(badKit) as NonNullable<ResumeDoc['extras']>;
    expect(kitExportState(P, J.A, e).exportable).toBe(false);
    e.kitReview = makeKitReview(P, J.A, R, e, 2);
    expect(kitExportState(P, J.A, e, R).exportable).toBe(true);
  });
  describe('override invalidation', () => {
    const setup = () => { const e = ex(badKit) as NonNullable<ResumeDoc['extras']>; e.kitReview = makeKitReview(P, J.A, R, e, 2); return e; };
    it('unchanged profile / job / resume / text stays valid (even re-derived objects)', () => {
      const e = setup();
      expect(kitExportState(structuredClone(P), structuredClone(J.A), e, structuredClone(R)).overridden).toBe(true);
    });
    it('(a) a relevant profile fact edited → invalid', () => {
      const e = setup(); const p2 = structuredClone(P); p2.projects[0].bullets[0].zh += '（改）';
      expect(kitExportState(p2, J.A, e, R).exportable).toBe(false);
      const p3 = structuredClone(P); p3.education[0].expectedConferralDate = '2027-06';
      expect(kitExportState(p3, J.A, e, R).overridden).toBe(false);
    });
    it('(b) JD switched or edited → invalid', () => {
      const e = setup();
      expect(kitExportState(P, J.B, e, R).overridden).toBe(false);
      expect(kitExportState(P, { ...J.A, rawText: J.A.rawText + '\n熟悉 CATIA' }, e, R).overridden).toBe(false);
      expect(kitExportState(P, { ...J.A, mustHave: [...J.A.mustHave, { zh: 'CATIA', en: 'CATIA' }] }, e, R).overridden).toBe(false);
    });
    it('(c) cover letter or intro edited → invalid', () => {
      const e = setup(); e.coverLetter!.zh += '我还精通 CATIA。';
      expect(kitExportState(P, J.A, e, R).exportable).toBe(false);
      const e2 = setup(); e2.selfIntro!.en += ' Extra.';
      expect(kitExportState(P, J.A, e2, R).overridden).toBe(false);
    });
    it('(d) résumé regenerated for the job → invalid', () => {
      const e = setup();
      expect(kitExportState(P, J.A, e, { ...R, id: 'resume-new', createdAt: '2026-11-02T00:00:00Z' }).overridden).toBe(false);
    });
    it('old override without fingerprints is treated as invalid', () => {
      const e = ex(badKit) as NonNullable<ResumeDoc['extras']>;
      e.kitReview = { overrideAt: '2026-11-01T00:00:00Z', textHash: kitHash(e), issues: 2 };
      expect(kitExportState(P, J.A, e, R).overridden).toBe(false);
    });
  });
});

describe('v1.10.1 prep directions never claim skills', () => {
  it('drops items that say the candidate already has the skill', async () => {
    mock.mockResolvedValue({ items: [
      { area: { zh: 'ROS 与运动学', en: 'ROS & kinematics' }, why: { zh: '岗位要求熟悉机器人运动学、ROS，需能讲清基本概念。', en: 'The JD asks for kinematics and ROS.' }, source: '熟悉机器人运动学、ROS' },
      { area: { zh: '离线编程', en: 'Offline programming' }, why: { zh: '你已具备 RobotStudio 经验，与岗位匹配。', en: 'You already have RobotStudio experience.' }, source: '机器人离线编程与仿真（RobotStudio）' },
    ] });
    const q = await generatePrep(S, J.C);
    expect(q.map((x) => x.area.zh)).toEqual(['ROS 与运动学']);
  });
});

describe('v1.10.1 resume: no keyword-injected tools, degree / major exact', () => {
  const txt = (p: ProfileDoc, r: ResumeDoc, l: 'zh' | 'en') => layoutToText(buildLayout(p, BUILTIN_TEMPLATES[0], l, r));
  it('AI rewrite that injects NX / ROS is rejected; AI summary with another major is dropped; translation with another major is not used', async () => {
    mock.mockResolvedValueOnce({ selection: { work: ['work-1'], projects: ['proj-1', 'proj-3'], education: ['edu-1'], skills: [], certificates: [] }, matchScore: 70, gaps: [], items: [
      { sourceId: 'work-1-b1', text: '实习期间协助完成发电机支架的 SolidWorks 与 NX 结构设计；参与 2 轮原型验证并整理装配图纸。' },
      { sourceId: 'proj-3-b1', text: '在 RobotStudio 与 ROS 中参与六轴机械臂抓取路径的离线编程与仿真（仅仿真，未上实机）。' },
      { sourceId: 'summary', text: '船舶与海洋工程专业应届生，熟悉 NX 与 ROS。' },
    ] });
    mock.mockImplementation(async (_s: unknown, msgs: { content: string }[]) => {
      const c = msgs?.find((m) => m.content.includes('"items"'))?.content; if (!c) return {};
      let items: { sourceId: string; text: string }[] = [];
      try { items = JSON.parse(c.slice(c.indexOf('{"glossary'))).items; } catch { return {}; }
      return { items: items.map((i) => ({ sourceId: i.sourceId, text: i.sourceId.startsWith('edu') || i.sourceId === 'summary' ? 'Naval Architecture and Ocean Engineering graduate' : "Translated bullet" })) };
    });
    const r = await generateResume(S, P, J.A, 'zh', 1);
    const zh = txt(P, r, 'zh'), en = txt(P, r, 'en');
    expect(zh).not.toMatch(/\bNX\b|\bROS\b/); expect(en).not.toMatch(/\bNX\b|\bROS\b/);
    expect(zh).not.toContain('船舶与海洋工程');
    expect(en).not.toContain('Naval Architecture');
    expect(en).toContain("Translated bullet"); // 证明本地化 mock 确实生效
    expect(zh).toContain('轮机工程'); expect(en).toContain('Marine Engineering');
  });
  it('rules path: degree and major are copied exactly in zh and en for all three jobs', () => {
    for (const k of ['A', 'B', 'C'] as const) {
      const r = generateRules(P, J[k], 'zh');
      expect(txt(P, r, 'zh')).toContain('轮机工程'); expect(txt(P, r, 'en')).toContain('Marine Engineering');
      expect(txt(P, r, 'zh')).not.toMatch(/\bNX\b|\bROS\b/);
    }
  });
});
