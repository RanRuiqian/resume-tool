/** v1.10 测试用虚构资料（人物、学校、公司、数字全部虚构；不对应任何真实用户） */
import type { JobParse, LocalizedText, ProfileDoc } from '../../src/types';
import { normalizeJob, parseJdRules } from '../../src/ai/jd';

const T = (zh: string, en: string, id?: string): LocalizedText => ({ zh, en, source: 'zh', status: { zh: 'manual', en: 'confirmed' }, ...(id ? { id } : {}) } as LocalizedText);
const bl = (pid: string, xs: [string, string][]) => xs.map(([zh, en], i) => T(zh, en, `${pid}-b${i + 1}`));

export function fictionalEngineer(): ProfileDoc {
  return {
    version: 1, primaryLanguage: 'zh', glossary: [],
    profile: { name: T('林小舟', 'Xiaozhou Lin'), headline: T('机械工程方向应届生', 'Mechanical engineering graduate'),
      summary: T('轮机工程专业应届生，做过结构设计、机器视觉测试和机器人仿真项目。熟悉 SolidWorks 与 Python。喜欢动手做原型。课余参与校机器人社团活动。', 'Marine Engineering graduate with projects in structural design, machine-vision testing and robot simulation. Familiar with SolidWorks and Python. Enjoys hands-on prototyping. Takes part in the university robotics club.'),
      contacts: { email: 'lin.xz@example.com', phone: '', location: T('虚构市', 'Fictional City') } },
    education: [{ id: 'edu-1', enabled: true, school: T('虚构海事大学', 'Fictional Maritime University'), degree: T('本科', 'B.Eng.'), major: T('轮机工程', 'Marine Engineering'), start: '2022-09', end: '2026-06',
      highlights: bl('edu-1', [['GPA 3.6/4.0（估算，非官方，以学校成绩单为准）', 'GPA 3.6/4.0 (est., unofficial; subject to official transcript)'], ['相关课程：机械设计、工程制图、热力学', 'Relevant coursework: Machine Design, Engineering Drawing, Thermodynamics'], ['校园歌手大赛二等奖', 'Second prize, campus singing contest']]) }],
    work: [{ id: 'work-1', enabled: true, company: T('虚构动力设备公司', 'Fictional Power Equipment Co.'), title: T('结构设计实习生', 'Structural Design Intern'), start: '2025-07', end: '2025-09', tags: ['SolidWorks', 'CAD'],
      bullets: bl('work-1', [
        ['实习期间协助完成发电机支架的 SolidWorks 结构设计；参与 2 轮原型验证并整理装配图纸。', 'As an intern, assisted with SolidWorks structural design of a generator bracket; took part in 2 rounds of prototype validation and prepared assembly drawings.'],
        ['协助整理 BOM 清单，约 120 个零件。', 'Assisted in compiling the BOM of about 120 parts.'],
        ['参与周例会记录与会议纪要整理。', 'Took meeting notes at weekly meetings.'],
      ]) }],
    projects: [
      { id: 'proj-1', enabled: true, name: T('模块化 3D 打印夹具设计（课程项目）', 'Modular 3D-Printed Fixture (course project)'), role: T('组员', 'Team member'), start: '2025-03', end: '2025-06', tags: ['SolidWorks', '3D 打印'], link: '',
        bullets: bl('proj-1', [
          ['课程项目中用 SolidWorks 设计模块化夹具，迭代 3 版原型并用 3D 打印验证装配（PLA、0.2 mm 层高、20% 填充）。', 'In a course project, designed a modular fixture in SolidWorks, iterated 3 prototypes and validated assembly by 3D printing (PLA, 0.2 mm layers, 20% infill).'],
          ['尝试用 PETG 材料打印但翘曲失败，改回 PLA。', 'Tried PETG but it failed due to warping; reverted to PLA.'],
          ['对夹具做了简单的有限元仿真（课程作业水平），预计可减重约 15%。', 'Ran a simple FEA simulation (coursework level); expected weight reduction of about 15%.'],
        ]) },
      { id: 'proj-2', enabled: true, name: T('相机模组图像质量测试', 'Camera Module Image-Quality Testing'), role: T('参与', 'Participant'), start: '2024-10', end: '2025-01', tags: ['OpenCV', 'Python'], link: '',
        bullets: bl('proj-2', [
          ['参与搭建相机图像质量测试流程，按 ISO 12233 测量 MTF50 与 SNR。', 'Took part in building a camera image-quality test flow, measuring MTF50 and SNR per ISO 12233.'],
          ['用 Python + OpenCV 编写标定与畸变分析脚本，在室温条件下完成 30 组测试。', 'Wrote calibration and distortion-analysis scripts in Python + OpenCV, completing 30 test runs at room temperature.'],
        ]) },
      { id: 'proj-3', enabled: true, name: T('六轴机械臂抓取仿真', 'Six-Axis Robot Arm Grasping Simulation'), role: T('参与', 'Participant'), start: '2024-03', end: '2024-06', tags: ['ROS', 'RobotStudio'], link: '',
        bullets: bl('proj-3', [
          ['在 RobotStudio 中参与六轴机械臂抓取路径的离线编程与仿真（仅仿真，未上实机）。', 'Took part in offline programming and simulation of a six-axis arm grasping path in RobotStudio (simulation only, not on a real robot).'],
          ['与组员讨论过用 ROS 做运动学验证的设想。', 'Discussed with teammates the idea of using ROS for kinematic verification.'],
        ]) },
      { id: 'proj-4', enabled: true, name: T('校园奶茶店营销策划', 'Campus Tea-Shop Marketing Plan'), role: T('组长', 'Lead'), start: '2023-10', end: '2023-12', tags: ['营销'], link: '',
        bullets: bl('proj-4', [['策划校园奶茶店促销活动，问卷回收 200 份。', 'Planned a campus tea-shop promotion and collected 200 survey responses.']]) },
    ],
    skills: [
      { id: 'sk-1', enabled: true, name: T('SolidWorks', 'SolidWorks'), category: T('设计', 'Design'), level: 'proficient' },
      { id: 'sk-2', enabled: true, name: T('Python', 'Python'), category: T('编程', 'Programming'), level: 'proficient' },
      { id: 'sk-3', enabled: true, name: T('OpenCV', 'OpenCV'), category: T('编程', 'Programming'), level: 'familiar' },
      { id: 'sk-4', enabled: true, name: T('RobotStudio', 'RobotStudio'), category: T('仿真', 'Simulation'), level: 'familiar' },
      { id: 'sk-5', enabled: true, name: T('Photoshop', 'Photoshop'), category: T('其他', 'Other'), level: 'familiar' },
      { id: 'sk-6', enabled: true, name: T('视频剪辑', 'Video editing'), category: T('其他', 'Other'), level: 'familiar' },
    ],
    certificates: [
      { id: 'cert-1', enabled: true, name: T('PTE 学术英语 65 分', 'PTE Academic 65'), issuer: T('Pearson', 'Pearson'), date: '2025-05' },
      { id: 'cert-2', enabled: true, name: T('普通话二级甲等', 'Putonghua Level 2A'), issuer: T('虚构测试中心', 'Fictional Test Center'), date: '2023-05' },
      { id: 'cert-3', enabled: true, name: T('急救员证书', 'First Aid Certificate'), issuer: T('虚构红会', 'Fictional Red Cross'), date: '2024-01' },
    ],
    awards: [
      { id: 'award-1', enabled: true, name: T('机械创新设计大赛三等奖', 'Third Prize, Mechanical Innovation Design Contest'), issuer: T('虚构海事大学', 'Fictional Maritime University'), date: '2025-05' },
      { id: 'award-2', enabled: true, name: T('校园歌手大赛二等奖', 'Second Prize, Campus Singing Contest'), issuer: T('虚构海事大学', 'Fictional Maritime University'), date: '2024-05' },
    ],
  } as unknown as ProfileDoc;
}

