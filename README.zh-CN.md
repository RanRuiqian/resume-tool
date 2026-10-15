# 双语简历生成器（Bilingual Resume Builder）

[English](./README.md) | 中文

纯前端、隐私优先的开源求职简历工具：在本地维护结构化履历资料库 → 上传岗位截图或粘贴 JD → AI 解析岗位并从资料库挑选、改写经历（**不编造**）→ 一键下载 zip，内含 **中/英 × PDF/Word** 共 4 个文件。

## 功能（v1 MVP）

- **个人资料库**：教育、工作、项目、技能、证书、获奖、照片、联系方式；每个文本字段都有中/英两份，可只填一种，AI 补译另一种并标记「机翻待校对 / 已确认 / 过期」；专有名词表（glossary）；JSON 导入 / 导出备份。数据存在浏览器 IndexedDB。
- **岗位解析**：上传截图（多模态模型识别文字）或粘贴文本 → 输出必备要求、加分项、年限、中英关键词对照、公司简称、岗位缩写（不确定则留空），结果可编辑。
- **生成**：先生成主版本（默认 = JD 语言），再基于主版本本地化出副版本；每条内容都带 `sourceId` 指向资料库原始条目；自动一致性校验（条目、数字、日期），不一致时高亮；匹配度与缺口提示。
- **版式设置**：3 套内置 JSON 模板（经典单栏 / 现代双栏 / 紧凑一页），可调照片位置（左 / 右 / 无）、模块顺序与标题、单/双栏、字体、颜色、间距；每套模板有中/英语言变体（中文版默认显示照片，英文版默认隐藏）；改动内置模板会自动另存为自定义模板；CN / EN / 并排实时预览。
- **导出**：一键下载 `公司_岗位缩写_YYYYMMDD.zip`（同一天重复导出追加 `_2`、`_3`），内含 `公司_岗位缩写_CN.pdf / _CN.docx / _EN.pdf / _EN.docx`；文件名不含姓名，导出前可修改公司名与缩写，自动清理非法字符；zip 条目使用 UTF-8 标志位，Windows / macOS 解压不乱码。
  - PDF：`@react-pdf/renderer` + 内置 Noto Sans SC 子集（GB2312 常用字），导出时再按实际用字子集化嵌入（单份 PDF ≈100 KB）。
  - Word：`docx` 生成真实段落 + 内置标题样式；双栏和照片使用**无边框表格**，不使用文本框，方便在 Word / WPS 中修改。
- **演示模式**：无需 API Key，使用规则解析与关键词匹配（不改写，副版本用资料库已有译文）。访问 `/?demo` 可一键载入示例资料 + 示例 JD + 生成结果。

## 快速开始

```bash
npm install
npm run dev          # 开发服务器 http://localhost:5173
# 打开 http://localhost:5173/?demo 体验示例数据
npm run build && npm run preview   # 生产构建预览 http://localhost:4173
```

在「设置」页关闭演示模式并填写：Base URL（OpenAI / DeepSeek / 通义等 OpenAI 兼容接口）、API Key、生成模型、多模态模型（截图识别用）、可选翻译模型。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run test` | 单元测试（命名规则、一致性校验、导出流水线） |
| `npm run lint` / `npm run typecheck` | oxlint / TypeScript 检查 |
| `npm run verify:export` | 用示例数据生成 3 套模板的 zip 到 `../out/`，便于人工检查 |

## 部署

- **Vercel**：导入仓库，框架选 Vite，直接部署。
- **GitHub Pages**：`BASE_PATH=/<仓库名>/ npm run build`，把 `dist/` 发布到 Pages。

## 隐私

资料、API Key、导出文件都只在你的浏览器里。调用 AI 时，资料与 JD 会直接发送到你配置的服务商（不经过任何本项目服务器）；照片、出生年月、性别、籍贯不会发送。请定期「导出 JSON 备份」，以防浏览器数据被清理。

## 目录

```
src/types      数据类型（LocalizedText、Profile、Template、Resume…）
src/storage    Dexie(IndexedDB)、JSON 导入导出与迁移
src/ai         OpenAI 兼容 provider、prompts、JD 解析、翻译、生成/本地化、一致性校验
src/locale     双语字段读取、过期标记、日期格式
src/render     模板 + 语言变体 → Layout Model；网页预览
src/export     pdf/（react-pdf）、docx/（Word）、naming.ts、zip.ts
src/templates  内置模板 JSON
src/pages      资料库 / 岗位解析 / 生成 / 版式 / 设置
```

## 许可

MIT。内置字体为 Noto Sans CJK SC 子集，遵循 SIL OFL 1.1。
