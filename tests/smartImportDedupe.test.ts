import { describe, expect, it } from 'vitest';
import { applyImportPlan, applyReplace, buildImportPlan, mergePreview, planSummary, sampleResidue, type ImportPlan } from '../src/ai/importPlan';
import { dupMatch, findIncomingDuplicates } from '../src/ai/dedupe';
import { mergeProfiles, rawToProfile, type Raw } from '../src/ai/importProfile';
import { emptyProfile, normalizeProfile } from '../src/storage/profileIO';
import sample from '../src/sample/sample-profile.json';

// 全部为虚构数据：结构上模拟「中英文各识别成一条」「同一实习被识别成正式工作 + 实习」等问题，不含任何真实个人信息
const COURSES = Array.from({ length: 76 }, (_, i) => `模拟课程${i + 1}（${(i % 4) + 1} 学分）`);
const buggyAiOutput = (): Raw => ({
  name: '测试用户庚',
  education: [
    { school: '东临海事大学', degree: '工学学士', major: '轮机工程', start: '2019-09', end: '2023-06', courses: COURSES.slice(0, 22) },
    { school: 'Donglin Maritime University', degree: 'Bachelor of Engineering', major: 'Marine Engineering', start: '2019-09', end: '2023-06' },
    { school: 'Sunbay University Malaysia', degree: 'Master of Applied Engineering', major: 'Industrial AI & Robotics', start: '2026-02', end: '2027-01', expectedConferralDate: '2027-01' },
    { school: '桑湾大学马来西亚分校', degree: '应用工程硕士', major: '工业人工智能与机器人', start: '2026-02', end: '2027-01' },
  ],
  work: [
    { company: '北岭生物科技股份有限公司', title: '自动化生产技术员', start: '2023-10', end: '2024-06', bullets: ['维护灌装线 PLC 程序'] },
    { company: '北岭生物科技', title: '自动化生产技术员（实习）', start: '2023-10', end: '2024-06', bullets: ['维护灌装线 PLC 程序', '编写设备点检表'] },
  ],
  projects: [
    { name: 'Low-cost Smart Stethoscope for Clinical Training', kind: 'core', start: '2026-03', end: '2026-11', bullets: ['Built a prototype'] },
    { name: '智能听诊器', start: '2026-03', end: '2026-11', bullets: ['完成样机与实验'] },
    { name: 'Dynamic Performance Analysis of a Pressure Reducing Valve Using AMESim', aliases: ['本科 AMESim 毕业设计'], kind: 'core', start: '2022-12', end: '2023-05' },
    { name: '本科 AMESim 毕业设计', start: '2022-12', end: '2023-05', bullets: ['搭建减压阀仿真模型'] },
    { name: '课程实验：液压回路搭建', kind: 'auxiliary', nature: '课程实验', start: '2021-10', end: '2021-12' },
  ],
});