export const JD_A_MECH = `机械结构设计工程师（应届）
虚构新能源科技有限公司
岗位职责：
1. 负责发电机及附件的机械结构设计与 CAD 建模
2. 参与原型样机的装配与验证
任职要求：
1. 机械工程、轮机工程等相关专业本科
2. 熟练使用 SolidWorks 或 NX
3. 了解有限元分析者优先`;

export const JD_B_VISION = `Machine Vision Test Engineer
Fictional Optics Ltd.
Responsibilities:
- Build camera image quality test flows (MTF, SNR, distortion)
- Write Python / OpenCV analysis scripts
Requirements:
- Bachelor in engineering
- Python, OpenCV
- Experience with ISO 12233 is a plus`;

export const JD_C_ROBOT = `机器人应用工程师
虚构自动化公司
岗位职责：
1. 机器人离线编程与仿真（RobotStudio）
2. 现场调试支持
任职要求：
1. 机械、自动化相关专业
2. 熟悉机器人运动学、ROS`;

const B = (zh: string, en: string) => ({ zh, en });
/** 模拟「AI 解析后」的结构化岗位（规则解析器的关键词表偏互联网岗位，这里显式给出，保证测试可复现） */
export const jobs = () => {
  const mk = (text: string, x: Partial<JobParse>): JobParse => normalizeJob({ ...parseJdRules(text), ...x } as JobParse);
  return {
    A: mk(JD_A_MECH, { title: B('机械结构设计工程师', 'Mechanical Design Engineer'), mustHave: [B('机械结构设计', 'mechanical structural design'), B('SolidWorks', 'SolidWorks'), B('CAD', 'CAD')], keywords: [B('原型验证', 'prototype validation'), B('装配', 'assembly'), B('发电机', 'generator')], niceToHave: [B('有限元分析', 'FEA')], responsibilities: [B('发电机结构设计与 CAD 建模', 'generator structural design and CAD modeling'), B('原型样机装配与验证', 'prototype assembly and validation')] }),
    B: mk(JD_B_VISION, { jdLanguage: 'en', title: B('机器视觉测试工程师', 'Machine Vision Test Engineer'), mustHave: [B('Python', 'Python'), B('OpenCV', 'OpenCV'), B('图像质量测试', 'image quality testing')], keywords: [B('MTF', 'MTF'), B('SNR', 'SNR'), B('畸变', 'distortion'), B('相机', 'camera')], niceToHave: [B('ISO 12233', 'ISO 12233')], responsibilities: [B('搭建相机图像质量测试流程', 'build camera image quality test flows')] }),
    C: mk(JD_C_ROBOT, { title: B('机器人应用工程师', 'Robotics Application Engineer'), mustHave: [B('机器人离线编程', 'robot offline programming'), B('RobotStudio', 'RobotStudio'), B('运动学', 'kinematics'), B('ROS', 'ROS')], keywords: [B('仿真', 'simulation'), B('调试', 'commissioning')], niceToHave: [], responsibilities: [B('机器人离线编程与仿真', 'robot offline programming and simulation')] }),
  };
};
