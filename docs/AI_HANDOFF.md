# AI 交接说明（AI_HANDOFF）

本文件让新的 AI 助手无需阅读聊天记录即可接手。最后更新：2026-10-31（v1.6.1 智能导入修正）。

## 1. 产品
面向中国求职者（主要是 2027 届机械 / 机器视觉方向）的双语简历工具：
- **简历生成**：维护一份中英双语资料库 → 粘贴岗位 JD → AI 匹配与改写 → 事实审查（每条内容要有依据，红色项需二次确认）→ 导出中英文 PDF / Word（同一 ZIP）。
- **求职投递管理（第三阶段）**：岗位库、申请状态与历史、待办 / 面试、简历版本快照、附件、统计；从旧「2027 求职投递导航」工具导入；完整备份恢复。

## 2. 技术栈与运行
React 19 + TypeScript + Vite，Dexie（IndexedDB），vitest + fake-indexeddb，oxlint，Python Playwright e2e。GitHub Actions：`pr-check.yml`（PR：测试、类型、lint、构建），`deploy.yml`（推送 main → GitHub Pages）。

## 3. 目录地图
| 路径 | 作用 |
|---|---|
| `src/App.tsx` | 顶部导航与 hash 路由；`go(page)` 切换；页面 key：`applications`、`profile`、`layout`、`settings`、`wizard` 等 |
| `src/pages/WizardPage.tsx` | 生成流程；支持从岗位带入 JD（`jdPrefill`）并在生成后「关联并返回」（`trackerReturn`） |
| `src/pages/ApplicationsPage.tsx` | 求职投递：统计、筛选、列表；子路由 `new`、`import`、`backup`、`<id>`、`<id>/edit` |
| `src/components/tracker/PostingForm.tsx` | 新增 / 编辑岗位，实时重复提示 |
| `src/components/tracker/PostingDetail.tsx` | 详情：状态 + 历史、简历版本、附件、待办、面试、JD |
| `src/components/tracker/ImportPanel.tsx` | 导入：解析 → 映射 → 预览 → 逐行处理 → 确认 |
| `src/components/tracker/BackupPanel.tsx` | ZIP 完整备份 / 校验 / 部分恢复；轻量 JSON |
| `src/tracker/types.ts` | 类型、10 种状态及中英文标签 |
| `src/tracker/repo.ts` | 数据操作：岗位、申请、状态变更（追加事件）、去重、级联删除、快照、附件 SHA-256 |
| `src/tracker/importers.ts` | CSV / 通用 JSON / ran-application-handoff 1.0 专用适配器、导入计划与单事务执行 |
| `src/tracker/backup.ts` | 档案格式 `resume-tool-archive` v1，`scrubSecrets` |
| `src/tracker/stats.ts` | 统计（只从真实记录计算） |
| `src/storage/db.ts` | Dexie 数据库与迁移（v1–v4） |
| `src/storage/mode.ts`, `demo.ts` | `?demo` 演示模式与示例数据 |
| `src/ai/` | DeepSeek 调用（不要改调用方式）；`provider.ts` 的 `AiError.kind` 区分 Key 无效 / 余额 / 模型 / 超时 / 网络；`testConnection` 用于连接测试 |
| `src/storage/apiProfiles.ts` | 多 API 配置纯函数：迁移、增改、切换、删除、脱敏、校验 |
| `src/storage/settingsLoad.ts` | 读取设置 + 迁移（deepseek-chat→deepseek-flash、单套→列表、迁移前快照） |
| `src/components/ApiManager.tsx` | 设置页「AI API 管理」界面；`ApiForm` 也用于首次使用卡片 |
| `src/audit/` | 事实审查 |
| `src/export/` | PDF / Word 导出 |
| `tests/` | vitest；`tests/e2e/*.py` 浏览器验收；`tests/fixtures/` 全部虚构 |

## 4. 核心概念
- **岗位 vs 申请**：岗位（`postings`）只描述职位；收藏或投递后才有申请（`applications`）。目前一个岗位最多一条申请。
- **状态历史**：每次变更追加 `appEvents`（同一毫秒按 ID 顺序排序），永不覆盖。
- **简历版本**：`artifacts` 中 `snapshot`（生成结果 + 资料 + JD 深拷贝，附审查摘要）或 `uploaded`（用户上传的实际提交文件）。
- **附件**：元数据在 `attachments`，二进制在 `attachmentBlobs`，同一事务写入，带 SHA-256，可校验。
- **导入幂等**：每条记录有 `importKeys`；导航工具按原始 `id`，其他来源按「公司|岗位|城市|链接」哈希。
- **导入不伪造**：未知状态不建申请；原数据没有投递日期时不填写投递时间。

