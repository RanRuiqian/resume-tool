# AGENTS.md — 给 AI 编程助手（Codex / Cursor / Claude 等）的说明

不需要任何聊天记录即可接手。阅读顺序：本文件 → `docs/AI_HANDOFF.md` → `docs/DATA_SCHEMA.md` → `docs/PROJECT_STATUS.md`。

## 项目一句话
纯前端（React + TypeScript + Vite + Dexie/IndexedDB）的「双语简历生成器 + 求职投递管理」，部署在 GitHub Pages：https://ranruiqian.github.io/resume-tool/ 。没有后端，用户数据只在用户自己的浏览器里。

## 绝对规则
1. **不得提交、打印或导出 API Key。** Key 只存在浏览器 IndexedDB `settings` 表（多套配置在同一条 `settings` 记录的 `apiProfiles` 里，见 `docs/AI_HANDOFF.md`「多 API 配置」）。界面只显示脱敏 Key（`maskKey`）。备份 ZIP / JSON、日志、fixture、截图都不能出现它（`src/tracker/backup.ts` 的 `scrubSecrets` 与测试会检查）。
2. **只用虚构数据**：公司名带「模拟 / 虚构 / 示例」，网址用 `example.com`，人名用「测试用户X」。不得提交真实简历、联系方式、附件。
3. **数据库只做增量迁移**：在 `src/storage/db.ts` 追加 `this.version(N+1)`；不删表、不清库、不修改已有版本。当前版本 **4**。
4. **不得伪造事实**：不自动投递、不自动发邮件、不把未知状态猜成「已投递」、不编造投递时间或个人经历。
5. 申请里的简历快照（`artifacts`）创建后内容不可修改。
6. 正常模式（库 `resume-tool`）与 `?demo` 演示模式（库 `resume-tool-demo`）严格隔离。
7. 界面文案默认中文；英文通过 `src/i18n` 与页面内 `L(zh, en)`。
8. 不要改动 DeepSeek / AI 调用方式（`src/ai`）。所有 AI 调用都读 `settings` 的平铺字段（= 当前启用配置），**不要**在业务代码里直接读 `apiProfiles`；增删改切换只走 `src/storage/apiProfiles.ts` 与 store 的 `saveApiProfile / switchApiProfile / removeApiProfile`。
9. 不要强推（force push），不要直接合并到 `main`；`main` 推送即自动部署。

## 命令
```bash
npm ci
npm test               # vitest（fake-indexeddb）——单元 / 集成测试
npx tsc -b             # 类型检查
npm run lint           # oxlint
npm run build          # 生产构建（含 tsc）
npm run verify:export  # 中英文 PDF/Word 导出回归（不调用 AI）
```
浏览器 e2e（需要 Python Playwright 与 Chrome/Chromium）：
```bash
npm run build && npx vite preview --port 4173 &
python3 tests/e2e/tracker_e2e.py   # 投递管理主流程（33 项）
python3 tests/e2e/release_e2e.py   # 发布验收：导航工具导入、完整备份恢复、空库、移动端/桌面端（35 项）
python3 tests/e2e/organize_e2e.py  # v1.9 AI 整理现有资料 + 首次导入质量（35 项，AI 全部模拟）
python3 tests/e2e/info_loss_e2e.py # v1.9.1/1.9.2 AI 信息丢失 + 英文译文交叉核对回归（18 项，AI 全部模拟）
python3 tests/e2e/api_profiles_e2e.py  # 多 API 配置管理（46 项，全部虚构 Key，AI 接口被拦截模拟）
```
可选环境变量：`E2E_BASE`（默认 http://localhost:4173/），`SHOT_DIR`（截图目录）。

## 提交前检查清单
- 上面所有命令通过；
- `git diff` 中没有 Key、真实姓名、手机号、邮箱、真实简历；
- 改了数据结构 → 同步更新 `docs/DATA_SCHEMA.md`、`tests/dataSafety.test.ts`、`backup.ts` 的 `SECTIONS`；
- 改了导入格式 → 同步更新 `docs/DATA_SCHEMA.md` 的「导入格式」并补 fixture 测试。
