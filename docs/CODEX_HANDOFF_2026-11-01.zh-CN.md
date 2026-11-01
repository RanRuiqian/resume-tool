# Resume Tool — Codex 交接文档（2026-11-01）

> 本文件面向**没有任何此前对话记录**的新开发者（Codex）。读完本文件 + `docs/AI_HANDOFF.md` 即可继续项目。
> 所有时间为北京时间（UTC+8）。

## 0. 一句话现状

- 正式版本 **v1.11.0** 已上线，功能可用；但**未通过用户真实简历质量验收**，生成结果**不建议直接用于正式投递**。
- 下一轮目标：**v1.11.1 简历质量修复**（见第 11、12 节）。

## 1. 项目目标与产品定位

纯前端的个人求职工具：用户维护一份完整的「个人资料母库」，粘贴/截图岗位 JD 后，由 AI 针对岗位从母库中**选材、精简、改写**，生成中英文一页简历、求职信和一分钟自我介绍，并管理投递记录。

核心原则：**母库是完整事实记录，只在生成的简历副本里精简；AI 只能删减和改写措辞，不能编造事实。** 数据全部存在用户浏览器本地（IndexedDB），没有后端；API Key 由用户自己在设置页填写。

## 2. 仓库与版本

- 仓库：https://github.com/RanRuiqian/resume-tool （本地工作目录在旧环境为 `/workspace/resume-tool/app`）
- 正式网站：https://ranruiqian.github.io/resume-tool/
- 当前 main：`64ceada52280aca94933fc9f4e1a600033c6b1d1`（PR #11 的 merge commit，v1.11.0）
- Pages 部署：Actions run 41294081074，成功，2026-11-01 17:40（UTC+8）
- 网站上没有显示版本号；v1.11.0 是通过 bundle 中「加入求职管理」「岗位分析历史」文字与默认模型 `deepseek-flash` 确认的。

## 3. 架构与技术栈

- React 19 + TypeScript + Vite；状态在 `src/store.tsx`。
- 存储：Dexie 4（IndexedDB），库名 `resume-tool`（演示模式用独立的 `resume-tool-demo`），schema 版本 **v4**。
- AI：OpenAI 兼容 Chat Completions 接口，默认 DeepSeek；支持多 API 配置。
- OCR：tesseract.js 本地识别（资源由 `scripts/copy-ocr-assets.mjs` 在 dev/build 前复制）。
- 导出：PDF 用 `@react-pdf/renderer`（Web Worker），Word 用 `docx`，打包用 `jszip`。
- 部署：GitHub Actions → GitHub Pages（见第 6 节）。
- 测试：vitest（+ fake-indexeddb），oxlint，tsc。

## 4. 目录与主要文件

