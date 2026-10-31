# AI 交接说明（AI_HANDOFF）

## 项目是什么
纯前端的「双语简历生成器 + 求职投递管理」。React + TypeScript + Vite，数据存浏览器 IndexedDB（Dexie），部署在 GitHub Pages。没有后端，所有数据只在用户本机。

## 目录
| 路径 | 作用 |
|---|---|
| `src/App.tsx` | 顶部导航与 hash 路由（`#applications/<id>` 等），`go(page)` 切换 |
| `src/pages/WizardPage.tsx` | 生成流程：资料 → JD → 匹配 → 生成 → 事实审查 → 导出 |
| `src/pages/ApplicationsPage.tsx` | 求职投递：列表、统计、筛选、子路由 new / import / backup / `<id>` / `<id>/edit` |
| `src/tracker/types.ts` | 岗位、申请、事件、简历版本、附件的类型与 10 种状态 |
| `src/tracker/repo.ts` | 增删改、状态变更（写事件）、去重、级联删除、简历快照、附件（SHA-256） |
| `src/tracker/stats.ts` | 统计（只从真实记录计算） |
| `src/tracker/importers.ts` | CSV / JSON / ran-application-handoff 解析、字段映射、导入计划与执行 |
| `src/tracker/backup.ts` | ZIP 完整档案导出 / 校验 / 恢复，轻量 JSON 导出，去除密钥 |
| `src/components/tracker/*` | 表单、详情、导入面板、备份面板 |
| `src/storage/db.ts` | Dexie 数据库与迁移（当前 v4） |
| `src/storage/mode.ts` | `?demo` 演示模式：独立库 `resume-tool-demo` |

## 关键约定
- 岗位（`postings`）与申请（`applications`）分离：只有收藏或投递后才有申请记录。一个岗位目前对应 0 或 1 条申请。
- 每次状态变更追加一条 `appEvents`，历史不覆盖。
- 「关联当前简历」对生成结果做 `structuredClone` 深拷贝并附事实审查摘要；之后修改资料不会影响快照。
- 「从岗位去生成」：写 `sessionStorage/localStorage` 的 `jdPrefill` 与 `trackerReturn`，生成页顶部出现返回横幅。
- ran-application-handoff 1.0：**真实 schema 尚未确认**，目前是适配器占位 + 字段自动猜测 + 手动映射界面。拿到真实样例后在 `importers.ts` 的 `ALIASES` / `jsonToSource` 中补齐，并加 fixture 测试。

## 未完成 / 后续方向
见 `docs/PROJECT_STATUS.md`。
