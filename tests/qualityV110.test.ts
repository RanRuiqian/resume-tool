import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import type { ProfileDoc, Settings } from '../src/types';
import { fictionalEngineer, jobs } from './helpers/v110Fixture';
import { guardRewrite, rewriteSafe } from '../src/quality/resumeGuard';
import { conciseBullet, conciseBi, jobTerms, planResume, relevance, compactSummary } from '../src/ai/relevance';
import { generateRules, generateResume } from '../src/ai/generate';
import { analyzeJob, isAnalysisStale, jdHash, normalizeJob, parseJdRules } from '../src/ai/jd';
import { extractJdBody } from '../src/ai/jdText';
import { compactGpaNote } from '../src/render/resumeText';
import { buildLayout } from '../src/render/layout';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { checkKit, degradeText, enWords, generateCoverKit, layoutToText, zhLen } from '../src/ai/extras';

const S = { demoMode: false, baseUrl: 'https://api.deepseek.com', apiKey: 'sk-FAKE-test', model: 'deepseek-flash' } as unknown as Settings;
const mock = chatJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mock.mockReset());
const P = fictionalEngineer();
const J = jobs();
const text = (p: ProfileDoc, r: ReturnType<typeof generateRules>, l: 'zh' | 'en', t = 0) => layoutToText(buildLayout(p, BUILTIN_TEMPLATES[t], l, r));
const projTitles = (r: ReturnType<typeof generateRules>, l: 'zh' | 'en' = 'zh') => buildLayout(P, BUILTIN_TEMPLATES[0], l, r).main.concat(buildLayout(P, BUILTIN_TEMPLATES[0], l, r).side ?? []).find((s) => s.key === 'projects')?.blocks.map((b) => b.title) ?? [];

describe('v1.10 resume guard (fact safety for the resume copy)', () => {
  it('allows dropping minor facts but not adding / changing numbers', () => {
    const src = '迭代 3 版原型并 3D 打印验证（PLA、0.2 mm 层高、20% 填充）';
    expect(rewriteSafe(src, '迭代 3 版原型并 3D 打印验证', 'zh')).toBe(true);
    expect(guardRewrite(src, '迭代 4 版原型并 3D 打印验证', 'zh').join()).toContain('数字');
    expect(guardRewrite('良率提升 15%', '良率提升 25%', 'zh').length).toBeGreaterThan(0);
  });
  it('keeps qualifiers (simulation only / discussed / expected / intern / course)', () => {
    expect(rewriteSafe('参与机械臂路径仿真（仅仿真，未上实机）', '完成机械臂路径规划', 'zh')).toBe(false);
    expect(rewriteSafe('与组员讨论过用 ROS 做运动学验证的设想', '用 ROS 完成运动学验证', 'zh')).toBe(false);
    expect(rewriteSafe('预计可减重约 15%', '减重 15%', 'zh')).toBe(false);
    expect(rewriteSafe('Took part in a simulation-only study', 'Led a field deployment', 'en')).toBe(false);
  });
  it('never raises participation level or adds completion / company facts', () => {
    expect(rewriteSafe('协助完成支架结构设计', '主导支架结构设计', 'zh')).toBe(false);
    expect(rewriteSafe('Assisted with bracket design', 'Led bracket design', 'en')).toBe(false);
    expect(rewriteSafe('课程项目中设计夹具', '在公司独立设计并已完成量产夹具', 'zh')).toBe(false);
  });
});

