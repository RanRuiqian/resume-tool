import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dupMatch } from '../src/ai/dedupe';
import { checkAgainstSource, dateContexts, CRITICAL } from '../src/ai/sourceCheck';
import { chunkText, rawToProfile, type Raw } from '../src/ai/importProfile';
import { applyImportPlan, buildImportPlan, type ImportPlan } from '../src/ai/importPlan';
import { emptyProfile } from '../src/storage/profileIO';

// 全部为虚构数据（v1.6.1 回归测试）
const E = (school: string, degree: string, major: string, start: string, end: string) => ({ id: 'e' + Math.random(), school: school ? (/[\u4e00-\u9fff]/.test(school) ? { zh: school } : { en: school }) : {}, degree: /[\u4e00-\u9fff]/.test(degree) ? { zh: degree } : { en: degree }, major: /[\u4e00-\u9fff]/.test(major) ? { zh: major } : { en: major }, start, end } as never);

describe('修正 1：教育去重安全', () => {
  it('中英文校名无法对应 + 相同日期 → 只是「可能重复」，不自动合并', () => {
    const m = dupMatch('education', E('模拟北辰大学', '工学学士', '机械工程', '2018-09', '2022-06'), E('Nanfeng Institute of Technology', 'Bachelor of Engineering', 'Mechanical Engineering', '2018-09', '2022-06'));
    expect(m.strong).toBe(false); expect(m.score).toBeGreaterThanOrEqual(0.55);
  });
  it('同校、同层次但不同学位 / 专业（双学位）→ 不合并', () => {
    const m = dupMatch('education', E('模拟北辰大学', '工学学士', '机械工程', '2018-09', '2022-06'), E('模拟北辰大学', '经济学学士', '金融学', '2018-09', '2022-06'));
    expect(m.strong).toBe(false); expect(m.score).toBeLessThan(0.55);
  });
  it('同校不同学历层次 → 不合并', () => {
    expect(dupMatch('education', E('模拟北辰大学', '工学学士', '机械工程', '2018-09', '2022-06'), E('模拟北辰大学', '工学硕士', '机械工程', '2018-09', '2022-06')).score).toBe(0);
  });
  it('同期不同学校（同语言）→ 不提示重复', () => {
    expect(dupMatch('education', E('模拟北辰大学', '工学学士', '机械工程', '2018-09', '2022-06'), E('模拟南风大学', '工学学士', '机械工程', '2018-09', '2022-06')).score).toBe(0);
  });
  it('保留可靠去重：同名 + 同学位 + 同日期 → 自动合并', () => {
    const m = dupMatch('education', E('模拟北辰大学', '工学学士', '机械工程', '2018-09', '2022-06'), E('模拟北辰大学 ', '工学学士', '机械工程', '2018-09', '2022-06'));
    expect(m.strong).toBe(true);
  });
  it('中英文写法通过别名可对应时 → 可自动合并', () => {
    const a = { ...(E('模拟北辰大学', '工学学士', '机械工程', '2018-09', '2022-06') as object), aliases: ['Beichen Mock University'] } as never;
    expect(dupMatch('education', a, E('Beichen Mock University', 'Bachelor of Engineering', 'Mechanical Engineering', '2018-09', '2022-06')).strong).toBe(true);
  });
});

