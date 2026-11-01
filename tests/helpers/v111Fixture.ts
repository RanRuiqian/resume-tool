/**
 * v1.11 测试用虚构资料（人物、学校、公司、论文、数字全部虚构；不对应任何真实用户）。
 * 结构模仿常见的机械类应届生资料：数字耳镜项目（结构设计 / 3D 打印 / 原型 / 成像测试 / 4 人作者论文）、
 * 机器人仿真课程（Visual Components / RobotStudio）、AMESim 液压建模；资料里没有 NX、ROS、电机 / 发电机经历。
 */
import type { JobParse, LocalizedText, ProfileDoc } from '../../src/types';
import { normalizeJob, parseJdRules } from '../../src/ai/jd';

const T = (zh: string, en: string, id?: string): LocalizedText => ({ zh, en, source: 'zh', status: { zh: 'manual', en: 'confirmed' }, ...(id ? { id } : {}) } as LocalizedText);
const bl = (pid: string, xs: [string, string][]) => xs.map(([zh, en], i) => T(zh, en, `${pid}-b${i + 1}`));

export function otoscopeEngineer(): ProfileDoc {
  return {
    version: 1, primaryLanguage: 'zh', glossary: [],
    profile: { name: T('沈一帆', 'Yifan Shen'), headline: T('机械工程方向应届生', 'Mechanical engineering graduate'),
      summary: T('轮机工程专业本科在读，参与数字耳镜的结构设计、3D 打印原型与成像测试，并完成机器人仿真与液压建模课程项目。能使用 SolidWorks、AMESim、Visual Components、RobotStudio、Python 和 MATLAB，并撰写英文技术文档。',
        'Marine Engineering undergraduate who took part in the structural design, 3D-printed prototyping and imaging tests of a digital otoscope, and completed robot-simulation and hydraulic-modelling course projects. Uses SolidWorks, AMESim, Visual Components, RobotStudio, Python and MATLAB, and writes English technical documentation.'),
      contacts: { email: 'shen.yf@example.com', phone: '', location: T('虚构市', 'Fictional City') } },
    education: [{ id: 'edu-1', enabled: true, school: T('虚构海事大学', 'Fictional Maritime University'), degree: T('本科', 'B.Eng.'), major: T('轮机工程', 'Marine Engineering'), start: '2023-09', end: '2027-06', expectedConferralDate: '2027-06',
      highlights: bl('edu-1', [
        ['GPA 3.4/4.0（由百分制自行换算，非官方）', 'GPA 3.4/4.0 (self-converted from percentage scores; unofficial)'],
        ['相关课程：机械设计、工程制图、液压与气压传动、轮机自动化', 'Relevant coursework: Machine Design, Engineering Drawing, Hydraulic & Pneumatic Transmission, Marine Engineering Automation'],
        ['选修课程：大学生职业生涯规划、中国近现代史纲要', 'Electives: Career Planning, Modern Chinese History'],
      ]) }],
    work: [{ id: 'work-1', enabled: true, company: T('虚构船舶修造有限公司', 'Fictional Shipyard Co., Ltd.'), title: T('轮机实习生', 'Marine Engineering Intern'), start: '2025-07', end: '2025-08', tags: ['轮机'],
      bullets: bl('work-1', [
        ['参与主机与辅机拆装检修，记录关键零件的磨损测量数据。', 'Took part in main and auxiliary engine overhauls and recorded wear measurements of key parts.'],
        ['用 Excel 整理设备台账和维修记录。', 'Maintained equipment ledgers and repair records in Excel.'],
      ]) }],
    projects: [
      { id: 'proj-oto', enabled: true, name: T('数字耳镜原型开发（大学生创新项目）', 'Digital Otoscope Prototype (student innovation project)'), role: T('项目成员（负责结构设计）', 'Team member (structural design)'), start: '2024-09', end: '2025-06', tags: ['SolidWorks', '3D 打印', 'MTF50'], link: '',
        bullets: bl('proj-oto', [
          ['负责用 SolidWorks 设计耳镜手柄、镜头模组外壳和卡扣结构，考虑装配间隙与镜头定位，共迭代 4 版。', 'Designed the handle, lens-module housing and snap-fit structure in SolidWorks, accounting for assembly clearance and lens positioning, over 4 design iterations.'],
          ['用光固化 3D 打印制作原型并完成装配，根据装配测试修正卡扣强度与线缆走线问题。', 'Built prototypes by resin 3D printing and assembled them, fixing snap-fit strength and cable-routing issues found in assembly tests.'],
          ['参与搭建成像测试流程，按 ISO 12233 测量 MTF50 与 SNR，对比 2 款镜头模组的成像质量。', 'Took part in building the imaging test flow, measuring MTF50 and SNR per ISO 12233 to compare the image quality of 2 lens modules.'],
          ['测试条件与结果：MTF50 0.32 cycles/pixel，SNR 38 dB，视场角 70°，工作距离 10–30 mm，照度 500 lux，曝光 10 ms。', 'Test conditions and results: MTF50 0.32 cycles/pixel, SNR 38 dB, FOV 70°, working distance 10–30 mm, 500 lux illumination, 10 ms exposure.'],
          ['以第一作者撰写会议论文《一种低成本数字耳镜的结构与成像设计》，已被虚构国际医学工程会议录用（作者：沈一帆、赵明、钱晓、孙立）。', 'First author of the conference paper "Structural and Imaging Design of a Low-Cost Digital Otoscope", accepted by the Fictional International Conference on Medical Engineering (authors: Yifan Shen, Ming Zhao, Xiao Qian, Li Sun).'],
          ['协助整理项目周报与会议纪要。', 'Helped compile weekly project reports and meeting minutes.'],
        ]) },
      { id: 'proj-rob', enabled: true, name: T('工业机器人仿真课程设计', 'Industrial Robot Simulation (course design)'), role: T('组员', 'Team member'), start: '2025-03', end: '2025-06', tags: ['Visual Components', 'RobotStudio'], link: '',
        bullets: bl('proj-rob', [
          ['课程设计中用 Visual Components 搭建工作站布局，完成机械臂取放（pick-and-place）路径仿真与节拍分析。', 'In a course design, built a workcell layout in Visual Components and completed pick-and-place path simulation and cycle-time analysis for a robot arm.'],
          ['用 RobotStudio 完成搬运路径的离线编程与仿真（仅仿真，未在实体机器人上运行）。', 'Completed offline programming and simulation of a handling path in RobotStudio (simulation only, not run on a physical robot).'],
          ['与组员讨论过加入视觉定位的方案，未实施。', 'Discussed with teammates adding vision-based positioning; not implemented.'],
        ]) },
      { id: 'proj-hyd', enabled: true, name: T('液压起升系统建模（课程项目）', 'Hydraulic Hoist System Modelling (course project)'), role: T('组员', 'Team member'), start: '2024-10', end: '2024-12', tags: ['AMESim'], link: '',
        bullets: bl('proj-hyd', [
          ['用 AMESim 建立液压起升回路模型，仿真分析不同负载下的压力响应。', 'Built a hydraulic hoist circuit model in AMESim and simulated the pressure response under different loads.'],
        ]) },
      { id: 'proj-club', enabled: true, name: T('学院科技节组织', 'College Tech Festival Organisation'), role: T('志愿者', 'Volunteer'), start: '2023-10', end: '2023-11', tags: [], link: '',
        bullets: bl('proj-club', [['协助组织学院科技节展台布置与签到。', 'Helped set up booths and run check-in for the college tech festival.']]) },
    ],
    skills: [
      { id: 'sk-sw', enabled: true, name: T('SolidWorks', 'SolidWorks'), category: T('设计', 'Design'), level: 'proficient' },
      { id: 'sk-ame', enabled: true, name: T('AMESim', 'AMESim'), category: T('仿真', 'Simulation'), level: 'familiar' },
      { id: 'sk-vc', enabled: true, name: T('Visual Components', 'Visual Components'), category: T('仿真', 'Simulation'), level: 'familiar' },
      { id: 'sk-rs', enabled: true, name: T('RobotStudio', 'RobotStudio'), category: T('仿真', 'Simulation'), level: 'familiar' },
      { id: 'sk-py', enabled: true, name: T('Python', 'Python'), category: T('编程', 'Programming'), level: 'familiar' },
      { id: 'sk-ml', enabled: true, name: T('MATLAB', 'MATLAB'), category: T('编程', 'Programming'), level: 'familiar' },
      { id: 'sk-off', enabled: true, name: T('Word / Excel / PowerPoint', 'Word / Excel / PowerPoint'), category: T('办公', 'Office'), level: 'proficient' },
      { id: 'sk-doc', enabled: true, name: T('英文技术文档写作', 'English technical writing'), category: T('其他', 'Other'), level: 'familiar' },
    ],
    certificates: [
      { id: 'cert-pte', enabled: true, name: T('PTE 学术英语 62 分', 'PTE Academic 62'), issuer: T('Pearson', 'Pearson'), date: '2025-04' },
      { id: 'cert-c1', enabled: true, name: T('计算机二级（MS Office）', 'NCRE Level 2 (MS Office)'), issuer: T('虚构考试中心', 'Fictional Exam Center'), date: '2023-09' },
    ],
    awards: [
      { id: 'aw-1', enabled: true, name: T('机械创新设计大赛省级三等奖', 'Provincial Third Prize, Mechanical Innovation Design Contest'), issuer: T('虚构省教育厅', 'Fictional Provincial Education Dept.'), date: '2025-05' },
      { id: 'aw-2', enabled: true, name: T('院级优秀志愿者', 'College Outstanding Volunteer'), issuer: T('虚构海事大学', 'Fictional Maritime University'), date: '2023-12' },
    ],
  } as unknown as ProfileDoc;
}

