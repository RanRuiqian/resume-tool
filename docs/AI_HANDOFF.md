# AI 交接说明（AI_HANDOFF）

本文件让新的 AI 助手无需阅读聊天记录即可接手。最后更新：2026-10-31。

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

## 5. ran-application-handoff 1.0（旧导航工具）
**重要：目前只按用户口头描述的结构实现和测试，尚未用真实导出文件验证。** 用户可以提供真实样本；拿到后请：把脱敏后的样本存为 fixture、跑 `tests/handoff10.test.ts` 同类测试、修正 `HANDOFF_MAPPING` / `HANDOFF_STATUS`。
描述的结构与映射规则见 `docs/DATA_SCHEMA.md`「导入格式」。实现：`src/tracker/importers.ts` 中 `handoff10()`、`HANDOFF_MAPPING`、`HANDOFF_STATUS`。

## 6. 测试现状
单元 / 集成 154 项（vitest），浏览器 e2e 33 + 35 + 46 项（`api_profiles_e2e.py`），导出回归 3 模板 × 中英 PDF / Word。具体覆盖见 `docs/DEVELOPMENT.md`。

## 7. 待办与已知限制
见 `docs/PROJECT_STATUS.md`。