| 路径 | 用途 |
|---|---|
| `src/pages/` | 页面：`WizardPage`（首次引导）、`ProfilePage`（资料母库）、`JobPage`（JD 截图/文本与分析）、`GeneratePage`（生成简历/求职信）、`LayoutPage`（排版模板）、`ApplicationsPage`（求职管理）、`SettingsPage`（API 配置） |
| `src/components/` | `ApiManager`（多 API）、`CareerKit`（求职信+自我介绍+事实核对 UI）、`ExportDialog`（导出及高风险改写确认）、`JobHistory`（岗位分析历史）、`OrganizePanel`（AI 整理母库）、`SmartImport`（导入简历到母库）、`FactAudit`、`tracker/` 等 |
| `src/ai/provider.ts` | AI 请求封装：思考模式关闭、截断报错、JSON 解析与重试 |
| `src/ai/prompts.ts` | 所有 Prompt |
| `src/ai/jd.ts` / `jdText.ts` / `ocr.ts` | JD 解析、OCR 文本去噪、截图识别 |
| `src/ai/evidence.ts` | v1.11 分阶段选材：`analyzeJd`(L49) → `extractEvidence`(L109) → `rankEvidence`(L139) → `allocate`(L172) 篇幅分配；`pickSide`(L239) 技能/证书/奖项 |
| `src/ai/relevance.ts` | v1.10 相关性评分、`conciseBullet`、`planResume`(L104)、`compactSummary`(L137) |
| `src/ai/summary.ts` | 个人简介精简 `focusSummary`(L43) 与护栏 `guardSummary`(L73) |
| `src/ai/generate.ts` | 简历生成主流程，调用 allocate + AI 改写 + 护栏；简介处理在约 L116–L145 |
| `src/ai/selection.ts` | 手动勾选条目/要点/简介 |
| `src/quality/resumeGuard.ts` | 简历改写护栏：可省略事实，不得新增/改动数字，保留限定词 |
| `src/quality/kitVerify.ts` | 求职信/自我介绍逐句事实核对、指纹绑定的人工确认 |
| `src/quality/factCheck.ts`、`organize.ts`、`contentQuality.ts` | 母库整理与事实完整性检查 |
| `src/storage/db.ts` | Dexie schema（v1–v4） |
| `src/storage/defaults.ts` | 服务商默认值、停用模型迁移 |
| `src/storage/apiProfiles.ts` | 多 API 配置 |
| `src/tracker/` | 求职投递管理数据层 |
| `src/export/` | PDF/Word 导出、文件命名、一页适配 `fit.ts` |
| `src/templates/index.ts` | 四套简历模板 |
| `src/sample/` | **虚构**示例资料与 JD（仅用于演示/测试） |
| `scripts/verify-export.ts` | 导出检查脚本；`scripts/e2e-ai.ts` 端到端（可用 mock 或真实 Key）；`scripts/fixtures/` 虚构 fixture |
| `docs/` | `AI_HANDOFF.md`（总交接）、`PROJECT_STATUS.md`、`DATA_SCHEMA.md`、`DEVELOPMENT.md`、`SECURITY.md`、`V111_EVAL.zh-CN.md` 等 |

## 5. 安装、构建、测试

```bash
npm ci
npm run dev            # 本地开发（predev 复制 OCR 资源）
npm test               # vitest 单元测试（v1.11.0 时 450 个全部通过）
npm run typecheck      # tsc -b
npm run lint           # oxlint
npm run build          # tsc -b && vite build
npm run verify:export  # 导出检查
npm run e2e:ai         # AI 端到端；不设 Key 时走 mock
```

- 真实 DeepSeek 测试需要环境变量中的 Key（旧环境存放于 `/home/box/.secrets/deepseek.env`，**不得打印、不得提交**）。真实调用有费用，只在用户要求时运行，并与 mock 结果**分开报告**。
- PR 检查工作流 `.github/workflows/pr-check.yml`：`npm ci` → `npm test` → `npx tsc -b` → `npm run lint` → `npm run build`（无密钥）。

## 6. GitHub Pages 部署

`.github/workflows/deploy.yml`：push 到 `main`（或手动 workflow_dispatch）触发 → `npm ci` → `npm test` → `npm run build`（`BASE_PATH=/resume-tool/`）→ 复制 `index.html` 为 `404.html`、加 `.nojekyll` → `upload-pages-artifact` → `deploy-pages`。
**合并到 main 即自动部署**，因此合并必须得到用户明确批准。

## 7. DeepSeek 调用与配置

- 默认：provider `deepseek`，baseUrl `https://api.deepseek.com`，model **`deepseek-flash`**（`src/storage/defaults.ts`）。也支持 **`deepseek-v4-pro`**（质量更好、更慢更贵）。
- 旧名 `deepseek-chat` / `deepseek-reasoner` 已于 **2026-07-24 停用**（官方 2026-04-24 公告）；设置加载时自动迁移到当前默认（`RETIRED_DEEPSEEK_MODELS`）。
- `provider.ts`：官方 DeepSeek 接口显式 `thinking: {type:'disabled'}`（L33）；`finish_reason=length` 抛出截断错误（L52）；JSON 无效时重试一次，并尝试截取首个完整 JSON。
- 多 API 配置：`src/storage/apiProfiles.ts` + `ApiManager.tsx`，可存多套服务商/Key/模型并切换；地址仅允许 https（本机回环例外）；迁移快照不保存明文 Key。
- 已知：首页主 bundle 中搜不到字符串 `deepseek-v4-pro`（可能在懒加载的设置页 chunk，或需手动输入）。需在真实浏览器设置页确认该选项是否可选。