describe('修正 2：四种日期严格区分', () => {
  const src = '模拟南风大学 应用工程硕士\n时间：2026.02—预计 2027.01（预计授予学位时间，尚未授予）\n';
  it('「预计 2027.01」被 AI 当成实际授予 → 清空实际授予、保留为预计，并给出严重提示', () => {
    const p = checkAgainstSource(rawToProfile({ education: [{ school: '模拟南风大学', degree: '应用工程硕士', start: '2026-02', end: '2027-01', actualConferralDate: '2027-01' }] }), src);
    const e = p.education[0];
    expect(e.actualConferralDate).toBe('');
    expect(e.expectedConferralDate).toBe('2027-01');
    expect(e.end).toBe('');
    expect(e.start).toBe('2026-02');
    expect(e.uncertain!.some((x) => x.startsWith(CRITICAL) && x.includes('预计'))).toBe(true);
  });
  it('原文明确「已于 … 实际授予」→ 保留实际授予日期', () => {
    const p = checkAgainstSource(rawToProfile({ education: [{ school: '模拟北辰大学', degree: '工学学士', start: '2019-09', end: '2023-06', actualConferralDate: '2023-06' }] }), '时间：2019.09—2023.06　学位已于 2023.06 实际授予。');
    expect(p.education[0].actualConferralDate).toBe('2023-06'); expect(p.education[0].end).toBe('2023-06');
    expect(p.education[0].uncertain ?? []).toHaveLength(0);
  });
  it('只出现日期、没有「已授予」证据 → 实际授予日期留空并严重提示', () => {
    const p = checkAgainstSource(rawToProfile({ education: [{ school: '模拟北辰大学', start: '2019-09', end: '2023-06', actualConferralDate: '2023-06' }] }), '模拟北辰大学 2019年9月—2023年6月');
    expect(p.education[0].actualConferralDate).toBe('');
    expect(p.education[0].uncertain!.some((x) => x.startsWith(CRITICAL))).toBe(true);
  });
  it('英文 expected / 在读 同样识别', () => {
    const p = checkAgainstSource(rawToProfile({ lang: 'en', education: [{ school: 'Mock Bay University', start: '2026-02', end: '2027-01', actualConferralDate: '2027-01' }] }), 'Mock Bay University, Feb 2026 – Jan 2027 (expected)');
    expect(p.education[0].actualConferralDate).toBe(''); expect(p.education[0].expectedConferralDate).toBe('2027-01');
  });
  it('原文没有的可全职入职 / 课程结束日期 → 清空', () => {
    const p = checkAgainstSource(rawToProfile({ education: [{ school: '模拟北辰大学', start: '2019-09', availableFullTimeDate: '2027-03', courseCompletionDate: '2026-12' }] }), '模拟北辰大学 2019.09 入学');
    expect(p.education[0].availableFullTimeDate).toBe(''); expect(p.education[0].courseCompletionDate).toBe('');
  });
  it('dateContexts 支持多种写法', () => {
    for (const t of ['2027.01', '2027-1', '2027/01', '2027年1月', 'Jan 2027', 'January, 2027']) expect(dateContexts(t, '2027-01').length).toBe(1);
    expect(dateContexts('2027.11', '2027-01')).toHaveLength(0);
  });
});

