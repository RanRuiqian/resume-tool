/**
 * 测试用途 · 仿「真实母库」字段结构的虚构资料：只模仿结构（双学位含预计毕业、实习、核心 + 辅助项目、课程实验、
 * 学生干部 / 社团、志愿服务、证书、长课程列表），所有人名、学校、单位、内容均为虚构。
 * 多条经历故意不填 kind，模拟旧版资料，用来检验分类推断。
 */
import type { LocalizedText, ProfileDoc } from '../../../src/types';
import { normalizeProfile } from '../../../src/storage/profileIO';
import { TEST_PHOTO } from './engineerProfile';

let n = 0;
const L = (zh: string, en: string): LocalizedText => ({ id: `m-${++n}`, zh, en, source: 'zh', status: { zh: 'manual', en: 'confirmed' } });
const B = (k: number, zh: string, en: string) => Array.from({ length: k }, (_, i) => L(`${zh}（要点 ${i + 1}）`, `${en} (point ${i + 1})`));

const COURSES = ['理论力学', '材料力学', '机械原理', '机械设计', '工程制图', '互换性与测量技术', '机械制造技术基础', '液压与气压传动', '控制工程基础', '数控技术', '有限元分析', '机电传动控制', '测试技术', '工程材料', 'C 语言程序设计', '单片机原理', '机械振动', '现代设计方法'];
const COURSES_EN = ['Theoretical Mechanics', 'Mechanics of Materials', 'Theory of Machines', 'Machine Design', 'Engineering Drawing', 'Tolerances and Measurement', 'Manufacturing Technology', 'Hydraulic and Pneumatic Transmission', 'Control Engineering', 'CNC Technology', 'Finite Element Analysis', 'Electromechanical Drive Control', 'Measurement Technology', 'Engineering Materials', 'C Programming', 'Microcontroller Principles', 'Mechanical Vibration', 'Modern Design Methods'];

export interface MukuVariant { photo?: boolean; rich?: boolean }

