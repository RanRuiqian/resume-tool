/**
 * 测试用途 · 虚构工科样例（4 套正式预设共用同一份事实）。
 * 人名、学校、公司、竞赛名称均为虚构，不对应任何真实个人或单位；照片为灰色剪影 TEST 占位图。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LocalizedText, ProfileDoc } from '../../../src/types';
import { normalizeProfile } from '../../../src/storage/profileIO';

let n = 0;
const L = (zh: string, en: string, id?: string): LocalizedText => ({ id: id ?? `t-${++n}`, zh, en, source: 'zh', status: { zh: 'manual', en: 'confirmed' } });
export const TEST_PHOTO = 'data:image/png;base64,' + readFileSync(resolve(__dirname, 'test-photo-placeholder.png')).toString('base64');

export interface Variant { photo?: boolean; long?: boolean; nearOnePage?: boolean; noWork?: boolean }

export function engineerProfile(v: Variant = {}): ProfileDoc {
  n = 0;
  const raw = {
    version: '1', primaryLanguage: 'zh', glossary: [],
    profile: {
      name: L('张测试', 'Ce Zhang'),
      headline: L('测试用途 · 虚构样例｜求职意向：机械设计工程师', 'TEST SAMPLE (fictional) | Mechanical Design Engineer'),
      summary: L('', ''),
      photo: v.photo ? TEST_PHOTO : undefined, photoAspect: 0.75,
      contacts: { phone: '138-0000-0000', email: 'test.sample@example.com', location: L('上海', 'Shanghai, China') },
      personal: { birth: '2000.01', gender: '男', hometown: '测试省', politics: '共青团员' },
    },
    education: [
      { id: 'edu-m', school: L('华东测试理工大学（虚构）', 'East China Test University of Technology (fictional)'), degree: L('工学硕士', 'Master of Engineering'), major: L('机械工程', 'Mechanical Engineering'),
        start: '2025-09', end: '', expectedConferralDate: '2028-03', highlights: [L('研究方向：齿轮传动系统动力学与轻量化设计', 'Research focus: gear transmission dynamics and lightweight design', 'edu-m-h1')] },
      { id: 'edu-b', school: L('华东测试理工大学（虚构）', 'East China Test University of Technology (fictional)'), degree: L('工学学士', 'Bachelor of Engineering'), major: L('机械设计制造及其自动化', 'Mechanical Design, Manufacturing and Automation'),
        start: '2021-09', end: '2025-06', actualConferralDate: '2025-06', highlights: [L('GPA 3.52/4.00；主修课程：机械原理、机械设计、工程力学、液压与气压传动', 'GPA 3.52/4.00; core courses: Theory of Machines, Machine Design, Engineering Mechanics, Hydraulic and Pneumatic Transmission', 'edu-b-h1')] },
    ],
    projects: [
      { id: 'proj-1', kind: 'core', nature: v.long ? '硕士课题' : '', name: L(v.long ? '基于 ANSYS Workbench 与 Adams 刚柔耦合仿真的船用二级圆柱齿轮减速器箱体模态分析、拓扑优化与轻量化结构设计（课题组纵向项目子课题）' : '船用齿轮减速器箱体模态分析与轻量化设计', v.long ? 'Modal Analysis, Topology Optimization and Lightweight Design of a Marine Two-Stage Cylindrical Gear Reducer Housing Using ANSYS Workbench and Adams Rigid-Flexible Coupling Simulation' : 'Modal Analysis and Lightweight Design of a Marine Gear Reducer Housing'),
        role: L('课题组成员', 'Research Team Member'), start: '2025-10', end: 'present', tags: ['ANSYS', 'SolidWorks'],
        bullets: [
          L('用 SolidWorks 建立箱体三维模型，导入 ANSYS Workbench 完成前 6 阶自由模态分析，识别出 2 处共振风险区域', 'Built the housing model in SolidWorks and ran a free modal analysis of the first 6 modes in ANSYS Workbench; identified 2 resonance-risk regions', 'proj-1-b1'),
          L('对加强筋布置做拓扑优化，在一阶固有频率不低于原方案的约束下，箱体质量由 48.6 kg 降至 43.1 kg', 'Ran topology optimization on the rib layout; reduced housing mass from 48.6 kg to 43.1 kg while keeping the first natural frequency at or above the baseline', 'proj-1-b2'),
          L('按 GB/T 1184 标注关键安装面平面度 ≤ 0.02 mm、轴承孔 Φ90H7、表面粗糙度 Ra 1.6 μm，并完成工程图', 'Specified key mounting-face flatness ≤ 0.02 mm, bearing bore Φ90H7 and surface roughness Ra 1.6 μm per GB/T 1184 on the drawings', 'proj-1-b3'),
        ] },
      { id: 'proj-2', kind: 'auxiliary', nature: '课程设计', name: L('PLC 控制的物料分拣输送线', 'PLC-Controlled Material Sorting Conveyor'), role: L('小组组长（3 人）', 'Team Lead (3 students)'), start: '2024-03', end: '2024-06', tags: ['PLC'],
        bullets: [
          L('用 Siemens S7-1200 与 TIA Portal 编写梯形图程序，实现按颜色与尺寸两类传感器信号分拣', 'Programmed ladder logic on a Siemens S7-1200 in TIA Portal to sort parts by color and size sensor signals', 'proj-2-b1'),
          L('设计气缸推料机构并完成气路图，调试后在课程验收中连续运行 30 分钟无卡料', 'Designed the pneumatic pusher and its circuit diagram; ran 30 minutes without jamming at the course acceptance test', 'proj-2-b2'),
        ] },
      ...(v.long || v.nearOnePage ? [
        { id: 'proj-3', kind: 'auxiliary', nature: '课程实验', name: L('液压系统 AMESim 仿真与 MATLAB/Simulink 联合控制', 'Hydraulic System Simulation in AMESim with MATLAB/Simulink Co-Control'), role: L('个人完成', 'Individual'), start: '2024-09', end: '2024-12', tags: [],
          bullets: [
            L('在 AMESim 中搭建阀控缸模型，与 Simulink 联合仿真比较 PID 与前馈 + PID 两种控制方式的阶跃响应', 'Built a valve-controlled cylinder model in AMESim and compared step responses of PID and feedforward + PID control via Simulink co-simulation', 'proj-3-b1'),
            L('整理实验报告，记录系统压力 ≤ 16 MPa 工况下的超调量与调节时间', 'Documented overshoot and settling time at system pressure ≤ 16 MPa in the lab report', 'proj-3-b2'),
          ] },
      ] : []),
      ...(v.long ? [1, 2, 3, 4, 5].map((k) => ({ id: `proj-x${k}`, kind: 'auxiliary', nature: '课程设计', name: L(`机械设计课程设计 ${k}：带式输送机传动装置（单级圆柱齿轮减速器）`, `Machine Design Course Project ${k}: Belt Conveyor Drive (Single-Stage Cylindrical Gear Reducer)`), role: L('个人完成', 'Individual'), start: '2023-12', end: '2024-01', tags: [],
        bullets: [
          L('完成电机选型、传动比分配与齿轮、轴、轴承的强度校核，绘制 A0 装配图 1 张、零件图 3 张', 'Selected the motor, allocated transmission ratios and checked gear, shaft and bearing strength; drew 1 A0 assembly drawing and 3 part drawings', `proj-x${k}-b1`),
          L('使用 AutoCAD 与 SolidWorks 出图，按指导教师意见修改 2 轮', 'Produced drawings in AutoCAD and SolidWorks and revised them twice based on instructor feedback', `proj-x${k}-b2`),
        ] })) : []),
    ],
    work: v.noWork ? [] : [
      { id: 'work-1', kind: 'internship', company: L('测试重工装备有限公司（虚构）', 'Test Heavy Equipment Co., Ltd. (fictional)'), title: L('机械设计实习生', 'Mechanical Design Intern'), start: '2024-07', end: '2024-09', tags: [],
        bullets: [
          L('参与输送设备支架的 SolidWorks 建模与出图，完成 12 张零件图的尺寸与公差标注', 'Modeled conveyor support frames in SolidWorks and dimensioned and toleranced 12 part drawings', 'work-1-b1'),
          L('跟随工艺工程师在车间核对焊接件尺寸，整理 1 份常见装配问题清单', 'Checked welded-part dimensions on the shop floor with a process engineer and compiled a list of common assembly issues', 'work-1-b2'),
        ] },
      { id: 'work-2', kind: 'club', company: L('机械创新协会（校级社团）', 'Mechanical Innovation Society (student club)'), title: L('技术部部长', 'Head of Technical Team'), start: '2022-09', end: '2023-06', tags: [],
        bullets: [L('组织 4 次 SolidWorks 入门培训，带领 6 名成员完成竞赛作品样机装配', 'Ran 4 introductory SolidWorks workshops and led 6 members in assembling a competition prototype', 'work-2-b1')] },
    ],
    skills: [
      ['SolidWorks', 'SolidWorks', '设计软件', 'Design Software'], ['AutoCAD', 'AutoCAD', '设计软件', 'Design Software'], ['ANSYS Workbench', 'ANSYS Workbench', '设计软件', 'Design Software'],
      ['Python', 'Python', '编程与仿真', 'Programming & Simulation'], ['MATLAB/Simulink', 'MATLAB/Simulink', '编程与仿真', 'Programming & Simulation'], ['Siemens S7-1200 PLC', 'Siemens S7-1200 PLC', '编程与仿真', 'Programming & Simulation'],
      ['GD&T / 形位公差标注', 'GD&T', '工程基础', 'Engineering Fundamentals'], ['英语 CET-6（532 分）', 'English: CET-6 (score 532)', '语言', 'Languages'],
    ].map(([zh, en, cz, ce], i) => ({ id: `sk-${i}`, name: L(zh, en), category: L(cz, ce) })),
    certificates: [{ id: 'cert-1', name: L('SolidWorks 认证助理工程师（CSWA）', 'Certified SolidWorks Associate (CSWA)'), issuer: L('达索系统', 'Dassault Systèmes'), date: '2024-05' }],
    awards: [{ id: 'aw-1', name: L('全国大学生机械创新设计大赛（测试样例）省级二等奖', 'Provincial Second Prize, National Undergraduate Mechanical Innovation Design Competition (test sample)'), issuer: L('赛事组委会', 'Organizing Committee'), date: '2023-11' }],
  };
  return normalizeProfile(raw);
}
