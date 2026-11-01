import { personalFixture } from './v112PersonalFixture';
import { normalizeProfile } from '../../src/storage/profileIO';
import { normalizeCourse } from '../../src/storage/courses';

/** 82 门合成课程 + 同一项目的两个学分单元。所有名称/成绩/身份均为虚构。 */
export function coursesFixture() {
  const p = normalizeProfile(personalFixture());
  p.profile.summary = { zh: '测试用户三十具有轮机工程本科背景，参与过模拟生产装配与课程结构设计实践。', en: 'Test User Thirty has an undergraduate background in Marine Engineering and has participated in simulated production assembly and structural design coursework.', status: { zh: 'confirmed', en: 'confirmed' } };
  p.profile.headline = { zh: '轮机工程背景 · 工程方向应届生', en: 'Marine Engineering background · Engineering candidate' };
  p.profile.contacts.github = 'https://example.com/resume-tool'; p.profile.contacts.website = 'https://example.com/portfolio';
  p.education.push({ ...structuredClone(p.education[0]), id: 'edu-master', school: { zh: '模拟工程大学', en: 'Fictional Engineering University' }, degree: { zh: '工程硕士在读', en: 'Engineering Master student' }, major: { zh: '工程', en: 'Engineering' }, highlights: [], start: '2025-01', end: 'present' });
  p.courses = Array.from({ length: 76 }, (_, i) => normalizeCourse({
    educationId: 'edu-1', school: '虚构海事大学', level: 'bachelor', term: `Term ${Math.floor(i / 10) + 1}`, code: `MOCKB${String(i + 1).padStart(3, '0')}`,
    name: { zh: `模拟基础课程${i + 1}`, en: `Fictional Foundation Course ${i + 1}` }, credits: '3', grade: { raw: i > 73 ? '' : `MOCK-UG-GRADE-${i + 1}`, status: i > 73 ? 'unverified' : 'recorded' },
    synopsis: { zh: '介绍示例工程知识与基础分析方法，仅为虚构测试课程说明。' }, knowledgeTags: ['基础知识'], evidenceLevel: 'inferred', sources: [{ id: 'mock-transcript', label: '虚构本科成绩单' }], confirmation: 'confirmed',
  }));
  for (let i = 0; i < 6; i++) p.courses.push(normalizeCourse({ educationId: 'edu-master', school: '模拟工程大学', level: 'master', term: i < 3 ? 'Mock S1' : 'Mock S2', code: `MOCKM${i + 1}`, name: { zh: `模拟进阶课程${i + 1}`, en: `Fictional Advanced Course ${i + 1}` },
    grade: { raw: i < 3 ? `MOCK-PG-GRADE-${i + 1}` : '', status: i < 3 ? 'recorded' : 'not-released' }, synopsis: {}, confirmation: 'confirmed', evidenceLevel: 'official' }));
  for (const letter of ['A', 'B']) p.courses.push(normalizeCourse({ educationId: 'edu-master', level: 'master', code: `MOCKPROJECT${letter}`, name: { en: `Industry-based project ${letter}` }, projectIds: ['core'], confirmation: 'confirmed' }));
  p.courses[0].name = { zh: '模拟供应链基础', en: 'Fictional Supply Chain Foundations' }; p.courses[0].aliases = ['Supply Chain']; p.courses[0].knowledgeTags = ['供应链优化', '生产流程'];
  p.courses[0].synopsis = { zh: '介绍数据驱动的供应链优化基础，不证明供应商开发或合同谈判经验。' };
  p.courses[1].name = { zh: '模拟船舶辅机', en: 'Fictional Marine Auxiliary Machinery' }; p.courses[1].synopsis = { zh: '根据名称推断可能涉及泵与辅助控制，PLC 内容待核实，不证明编程能力。' };
  return p;
}