## 8. Dexie 数据结构与兼容要求

- 版本：v1（profile/templates/jobs/resumes/exports/settings/state）→ v2（backups）→ v3（resume item `syncStatus`）→ **v4**（postings/applications/appEvents/artifacts/attachments/attachmentBlobs）。详见 `docs/DATA_SCHEMA.md`。
- **规则**：除非绝对必要不升级 schema；新字段只能是**可选字段**，读取时做默认值兼容；**绝不**重置、清空、覆盖用户数据库；**不**写入演示数据；**不**重新初始化用户资料；不删除已有岗位、简历、投递记录。

## 9. 已完成功能（截至 v1.11.0）

- 个人资料母库管理；智能导入、AI 整理母库（含信息丢失防护）。
- 多 API 配置与模型切换。
- JD 截图 OCR（本地去噪）+ 岗位分析；分析结果按 JD 文本 hash 缓存，JD 变化显示「已过期」，有「重新分析」；截图 × 删除；「清空本次岗位」。
- 中英文简历生成；分阶段选材（JD 能力加权 → 证据抽取 → 价值排序 → 篇幅分配 → AI 改写 → 事实护栏）；最小字号 9pt。
- 四套模板；中英文 PDF / Word 导出。
- 求职信 + 一分钟自我介绍（中文 180–220 字、英文 100–130 词）。
- 事实核对 `kitVerify`：逐句分类（候选人事实 / JD 事实 / 动机 / 未来计划 / 限定），AI 最多重试 2 次，被拦截不保存；「采用精简版」「我已逐句人工核对，允许导出」；人工确认绑定 4 个指纹（文本、资料事实、JD/岗位、简历 id/时间），任何一项变化即失效；未核实内容不进 Word 导出。
- 求职管理：「加入求职管理」默认状态「待投递」，去重；岗位分析历史（可重命名）与求职管理双向关联。

## 10. 已知问题及重现方法

1. **v1.11.0 真实简历质量问题**（第 11 节）。重现：用真实资料（或结构相近的**虚构**资料：多段工作经历含无要点的兼职、多个项目、含「估算，非官方」的 GPA、Python 与 PTE 并列技能、AMESim 仿真毕设）+ ABB 机械设计工程师 JD，生成中英文简历并打开导出页。
2. 新增岗位时城市字段为空（求职管理/添加岗位）。
3. `deepseek-v4-pro` 字符串不在主 bundle（第 7 节）。
4. 网站不显示版本号。
5. flash 模型下求职信/自我介绍事实核对仍有误报。

## 11. 本次真实测试失败情况（v1.11.0，ABB 机械设计工程师 JD）

测试产物 `ABB_ME_20261101_3.zip`（中英 PDF + Word）由用户保管，含真实个人资料，**不得上传到仓库或任何公开位置**。复现请用虚构数据。

1. 个人简介消失。
2. AMESim 液压溢流阀本科毕业设计被错误排除。
3. 耳镜项目占篇幅过多，且保留了对机械设计岗位价值较低的材料成本信息。
4. 低相关的课程和活动仍保留。
5. 教师助手、KFC、Walmart 等经历仅显示名称，没有时间或职责。
6. 自动化生产技术员经历出现重复描述。
7. 非官方估算 GPA 仍显示。
8. Python 与 PTE 被归为同一「语言」类别。
9. 部分技术技能及证书被不合理省略。
10. 求职信和自我介绍仍有事实检查误报。
11. 导出页仍提示两处高风险改写未确认。

结论：可用，但**未通过真实验收**，不建议用于正式投递。

### 疑似根因（**均未确认**，需 Codex 用虚构数据复现验证）

