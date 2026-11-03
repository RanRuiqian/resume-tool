import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import type { Settings } from '../src/types';
import { parseFactLibrary, skillGroup } from '../src/ai/factLibrary';
import { factGuard } from '../src/quality/resumeGuard';
import { applyResumeLabels, fillResumeLabels, resumeLabelTargets } from '../src/ai/labels';
import { generateResume } from '../src/ai/generate';
import { buildLayout } from '../src/render/layout';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { personalFixture, personalPlan } from './helpers/v112PersonalFixture';
import { jobs } from './helpers/v110Fixture';
import { sourceText } from '../src/ai/provenance';

/**
 * 2026-11（Claude 接手）回归：
 * A. V7 格式导入不把句号、栏目标题、课程性质列、简介字段名带进简历；
 * B. 放宽后的事实护栏：允许省略限定词，但拦截新数字与「抬高」；
 * C. 英文简历的单位 / 职位 / 学位等短字段按需补译；
 * D. 撰写一次给出中英文，不再整份机翻副版本。
 * 全部为虚构数据。
 */
const api = vi.mocked(chatJson);
const settings = { demoMode: false, model: 'mock-model', provider: 'custom', apiKey: 'FAKE-TEST-ONLY' } as Settings;
beforeEach(() => { api.mockReset(); });

const row = (id: string, body: string) => `[x] ${id}｜${body}`;
const v7 = () => [
  '01｜个人基本信息与求职意向',
  row('ID-001', '中文姓名：测试用户乙。'), row('ID-002', '英文姓名：Test User B。'), row('ID-009', '求职兴趣方向：机械设计、自动化。'),
  '02｜教育背景与成绩',
  row('EDU-B01', '学校：Mock Ocean University（模拟海洋大学）。'), row('EDU-B03', '专业：轮机工程（Marine Engineering）。'), row('EDU-B04', '学位：工学学士。'), row('EDU-B05', '修读时间：2019-09 至 2023-06。'),
  '04｜本科课程（2 门，全部已确认）', '【2019—2020 学年第 1 学期｜2 条】',
  row('BSC-001', '工程制图｜专必｜2.5 学分｜及格｜概述：虚构制图课程。'), row('BSC-002', '机械设计基础｜实践｜3 学分｜61 分｜概述：虚构机械课程。'),
  '05｜工作与生产实践',
  row('WRK-001', '单位：模拟生物科技股份有限公司。'), row('WRK-002', '职位：自动化生产技术员。'), row('WRK-003', '时间：2023-10 至 2024-06。'), row('WRK-004', '性质：企业实习与生产实践。'), row('WRK-005', '工作内容：参与虚构设备的运行维护。'),
  '06｜核心项目 1：虚构耳镜',
  row('PRO-DEMO-01', '中文名：虚构数字耳镜。'), row('PRO-DEMO-02', '英文名：Mock Digital Otoscope。'), row('PRO-DEMO-03', '年份：2026；性质：应用工程硕士毕业项目。'), row('PRO-DEMO-04', '外壳设计：虚构模块化外壳。'),
  '07｜核心项目 2：虚构仿真',
  row('PRO-SIM-01', '中文名：虚构液压仿真。'), row('PRO-SIM-03', '性质：模拟大学本科个人毕业设计；约 2022-10 至 2023-05。'), row('PRO-SIM-05', '在 AMESim 中建立虚构模型。'),
  '12｜工程软件、专业方法与技能', '【工程/原型与真实实践】',
  row('SKL-001', 'SolidWorks【基础使用】：虚构建模练习。'), row('SKL-002', 'AMESim【本科毕业设计】：虚构仿真。'),
  '【机器人/视觉计算课程实验】', row('SKL-003', 'MATLAB【课程实践】：虚构标定。'),
  '14｜固定个人简介（中英文）', row('INTRO-001', '中文个人简介：测试用户乙的虚构简介。'), row('INTRO-002', 'English personal summary: Test User B has a fictional background.'),
].join('\n');

