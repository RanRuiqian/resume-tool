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
| `src/ai/` | DeepSeek 调用（不要改调用方式） |
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

## 5. ran-application-handoff 1.0（旧导航工具）
**重要：目前只按用户口头描述的结构实现和测试，尚未用真实导出文件验证。** 用户可以提供真实样本；拿到后请：把脱敏后的样本存为 fixture、跑 `tests/handoff10.test.ts` 同类测试、修正 `HANDOFF_MAPPING` / `HANDOFF_STATUS`。
描述的结构与映射规则见 `docs/DATA_SCHEMA.md`「导入格式」。实现：`src/tracker/importers.ts` 中 `handoff10()`、`HANDOFF_MAPPING`、`HANDOFF_STATUS`。

## 6. 测试现状
单元 / 集成 111 项（vitest），浏览器 e2e 33 + 35 项，导出回归 3 模板 × 中英 PDF / Word。具体覆盖见 `docs/DEVELOPMENT.md`。

## 7. 待办与已知限制
见 `docs/PROJECT_STATUS.md`。