## 4b. 多 API 配置（2026-10-31）
- **存储**：不升级 Dexie、不改业务表。在原 `settings` 表的 `id='settings'` 记录里新增 `apiProfiles: ApiProfile[]` 与 `activeProfileId: string | null`。每条配置有独立 `id`（`api-<时间>-<随机>`），同一服务商可存多条。
- **不变式**：`settings` 的平铺字段 `provider / baseUrl / apiKey / model / translateModel / visionModel` 永远等于当前启用配置（`applyActive` 统一刷新，store 的 `setSettings` 也会调用）。所以所有 AI 调用（资料整理、JD 解析、生成、翻译、OCR 视觉）无需改动；每个操作在开始时拿到当时的 `settings` 对象，中途切换不会混用。没有启用配置时 `apiKey=''`，调用直接报「尚未启用 API」。
- **迁移**（`loadSettings`，幂等）：旧单套配置有 Key → 生成一条「<服务商>（原配置）」并启用；没 Key → 空列表。迁移前把不敏感信息（无明文 Key，只有末 4 位脱敏）存为同表 `id='settings-premigrate-profiles-v1'`（只写一次）；`scrubSettingsCopies` 每次加载清理非主记录中的 Key。Base URL 只允许 https（本机回环 http 例外，`baseUrlProblem`，保存与请求时都检查）。DeepSeek `deepseek-chat→deepseek-flash` 规则对每条配置继续生效。
- **删除当前配置**：不自动切换（避免切到其他收费服务），进入未启用状态，由用户选择。
- **连接测试**：`testConnection(settingsForProfile(settings, p))`，最小请求（`max_tokens: 8`），不改变启用配置；网络故障归为 `network`，不会提示 Key 无效。
- **演示模式**：启用 / 切换配置会关闭演示模式；设置页顶部 `AiModeBanner` 显示「演示 / 未启用 / 真实调用 xx」。

## 4c. 智能导入资料库（v1.6 / v1.6.1）
- **流程**（`src/components/SmartImport.tsx`）：上传 → 本地提取文本（文件卡片，可编辑，**不自动调用 AI**）→ 用户点击识别 → `importProfileDetailed` 分段（≤6000 字 / 段）调用 AI → 每段先 `rawToProfile` 再 `checkAgainstSource`（本段原文证据检查）→ `mergeProfiles` 跨段合并 → `buildImportPlan` 生成审核计划（**只是预览**）→ 用户逐条决定 → 选「合并 / 替换」模式 → 确认。替换前自动快照，导入后可回滚；有未决条目时确认按钮禁用；原始全文存入 `sourceTexts`。
- **去重**（`src/ai/dedupe.ts`，只用结构化信号，不含任何具体学校 / 单位 / 人名规则）：
  - 名称只在同一语言写法之间比较（含 `aliases`）；日期不相交 → 不是重复。
  - 教育：学历层次不同、或同校同层次但学位名 / 专业明显不同（双学位）→ 不合并；同期不同学校 → 不提示。**自动合并（strong）只在学校名同语言一致 + 学位 / 专业不冲突 + 时间吻合时**；中英文校名无法对应时，即使日期相同也只标「可能重复」（undecided），由用户决定。
  - 工作：同单位同期同职位 → 合并；同单位不同职位 → 不合并；另一条只有单位名（无职位、无日期，如公司简称片段）→ 视为同一段经历的补充并合并。合并时更具体的类型优先（实习 > 正式），不会推断出另一份正式工作。
  - 项目：名称 / 别名一致 → 合并；中英文名 + 相同日期 → 只提示。
- **原文证据检查**（`src/ai/sourceCheck.ts`）：日期必须能在本段原文找到（支持 2027.01 / 2027-01 / 2027年1月 / Jan 2027），否则清空并写入条目 `uncertain`；`actualConferralDate` 必须有「已于 / 已获得 / 实际授予 / conferred」等措辞，只有「预计 / expected / 在读 / 尚未」时清空并改为 `expectedConferralDate`；`end` 只来自「预计」措辞时同样移出；任职性质 fulltime / internship / parttime 需在单位名附近有对应字样；证书 / 奖项的颁发机构找不到原文就清空。以 `【严重】` 开头的说明在审核页列为「需要你决定 / 重要问题」。
- **主语言纠正**：`rawToProfile` 中主字段文字的语言与文档语言不同（中文资料里英文题目）时，放到对应语言位置，避免中英文混放导致去重失效。

