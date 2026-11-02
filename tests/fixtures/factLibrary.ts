/** Completely fictional facts in the real format's grammar. No personal source text or actual grades. */
export function mockFactLibrary(): string {
  const row = (id: string, body: string) => `[x] ${id}｜${body}`;
  const r = (prefix: string, n: number, body: string, width = 2) => row(`${prefix}-${String(n).padStart(width, '0')}`, body);
  const bachelor = Array.from({ length: 76 }, (_, i) => r('BSC', i + 1, `示例课程${i + 1}｜Mock Course ${i + 1}｜2.5 学分｜${i === 27 ? '成绩受遮挡【待复核】' : '75 分'}｜概述：虚构课程说明${i + 1}。`, 3));
  const master = ['工程物联网', '增材制造', '供应链优化', '神经网络', '先进机器人', '精益制造'].map((name, i) => r('MSC', i + 1, `2025 S1｜MOCK${5000 + i}｜Mock Course（${name}）｜${i > 2 ? '成绩未公布。' : '70 / C。'}\n    内容：示例课程说明，不代表职业实践。`));
  const pro = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => r(prefix, i + 1, i === 0 ? `中文名：示例${prefix}项目。` : i === 1 ? `英文名：Mock ${prefix} Project` : i === 2 ? '性质：本科毕业设计' : `项目事实：虚构操作${i}，使用 Python，未开展临床验证。`));
  const skills = Array.from({ length: 45 }, (_, i) => r('SKL', i + 1, `${['Python', 'Visual Components Python Commands', 'GitHub', 'GitHub Pages'][i] || `示例工具${i + 1}`}【课程实践】：虚构使用说明。`, 3));
  return [
    '虚构格式回归样本（非真实母库）', '标记：[x]＝已审核。', '01｜个人基本信息与求职意向',
    row('ID-001', '中文姓名：测试用户甲'), row('ID-002', '英文姓名：Test User A'), row('ID-003', '个人邮箱：mock@example.com'),
    ...Array.from({ length: 19 }, (_, i) => r('ID', i + 4, `模拟备注：虚构信息${i}。`, 3)),
    '02｜教育背景与成绩',
    row('EDU-M01', '学校：模拟硕士大学'), row('EDU-M02', '学位：硕士'), row('EDU-M03', '专业方向：示例工程'), row('EDU-M04', '入学时间：2024年7月'), row('EDU-M05', '预计毕业：2026年11月'), row('EDU-M06', '毕业项目：ENG5813 / ENG5814，关联示例项目，不另外建立学历'), row('EDU-M07', '课程资料说明：虚构备注'),
    row('EDU-B01', '学校：模拟本科大学'), row('EDU-B02', '学院：模拟学院'), row('EDU-B03', '专业：示例机械'), row('EDU-B04', '学位：学士'), row('EDU-B05', '修读时间：2018年9月—2022年6月'), row('EDU-B07', '本科历史成绩：仅为虚构资料，不推算成绩'),
    '03｜硕士授课课程（6 门）', ...master, row('MSC-S01', '学校成绩页面记录：虚构汇总，不是课程'), row('MSC-S02', '说明：未公布保持未知'),
    '04｜本科课程（76 门）', '【2020—2021 学年第一学期】', ...bachelor,
    '05｜工作与生产实践', r('WRK', 1, '单位：模拟生产公司', 3), r('WRK', 2, '职位：测试实习生', 3), r('WRK', 3, '时间：2021年7月—2021年8月', 3), r('WRK', 4, '性质：实习', 3), r('WRK', 5, '工作内容：进行虚构流程观察', 3),
    '06｜核心项目 1：示例采集项目', ...pro('PRO-DEMOA', 32), '07｜核心项目 2：示例仿真项目', ...pro('PRO-DEMOB', 9),
    '08｜硕士课程实验与代表性课程项目', '【课程：先进机器人】',
    row('LRN-ROB-07', 'Lab 2A（真实操作）：使用 BIOLOID，在虚构教学环境操作'), row('LRN-ROB-01', 'Lab 2B（纯仿真）：使用 Visual Components Python Commands，仿真任务'), row('LRN-ROB-02', 'Lab 2B：虚构仿真补充'),
    '【课程：精益制造】', row('LRN-LEAN-01', 'Lean Assignment 1：虚构半导体仿真'), row('LRN-LEAN-02', 'Assignment 1：虚构补充'), row('LRN-LEAN-03', 'Lean Assignment 2：虚构打印质量分析'), row('LRN-LEAN-04', 'A2 质量测量：虚构课程事实'),
    ...Array.from({ length: 42 }, (_, i) => r('LRN-DEMO', i + 1, `虚构课程操作${i + 1}，不升级为工作经历。`)),
    '09｜学术论文与会议', ...Array.from({ length: 6 }, (_, i) => r('PUB', i + 1, i ? '说明：虚构论文补充，不要求上传证明' : '论文题目：示例测试报告', 3)),
    '10｜学生组织、兼职与志愿活动',
    row('ORG-001', '模拟学生会公关部部长；2024年8月—2025年6月'), row('ORG-002', '担任学生会公关部负责人期间，参与示例策划'), row('ORG-003', '与学生会成员共同进行虚构活动'), row('ORG-005', '模拟学生会宣传部成员'), row('ORG-006', '宣传部职责：虚构宣传职责'), row('ORG-007', '模拟学生会外联部成员'), row('ORG-008', '外联部职责：虚构联络职责'), row('ORG-009', '宣传部和外联部是不同部门，不应合并'), row('ORG-010', '在模拟酒店进行虚构服务工作'), row('ORG-011', '在模拟餐饮公司兼职'), row('ORG-012', '在模拟零售公司兼职'), row('ORG-014', '参与示例社区志愿活动'),
    '11｜证书、语言与奖项', row('CERT-001', '示例证书'), row('CERT-002', '示例语言考试：测试资料'), row('LANG-001', '示例语言能力事实，不作换算'), ...Array.from({ length: 5 }, (_, i) => r('AWD', i + 1, `示例虚构奖项${i + 1}`, 3)),
    '12｜工程软件、专业方法与技能', ...skills,
    '13｜个人软件工具与 AI 产品实践', ...Array.from({ length: 12 }, (_, i) => r('TOOL', i + 1, i === 0 ? '名称：示例个人工具' : i === 1 ? '技术：GitHub、GitHub Pages、React' : '功能：虚构软件功能', 3)),
    '14｜固定个人简介（中英文）', row('INTRO-001', '中文个人简介：测试用户甲的虚构简介。'), row('INTRO-002', 'Test User A has a fictional background.'), '—— 虚构样本结束 ——',
  ].join('\n');
}
