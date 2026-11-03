import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import type { JobParse, Settings } from '../src/types';
import { fictionalEngineer, jobs } from './helpers/v110Fixture';
import { buildKitContext, verifySentence } from '../src/quality/kitVerify';
import { generatePrep, quotedFrom } from '../src/ai/extras';

// 2026-11-03 负责人实测：求职信把换说法的句子判为「资料中没有」、备考方向无输出。全部虚构资料。
const S = { demoMode: false, baseUrl: 'https://api.example.com', apiKey: 'sk-FAKE-test', model: 'm' } as unknown as Settings;
const mock = chatJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mock.mockReset());

const P = fictionalEngineer();
// 加一段在读硕士：学校带校区、学位名含专业（资料中 major 写的是英文全称）
P.education.push({ ...structuredClone(P.education[0]), id: 'edu-m', school: { zh: '虚构理工大学马来西亚校区', en: 'Fictional Tech University Malaysia' }, degree: { zh: '应用工程硕士', en: 'Master of Applied Engineering' }, major: { zh: '工业人工智能与机器人', en: 'Industrial AI and Robotics' }, start: '2025-07', end: '2027-01', expectedConferralDate: '2027-01', highlights: [] });
// 本科已结束
P.education[0].end = '2025-06'; delete P.education[0].expectedConferralDate; P.education[0].actualConferralDate = '2025-06';
P.projects[0].bullets.push({ id: 'proj-1-lan', zh: '在导师指导下，与临床医生讨论需求，实现局域网内图片共享。', en: 'Under supervision, discussed needs with clinicians and implemented image sharing over the local network.' });
const J = jobs();
const ctx = buildKitContext(P, J.A, new Date('2026-11-01'));
const v = (s: string, l: 'zh' | 'en') => verifySentence(s, l, 'coverLetter', ctx);

describe('求职信核对：换说法不再误判', () => {
  it('「校区攻读应用工程硕士」：学位名算专业依据', () => {
    const t = v('我目前在虚构理工大学马来西亚校区攻读应用工程硕士，预计2027年1月获得学位。', 'zh');
    expect(t.reasons.join('')).not.toMatch(/应用工程/);
  });
  it('「符合岗位对实践项目和专业工具的要求」不是专业名', () => {
    const t = v('这些经历让我对结构设计有具体实践，也符合岗位对实践项目和专业工具的要求。', 'zh');
    expect(t.reasons.join('')).not.toMatch(/专业/);
  });
  it('LAN ↔ 局域网 不算新增名词', () => {
    const t = v('I also implemented image sharing over the LAN for the course project.', 'en');
    expect(t.reasons.join('')).not.toMatch(/LAN/);
  });
  it('已结束的本科写 completed 不算新增事实；导师在资料任一处出现即可', () => {
    expect(v('My bachelor\'s degree in Marine Engineering was completed at Fictional Maritime University.', 'en').reasons.join('')).not.toMatch(/已完成/);
    expect(v('在课程项目中，我在导师指导下实现了局域网内图片共享。', 'zh').reasons.join('')).not.toMatch(/导师/);
  });
  it('仍然拦下：错误专业、找不到依据的「带领团队部署到产线」、新数字', () => {
    expect(v('我是船舶与海洋工程专业的应届生。', 'zh').ok).toBe(false);
    expect(v('在相机模组项目中，我带领团队把测试系统部署到了生产线上。', 'zh').reasons.join('')).toMatch(/部署|参与程度/);
    expect(v('实习期间我协助完成发电机支架的 SolidWorks 结构设计，效率提升 45%。', 'zh').reasons.join('')).toMatch(/数字/);
  });
});

describe('备考方向：引用要求编号，不再因原文断行 / 全半角被全部丢弃', () => {
  const job = (): JobParse => {
    const j = structuredClone(J.A);
    // 截图识别的原文：断行、全角标点、空格
    j.rawText = '岗位职责：\n1．负责产品结构设计，\n输出生产图纸\n任职要求：熟练使用 SolidWorks／NX';
    return j;
  };
  it('refs 对应解析出的要求即可保留；source 填要求原文；points 保留', async () => {
    mock.mockResolvedValue({ items: [
      { area: { zh: '结构设计与工程图', en: 'Structural design & drawings' }, why: { zh: '岗位核心工作。', en: 'Core work.' }, points: [{ zh: '公差配合选用', en: 'Tolerance & fits' }], refs: ['R1'] },
      { area: { zh: '编号无效', en: 'bad' }, why: { zh: 'x', en: 'x' }, refs: ['R999'] },
    ] });
    const q = await generatePrep(S, job());
    expect(q.map((x) => x.area.zh)).toEqual(['结构设计与工程图']);
    expect(q[0].source.length).toBeGreaterThan(2); expect(q[0].points?.[0].zh).toBe('公差配合选用');
    const prompt = mock.mock.calls[0][1][1].content as string;
    expect(prompt).toMatch(/R1｜/);
  });
  it('没有编号时，摘录跨断行 / 全半角也能对上原文', async () => {
    expect(quotedFrom('负责产品结构设计，输出生产图纸', job().rawText)).toBe(true);
    expect(quotedFrom('熟练使用 SolidWorks/NX', job().rawText)).toBe(true);
    expect(quotedFrom('负责海外销售与客户维护', job().rawText)).toBe(false);
    mock.mockResolvedValue({ items: [{ area: { zh: 'CAD', en: 'CAD' }, why: { zh: '要求。', en: 'Req.' }, source: '熟练使用 SolidWorks/NX' }] });
    expect((await generatePrep(S, job())).length).toBe(1);
  });
  it('仍不替候选人声称已具备', async () => {
    mock.mockResolvedValue({ items: [{ area: { zh: '结构设计', en: 'Design' }, why: { zh: '你已具备相关经验。', en: 'You already have it.' }, refs: ['R1'] }] });
    expect(await generatePrep(S, job())).toEqual([]);
  });
});

describe('2026-11-03 第二轮实测：completed 不误判；删句后过短会补足', () => {
  it('原文没有「未完成 / 计划」时，completed / 实现 只是换说法', () => {
    expect(v('In the course project, I completed a modular fixture design in SolidWorks and 3 prototype iterations.', 'en').reasons.join('')).not.toMatch(/已完成/);
  });
  it('原文是计划 / 未完成时，仍拦下「完成」', () => {
    const P2 = structuredClone(P); P2.projects[0].bullets = [{ id: 'proj-1-plan', zh: '计划在课程项目中完成夹具的有限元校核（尚未完成）。', en: 'Planned FEA check of the fixture in the course project (not yet completed).' }];
    const c2 = buildKitContext(P2, J.A, new Date('2026-11-01'));
    expect(verifySentence('课程项目中我完成了夹具的有限元校核。', 'zh', 'coverLetter', c2).ok).toBe(false);
  });
});

describe('公版简历的求职信用占位符', () => {
  it('generic 岗位时提示词要求【公司名称】【岗位名称】占位', async () => {
    const { generateCoverKit } = await import('../src/ai/extras');
    const { makeGenericJob } = await import('../src/ai/genericJob');
    const { generateRules } = await import('../src/ai/generate');
    const gj = makeGenericJob(P);
    mock.mockResolvedValue({ coverLetter: { zh: '', en: '' }, selfIntro: { zh: '', en: '' } });
    await generateCoverKit(S, P, gj, generateRules(P, gj, 'zh')).catch(() => null);
    expect(mock.mock.calls[0][1][1].content as string).toContain('【公司名称】');
  });
});
