# AGENTS.md — 给 AI 编程助手（Codex / Cursor / Claude 等）的说明

先读 `docs/AI_HANDOFF.md`，再读 `docs/DATA_SCHEMA.md`。

## 必须遵守
- **不得提交或打印任何 API Key**。Key 只存在用户浏览器 IndexedDB 的 `settings` 表；备份、日志、fixture、截图都不能包含它。
- **只用虚构数据**写测试和示例（公司名用「模拟/虚构/示例」，链接用 `example.com`）。
- **数据库只做增量迁移**：在 `src/storage/db.ts` 新增 `this.version(N+1)`，不得删表、不得清库、不得改已有版本定义。
- 不要实现自动投递、自动发邮件或伪造投递状态 / 个人经历。
- 界面文案默认中文；英文通过 `src/i18n` 与 `L()` 提供。
- 不要改动 DeepSeek 调用方式（`src/ai`）。
- 申请记录里的简历快照（`artifacts`）一经创建不可修改内容。

## 常用命令
```bash
npm ci
npm test            # vitest（fake-indexeddb）
npx tsc -b          # 类型检查
npm run lint        # oxlint
npm run build
npm run verify:export   # 中英文 PDF/Word 导出回归（不调用 AI）
```
浏览器 e2e：`npm run build && npx vite preview --port 4173`，然后 `python3 tests/e2e/tracker_e2e.py`（需要 Playwright + Chrome）。

## 提交前检查
测试、类型、lint、构建全部通过；`git diff` 中没有 Key、真实姓名、手机号、邮箱或真实简历。