describe('通用去重：本次识别结果内部', () => {
  const inc = rawToProfile(buggyAiOutput());
  const plan = buildImportPlan(emptyProfile(), inc, []);
  const decided: ImportPlan = { ...plan, items: plan.items.map((x) => (x.action === 'undecided' ? { ...x, action: 'merge' } : x)) };
  it('中英文学历各一条 → 判为同一条并预设合并（共 2 段学历）', () => {
    const edu = plan.items.filter((x) => x.section === 'education');
    expect(edu.filter((x) => x.status === 'internal').map((x) => x.action)).toEqual(['merge', 'merge']);
    const out = applyImportPlan(emptyProfile(), inc, decided);
    expect(out.education).toHaveLength(2);
    const ba = out.education[0];
    expect(ba.school.zh).toBe('东临海事大学');
    expect(ba.aliases).toContain('Donglin Maritime University');
    expect(out.education[1].expectedConferralDate).toBe('2027-01');
    expect(out.education[1].actualConferralDate).toBeUndefined();
  });
  it('同一单位同一时间的「正式工作」与「实习」→ 一条实习，不推断另一份正式工作', () => {
    const out = applyImportPlan(emptyProfile(), inc, decided);
    expect(out.work).toHaveLength(1);
    expect(out.work[0].kind).toBe('internship');
    expect(out.work[0].bullets.map((b) => b.zh)).toEqual(['维护灌装线 PLC 程序', '编写设备点检表']);
  });
  it('项目：别名一致自动合并；不同语言名称 + 相同日期只提示，必须用户决定，不会静默生成两份核心项目', () => {
    const pj = plan.items.filter((x) => x.section === 'projects');
    const amesim = pj.find((x) => x.title === '本科 AMESim 毕业设计')!;
    expect(amesim.status).toBe('internal'); expect(amesim.action).toBe('merge');
    const steth = pj.find((x) => x.title === '智能听诊器')!;
    expect(steth.status).toBe('internal'); expect(steth.action).toBe('undecided');
    expect(() => applyImportPlan(emptyProfile(), inc, plan)).toThrow(/未选择处理方式/);
    const p2: ImportPlan = { ...plan, items: plan.items.map((x) => (x.key === steth.key ? { ...x, action: 'merge' } : x)) };
    const out = applyImportPlan(emptyProfile(), inc, p2);
    expect(out.projects).toHaveLength(3);
    expect(out.projects.filter((x) => x.kind === 'core')).toHaveLength(2);
    expect(out.projects.find((x) => x.kind === 'auxiliary')!.nature).toBe('课程实验');
    const st = out.projects[0];
    expect(st.aliases).toContain('智能听诊器');
    expect(st.bullets.map((b) => b.en || b.zh)).toEqual(['Built a prototype', '完成样机与实验']);
    expect(st.mergeHistory?.length).toBe(1);
  });
  it('合并预览给出合并前两条与合并后的字段', () => {
    const it0 = plan.items.find((x) => x.section === 'work' && x.status === 'internal')!;
    const pv = mergePreview(emptyProfile(), inc, it0)!;
    expect(pv.before).toHaveLength(2);
    expect(pv.after.kind).toBe('internship');
  });
  it('提交前汇总数量', () => {
    const s = planSummary(plan, 'merge');
    expect(s.pending).toBe(1);
    expect(s.merge).toBe(4); // 2 学历 + 1 工作 + 1 项目
    expect(s.add).toBe(6);
  });
});

describe('反例：不能仅凭相同关键词强制合并', () => {
  const W = (company: string, title: string, start: string, end: string) => ({ id: 'x' + Math.random(), company: { zh: company }, title: { zh: title }, start, end } as never);
  it('同单位、不同时间段的两段实习不合并', () => {
    expect(dupMatch('work', W('甲乙模拟公司', '测试实习生', '2022-07', '2022-09'), W('甲乙模拟公司', '测试实习生', '2023-07', '2023-09')).score).toBe(0);
  });
  it('同单位、同时期但职位明显不同 → 不判为重复', () => {
    expect(dupMatch('work', W('甲乙模拟公司', '财务助理', '2022-01', '2022-12'), W('甲乙模拟公司', '机械设计工程师', '2022-03', '2022-08')).strong).toBe(false);
  });
  it('都含关键词 ROS 但时间不同的两个项目不合并', () => {
    const inc = rawToProfile({ projects: [{ name: 'ROS 巡检机器人', start: '2021-03', end: '2021-06' }, { name: 'ROS 机械臂抓取', start: '2024-03', end: '2024-06' }] });
    expect(findIncomingDuplicates(inc)).toHaveLength(0);
  });
  it('同一学校的本科与硕士不合并', () => {
    const inc = rawToProfile({ education: [{ school: '模拟理工大学', degree: '学士', major: '机械', start: '2015-09', end: '2019-06' }, { school: '模拟理工大学', degree: '硕士', major: '机械', start: '2019-09', end: '2022-06' }] });
    expect(findIncomingDuplicates(inc)).toHaveLength(0);
  });
  it('名称只有部分关键词相同、缺少日期 → 不自动合并', () => {
    const inc = rawToProfile({ projects: [{ name: 'AMESim 液压仿真练习' }, { name: 'AMESim 发动机冷却系统建模' }] });
    expect(findIncomingDuplicates(inc).filter((d) => d.match.strong)).toHaveLength(0);
  });
});