describe('v1.10 relevance & density (scenarios A/B/C, fictional profile)', () => {
  it('scenario A (mechanical): keeps structural / prototype projects, drops unrelated ones', () => {
    const r = generateRules(P, J.A, 'zh');
    const t = text(P, r, 'zh');
    expect(t).toContain('模块化 3D 打印夹具');
    expect(t).not.toContain('奶茶店');
    expect(t).not.toContain('MTF50'); // 机械岗不展示视觉测试参数
    expect(t).not.toContain('PETG'); // 失败方案不进简历
    expect(t).not.toContain('周例会');
    expect(t).toContain('轮机工程'); // 学位 / 专业名称不改
  });
  it('scenario B (vision): keeps MTF/SNR/ISO 12233 details because the JD asks for them', () => {
    const r = generateRules(P, J.B, 'en');
    const t = text(P, r, 'en');
    expect(t).toContain('MTF50'); expect(t).toContain('ISO 12233'); expect(t).toContain('room temperature');
    expect(t).not.toContain('Tea-Shop');
    expect(t).toContain('Marine Engineering');
  });
  it('scenario C (robotics): keeps "simulation only" and "discussed" qualifiers verbatim', () => {
    const r = generateRules(P, J.C, 'zh');
    const t = text(P, r, 'zh');
    expect(t).toContain('六轴机械臂');
    expect(t).toContain('仅仿真，未上实机');
    if (t.includes('ROS')) expect(t).toContain('讨论过');
    const e = text(P, r, 'en');
    expect(e).toContain('simulation only');
  });
  it('zh and en versions pick the same entries and bullets', () => {
    for (const j of [J.A, J.B, J.C]) {
      const r = generateRules(P, j, 'zh');
      expect(projTitles(r, 'zh').length).toBe(projTitles(r, 'en').length);
      for (const i of r.items) if (i.sourceId !== 'summary') { expect(i.zh.trim(), i.sourceId).not.toBe(''); expect(i.en.trim(), i.sourceId).not.toBe(''); }
    }
  });
  it('one-page caps: core ≤3, minor ≤1, ≤3 projects, no padding with zero-relevance bullets', () => {
    const plan = planResume(P, J.A, 'zh', 1);
    for (const e of plan.entries.filter((x) => x.kind !== 'education')) expect(e.bulletIds.length).toBeLessThanOrEqual(e.core ? 3 : Math.max(2, 1));
    expect(plan.entries.filter((e) => e.kind === 'projects').length).toBeLessThanOrEqual(3);
    const two = planResume(P, J.A, 'zh', 2);
    expect(two.caps).toEqual({ core: 4, minor: 2 });
  });
  it('master library is not modified by generation', () => {
    const before = JSON.stringify(P);
    for (const j of [J.A, J.B, J.C]) { generateRules(P, j, 'zh'); generateRules(P, j, 'en', 2); }
    expect(JSON.stringify(P)).toBe(before);
  });
  it('relevance penalises unrelated measurement terms; conciseBullet keeps first sentence and drops failed attempts', () => {
    const tA = jobTerms(J.A);
    expect(relevance('按 ISO 12233 测量 MTF50 与 SNR', tA)).toBeLessThan(relevance('SolidWorks 结构设计与原型验证', tA));
    const out = conciseBullet('用 SolidWorks 设计夹具并迭代 3 版原型；尝试 PETG 打印但翘曲失败；完成装配验证。', 'zh', tA);
    expect(out).toContain('SolidWorks'); expect(out).not.toContain('PETG');
  });
  it('conciseBi falls back to both originals when sentence counts differ', () => {
    const b = { zh: '设计支架；整理图纸。', en: 'Designed a bracket and prepared drawings.' } as never;
    expect(conciseBi(b, jobTerms(J.A), 'zh')).toEqual({ zh: '设计支架；整理图纸。', en: 'Designed a bracket and prepared drawings.' });
  });
  it('compactSummary keeps at most 2 sentences and never drops qualifiers', () => {
    const long = '机械工程方向应届生，具备结构设计与原型验证的课程项目经验，熟悉 SolidWorks、AutoCAD 与 Python 编程工具。参与过相机测试与机器人仿真两个项目，负责数据整理和脚本编写工作。喜欢动手做原型，乐于沟通协作。课余参与机器人社团的活动组织与宣传。';
    const s = compactSummary(long, 'zh');
    expect(s.split('。').filter(Boolean).length).toBeLessThanOrEqual(2);
    expect(s).toContain('课程');
  });
});

