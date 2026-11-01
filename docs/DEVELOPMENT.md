# 开发说明（DEVELOPMENT）

```bash
npm ci
npm run dev           # http://localhost:5173
npm test              # 单元/集成测试（vitest + fake-indexeddb）
npx tsc -b && npm run lint && npm run build
npm run verify:export # 导出回归
```

## 浏览器 e2e
```bash
npm run build && npx vite preview --port 4173 &
pip install playwright && python3 tests/e2e/jd_step2_e2e.py && python3 tests/e2e/kit_verify_e2e.py && python3 tests/e2e/tracker_e2e.py && python3 tests/e2e/release_e2e.py && python3 tests/e2e/api_profiles_e2e.py
```
`release_e2e.py` 覆盖：空库首启；导航工具 1.0 导入（48 岗位、portals 不导入、未映射字段提示、状态转换、无虚假投递时间、重复导入）；PDF / DOCX / 图片附件 + 实际提交简历 + 状态历史的 ZIP 备份，恢复到全新隔离数据库后逐项比对与 SHA-256 校验、无 Key；390×844 与 1440×900 下 9 个主要页面无横向溢出、无遮挡。

`api_profiles_e2e.py` 覆盖多 API 配置管理（46 项）：旧设置迁移与快照、新增 / 多服务商 / 同服务商两个 Key、反复切换、切换后 JD 解析请求使用新配置（无刷新）、刷新保持、编辑留空保留 Key、删除普通 / 当前 / 最后一个、连接测试成功 / 401 / 402 / 网络 / 超时、Key 不出现在页面 / 网址 / 日志 / 业务表、?demo 隔离、390×844 手机布局。AI 接口被 Playwright 拦截模拟，Key 均为虚构。
`kit_verify_e2e.py`（11 项）覆盖求职信逐句核对失败：不保存、列原因与逐句明细、保留手改旧文本、导出拦截、人工核对放行（kitReview）。AI 接口模拟，资料虚构。

覆盖：新增/编辑岗位、状态历史、外链、关联简历快照不可变、上传实际提交文件与附件、生成流程往返、CSV/JSON 导入与重复导入、筛选统计、删除提示、ZIP 备份与新浏览器恢复、演示隔离、英文界面。
种子数据 `tests/fixtures/e2e-seed.json` 与 `tests/fixtures/files/*` 均为虚构。

## 新增数据库字段 / 表
在 `src/storage/db.ts` 加新版本 `this.version(5).stores({...}).upgrade(...)`，同时：更新 `tests/dataSafety.test.ts` 的版本断言、`docs/DATA_SCHEMA.md`、`backup.ts` 的 `SECTIONS`（如需备份）。

## 部署
推送到 `main` 由 `.github/workflows/deploy.yml` 发布到 GitHub Pages；PR 由 `pr-check.yml` 跑测试、类型、lint、构建。