describe('A. V7 import cleanup (ABB export bugs)', () => {
  const p = () => parseFactLibrary(v7())!.profile;
  it('strips trailing punctuation from names, company, title and headline', () => {
    const x = p();
    expect(x.profile.name).toMatchObject({ zh: '测试用户乙', en: 'Test User B' });
    expect(x.profile.headline.zh).toBe('机械设计、自动化');
    expect(x.work[0].company.zh).toBe('模拟生物科技股份有限公司');
    expect(x.work[0].title.zh).toBe('自动化生产技术员');
  });
  it('never uses the course-type column (专必 / 实践) as the English course name', () => {
    const cs = p().courses!;
    expect(cs.map((c) => c.name.zh)).toEqual(['工程制图', '机械设计基础']);
    expect(cs.every((c) => !c.name.en)).toBe(true);
  });
  it('reads Chinese（English） names in both directions', () => {
    const e = p().education[0];
    expect(e.school).toMatchObject({ zh: '模拟海洋大学', en: 'Mock Ocean University' });
    expect(e.major).toMatchObject({ zh: '轮机工程', en: 'Marine Engineering' });
    expect(e.degree.zh).toBe('工学学士');
  });
  it('drops the "English personal summary:" field label from the summary text', () => {
    expect(p().profile.summary.en).toBe('Test User B has a fictional background.');
  });
  it('takes project nature from inline 性质 instead of the section heading, and dates from it', () => {
    const [demo, sim] = p().projects;
    expect(demo.nature).toBe('应用工程硕士毕业项目'); expect(demo.start).toBe('2026');
    expect(demo.bullets.map((b) => b.zh).join()).not.toContain('性质');
    expect(sim.nature).toBe('模拟大学本科个人毕业设计'); expect(sim.start).toBe('2022-10'); expect(sim.end).toBe('2023-05');
    expect(sim.bullets.map((b) => b.zh).join()).not.toContain('性质');
  });
  it('groups skills by subsection; the 【】 tag is a proficiency level, not a group', () => {
    const s = p().skills;
    expect(s.map((x) => [x.name.zh ?? x.name.en, x.category?.zh, x.level])).toEqual([
      ['SolidWorks', '工程/原型', '基础使用'], ['AMESim', '工程/原型', '本科毕业设计'], ['MATLAB', '机器人/视觉计算', '课程实践'],
    ]);
    expect(skillGroup('【人工智能/模型训练课程实验】')).toBe('人工智能/模型训练');
  });
});

describe('B. looser fact guard', () => {
  it('accepts a natural rewrite that omits a qualifier word', () => {
    expect(factGuard('在课程项目中参与外壳结构设计，使用 SolidWorks 建模', '设计外壳结构并用 SolidWorks 完成建模', 'zh').filter((x) => !/完成/.test(x))).toEqual([]);
    expect(factGuard('在 AMESim 仿真条件下比较阀芯质量与弹簧刚度', 'Compared spool mass and spring stiffness in AMESim', 'en')).toEqual([]);
  });
  it('still blocks new numbers, inflated roles and invented deployment', () => {
    expect(factGuard('参与路径规划，仅仿真', '主导路径规划并在工厂部署', 'zh').join()).toMatch(/工厂|参与程度/);
    expect(factGuard('测试 3 个样件', '测试 5 个样件，良率提升 20%', 'zh').join()).toMatch(/数字/);
    expect(factGuard('可变焦功能尚未完成', '实现可变焦功能', 'zh').join()).toMatch(/未完成/);
  });
});

describe('C. bilingual labels for the English resume', () => {
  it('collects only selected entries missing a language and writes translations back', async () => {
    const p = parseFactLibrary(v7())!.profile;
    const r = { selection: { work: [p.work[0].id], projects: [], education: [p.education[0].id], skills: [p.skills[0].id], certificates: [], awards: [] },
      courseSelection: { ids: [p.courses![0].id], gradeIds: [], snapshots: [{ id: p.courses![0].id, educationId: '', school: '', name: structuredClone(p.courses![0].name), code: '' }] } } as never;
    const targets = resumeLabelTargets(p, r);
    expect(targets.map((t) => t.t.zh)).toEqual(['工学学士', '模拟生物科技股份有限公司', '自动化生产技术员', '工程/原型', '工程制图']);
    api.mockResolvedValueOnce({ items: targets.map((t) => ({ key: t.key, text: `EN:${t.t.zh}` })) });
    const out = await fillResumeLabels(settings, p, r);
    expect(out.count).toBe(5);
    expect(out.profile.work[0].company.en).toBe('EN:模拟生物科技股份有限公司');
    expect(out.profile.work[0].company.status?.en).toBe('machine');
    expect(out.resume.courseSelection!.snapshots![0].name.en).toBe('EN:工程制图');
    expect(p.work[0].company.en).toBeUndefined(); // 输入的 profile 不被就地修改
    expect(applyResumeLabels(p, r, [], new Map()).count).toBe(0);
  });
});