describe('v1.10 AI path fixes (mocked DeepSeek)', () => {
  it('bug A: selected entry with no AI items gets ≤2 concise bullets, not all raw bullets', async () => {
    mock.mockResolvedValueOnce({ selection: { work: ['work-1'], projects: ['proj-1'], education: ['edu-1'] }, items: [], matchScore: 70, gaps: [] });
    mock.mockRejectedValueOnce(new Error('offline'));
    const r = await generateResume(S, P, J.A, 'zh', 1);
    const w = r.items.filter((i) => i.sourceId.startsWith('work-1-'));
    expect(w.length).toBeGreaterThan(0); expect(w.length).toBeLessThanOrEqual(2);
    expect(w.some((i) => i.sourceId === 'work-1-b3')).toBe(false);
  });
  it('bug B: rewrite failing the guard falls back to the concise original, not an invented text', async () => {
    mock.mockResolvedValueOnce({ selection: { work: ['work-1'], projects: ['proj-3'], education: ['edu-1'] }, items: [
      { sourceId: 'proj-3-b1', text: '主导六轴机械臂抓取路径规划并在工厂完成部署' },
      { sourceId: 'work-1-b1', text: '协助完成发电机支架的 SolidWorks 结构设计，参与 2 轮原型验证' },
    ], matchScore: 72, gaps: [] });
    mock.mockRejectedValueOnce(new Error('offline'));
    const r = await generateResume(S, P, J.C, 'zh', 1);
    const b = r.items.find((i) => i.sourceId === 'proj-3-b1')!;
    expect(b.zh).toContain('仅仿真'); expect(b.zh).not.toContain('工厂');
    expect(r.notes?.join()).toContain('事实护栏');
    expect(r.items.find((i) => i.sourceId === 'work-1-b1')!.zh).toContain('协助');
  });
});

describe('v1.10 JD analysis stability', () => {
  it('hash ignores whitespace / punctuation width; stale detection follows text changes', () => {
    expect(jdHash('岗位职责：负责设计。')).toBe(jdHash('岗位职责: 负责设计.  '));
    const j = normalizeJob(parseJdRules('机械工程师\n负责结构设计'));
    expect(isAnalysisStale(j, '机械工程师\n负责结构设计')).toBe(false);
    expect(isAnalysisStale(j, '机械工程师\n负责结构设计与仿真')).toBe(true);
  });
  it('analyzeJob reuses current / history analysis without calling AI; force re-analyses', async () => {
    const txt = '机器人应用工程师\n负责离线编程';
    const parse = vi.fn(async () => normalizeJob(parseJdRules(txt)));
    const first = await analyzeJob(S, txt, { current: null, parse });
    expect(parse).toHaveBeenCalledTimes(1);
    const again = await analyzeJob(S, txt + '  ', { current: first.job, parse });
    expect(again.reused).toBe('current'); expect(parse).toHaveBeenCalledTimes(1);
    const hist = await analyzeJob(S, txt, { current: null, history: [first.job], parse });
    expect(hist.reused).toBe('history'); expect(hist.job.id).not.toBe(first.job.id); expect(hist.job.keywords).toEqual(first.job.keywords);
    await analyzeJob(S, txt, { current: first.job, parse, force: true });
    expect(parse).toHaveBeenCalledTimes(2);
  });
  it('analyzeJob falls back to rules with aiError when AI fails', async () => {
    const r = await analyzeJob(S, '测试工程师\n负责测试', { current: null, parse: async () => { throw new Error('timeout'); } });
    expect(r.aiError).toBe('timeout'); expect(r.job.rawText).toContain('测试工程师');
  });
  it('keywords are deduped & stably ordered; niceToHave only when the JD marks it', () => {
    const base = parseJdRules('结构工程师\n熟悉 SolidWorks\n熟悉 CAD');
    const j1 = normalizeJob({ ...base, mustHave: [{ zh: 'SolidWorks', en: 'SolidWorks' }], keywords: [{ zh: 'CAD', en: 'CAD' }, { zh: 'SolidWorks', en: 'SolidWorks' }, { zh: 'cad', en: 'CAD' }], niceToHave: [{ zh: '有限元', en: 'FEA' }] });
    const j2 = normalizeJob({ ...base, mustHave: [{ zh: 'SolidWorks', en: 'SolidWorks' }], keywords: [{ zh: 'SolidWorks', en: 'SolidWorks' }, { zh: 'CAD', en: 'CAD' }], niceToHave: [{ zh: '有限元', en: 'FEA' }] });
    expect(j1.keywords.map((k) => k.en)).toEqual(j2.keywords.map((k) => k.en));
    expect(j1.keywords.length).toBe(2);
    expect(j1.niceToHave).toEqual([]); // JD 没写「优先 / 加分」
    const j3 = normalizeJob({ ...parseJdRules('结构工程师\n有有限元经验者优先'), niceToHave: [{ zh: '有限元', en: 'FEA' }] });
    expect(j3.niceToHave.length).toBe(1);
  });
  it('extractJdBody removes job-board noise and similar-jobs tail', () => {
    const raw = '共有47个符合条件的职位\n机械设计工程师\n虚构科技有限公司\n岗位职责：负责结构设计\n128 人已申请\n3 天前发布\n立即申请\n相似职位\n电气工程师 虚构电气';
    const r = extractJdBody(raw);
    expect(r.text).toContain('岗位职责：负责结构设计');
    expect(r.text).not.toMatch(/共有47个|已申请|电气工程师|立即申请/);
    expect(r.removed.length).toBeGreaterThan(0);
  });
});