export function mukuProfile(v: MukuVariant = {}): ProfileDoc {
  n = 0;
  const rich = !!v.rich;
  const raw = {
    version: '1', primaryLanguage: 'zh', glossary: [],
    profile: {
      name: L('李样例', 'Yang Li'), headline: L('测试用途 · 虚构母库结构样例｜求职意向：结构设计工程师', 'TEST SAMPLE (fictional) | Structural Design Engineer'), summary: L('', ''),
      photo: v.photo ? TEST_PHOTO : undefined, photoAspect: 0.75,
      contacts: { phone: '139-0000-0000', email: 'muku.sample@example.com', location: L('武汉', 'Wuhan, China') },
      personal: { birth: '2001.02', gender: '女', hometown: '样例省', politics: '中共党员' },
    },
    education: [
      { id: 'e-m', school: L('样例交通大学（虚构）', 'Sample Jiaotong University (fictional)'), degree: L('工学硕士', 'Master of Engineering'), major: L('机械工程', 'Mechanical Engineering'),
        start: '2025-09', end: '', expectedConferralDate: '2028-06', highlights: [L('研究方向：轨道车辆转向架结构疲劳', 'Research focus: fatigue of railway bogie structures')] },
      { id: 'e-b', school: L('样例工业大学（虚构）', 'Sample University of Technology (fictional)'), degree: L('工学学士', 'Bachelor of Engineering'), major: L('机械设计制造及其自动化', 'Mechanical Design, Manufacturing and Automation'),
        start: '2021-09', end: '2025-06', actualConferralDate: '2025-06', courses: COURSES,
        highlights: [L(`主修课程：${COURSES.join('、')}`, `Core courses: ${COURSES_EN.join(', ')}`)] },
    ],
    projects: [
      { id: 'p-core1', kind: 'core', nature: '硕士课题', name: L('转向架构架焊缝疲劳寿命评估（虚构课题）', 'Fatigue Life Assessment of Bogie Frame Welds (fictional)'), role: L('课题组成员', 'Research Team Member'), start: '2025-10', end: 'present', tags: [],
        bullets: B(rich ? 6 : 3, '用 ANSYS 计算焊缝热点应力并按 IIW 推荐曲线估算寿命', 'Computed weld hot-spot stress in ANSYS and estimated life with IIW curves') },
      { id: 'p-core2', kind: 'core', nature: '本科毕业设计', name: L('小型桁架机械手结构设计（毕业设计）', 'Structural Design of a Small Gantry Manipulator (Graduation Project)'), role: L('个人完成', 'Individual'), start: '2024-12', end: '2025-05', tags: [],
        bullets: B(rich ? 5 : 2, '完成同步带传动选型与横梁刚度校核', 'Selected the timing-belt drive and checked beam stiffness') },
      { id: 'p-aux1', kind: 'auxiliary', nature: '课程实验', name: L('材料力学拉伸与扭转实验', 'Tensile and Torsion Tests in Mechanics of Materials'), role: L('实验小组成员', 'Lab Group Member'), start: '2023-03', end: '2023-06', tags: [],
        bullets: B(2, '记录低碳钢应力-应变曲线并计算屈服强度', 'Recorded stress-strain curves of low-carbon steel and computed yield strength') },
      { id: 'p-aux2', kind: 'auxiliary', nature: '课程设计', name: L('二级展开式圆柱齿轮减速器课程设计', 'Two-Stage Cylindrical Gear Reducer Course Project'), role: L('个人完成', 'Individual'), start: '2023-12', end: '2024-01', tags: [],
        bullets: B(rich ? 4 : 2, '完成齿轮与轴的强度校核并绘制装配图', 'Checked gear and shaft strength and drew the assembly') },
      ...(rich ? [3, 4, 5, 6].map((k) => ({ id: `p-aux${k}`, kind: 'auxiliary', nature: '课程实验', name: L(`测试技术课程实验 ${k}：应变片电桥测量`, `Measurement Technology Lab ${k}: Strain-Gauge Bridge Measurement`), role: L('实验小组成员', 'Lab Group Member'), start: '2024-03', end: '2024-06', tags: [],
        bullets: B(3, '搭建半桥电路并标定灵敏度', 'Built a half-bridge circuit and calibrated sensitivity') })) : []),
    ],
    // 以下 work 条目故意不填 kind（旧资料），由名称推断
    work: [
      { id: 'w-intern', company: L('样例轨道装备有限公司（虚构）', 'Sample Rail Equipment Co., Ltd. (fictional)'), title: L('结构设计实习生', 'Structural Design Intern'), start: '2024-07', end: '2024-08', tags: [],
        bullets: B(rich ? 5 : 2, '参与车体附件三维建模与出图', 'Modeled and drew car-body attachments') },
      { id: 'w-ra', company: L('样例精密测量研究所（虚构）', 'Sample Precision Metrology Institute (fictional)'), title: L('兼职科研助理', 'Part-time Research Assistant'), start: '2025-02', end: '2025-06', tags: [], kind: 'parttime',
        bullets: B(2, '整理三坐标测量数据并编写 Python 处理脚本', 'Organized CMM data and wrote Python processing scripts') },
      { id: 'w-su', company: L('样例工业大学机械学院学生会（虚构）', 'Student Union, School of Mechanical Engineering (fictional)'), title: L('学术部部长', 'Head of Academic Affairs'), start: '2022-09', end: '2023-06', tags: [],
        bullets: B(rich ? 3 : 1, '组织学院学术讲座并统筹报名', 'Organized school academic talks and coordinated registration') },
      { id: 'w-monitor', company: L('机械 2101 班（虚构）', 'Class 2101, Mechanical Engineering (fictional)'), title: L('班长', 'Class Monitor'), start: '2021-09', end: '2025-06', tags: [],
        bullets: B(1, '协助辅导员处理班级事务', 'Assisted the counselor with class affairs') },
      { id: 'w-robot', company: L('机器人创新俱乐部（虚构）', 'Robotics Innovation Club (fictional)'), title: L('机械组组长', 'Mechanical Team Lead'), start: '2022-03', end: '2023-12', tags: [], kind: 'other',
        bullets: B(rich ? 3 : 1, '负责比赛机器人底盘设计与装配', 'Designed and assembled the competition robot chassis') },
      { id: 'w-vol', company: L('样例城市马拉松赛事（虚构）', 'Sample City Marathon (fictional)'), title: L('赛事志愿者', 'Event Volunteer'), start: '2023-04', end: '2023-04', tags: [],
        bullets: B(1, '负责补给站物资分发', 'Handled supplies at a refreshment station') },
    ],
    skills: [
      ['SolidWorks', 'SolidWorks', '设计软件', 'Design Software'], ['ANSYS', 'ANSYS', '设计软件', 'Design Software'],
      ['Python', 'Python', '编程', 'Programming'], ['英语 CET-6', 'Languages: English: CET-6', '语言', 'Languages'],
    ].map(([zh, en, cz, ce], i) => ({ id: `s-${i}`, name: L(zh, en), category: L(cz, ce) })),
    certificates: [
      { id: 'c-1', name: L('机械 CAD 绘图员证书（测试样例）', 'Mechanical CAD Drafter Certificate (test sample)'), issuer: L('样例认证中心', 'Sample Certification Center'), date: '2023-06' },
      { id: 'c-2', name: L('全国计算机等级考试二级（C 语言）', 'National Computer Rank Examination Level 2 (C Programming)'), issuer: L('样例考试中心', 'Sample Exam Center'), date: '2022-12' },
    ],
    awards: [
      { id: 'a-1', name: L('样例省大学生先进成图技术与产品信息建模创新大赛（测试样例）团体一等奖', 'First Prize (Team), Sample Provincial College Students Advanced Graphics Technology and Product Information Modeling Innovation Competition (test sample)'), issuer: L('样例组委会', 'Sample Organizing Committee'), date: '2023-05' },
      { id: 'a-2', name: L('校级一等奖学金', 'First-Class University Scholarship'), issuer: L('样例工业大学', 'Sample University of Technology'), date: '2022-10' },
    ],
  };
  return normalizeProfile(raw);
}