describe('D. one bilingual writing pass', () => {
  it('keeps both languages from the writer and only localizes what is missing', async () => {
    const p = personalFixture();
    let call = 0, localizeCalls = 0;
    api.mockImplementation(async (_s, msgs) => {
      call++;
      if (call === 1) return personalPlan();
      const content = String(msgs.at(-1)!.content);
      const payload = JSON.parse(content.split('\n\n').at(-1)!);
      if (call === 2) return { items: payload.facts.map((x: { sourceId: string; text: string; alt: string }) => ({ sourceId: x.sourceId, zh: x.text, en: x.alt || `Native English for ${x.sourceId}` })) };
      localizeCalls++;
      return { items: payload.items.map((x: { sourceId: string; sourceIds?: string[] }) => ({ sourceId: x.sourceId, text: sourceText(p, x).en })) };
    });
    const r = await generateResume(settings, p, jobs().A, 'zh', 1);
    const written = r.items.filter((i) => i.sourceId !== 'summary' && i.translation?.source === 'ai' && i.syncStatus === 'in-sync');
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((i) => i.zh && i.en)).toBe(true);
    // 撰写阶段已给出英文的条目不会再被送去翻译
    const sentToLocalize = api.mock.calls.slice(2).flatMap((c) => JSON.parse(String(c[1].at(-1)!.content).split('\n\n').at(-1)!).items.map((x: { sourceId: string }) => x.sourceId));
    expect(sentToLocalize.filter((id: string) => written.some((w) => w.sourceId === id))).toEqual([]);
    expect(localizeCalls).toBeLessThanOrEqual(2);
    const en = buildLayout(p, structuredClone(BUILTIN_TEMPLATES[0]), 'en', r);
    expect(en.header.name).toBeTruthy();
  });
});

describe('E. fuller resumes: org entries, task titles, AI skill groups', () => {
  it('splits student-union / part-time rows into unit and role and drops availability notes', async () => {
    const { splitOrg } = await import('../src/ai/factLibrary');
    expect(splitOrg('模拟大学校学生会外联部成员（本科期间，具体起止月份暂缺）。')).toMatchObject({ org: '模拟大学校学生会', role: '外联部成员' });
    expect(splitOrg('模拟大学航海学院学生会宣传部成员（本科期间，具体起止月份暂缺）')).toMatchObject({ org: '模拟大学航海学院学生会', role: '宣传部成员' });
    expect(splitOrg('本科期间曾在模拟快餐店（MOCK）兼职；具体日期、岗位未补充。')).toMatchObject({ org: '模拟快餐店（MOCK）', role: '兼职' });
    expect(splitOrg('Monash 模拟学生会公关部部长；任期 2026-07 至 2026-12。')).toMatchObject({ org: 'Monash 模拟学生会', role: '公关部部长' });
    expect(splitOrg('参与家乡社区抗疫志愿活动，并获得社区荣誉证书。')).toMatchObject({ org: '家乡社区', role: '抗疫志愿活动' });
  });
  it('does not use the heading fact as a bullet when the org has detail rows', () => {
    const text = ['10｜学生组织、兼职与志愿活动',
      row('ORG-001', '模拟学生会公关部部长；2024年8月—2025年6月'), row('ORG-002', '担任模拟学生会公关部负责人，参与活动策划'),
      row('ORG-011', '本科期间曾在模拟快餐店兼职；具体日期、岗位未补充。')].join('\n');
    const w = parseFactLibrary(`01｜个人基本信息\n${row('ID-001', '中文姓名：测试用户丙')}\n${text}`)!.profile.work;
    expect(w[0]).toMatchObject({ company: { zh: '模拟学生会' }, title: { zh: '公关部部长' }, kind: 'club' });
    expect(w[0].bullets.map((b) => b.zh)).toEqual(['担任模拟学生会公关部负责人，参与活动策划']);
    expect(w[1]).toMatchObject({ company: { zh: '模拟快餐店' }, title: { zh: '兼职' }, kind: 'parttime' });
    expect(w[1].bullets[0].zh).not.toMatch(/未补充/);
  });
  it('renders skills in the AI-chosen groups and order, falling back to profile categories for the rest', () => {
    const p = parseFactLibrary(v7())!.profile;
    const [sw, ame, matlab] = p.skills;
    const r = { selection: { work: [], projects: [], education: [], skills: [sw.id, ame.id, matlab.id], certificates: [], awards: [] }, items: [],
      skillGroups: [{ zh: '设计与仿真', en: 'Design & Simulation', ids: [ame.id, sw.id] }] } as never;
    const zh = buildLayout(p, structuredClone(BUILTIN_TEMPLATES[0]), 'zh', r);
    const blocks = [...zh.main, ...zh.side].find((s) => s.key === 'skills')!.blocks;
    expect(blocks[0]).toMatchObject({ title: '设计与仿真', text: 'AMESim、SolidWorks' });
    expect(blocks[1]).toMatchObject({ title: '机器人/视觉计算', text: 'MATLAB' });
    const en = buildLayout(p, structuredClone(BUILTIN_TEMPLATES[0]), 'en', r);
    expect([...en.main, ...en.side].find((s) => s.key === 'skills')!.blocks[0].title).toBe('Design & Simulation');
  });
});