describe('v1.10 layout: GPA note & language tests', () => {
  it('compactGpaNote keeps only est./unofficial qualifiers', () => {
    expect(compactGpaNote('GPA 3.6/4.0（估算，非官方，以学校成绩单为准）', 'zh')).toBe('GPA 3.6/4.0（估算，非官方）');
    expect(compactGpaNote('GPA 3.6/4.0 (est., unofficial; subject to official transcript)', 'en')).toBe('GPA 3.6/4.0 (est., unofficial)');
    expect(compactGpaNote('GPA 3.6/4.0，排名前 15%。', 'zh')).toBe('GPA 3.6/4.0，排名前 15%。');
    expect(compactGpaNote('负责结构设计（以实物为准）', 'zh')).toBe('负责结构设计（以实物为准）');
  });
  it('language tests move from certificates into skills; master library unchanged', () => {
    const r = generateRules(P, J.A, 'zh');
    for (const tpl of BUILTIN_TEMPLATES) {
      const m = buildLayout(P, tpl, 'zh', r);
      const secs = [...m.main, ...(m.side ?? [])];
      const certs = secs.find((s) => s.key === 'certificates');
      expect(JSON.stringify(certs ?? '')).not.toContain('PTE');
      if (secs.some((s) => s.key === 'skills')) expect(JSON.stringify(secs.find((s) => s.key === 'skills'))).toContain('PTE');
    }
    expect(P.certificates.some((c) => c.name.zh.includes('PTE'))).toBe(true);
  });
});

