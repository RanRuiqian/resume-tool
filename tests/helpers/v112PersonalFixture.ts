import type { ProfileDoc } from '../../src/types';
import { fictionalEngineer } from './v110Fixture';
import type { AiSelectionOutput } from '../../src/ai/aiPlanner';

/** 全部为合成资料，不使用用户提供的真实简介、院校或工作记录。 */
export function personalFixture(): ProfileDoc {
  const p = fictionalEngineer();
  p.profile.name = { zh: '测试用户三十', en: 'Test User Thirty' };
  p.profile.contacts = { email: 'test30@example.com' };
  p.profile.summary = { zh: '目前就读于虚构工程大学工程硕士，本科为机械工程专业。具有生产技术工作经历与结构设计、原型及视觉测试的课程实践背景。',
    en: 'Currently pursuing an engineering master degree at Fictional Engineering University, with an undergraduate background in mechanical engineering. Has production technology work experience and coursework in structural design, prototyping and vision testing.',
    source: 'zh', status: { zh: 'confirmed', en: 'confirmed' } };
  p.work = [
    { id: 'career', enabled: true, kind: 'fulltime', company: { zh: '模拟制造有限公司', en: 'Fictional Manufacturing Ltd.' }, title: { zh: '生产技术员', en: 'Production Technician' },
      start: '2024-07', end: '2025-02', tags: [], bullets: [{ id: 'career-b1', zh: '参与部件装配并记录尺寸检查结果。', en: 'Participated in component assembly and recorded dimensional inspection results.' }] },
    { id: 'student', enabled: true, kind: 'club', company: { zh: '虚构工程大学学生会', en: 'Fictional Engineering University Student Union' }, title: { zh: '公关部门负责人', en: 'Public Relations Coordinator' },
      start: '2025-03', end: 'present', tags: [], bullets: [{ id: 'student-b1', zh: '协调部门沟通与活动安排，整理宣传材料。', en: 'Coordinated departmental communication and event arrangements and prepared publicity materials.' },
        { id: 'student-b2', zh: '参与活动执行与反馈整理。', en: 'Participated in event delivery and feedback collation.' }] },
    { id: 'shop', enabled: true, kind: 'parttime', company: { zh: '模拟零售商店', en: 'Fictional Retail Store' }, title: { zh: '兼职店员', en: 'Part-time Assistant' },
      start: '2023-07', end: '2023-09', tags: [], bullets: [{ id: 'shop-b1', zh: '整理商品陈列。', en: 'Arranged product displays.' }] },
  ];
  p.projects = [{ ...p.projects[0], id: 'core', name: { zh: '模拟光学探头结构与测试课程项目', en: 'Fictional Optical Probe Design and Testing Course Project' },
    role: { zh: '参与', en: 'Participant' }, nature: '课程设计', tags: [], bullets: [
      { id: 'core-b1', zh: '课程项目中参与测量光学探头部件尺寸并设计模块化外壳。', en: 'In a course project, participated in measuring optical probe components and designing a modular enclosure.' },
      { id: 'core-b2', zh: '课程项目中参与原型装配并完成成像测试。', en: 'In a course project, participated in prototype assembly and completed imaging tests.' },
  ] }];
  return p;
}

export function personalPlan(): AiSelectionOutput {
  return { requirements: [{ text: '工程实践', tier: 'must', assessment: 'direct', evidenceIds: ['career-b1', 'core-b1'] }],
    entries: [{ entryId: 'career', bulletIds: ['career-b1'], reason: '真实生产环境背景，可迁移到工程岗位' },
      { entryId: 'core', bulletIds: ['core-b1', 'core-b2'], reason: '结构设计与原型测试' }],
    reserveEntries: [{ entryId: 'student', bulletIds: ['student-b1'], reason: '组织协调背景，空间允许时简写' }],
    education: [{ entryId: 'edu-1', bulletIds: [] }], skills: ['sk-1'], certificates: ['cert-1'], awards: [], tradeoffs: '保持职业背景，按岗位展开工程实践' };
}
