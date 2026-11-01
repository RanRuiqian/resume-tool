# PR #10（v1.10.1）本地验收步骤（Windows）

正式网站 https://ranruiqian.github.io/resume-tool/ 不受影响：本地地址 `http://localhost:4173` 与正式网站是**不同网址（origin）**，浏览器为每个网址单独保存数据（IndexedDB / localStorage），本地版本看不到、也改不了正式网站上的资料；反之亦然。

## 1. 先备份正式网站的资料
1. 打开正式网站 → 「投递记录」→「备份与恢复」（地址 `…/resume-tool/#applications/backup`）。
2. 点「⬇ 导出完整求职档案（ZIP，含附件）」，保存到电脑。备份不含 API Key。

## 2. 安装与启动（只需一次安装）
1. 安装 Node.js 20 LTS：https://nodejs.org/ （下载 Windows Installer，一路「下一步」）。
2. 下载 PR 分支代码：打开 https://github.com/RanRuiqian/resume-tool/archive/refs/heads/feat/resume-quality-v1.10.zip ，解压（例如到 `D:\resume-tool-pr10`）。
   - 会用 git 的话也可以：`git clone -b feat/resume-quality-v1.10 https://github.com/RanRuiqian/resume-tool.git`
3. 在解压后的文件夹（能看到 `package.json`）地址栏输入 `cmd` 回车，依次执行：
   ```
   npm ci
   npm run build
   npm run preview -- --port 4173
   ```
4. 浏览器打开 **http://localhost:4173/** 。看完后在黑色窗口按 `Ctrl+C` 关闭。下次只需第 3 步最后一条命令。

## 3. 导入资料、填 Key
1. 本地页面 →「投递记录」→「备份与恢复」→ 选择刚才的 ZIP 恢复。
2. 「设置」里填入你自己的 DeepSeek Key（只存在本机浏览器，不会进入代码或构建）。

## 4. 验收要点
- 选一个真实 JD → 生成简历：专业 / 学位名称一字不差；没有资料里没有的工具（如 ROS / NX）；未授予学位不写「已毕业」；语言成绩在技能「语言」组。
- 第④步「求职信 + 1 分钟自我介绍」：通过时显示「逐句核对通过」；未通过时显示「事实检查未通过，需人工核对」及逐句原因，**原来的文本不被替换**。
- 未通过的文本导出时不进入 Word；点「我已逐句人工核对，允许导出」后才放行。
- 放行后再做以下任一操作，放行应失效、导出重新被拦：改资料库中的相关事实；切换或修改 JD；改求职信 / 自我介绍；重新生成该岗位简历。
- 逐句核对是规则检查，不代表 100% 真实，导出前请自己通读。