describe('F. tailored summary gets one rewrite before falling back', () => {
  it('accepts the rewritten summary when the first one used a term missing from the library', async () => {
    const p = personalFixture();
    let call = 0;
    api.mockImplementation(async (_s, msgs) => {
      call++;
      if (call === 1) return personalPlan();
      const content = String(msgs.at(-1)!.content);
      if (call === 2) {
        const payload = JSON.parse(content.split('\n\n').at(-1)!);
        return { summary: { zh: '熟练使用 CATIA 的结构工程师', en: 'Structural engineer skilled in CATIA' },
          items: payload.facts.map((x: { sourceId: string; text: string; alt: string }) => ({ sourceId: x.sourceId, zh: x.text, en: x.alt || 'Native English' })) };
      }
      if (content.includes('在候选人资料里找不到')) {
        expect(content).toContain('CATIA');
        return { summary: { zh: `面向结构岗位：${p.profile.summary.zh}`, en: `Targeting structural roles. ${p.profile.summary.en}` } };
      }
      const payload = JSON.parse(content.split('\n\n').at(-1)!);
      return { items: (payload.items ?? []).map((x: { sourceId: string; sourceIds?: string[] }) => ({ sourceId: x.sourceId, text: sourceText(p, x).en })) };
    });
    const r = await generateResume(settings, p, jobs().A, 'zh', 1);
    expect(r.items.find((i) => i.sourceId === 'summary')!.zh).toBe(`面向结构岗位：${p.profile.summary.zh}`);
    expect(JSON.stringify(r.items)).not.toContain('CATIA');
  });
});