## 4d. 内容质量与「AI 整理现有资料」（v1.9，2026-10-31）
- 代码：`src/quality/contentQuality.ts`（本地规则：元信息/说明句识别 `detectMeta`/`splitMeta`、去机械第一人称 `stripFirstPerson`、`cleanProfile`、`qualityReport`、`isResumeSafe`、`contentView` 四类视图）；`src/quality/organize.ts`（`planOrganize` 生成预览计划 → `applyOrganize` 按用户勾选写入）；UI `src/components/OrganizePanel.tsx`（`OrganizePanel` + `ReviewSummary`）。
- 规则：核验说明 / 写作建议 / 证据提醒 / 免责声明 / 自评套话 → 移入 `notes`（前缀【核验】【建议】【证据】【说明】【自评】），绝不删除；原句保存在 `factualContent`。含「不确定」的技术事实不删。项目失败方案 → `dossier.failedAttempts`，局限 → `dossier.problems`。
- 风险：日期 / 学位 / 单位 / 职位 / 工具 / 数字变化、课程实验→商业、实习→全职、预计→已授予，由 `factGuard` 判为 high，必须单独勾选；用户确认过的文字只作为 high 建议；AI 版本为 high 时另给一条只用本地规则的 safe 版本。永不设置 `userConfirmedAt`。
- 防重复改写：AI 处理过的文字写入 `LocalizedText.organized` 指纹，文字未变不再送 AI；被拒绝的 AI 建议不会每次重复弹出。
- 首次导入：`importProfileDetailed` 在 `checkAgainstSource` 后执行 `cleanProfile`；SmartImport 机翻后再执行一次；导入 PROMPT 已追加 `MASTER_WRITING_RULES` 与 `projects[].archive`。
- 生成：`generate.ts` 用 `isResumeSafe` 过滤要点（最后一道防线，资料库原文不改）。
- AI 调用方式不变（`chatJson` + 平铺 settings 字段），分批 20 条，失败 / 超时抛错，资料不变。

### 4d-1. v1.9.1 信息丢失防护（A/B 分级）
- **A 类（可默认勾选）**：AI 输出经 `splitMeta` + `stripFirstPerson` 后与本地机械清洗结果 `equivalent()`（去标点和「进行/的/了/地/着」后相同；英文比较小写词序列）。此时采用本地版本。
- **B 类（永不默认勾选）**：其余 AI 改写。`factCheck.lossReport()` 给出「改写后找不到原文片段」（LCS 覆盖）和语义标记（地点/场景、工作对象、否定/限定、时间状态、因果/结论、职责范围、商业/正式性质、参与程度 参与<协助<负责<主导<独立完成、团队→个人、并列项减少）。同时总是生成 source=`local` 的安全版本。
- 另一语言为 machine/stale/空 且源语言与本地等价 → 视为重新机翻（只做数字核对），写入后标 machine。
- 指纹带盐 `saltOf(settings)=QUALITY_VERSION|model`；`planOrganize(..., {force:true})` = 「重新检查已拒绝建议」。
- 每批 try/catch，失败批记入 `plan.aiErrors` 并只做本地清洗；全部失败才抛错（资料不变）。
- `generate.ts`：`flagStale()` 把直接使用了 stale 资料译文的条目标为 needs-review；AI 主语言为 stale 时改用另一语言原文。
- 回归：`tests/infoLoss.test.ts`（mock AI 错误输出），`tests/e2e/info_loss_e2e.py`。

## 5. ran-application-handoff 1.0（旧导航工具）
**重要：目前只按用户口头描述的结构实现和测试，尚未用真实导出文件验证。** 用户可以提供真实样本；拿到后请：把脱敏后的样本存为 fixture、跑 `tests/handoff10.test.ts` 同类测试、修正 `HANDOFF_MAPPING` / `HANDOFF_STATUS`。
描述的结构与映射规则见 `docs/DATA_SCHEMA.md`「导入格式」。实现：`src/tracker/importers.ts` 中 `handoff10()`、`HANDOFF_MAPPING`、`HANDOFF_STATUS`。

## 6. 测试现状
单元 / 集成 201 项（vitest），浏览器 e2e：`tracker_e2e.py` 33、`release_e2e.py` 35、`api_profiles_e2e.py` 47、`smart_import_e2e.py` 41（Mock AI），导出回归 3 模板 × 中英 PDF / Word。具体覆盖见 `docs/DEVELOPMENT.md`。

## 7. 待办与已知限制
见 `docs/PROJECT_STATUS.md`。
