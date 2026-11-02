/** 全部虚构。仅模拟编号母库结构，不是用户 V7 原文件，不代表真实 V7 覆盖率。 */
export function mockNumberedLibrary(): string {
  const bachelor = Array.from({ length: 76 }, (_, i) => `- [x] BSC-${String(i + 1).padStart(3, '0')} 示例本科课程${i + 1}
课程名称：示例本科课程${i + 1}
课程代码：MOCK${1000 + i}
教育编号：EDU-01
学分：${i % 3 + 1}
成绩：${i === 10 ? '成绩遮挡 **' : String(60 + i % 30)}
原文说明：虚构课程内容${i + 1}，仅属于知识学习，不代表就业或工程实操。`).join('\n\n');
  const master = Array.from({ length: 6 }, (_, i) => `- [x] MSC-${String(i + 1).padStart(2, '0')} 示例硕士课程${i + 1}
课程名称：示例硕士课程${i + 1}
课程代码：${i >= 4 ? `ENG581${i - 1}` : `MOCK5${i}`}
教育编号：EDU-02
学分：6
成绩：${i === 5 ? '尚未公布' : '80（模拟）'}
关联项目：${i >= 4 ? 'PRO-01' : ''}
课程内容：虚构课程说明${i + 1}，此处不补全尚未公布的成绩。`).join('\n\n');
  return `# 虚构测试母库（非用户 V7）
01 个人信息
姓名：测试用户甲
邮箱：mock@example.com
所在地：示例城市
02 教育经历
- [x] EDU-01 模拟本科学校
学校：模拟本科学校
学位：学士
专业：示例机械工程
开始：2018-09
结束：2022-06
- [x] EDU-02 模拟马来西亚大学
学校：模拟马来西亚大学
学位：硕士
专业：示例工程
开始：2024-07
结束：未知
实际授予学位日期：尚未公布
03 硕士课程（6门，MSC-01～MSC-06）
${master}
04 本科课程（76门，BSC-001～BSC-076）
${bachelor}
05 工作经历
- [x] WRK-01 示例工作
公司：模拟工程公司
职位：测试实习生
开始：2021-07
结束：2021-08
工作内容：在测试夹具上执行模拟检查
06 核心项目
- [x] PRO-01 示例数字耳镜毕业项目
项目名称：示例数字耳镜毕业项目
关联课程：MSC-05、MSC-06
实际使用工具：Python
项目内容：示例图像采集实验，不涉及临床验证
- [x] PRO-02 示例 AMESim 本科毕业设计
项目名称：示例 AMESim 本科毕业设计
实际使用工具：AMESim
项目内容：模拟液压系统分析
07 课程实验
- [x] LRN-01 Lab 2A 实体 BIOLOID 示例实验
项目名称：Lab 2A 实体 BIOLOID 示例实验
实际使用工具：Python
实践内容：操作测试用实体机器人
- [x] LRN-02 Lab 2B Visual Components 示例仿真
项目名称：Lab 2B Visual Components 示例仿真
实际使用工具：Visual Components Python Commands
实践内容：仅执行软件仿真
- [x] LRN-03 Lean Assignment 1 示例半导体仿真
项目名称：Lean Assignment 1 示例半导体仿真
实践内容：半导体流程仿真
- [x] LRN-04 Lean Assignment 2 示例3D打印质量
项目名称：Lean Assignment 2 示例3D打印质量
实践内容：打印质量分析
08 学术论文
- [x] PUB-01 示例学术报告
论文题目：示例学术报告
内容：仅作测试的虚构报告，不要求上传证明
09 组织经历
- [x] ORG-01 模拟学生会宣传部
组织：模拟学生会
部门：宣传部测试成员
- [x] ORG-02 模拟学生会实践部
组织：模拟学生会
部门：实践部测试成员
10 证书
- [x] CER-01 示例证书
证书名称：示例证书
颁发机构：模拟机构
日期：未知
11 奖项
- [x] AWD-01 示例奖项
奖项名称：示例奖项
颁发机构：模拟机构
日期：2020-06
12 工程技能
- [x] SKL-01 Python
技能名称：Python
实际能力：在虚构实验中使用
关联项目：LRN-01、PRO-01
- [x] SKL-02 Visual Components Python Commands
技能名称：Visual Components Python Commands
关联项目：LRN-02
- [x] SKL-03 GitHub
技能名称：GitHub
- [x] SKL-04 GitHub Pages
技能名称：GitHub Pages
13 个人 AI 工具
- [x] AI-01 示例个人工具
工具名称：示例个人工具
说明：测试工具，不声称职业经验
14 个人简介
测试用户甲的虚构资料；仅用于隔离回归测试，不作为真实经历。`;
}