| 线索 | 指向 | 对应问题 |
|---|---|---|
| 全局分配无条件保留 enabled 工作经历：`allocate` 中 `work` 取全部 enabled（evidence.ts L182），`finalOrder` 用 `work.includes(id) \|\| chosen…length` 过滤（约 L216），没选中任何要点的工作经历也会进入简历 | `src/ai/evidence.ts` `allocate` | 5 |
| GPA 估算过滤 `GPA_CONV`（evidence.ts L102）要求同一句内出现「换算/估算/非官方…」；且 JD 含 GPA/绩点 时直接保留（L228）。「（估算，非官方）」若在另一字段/括号/句号后可能漏判；另外 v1.10 把 GPA 说明压缩为「（估算，非官方）」后可能与正则不匹配 | `evidence.ts` L102/L116/L228 | 7 |
| 项目篇幅竞争：`entryScore` 取前三要点加权，`capOf` 按排名给 4/3/2/1 条，第二轮 fill 对前两名仍按 cap 补入；高分项目（耳镜）可吃掉配额，成本信息若含 JD 词即得分；`keepProj` 阈值 `topE*0.2` + `maxProj=3` 可能把 AMESim 毕设挤出；毕设可能在 education 而非 projects，被 education 分支当「无关课程」处理 | `evidence.ts` L175–L212、L222–L235 | 2、3、4 |
| 整体排序：局部要点筛选改善，但 `finalOrder` 只按 entryScore 排序，与时间/类别顺序的关系未验证 | `evidence.ts` 约 L216 | 3、4 |
| 简介整体被删：`generate.ts` L139–L145 中 AI 简介被护栏拒绝后回落 `focusSummary`，后者在 `!ok`（任一分句改写不安全）时返回 `null`，再回落 `compactSummary`；若都得到空串则不 push 简介项。`focusSummary` 首个分句外 `clauseValue<1` 的分句全删、`LIM` zh 90 / en 50 的循环 pop 也可能删光 | `src/ai/summary.ts` L43–L66；`src/ai/generate.ts` L139–L145；`relevance.ts compactSummary` L137 | 1 |
| 技能分类：`pickSide` 用 `LANG_TEST_RE` 或 category 含「语言/language」判定语言类；Python 若在母库 category=「编程语言」会被当成语言。技能上限 `slice(0,8)` 与 `score>=1` 门槛、证书只留语言考试或 `score>=1` | `evidence.ts` L236–L248；渲染分组 `src/render/classify.ts` | 8、9 |
| 重复描述：`overlapBi>0.45` 去重只在同一条目内；中英两侧/AI 改写后的近似句未二次去重 | `evidence.ts tryAdd` 约 L190 | 6 |
| 求职信未来学习意愿误判：`classify` 中 `LEARN_FRAME`/`FUTURE`/`SELF` 正则（kitVerify.ts L114–L163）；`SELF.zh` 的 `我(?!希望|...)` 很宽，含「学习」+ 工具名的未来句可能被判成候选人自述，再因工具不在资料中被拦截 | `src/quality/kitVerify.ts` `verifySentence` L174 | 10 |
| 高风险改写提示：`resumeGuard.guardRewrite`（L45）对删除限定/数字等标记高风险，导出页 `ExportDialog` 要求确认；可能是简介/要点精简时触发 | `src/quality/resumeGuard.ts`、`src/components/ExportDialog.tsx` | 11 |

## 12. v1.11.1 建议修复顺序

1. 用**虚构**资料建立复现 fixture（覆盖第 11 节全部 11 项），先写失败测试。
2. 简介消失（1）——影响最大、最可见。
3. 工作经历无职责仍保留（5）+ 重复描述（6）。
4. GPA 估算过滤（7）+ Python/PTE 分类（8）+ 技能证书省略（9）。
5. 项目篇幅竞争与毕设排除（2、3、4），含整体排序。
6. 高风险改写提示来源（11）。
7. 求职信未来/学习句误报（10）——不放宽事实底线，只修分类。
8. 全部 mock 测试通过后，经用户同意再跑少量真实 DeepSeek 回归（flash，必要时 v4-pro），分开报告。

## 13. 不能修改或删除的用户数据

