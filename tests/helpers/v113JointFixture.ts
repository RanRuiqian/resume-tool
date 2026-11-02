import { coursesFixture } from './v113CoursesFixture';
import { newJointGroup, newJointRole, makeJointJob, roleInput, roleInputHash, jobRequirements } from '../../src/joint/jobs';
import type { JobParse } from '../../src/types';
import type { AiSelectionOutput } from '../../src/ai/aiPlanner';
import { personalPlan } from './v112PersonalFixture';

export function jointFixture(count = 3) {
  const p = coursesFixture(); p.courses = p.courses!.slice(0, 2);
  const group = newJointGroup(); group.id = 'fictional-joint-group'; group.company = '模拟联合工程公司';
  const names = ['模拟机械设计工程师', '模拟生产优化工程师', '模拟控制工程师'];
  group.roles = Array.from({ length: count }, (_, i) => ({ ...newJointRole(), id: `fictional-role-${i}`, name: names[i], text: `虚构 JD ${i + 1}：工程背景；${i === 0 ? '装配验证、NX 使用经验' : i === 1 ? '生产流程优化的理论基础' : 'PLC 编程实际经验'}`, url: `https://example.com/jobs/${i}` }));
  const jobs: JobParse[] = group.roles.map((r, i) => ({ id: `fictional-job-${i}`, createdAt: '2026-01-01', rawText: roleInput(group, r), jdLanguage: 'zh', company: { full: group.company, short: group.company }, title: { zh: r.name, en: `Fictional Role ${i + 1}` }, roleAbbr: `MOCK${i}`, yearsRequired: null, summary: '虚构岗位', keywords: [], responsibilities: [], niceToHave: [],
    mustHave: [{ zh: '工程背景', en: 'Engineering background' }, { zh: i === 0 ? '装配验证' : i === 1 ? '生产流程优化的理论基础' : 'PLC 编程实际经验', en: i === 0 ? 'Assembly validation' : i === 1 ? 'Theoretical foundation in production process optimisation' : 'Practical PLC programming experience' }, ...(i === 0 ? [{ zh: 'NX 使用经验', en: 'NX usage experience' }] : [])] }));
  group.roles.forEach((r, i) => { r.analysisId = jobs[i].id; r.analyses = [{ jobId: jobs[i].id, revision: 1, inputHash: roleInputHash(group, r), at: '2026-01-01' }]; });
  const job = makeJointJob(group, jobs), plan: AiSelectionOutput = { ...personalPlan(), courses: [p.courses[0].id] };
  const refs = jobRequirements(job);
  plan.requirements = refs.map((r) => ({ requirementId: r.id, text: r.text.zh, tier: r.tier, assessment: r.text.zh === '工程背景' ? 'direct' : r.text.zh === '装配验证' ? 'transferable' : r.text.zh.includes('理论基础') ? 'learning' : 'gap',
    evidenceIds: r.text.zh === '工程背景' ? ['edu-1'] : r.text.zh === '装配验证' ? ['career-b1', 'core-b2'] : r.text.zh.includes('理论基础') ? [p.courses![0].id] : [],
    reason: r.text.zh.includes('理论基础') ? '课程内容涉及数据驱动的流程优化，提供知识背景；不证明供应商开发或企业流程优化实操。' : r.text.zh.includes('实际经验') || r.text.zh.includes('NX') ? '没有对应的实际使用事实，不能由课程推断熟练度。' : '已有教育或实践事实可提供工程背景，具体岗位熟练程度仍需人工核实。' }));
  const common = refs.filter((r) => r.text.zh === '工程背景'), rest = refs.filter((r) => r.text.zh !== '工程背景');
  plan.jointSummary = { common: count > 1 ? [{ requirementIds: common.map((r) => r.id), reason: '岗位均要求工程背景，可由真实学历支持。' }] : [],
    complementary: [...(count === 1 ? common : []), ...rest].map((r) => ({ requirementIds: [r.id], reason: '该岗位特有方向，按实际事实兼顾；缺失要求不补造。' })),
    conflicts: count === 3 ? [{ requirementIds: [rest[0].id, rest.at(-1)!.id], reason: '机械装配与 PLC 实操要求方向不同，现有资料无法同时强匹配。' }] : [] };
  return { p, group, jobs, job, plan };
}