/** A：ABB 式机械设计工程师（虚构公司，岗位结构参照常见电机 / 机器人企业的机械设计岗） */
export const JD_A_ABB = `Mechanical Design Engineer (Graduate)
Fictional Motion Technologies (Shanghai) Co., Ltd.
Responsibilities:
- Mechanical design of motor and generator components and assemblies using 3D CAD (NX preferred)
- Create 2D drawings and BOMs; apply tolerance analysis
- Build and test prototypes; support assembly and manufacturing teams with DFM feedback
- Perform basic FEA / engineering simulation to verify designs
- Write technical documentation in English and communicate with global teams
Requirements:
- Bachelor degree in Mechanical Engineering or related
- Hands-on 3D CAD skills (NX, SolidWorks or Creo)
- Good English communication; teamwork
Preferred:
- Experience with electric motors or generators
- FEA tools such as ANSYS`;

export const JD_B_VISION = `机器视觉测试工程师
虚构光学科技有限公司
岗位职责：
1. 搭建相机与镜头模组的成像质量测试流程（MTF、SNR、视场角 FOV、畸变）
2. 负责图像采集、测试数据分析与测试报告
3. 用 Python 编写自动化测试脚本
任职要求：
1. 光学、机械、电子等相关专业本科
2. 熟悉 ISO 12233 等成像测试标准
3. 有深度学习视觉算法经验者优先`;