describe('修正 3：母库完整性（mock AI 分段输出，虚构资料）', () => {
  const text = readFileSync(new URL('./fixtures/files/mock_master_profile_zh.txt', import.meta.url), 'utf8');
  const COURSES = Array.from({ length: 76 }, (_, i) => `课程${i + 1}`);
  const segs: Raw[] = [
    { name: '测试用户庚', education: [
      { school: '东临海事大学', schoolOther: 'Donglin Maritime University', degree: '工学学士', major: '轮机工程', start: '2019-09', end: '2023-06', actualConferralDate: '2023-06', courses: COURSES.slice(0, 40), coursesInText: 40 },
      { school: 'Sunbay University Malaysia', degree: 'Master of Applied Engineering', major: 'Industrial AI & Robotics', start: '2026-02', end: '2027-01', actualConferralDate: '2027-01', availableFullTimeDate: '2027-03' },
      { school: '桑湾大学马来西亚分校', degree: '应用工程硕士', major: '工业人工智能与机器人', start: '2026-02', end: '2027-01' }],
      work: [{ company: '北岭生物科技股份有限公司', title: '自动化生产技术员', kind: 'fulltime', start: '2023-10', end: '2024-06' },
        { company: '北岭生物科技股份有限公司', companyOther: 'Beiling Biotech Co., Ltd.', title: '自动化生产技术员（实习）', kind: 'internship', start: '2023-10', end: '2024-06', bullets: ['负责 PLC 程序维护'] },
        { company: '某教育机构', title: '数学家教', kind: 'fulltime', start: '2022-03', end: '2022-12' }],
      projects: [
        { name: 'Low-cost Smart Stethoscope for Clinical Training', nameOther: '用于临床教学的低成本智能听诊器', aliases: ['A Low-cost Smart Stethoscope for Clinical Training'], kind: 'core', start: '2026-03', end: '2026-11' },
        { name: '用于临床教学的低成本智能听诊器', kind: 'core', start: '2026-03', end: '2026-11' },
        { name: '基于 AMESim 的减压阀动态性能分析', aliases: ['本科 AMESim 毕业设计'], kind: 'core', start: '2022-12', end: '2023-05' },
        { name: '本科 AMESim 毕业设计', kind: 'core' },
        { name: '课程实验：液压回路搭建', kind: 'auxiliary', nature: '课程实验', start: '2021-10', end: '2021-12' },
        { name: '教学实训：工业机器人示教编程', kind: 'auxiliary', nature: '教学实训', start: '2022-07' },
        { name: '个人求职简历工具', kind: 'auxiliary', start: '2026-09', end: 'present' }],
      certificates: [{ name: '全国大学英语六级', issuer: '模拟考试中心', date: '2020-12' }] },
    // 第 2、3 段：长成绩单 / 补充说明里再次提到的片段（日期不在本段原文中）
    { education: [{ school: '东临海事大学', major: '轮机工程', courses: COURSES.slice(40), coursesInText: 36 }], work: [{ company: '北岭生物', title: '', kind: 'internship' }] },
    { work: [{ company: '北岭生物科技股份有限公司', title: '自动化生产技术员（实习）', start: '2023-10', end: '2024-06' }], projects: [{ name: '个人求职简历工具', start: '2025-01' }] },
  ];
  it('全流程：2 段学历、1 份实习、2 个核心项目、辅助项目齐全、76 门课、无编造信息', async () => {
    let n = 0;
    vi.resetModules();
    vi.doMock('../src/ai/provider', () => ({ chatJson: async () => structuredClone(segs[Math.min(n++, segs.length - 1)]) }));
    const { importProfileDetailed } = await import('../src/ai/importProfile');
    expect(chunkText(text).length).toBe(3);
    const { profile, uncertain } = await importProfileDetailed({} as never, text);
    const plan = buildImportPlan(emptyProfile(), profile, uncertain);
    // 中英文硕士只提示可能重复，需用户确认（这里模拟用户确认合并）
    expect(plan.items.some((x) => x.section === 'education' && x.status === 'internal' && x.action === 'undecided')).toBe(true);
    const decided: ImportPlan = { ...plan, items: plan.items.map((x) => (x.action === 'undecided' ? { ...x, action: 'merge' } : x)) };
    const out = applyImportPlan(emptyProfile(), profile, decided);
    expect(out.education).toHaveLength(2);
    const [ba, ma] = out.education;
    expect(ba.courses).toHaveLength(76);
    expect(ba.actualConferralDate).toBe('2023-06');
    expect(ma.actualConferralDate || '').toBe('');
    expect(ma.expectedConferralDate).toBe('2027-01');
    expect(ma.availableFullTimeDate || '').toBe('');
    const bl = out.work.filter((w) => (w.company.zh ?? '').includes('北岭'));
    expect(bl).toHaveLength(1); expect(bl[0].kind).toBe('internship');
    expect(out.work.find((w) => w.company.zh === '某教育机构')!.kind ?? '').toBe(''); // 原文只写「兼职」，AI 编的「正式工作」被清除
    expect(out.projects.filter((p) => p.kind === 'core')).toHaveLength(2);
    expect(out.projects.find((p) => p.name.zh === '个人求职简历工具')!.start).toBe('2026-09'); // 第 3 段编造的日期被清除，不覆盖原文日期
    expect(out.projects.filter((p) => p.kind === 'auxiliary').map((p) => p.name.zh)).toEqual(['课程实验：液压回路搭建', '教学实训：工业机器人示教编程', '个人求职简历工具']);
    const cert = out.certificates[0];
    expect(cert.date).toBe(''); expect(cert.issuer.zh ?? '').toBe('');
    vi.doUnmock('../src/ai/provider');
  });
});