describe('母库完整性', () => {
  it('分段识别的课程取并集：76 门全部保留', () => {
    const a = rawToProfile({ education: [{ school: '东临海事大学', major: '轮机工程', courses: COURSES.slice(0, 40), coursesInText: 40 }] });
    const b = rawToProfile({ education: [{ school: '东临海事大学', major: '轮机工程', courses: COURSES.slice(35), coursesInText: 41 }] });
    const m = mergeProfiles(mergeProfiles(emptyProfile(), a), b);
    expect(m.education).toHaveLength(1);
    expect(m.education[0].courses).toHaveLength(76);
  });
  it('原文另一语言写法 → 同一条双语记录；备注进 notes 不进要点；未知字段保持空白', () => {
    const p = rawToProfile({ education: [{ school: '东临海事大学', schoolOther: 'Donglin Maritime University', degree: '工学学士', degreeOther: 'Bachelor of Engineering', notes: ['学位证编号待核实'] }], work: [{ company: '北岭生物', title: '技术员（实习）', start: '2023-10' }] });
    expect(p.education[0].school).toMatchObject({ zh: '东临海事大学', en: 'Donglin Maritime University' });
    expect(p.education[0].school.status).toEqual({ zh: 'manual', en: 'manual' });
    expect(p.education[0].notes).toEqual(['学位证编号待核实']);
    expect(p.education[0].highlights).toEqual([]);
    expect(p.education[0].actualConferralDate).toBeUndefined();
    expect(p.work[0].kind).toBe('internship');
    expect(p.work[0].end).toBe('');
  });
  it('导入时保存完整原始文本，可检索；normalize 后不丢失', () => {
    const text = '原文'.repeat(7000);
    const out = applyImportPlan(emptyProfile(), rawToProfile({ name: '测试' }), { items: [], basics: [], otherUncertain: [] }, { id: 's1', at: '2026-01-01T00:00:00Z', files: ['模拟.txt'], text });
    expect(normalizeProfile(JSON.parse(JSON.stringify(out))).sourceTexts![0].text.length).toBe(14000);
  });
});

describe('导入安全', () => {
  const SAMPLE = normalizeProfile(structuredClone(sample));
  it('已确认的现有数据不会被默认覆盖；替换已确认条目需要再次确认', () => {
    const base = rawToProfile({ work: [{ company: '模拟公司丁', title: '实习生', start: '2023-10', end: '2024-06' }] });
    base.work[0].userConfirmedAt = '2026-01-01T00:00:00Z';
    const inc = rawToProfile({ work: [{ company: '模拟公司丁', title: '实习生', start: '2023-10', end: '2024-07' }] });
    const plan = buildImportPlan(base, inc, []);
    const w = plan.items[0];
    expect(w.conflicts[0].useNew).toBe(false);
    expect(w.matchConfirmed).toBe(true);
    const p2: ImportPlan = { ...plan, items: [{ ...w, action: 'replace' }] };
    expect(() => applyImportPlan(base, inc, p2)).toThrow(/确认过/);
    const out = applyImportPlan(base, inc, { ...p2, items: [{ ...w, action: 'replace', overrideConfirmed: true }] });
    expect(out.work).toHaveLength(1); expect(out.work[0].end).toBe('2024-07'); expect(out.work[0].id).toBe(base.work[0].id);
    expect(out.work[0].mergeHistory![0].fieldsOverwritten[0].old).toContain('2024-06');
  });
  it('检测示例数据残留；替换后不再残留 Senior Frontend Engineer，照片保留', () => {
    const base = structuredClone(SAMPLE); base.profile.photo = 'data:image/png;base64,AAAA';
    expect(sampleResidue(base, SAMPLE).length).toBeGreaterThan(0);
    const inc = rawToProfile(buggyAiOutput());
    const plan = buildImportPlan(base, inc, []);
    const p2: ImportPlan = { ...plan, items: plan.items.map((x) => (x.action === 'undecided' ? { ...x, action: 'merge' } : x)) };
    expect(planSummary(p2, 'replace', base).pending).toBe(0);
    const out = applyReplace(base, inc, p2);
    expect(JSON.stringify(out)).not.toMatch(/Senior Frontend Engineer|前端/);
    expect(sampleResidue(out, SAMPLE)).toEqual([]);
    expect(out.profile.photo).toBe('data:image/png;base64,AAAA');
    expect(out.education).toHaveLength(2); expect(out.work).toHaveLength(1);
  });
  it('识别 / 预览不修改现有资料', () => {
    const base = structuredClone(SAMPLE); const snap = JSON.stringify(base);
    const inc = rawToProfile(buggyAiOutput());
    const plan = buildImportPlan(base, inc, []); planSummary(plan, 'merge', base);
    for (const it of plan.items) mergePreview(base, inc, it);
    expect(JSON.stringify(base)).toBe(snap);
  });
});