- 用户浏览器 IndexedDB `resume-tool` 中的一切：资料母库（profile）、岗位（jobs）、简历（resumes）、导出记录、设置（含用户自己的 API Key）、备份、投递相关表（postings/applications/appEvents/artifacts/attachments/attachmentBlobs）。
- 不主动清除/重置浏览器数据；不改资料库结构；不删已有岗位、简历、投递记录；不重新初始化；不写入演示数据覆盖已有资料。
- 用户的真实简历文件、`ABB_ME_20261101_3.zip` 不得进入仓库。

## 14. 硬性约束（每一轮都适用）

- 不直接改 main；每轮从最新 main 新建分支 + PR（可先 Draft）。**不自动合并、不自动部署**；只有用户明确批准后才用 **merge commit** 合并；不 force-push。
- 只用**虚构**测试数据；不提交任何真实个人资料或 API Key。
- 本科专业是 **轮机工程**，不得写成「船舶与海洋工程」。
- 母库保持完整，只在简历副本里精简。
- 不编造技能、数字、成果；不抬高参与程度（参与≠主导）；仿真≠部署；预计≠已授予/已完成。
- 资料中相互冲突的公司名或日期不得猜测或静默改写，提示用户确认。
- 保留四套模板、中英文 PDF/Word 导出、多 API 配置；不硬编码任何人的简历内容。
- mock 测试与真实 DeepSeek 测试分开报告；未执行的测试不得声称通过。
- 最小改动，不扩大范围。
- 回复用户用中文，简洁直白。

## 15. Codex 接手后的第一步

1. `git clone` 仓库，确认 main = `64ceada5…`（或更新的 merge commit），`npm ci && npm test && npm run typecheck && npm run lint && npm run build` 全绿。
2. 阅读本文件、`docs/AI_HANDOFF.md`、`docs/V111_EVAL.zh-CN.md`、`docs/DATA_SCHEMA.md`。
3. **第一项任务**：新建分支（如 `fix/v1.11.1-resume-quality`），用虚构资料写出第 11 节 11 个问题的复现测试（先从「个人简介消失」和「无职责工作经历仍保留」开始），逐条验证第 11 节的疑似根因，再按第 12 节顺序修复。不合并、不部署，提 Draft PR 等用户验收。

## 16. 之前尝试过但未彻底解决的方案

| 方案 | 结果 / 失败原因 |
|---|---|
| v1.10 `relevance.ts` 按 JD 相关度评分 + 长度上限；修复 bug A（AI 不返回要点时倾倒全部原始要点）和 bug B（要求保留所有数字） | 局部条目内筛选改善，但没有全局篇幅竞争，低相关内容仍会留下；被 v1.11 `evidence.allocate` 取代/叠加，两套逻辑并存 |
| v1.10 `resumeGuard`：允许省略事实、禁止新增/改动数字、保留限定词 | 防编造有效，但限定词保留规则较严，导致导出页仍出现「高风险改写未确认」；GPA 说明压缩成「（估算，非官方）」后 GPA 仍会显示 |
| v1.10.1 / v1.11 `kitVerify` 规则 + 词表方式减少求职信误报（5 类句型） | 正则/词表无法覆盖自然语言变体，flash 模型措辞多变，仍有误报；每次加规则又可能放过真实问题 |
| v1.11 staged 选材 A/B（三份虚构 JD，各 1 次）：main+flash 0/3、v1.11+flash 2/3、v1.11+v4-pro 3/3 | v4-pro 更稳但约 2.6 倍费用、更慢；默认仍为 flash，由用户决定是否切换；真实资料上 flash 仍未达标 |
| Cloudflare 预览环境用于验收 | 访问返回 403，放弃；改为仅在本地/正式站验收 |
| 提交 db1160c | 该提交无法通过类型检查，后续提交已修复；回溯历史时注意不要以它为基准 |
| 添加岗位城市字段 | 仍为空，未修 |
| 设置页 `deepseek-v4-pro` | 主 bundle 中未找到字符串，未在真实浏览器确认 |

## 17. P2 待办（用户未要求前不做）

- AI 整理报告的五类计数改为互斥。
- 增加「英文原文 + 中文译文」场景的测试。