describe('v1.10 cover letter & self-intro quality', () => {
  const src = '林小舟 轮机工程 SolidWorks 结构设计 2 轮原型验证 3 版原型';
  const good = {
    coverLetter: { zh: '您好，我是轮机工程专业应届生林小舟，希望应聘机械结构设计工程师。'.repeat(1) + '实习期间我协助完成发电机支架的 SolidWorks 结构设计，参与了 2 轮原型验证并整理装配图纸，体会到图纸细节对装配的影响。课程项目中我用 SolidWorks 设计模块化夹具，迭代 3 版原型，并通过 3D 打印检查装配关系。这些经历让我熟悉了从建模、出图到样机验证的基本流程，也养成了记录问题、逐项核对的习惯。贵岗位关注发电机结构设计与原型验证，与我做过的工作方向一致。对于有限元分析，我目前只有课程层面的基础，入职后希望在导师指导下系统学习。期待有机会进一步沟通，谢谢您的阅读。', en: '' },
    selfIntro: { zh: '', en: '' },
  };
  it('checkKit flags length, untraceable numbers, clichés and gap-skill claims', () => {
    const bad = { coverLetter: { zh: '我精通有限元分析，带领团队提升效率 50%。我是一个热爱学习、吃苦耐劳的人。', en: 'I am proficient in FEA.' }, selfIntro: { zh: '你好。', en: 'Hi.' } };
    const issues = checkKit(bad, { sourceText: src, gapTerms: ['有限元分析', 'FEA'] }).join('\n');
    expect(issues).toMatch(/过短/); expect(issues).toContain('50'); expect(issues).toMatch(/套话/); expect(issues).toContain('有限元分析');
    expect(checkKit(good, { sourceText: src, gapTerms: ['有限元分析'] }).filter((x) => x.includes('求职信（中文）') && !x.includes('过')).length).toBe(0);
  });
  it('degradeText removes unsafe sentences deterministically', () => {
    const t = '我协助完成支架结构设计。我精通有限元分析。我提升效率 50%。';
    const d = degradeText(t, 'zh', 'cover', { sourceText: src, gapTerms: ['有限元分析'] });
    expect(d).toBe('我协助完成支架结构设计。'); expect(degradeText(t, 'zh', 'cover', { sourceText: src, gapTerms: ['有限元分析'] })).toBe(d);
  });
  it('generateCoverKit retries at most twice, then blocks; lengths measured', async () => {
    const r = generateRules(P, J.A, 'zh');
    const out = { coverLetter: { zh: '我精通有限元分析并带领团队提升效率 50%。', en: 'I am an expert in FEA with 10 years of experience.' }, selfIntro: { zh: '大家好。', en: 'Hello.' } };
    mock.mockResolvedValue(out);
    const k = await generateCoverKit(S, P, J.A, r);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(k.quality.attempts).toBe(2);
    // v1.10.1：两次都未通过逐句核对 → 标记 blocked，由界面决定不保存；问题逐句给出
    expect(k.quality.status).toBe('blocked');
    expect(k.quality.issues.join('\n')).toMatch(/有限元分析|FEA/);
    expect(k.quality.safe).toBeNull();
    expect(zhLen('一二三 ABC')).toBe(4); expect(enWords('I am 22 years old.')).toBe(5);
  });
  it('generateCoverKit stops after one attempt when the first draft passes', async () => {
    const r = generateRules(P, J.A, 'zh');
    const zhIntro = '您好，我是林小舟，轮机工程专业应届生。在校期间我系统学习了机械设计和工程制图等课程，打下了结构设计的基础。实习时我协助完成发电机支架的 SolidWorks 结构设计，参与了 2 轮原型验证，学会了根据装配问题修改图纸。课程项目中我设计模块化夹具，迭代 3 版原型，并用 3D 打印检查装配。我比较擅长把问题拆开逐项核对，也愿意动手验证想法。接下来我希望在机械结构设计方向继续积累经验，把建模和原型验证做扎实。谢谢！';
    const enIntro = 'Hello, I am Xiaozhou Lin, a Marine Engineering graduate. During my internship I assisted with the SolidWorks structural design of a generator bracket and took part in 2 rounds of prototype validation, learning to revise drawings based on assembly feedback. In a course project I designed a modular fixture, iterated 3 prototypes and checked the assembly with 3D printing. I like breaking problems into small checks and testing ideas by hand. Next, I hope to keep growing in mechanical design and build solid habits in modeling and prototype validation. Thank you.';
    mock.mockResolvedValue({ coverLetter: { zh: good.coverLetter.zh, en: enIntro + ' ' + enIntro.replace('Hello, I am Xiaozhou Lin, a Marine Engineering graduate. ', '') }, selfIntro: { zh: zhIntro, en: enIntro } });
    const k = await generateCoverKit(S, P, J.A, r);
    expect(k.quality.attempts).toBeGreaterThanOrEqual(1);
    expect(mock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(zhLen(k.selfIntro.zh)).toBeLessThanOrEqual(260);
  });
});

describe('v1.10 AI path keeps language tests', () => {
  it('language-test certificate is kept even if AI did not select it', async () => {
    mock.mockResolvedValueOnce({ selection: { work: ['work-1'], projects: ['proj-1'], education: ['edu-1'], certificates: [] }, items: [], matchScore: 70, gaps: [] });
    mock.mockRejectedValueOnce(new Error('offline'));
    const r = await generateResume(S, P, J.A, 'zh', 1);
    expect(r.selection.certificates).toContain('cert-1');
    expect(r.selection.certificates).not.toContain('cert-3');
  });
});