export const JD_C_ROBOT = `Robotics Application Engineer
Fictional Automation Solutions Ltd.
Responsibilities:
- Robot cell simulation and offline programming (Visual Components, RobotStudio)
- Path planning and pick-and-place application design
- Support on-site commissioning of robot cells
Requirements:
- Bachelor in Mechanical, Mechatronics or Automation
- Experience with robot simulation tools
- ROS is a plus`;

const B = (zh: string, en: string) => ({ zh, en });
/** 模拟「AI 解析后」的结构化岗位（规则解析器偏互联网岗位，这里显式给出，保证单元测试可复现） */
export const jobs111 = () => {
  const mk = (id: string, text: string, x: Partial<JobParse>): JobParse => ({ ...normalizeJob({ ...parseJdRules(text), ...x } as JobParse), id });
  return {
    A: mk('job-a', JD_A_ABB, { jdLanguage: 'en', company: { full: 'Fictional Motion Technologies (Shanghai) Co., Ltd.', short: 'Fictional Motion' }, title: B('机械设计工程师', 'Mechanical Design Engineer'),
      responsibilities: [B('电机和发电机零部件的机械设计（3D CAD，优先 NX）', 'Mechanical design of motor and generator components using 3D CAD (NX preferred)'), B('绘制二维图纸和 BOM，进行公差分析', 'Create 2D drawings and BOMs; tolerance analysis'), B('制作并测试原型，为装配和制造提供 DFM 反馈', 'Build and test prototypes; DFM feedback to assembly and manufacturing'), B('进行基础有限元 / 工程仿真验证设计', 'Basic FEA / engineering simulation to verify designs'), B('撰写英文技术文档并与全球团队沟通', 'Write English technical documentation and communicate with global teams')],
      mustHave: [B('机械工程相关专业本科', 'Bachelor in Mechanical Engineering or related'), B('3D CAD（NX、SolidWorks 或 Creo）', '3D CAD (NX, SolidWorks or Creo)'), B('良好的英语沟通能力', 'Good English communication'), B('团队合作', 'Teamwork')],
      niceToHave: [B('电机或发电机经验', 'Electric motor or generator experience'), B('ANSYS 等有限元工具', 'FEA tools such as ANSYS')],
      keywords: [B('机械设计', 'mechanical design'), B('3D CAD', '3D CAD'), B('NX', 'NX'), B('SolidWorks', 'SolidWorks'), B('原型', 'prototype'), B('DFM', 'DFM'), B('有限元', 'FEA'), B('公差分析', 'tolerance analysis'), B('技术文档', 'technical documentation'), B('电机', 'electric motor')] }),
    B: mk('job-b', JD_B_VISION, { jdLanguage: 'zh', company: { full: '虚构光学科技有限公司', short: '虚构光学' }, title: B('机器视觉测试工程师', 'Machine Vision Test Engineer'),
      responsibilities: [B('搭建相机与镜头模组的成像质量测试流程（MTF、SNR、FOV、畸变）', 'Build imaging-quality test flows for cameras and lens modules (MTF, SNR, FOV, distortion)'), B('图像采集、测试数据分析与测试报告', 'Image acquisition, test data analysis and reports'), B('用 Python 编写自动化测试脚本', 'Write automated test scripts in Python')],
      mustHave: [B('光学、机械、电子等相关专业本科', 'Bachelor in optics, mechanical or electronics'), B('熟悉 ISO 12233 等成像测试标准', 'Familiar with imaging test standards such as ISO 12233')],
      niceToHave: [B('深度学习视觉算法经验', 'Deep-learning vision algorithm experience')],
      keywords: [B('MTF', 'MTF'), B('SNR', 'SNR'), B('视场角', 'FOV'), B('畸变', 'distortion'), B('图像采集', 'image acquisition'), B('Python', 'Python'), B('ISO 12233', 'ISO 12233'), B('深度学习', 'deep learning')] }),
    C: mk('job-c', JD_C_ROBOT, { jdLanguage: 'en', company: { full: 'Fictional Automation Solutions Ltd.', short: 'Fictional Automation' }, title: B('机器人应用工程师', 'Robotics Application Engineer'),
      responsibilities: [B('机器人工作站仿真与离线编程（Visual Components、RobotStudio）', 'Robot cell simulation and offline programming (Visual Components, RobotStudio)'), B('路径规划与取放应用设计', 'Path planning and pick-and-place application design'), B('支持机器人工作站现场调试', 'Support on-site commissioning of robot cells')],
      mustHave: [B('机械、机电或自动化专业本科', 'Bachelor in Mechanical, Mechatronics or Automation'), B('机器人仿真工具经验', 'Experience with robot simulation tools')],
      niceToHave: [B('ROS', 'ROS')],
      keywords: [B('Visual Components', 'Visual Components'), B('RobotStudio', 'RobotStudio'), B('离线编程', 'offline programming'), B('路径规划', 'path planning'), B('取放', 'pick-and-place'), B('现场调试', 'commissioning'), B('ROS', 'ROS')] }),
  };
};