describe('G. requirement evidence categories never block the resume (ABB 2026-11-02 failure)', () => {
  it('turns a "learning" claim that also cites project facts into transferable, with no repair call', async () => {
    const { jointFixture } = await import('./helpers/v113JointFixture');
    const { planWithAi } = await import('../src/ai/aiPlanner');
    const f = jointFixture();
    const learning = f.plan.requirements!.findIndex((r) => r.assessment === 'learning');
    const practical = f.plan.requirements!.find((r) => r.assessment === 'direct' || r.assessment === 'transferable')!.evidenceIds;
    const req = f.plan.requirements![learning];
    req.evidenceIds = [...req.evidenceIds, ...practical];
    api.mockResolvedValueOnce(f.plan);
    const r = await planWithAi(settings, f.p, f.job, 'zh', 1);
    expect(r.requirements[learning]).toMatchObject({ assessment: 'transferable', evidenceIds: practical });
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe('H. trim to target pages (round three)', () => {
  it('removes the fewest low-priority items needed, keeps professional work, and reports what was removed', async () => {
    const { trimToPages, nextTrim } = await import('../src/ai/trim');
    const { generateRules } = await import('../src/ai/generate');
    const p = personalFixture();
    const r = generateRules(p, jobs().A, 'zh', 2);
    r.layoutPolicy = 'readable';
    const size = (x: typeof r) => x.items.length + x.selection.skills.length + x.selection.awards.length + (x.courseSelection?.ids.length ?? 0);
    const steps: number[] = []; for (let s = nextTrim(p, r), cur = r; s; cur = s.resume, s = nextTrim(p, cur)) steps.push(size(s.resume));
    expect(steps.length).toBeGreaterThan(1);
    const limit = steps[1];
    let measures = 0;
    const measure = async (x: typeof r) => { measures++; const pages = size(x) > limit ? 2 : 1; return { zh: { pages }, en: { pages } }; };
    const tpl = structuredClone(BUILTIN_TEMPLATES[0]); tpl.page.targetPages = 1;
    const out = await trimToPages(p, tpl, r, measure);
    expect(size(out)).toBeLessThanOrEqual(limit);
    expect(size(out)).toBe(limit); // 二分查找：刚好删两步，不删过头
    expect(measures).toBeLessThanOrEqual(8);
    expect(out.notes!.some((n) => n.startsWith('为保持 1 页内'))).toBe(true);
    const professional = r.selection.work.filter((id) => !['club', 'volunteer', 'parttime'].includes(p.work.find((w) => w.id === id)?.kind ?? ''));
    expect(professional.every((id) => out.selection.work.includes(id))).toBe(true);
    // 被删的要点进入本简历暂存区，可重新勾选
    expect((out.deselectedItems ?? []).length + (r.items.length - out.items.length)).toBeGreaterThanOrEqual(0);
    expect(nextTrim(p, { ...r, selection: { work: [], projects: [], education: [], skills: [], certificates: [], awards: [] }, items: [], courseSelection: { ids: [], gradeIds: [] } })).toBeNull();
  });
  it('leaves a resume that already fits untouched', async () => {
    const { trimToPages } = await import('../src/ai/trim');
    const { generateRules } = await import('../src/ai/generate');
    const p = personalFixture(), r = generateRules(p, jobs().A, 'zh', 1);
    const out = await trimToPages(p, structuredClone(BUILTIN_TEMPLATES[0]), r, async () => ({ zh: { pages: 1 }, en: { pages: 1 } }));
    expect(out).toBe(r);
  });
});

describe('I. practice entries outside course headings are not labelled as course projects', () => {
  it('labels course tasks by activity but leaves extra-curricular practice unlabelled', () => {
    const text = ['01｜个人基本信息', row('ID-001', '中文姓名：测试用户丁'), '08｜硕士课程实验与代表性课程项目',
      '【MOC1234：虚构增材制造】', row('LRN-AM-01', 'MOC1234：学习虚构增材制造设计。'),
      '【本科补充实践（经本人核对）】', row('LRN-SHIP-01', '本科时期参与约四人团队的虚构船模设计和 3D 打印活动。')].join('\n');
    const ps = parseFactLibrary(text)!.profile.projects;
    expect(ps.find((x) => x.id.includes('LRN-AM'))).toMatchObject({ nature: '课程项目' });
    expect(ps.find((x) => x.id.includes('LRN-SHIP'))).toMatchObject({ name: { zh: '本科补充实践' }, nature: '' });
  });
});

describe('J. trimming keeps publications', () => {
  it('drops a non-publication bullet before the paper bullet even when the paper is last', async () => {
    const { nextTrim } = await import('../src/ai/trim');
    const p = personalFixture();
    const proj = { ...structuredClone(p.projects[0]), id: 'trim-proj', kind: 'auxiliary' as const, bullets: [0, 1, 2].map((i) => ({ id: `trim-b${i}`, zh: `原文 ${i}` })) };
    p.projects.push(proj);
    const ids = proj.bullets.map((b) => b.id);
    const r = { selection: { work: [], projects: [proj.id], education: [], skills: [], certificates: [], awards: [] },
      items: ids.map((id, i) => ({ sourceId: id, zh: i === 2 ? '第一作者论文被虚构会议录用' : `虚构要点 ${i}`, en: '', syncStatus: 'in-sync' as const })), courseSelection: { ids: [], gradeIds: [] } } as never;
    const step = nextTrim(p, r)!;
    const left = (step.resume as { items: { zh: string }[] }).items.map((i) => i.zh);
    expect(left).toContain('第一作者论文被虚构会议录用');
    expect(left).not.toContain('虚构要点 1');
  });
});

describe('K 选材条数上限（输出被截断的回归）', () => {
  const entry = (id: string, n: number, core: boolean) => ({ kind: 'projects' as const, id, score: 1, core, bulletIds: Array.from({ length: n }, (_, i) => `${id}-b${i}`) });
  it('主选每段最多 8 条、候补最多 4 条，总数超过软参考 1.5 倍时先删候补再删要点最多的主选末尾', async () => {
    const { capPlanFacts } = await import('../src/ai/generate');
    const out = capPlanFacts([entry('a', 27, true), entry('b', 12, true), entry('c', 12, true), entry('r', 9, false)], 12);
    const n = (id: string) => out.find((e) => e.id === id)!.bulletIds.length;
    expect(n('a')).toBeLessThanOrEqual(8); expect(n('r')).toBeLessThanOrEqual(4);
    expect(out.reduce((s, e) => s + e.bulletIds.length, 0)).toBeLessThanOrEqual(24);
    expect(out.find((e) => e.id === 'a')!.bulletIds[0]).toBe('a-b0');      // 保留最前（最重要）的
    expect(n('r')).toBeGreaterThanOrEqual(1);
  });
  it('教育条目不受影响', async () => {
    const { capPlanFacts } = await import('../src/ai/generate');
    const edu = { kind: 'education' as const, id: 'e', score: 1, core: true, bulletIds: Array.from({ length: 12 }, (_, i) => `e${i}`) };
    expect(capPlanFacts([edu], 10)[0].bulletIds).toHaveLength(12);
  });
});
