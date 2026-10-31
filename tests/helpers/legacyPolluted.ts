import { emptyProfile } from '../../src/storage/profileIO';
import type { LocalizedText, ProfileDoc } from '../../src/types';

/** 虚构的「旧版导入污染」资料：教育 2 / 工作 7 / 项目 14 / 技能 29 / 证书 2 / 获奖 5 / 其他要点 22（总结与要点混入核验说明、写作建议、第一人称，英文为机翻） */
const META = ['实际职责以本人核实为准。', '具体情况请自行确认。', '该经历可能适用于某些岗位。', '这可以作为求职材料。', '建议在简历中强调动手能力。', '尚需补充相关证据。', '本人实际掌握程度有待确认。', '以上信息仅供参考。'];
const m = (zh: string, en = ''): LocalizedText => ({ zh, en, status: { zh: 'manual', ...(en ? { en: 'machine' as const } : {}) } });
export function legacyPolluted(): ProfileDoc {
  const p = emptyProfile();
  p.profile.name = m('测试用户七', 'Test User Seven');
  p.profile.summary = m('我熟悉机械设计与测试流程。以上信息仅供参考。', 'I am familiar with mechanical design. For reference only.');
  p.education = [0, 1].map((i) => ({ id: `edu${i}`, enabled: true, school: m(`示例大学${i}`, `Example University ${i}`), degree: m(i ? '硕士' : '学士', i ? 'Master' : 'Bachelor'), major: m('机械工程', 'Mechanical Engineering'), start: i ? '2024-09' : '2020-09', end: i ? '2027-01' : '2024-06', ...(i ? { expectedConferralDate: '2027-01' } : { actualConferralDate: '2024-06' }), highlights: [m(`主修课程覆盖力学与控制${i}。${META[i]}`, `Core courses in mechanics ${i}.`)] })) as unknown as ProfileDoc['education'];
  p.work = Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, enabled: true, company: m(`示例公司${i}`, `Example Co ${i}`), title: m('测试实习生', 'Test Intern'), kind: 'internship', start: '2023-07', end: '2023-09', bullets: [m(`我在公司使用设备进行第${i + 1}轮测试。${META[i % 8]}`, `I used equipment for test round ${i + 1}.`), m(`整理测试数据 ${i + 3} 份。`, `Compiled ${i + 3} test reports.`)] })) as unknown as ProfileDoc['work'];
  p.projects = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, enabled: true, name: m(`课程实验${i + 1}`, `Course Lab ${i + 1}`), role: m('组员', 'Member'), kind: 'auxiliary', nature: '课程实验', start: '2022-03', end: '2022-06', tags: [], bullets: [m(`完成夹具设计与装配第${i + 1}版。${META[(i + 3) % 8]}`, `Designed fixture v${i + 1}.`), ...(i % 3 === 0 ? [m('第一版方案因刚度不足失败，后改为加强筋结构。')] : [])] })) as unknown as ProfileDoc['projects'];
  p.skills = Array.from({ length: 29 }, (_, i) => ({ id: `s${i}`, enabled: true, name: m(i % 10 === 0 ? `技能${i}（本人实际掌握程度有待确认）` : `技能${i}`, `Skill ${i}`), level: '' })) as unknown as ProfileDoc['skills'];
  p.certificates = [0, 1].map((i) => ({ id: `c${i}`, enabled: true, name: m(`示例证书${i}`, `Cert ${i}`), issuer: m('示例协会', 'Example Assoc'), date: '2023-01' })) as unknown as ProfileDoc['certificates'];
  p.awards = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, enabled: true, name: m(`示例奖项${i}`, `Award ${i}`), issuer: m('示例学院', 'Example College'), date: '2022-12', highlights: [] })) as unknown as ProfileDoc['awards'];
  for (const e of [...p.work, ...p.projects]) e.bullets.forEach((b, j) => { b.id = `${e.id}-b${j + 1}`; });
  for (const e of p.education) e.highlights.forEach((b, j) => { b.id = `${e.id}-h${j + 1}`; });
  return p;
}
