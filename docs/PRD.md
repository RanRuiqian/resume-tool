# 开源求职简历生成工具 — 产品需求文档（PRD）

| 项目 | 说明 |
|------|------|
| 文档版本 | v1.2 |
| 作者 | ruiqian |
| 更新日期 | 2026-10-16 |
| 状态 | Draft |
| 开源协议 | MIT |

### 修订记录

| 版本 | 日期 | 修订内容 |
|------|------|----------|
| v1.0 | 2026-10-15 | 初稿：资料库、岗位解析、智能匹配、版式编辑器、架构与路线图 |
| v1.1 | 2026-10-16 | 新增**中英双语简历**（P0）：资料库字段双语与 AI 翻译缓存、模板语言变体、"先生成主版本再本地化"的一致性流程、一键导出两版 PDF；同步更新数据模型、提示词、用户流程、路线图与风险 |
| v1.2 | 2026-10-16 | 导出改为**一键下载 zip**（中/英 × PDF/Word 共 4 个文件，P0）；放弃浏览器打印，改用纯前端库生成 PDF（@react-pdf/renderer）与 Word（docx），JSZip 打包；新增文件命名规则（公司_岗位缩写_日期，AI 提炼可手改，非法字符处理，重复导出加序号）；同步更新功能需求、流程、数据模型、技术选型与目录、路线图、风险 |

---

## 1. 项目概述与目标

### 1.1 背景

求职者往往维护多份简历、反复改写以贴合不同岗位，过程耗时且易遗漏关键经历；投递外企、海外岗位或双语 JD 时，还要额外维护中英两版并保证内容一致。现有工具多为模板编辑或简单填充，缺少「个人资料库 + 岗位解析 + 智能匹配改写 + 双语输出」的闭环。

本项目旨在打造一款**纯前端、隐私优先**的开源简历生成工具：用户在本地维护结构化履历资料库，上传招聘要求后由 AI 解析岗位、匹配经历并生成可编辑简历，**同时产出内容一致的中英文两版**，最终导出 PDF。

### 1.2 产品目标

| 目标 | 说明 |
|------|------|
| 个人可用 | ruiqian 先自用，覆盖日常投递改写场景 |
| 双语一键产出 | 针对同一岗位一次生成中、英两版，一键下载含 PDF + Word 的 zip，内容一致、版式符合各自习惯 |
| 开源验证 | GitHub 开源（MIT），中英双语 README，观察社区反馈 |
| 可产品化 | 架构预留云端与账号层，反响好后再商业化 |

### 1.3 成功指标（MVP）

- 本地完成「资料录入 → 岗位解析 → 生成简历 → 导出 PDF」全流程
- 同一岗位一键下载 zip（中/英 × PDF/Word 共 4 个文件），两版经历条目与关键数字**完全对应**；Word 可在 Office/WPS 中正常打开编辑
- 生成内容**不编造**经历，匹配度与缺口可解释
- 每版 PDF 控制在 **1–2 页**，版式可读
- GitHub 获得有效 Issue / Star 反馈，验证需求真实性

---

## 2. 目标用户与使用场景

### 2.1 目标用户

| 用户类型 | 特征 | 核心诉求 |
|----------|------|----------|
| 主用户（早期） | 技术向求职者 / 转岗者（如 ruiqian） | 快速针对不同 JD 定制简历，中英版同时就绪 |
| 开源贡献者 | 前端 / AI 应用开发者 | 可扩展模板、语言变体与 AI 层 |
| 潜在产品用户（后期） | 校招 / 社招、外企及出海求职者 | 省时、匹配准、双语一致、隐私可控 |

### 2.2 典型使用场景

1. **投递新岗位**：上传 JD 截图 → AI 拆解要求 → 从资料库挑经历改写 → 调版式 → 导出 PDF  
2. **外企 / 海外投递**：同一岗位一键生成中英两版，下载 zip 后分别投国内 HR 与海外 Hiring Manager；需要时在 Word 里做最后微调  
3. **资料维护**：只用中文（或英文）录入经历，AI 自动翻译另一语言，人工校对后缓存复用  
4. **多模板切换**：同一内容套不同模板（单栏/双栏、有无照片）供不同公司使用  
5. **缺口自检**：查看匹配度与缺失技能，决定是否补项目或调整投递策略  

---

## 3. 功能需求

优先级说明：**P0** = MVP 必做；**P1** = 增强体验；**P2** = 后续迭代。

### 3.1 个人资料库（P0）

| ID | 需求 | 优先级 |
|----|------|--------|
| F1.1 | 结构化存储：教育、工作、项目、技能、证书、获奖、照片、联系方式 | P0 |
| F1.2 | 每条经历支持详细描述 + 量化成果（bullet / 指标字段） | P0 |
| F1.3 | CRUD、排序、启用/停用（生成时可选入池） | P0 |
| F1.4 | JSON 导入 / 导出备份（含双语字段与翻译缓存） | P0 |
| F1.5 | 文本字段支持中/英双语（详见 3.5） | P0 |
| F1.6 | 照片本地上传（blob 存 IndexedDB），支持裁剪预览 | P1 |

### 3.2 岗位解析（P0）

| ID | 需求 | 优先级 |
|----|------|--------|
| F2.1 | 上传招聘要求截图（png/jpg/webp） | P0 |
| F2.2 | OCR / 多模态模型提取文字 | P0 |
| F2.3 | AI 拆解：必备技能、年限、关键词、加分项、岗位摘要 | P0 |
| F2.4 | 支持粘贴纯文本 JD（无截图时）；中/英文 JD 均可 | P0 |
| F2.5 | 关键词同时输出中英对照（用于两版各自的关键词贴合） | P0 |
| F2.6 | 解析结果可人工编辑后再进入生成 | P1 |
| F2.7 | 保存历史 JD 解析记录 | P2 |

### 3.3 智能匹配生成（P0）

| ID | 需求 | 优先级 |
|----|------|--------|
| F3.1 | 从资料库挑选最相关经历并排序 | P0 |
| F3.2 | 改写措辞贴合岗位关键词；**严禁编造**经历/公司/成果 | P0 |
| F3.3 | 控制篇幅约 1–2 页（可配置目标页数/字数，两版分别校验） | P0 |
| F3.4 | 展示匹配度分数与缺口提示（缺技能/年限等） | P0 |
| F3.5 | 生成结果可逐段人工微调后再渲染 | P1 |
| F3.6 | 一键「仅改写措辞 / 重新挑选经历」分步操作 | P2 |

### 3.4 版式编辑器与导出（P0 / P1）

| ID | 需求 | 优先级 |
|----|------|--------|
| F4.1 | 配置：照片位置、模块顺序、单/双栏、字体、颜色、间距 | P0 |
| F4.2 | 模板以 JSON 描述；内置 2–3 套可调模板，**每套含中/英两个语言变体** | P0 |
| F4.3 | 保存多套用户自定义模板 | P0 |
| F4.4 | 导出 PDF 与 Word（纯前端生成，详见 3.6） | P0 |
| F4.5 | 实时预览（WYSIWYG 近似），支持中/英切换预览与左右并排对照 | P1 |
| F4.6 | 社区模板贡献与导入 | P1 |
| F4.7 | 拖拽自由排版 | P2（v2） |

### 3.5 中英双语简历（P0，v1.1 新增）

| ID | 需求 | 优先级 |
|----|------|--------|
| F5.1 | **字段双语**：资料库所有自然语言字段（姓名、职位、描述、bullet、技能名等）可存 `zh` / `en` 两份；只填一种即可 | P0 |
| F5.2 | **AI 补译**：缺失语言由 AI 翻译生成，标记为「机翻待校对」；用户校对后标为「已确认」并缓存，原文未变则不重复翻译 | P0 |
| F5.3 | **翻译缓存失效**：源语言字段修改后，对应译文自动标记「过期」，提示重新翻译或手动更新 | P0 |
| F5.4 | **专有名词表**：公司名、产品名、技术名、学校官方英文名等可设固定译法（glossary），翻译与生成时强制遵循 | P0 |
| F5.5 | **模板语言变体**：同一模板含 `zh` / `en` 两套语言配置（模块标题、日期格式、字体、照片与个人信息显示、模块顺序覆盖） | P0 |
| F5.6 | **一致性生成**：针对岗位先生成「主版本」（默认与 JD 语言相同，可切换），再对照主版本翻译/本地化出另一版，**不独立生成两次** | P0 |
| F5.7 | **一致性校验**：自动比对两版条目 id、数量、数字/日期/百分比，发现不一致时高亮提示 | P0 |
| F5.8 | **一键导出两版**：一次操作下载 zip，内含中/英 × PDF/Word 共 4 个文件（详见 3.6） | P0 |
| F5.9 | 单版导出：仍可只导出任一语言或任一格式 | P1 |
| F5.10 | 英文版本地化风格：动词开头、过去时、去除主语，中文版保持简洁书面语 | P1 |
| F5.11 | 扩展更多语言（日语等），语言字段与变体结构可扩展 | P2 |

**中英文简历习惯差异（内置模板默认值，用户可覆盖）**

| 维度 | 中文版默认 | 英文版默认 |
|------|-----------|-----------|
| 照片 | 显示（右上/侧栏） | 不显示（欧美惯例，避免歧视风险） |
| 个人信息 | 可显示年龄/出生年月、性别、籍贯、政治面貌（均默认关闭，可勾选） | 仅姓名、邮箱、电话、城市、LinkedIn/GitHub |
| 模块标题 | 教育背景 / 工作经历 / 项目经历 / 专业技能 | Education / Experience / Projects / Skills |
| 模块顺序 | 常见：教育 → 工作（应届）或 工作 → 教育 | 常见：Summary → Experience → Education |
| 日期格式 | `2021.07 – 至今` | `Jul 2021 – Present` |
| 字体 | 思源黑体 / 思源宋体，正文 10–10.5pt | Inter / Source Sans / Georgia，正文 10–11pt |
| 篇幅 | 1–2 页 | 社招 1–2 页，应届 1 页优先 |
| 纸张 | A4 | A4（可选 Letter） |

### 3.6 导出与文件命名（P0，v1.2 新增）

| ID | 需求 | 优先级 |
|----|------|--------|
| F6.1 | **一键 zip 导出**：一次点击下载 1 个 zip，内含 4 个文件：中文 PDF、中文 Word、英文 PDF、英文 Word | P0 |
| F6.2 | **纯前端生成**：PDF 由 @react-pdf/renderer 生成，Word 由 `docx` 库生成，JSZip 打包；不依赖浏览器打印对话框，无需多次确认 | P0 |
| F6.3 | **同源渲染**：PDF 与 Word 均由同一份「生成结果 + 模板语言变体」驱动，内容完全一致 | P0 |
| F6.4 | **排版一致性**：Word 版尽量还原 PDF 的模块顺序、栏数、字体、字号、颜色、间距、照片位置；冲突时**可编辑性优先**（用真实段落/标题样式/表格而非文本框或图片，双栏用无边框表格实现） | P0 |
| F6.5 | **字体处理**：PDF 嵌入开源字体子集（思源黑体/宋体、Inter），保证跨设备显示；Word 只引用字体名（中文 fallback「微软雅黑 / 宋体」，英文 fallback「Calibri / Arial」），不嵌入字体以控制体积 | P0 |
| F6.6 | **自动命名**：AI 从 JD 提炼公司名与岗位缩写，导出前弹窗展示并可手动修改；命名规则见下 | P0 |
| F6.7 | **非法字符处理**：去除/替换 `\ / : * ? " < > \|` 及控制字符，合并多余空格与下划线，单段长度截断（公司 ≤ 20 字、缩写 ≤ 12 字符） | P0 |
| F6.8 | **重复导出加序号**：同一天同公司同岗位再次导出时，zip 名追加 `_2`、`_3`…（基于本地导出记录） | P0 |
| F6.9 | 导出前预检：页数超限、存在一致性问题或未校对机翻时给出提醒（不阻断） | P1 |
| F6.10 | 导出记录：本地保存历史导出（时间、岗位、文件名），可一键重新导出 | P2 |

**命名规则（不含用户姓名，投递时用户可自行改名）**

| 对象 | 规则 | 示例 |
|------|------|------|
| 压缩包 | `公司_岗位缩写_YYYYMMDD.zip`；重复时 `公司_岗位缩写_YYYYMMDD_序号.zip` | `字节跳动_FE_20261016.zip`、`字节跳动_FE_20261016_2.zip` |
| 中文 PDF / Word | `公司_岗位缩写_CN.pdf` / `.docx` | `字节跳动_FE_CN.pdf`、`字节跳动_FE_CN.docx` |
| 英文 PDF / Word | `公司_岗位缩写_EN.pdf` / `.docx` | `字节跳动_FE_EN.pdf`、`字节跳动_FE_EN.docx` |

- 公司名：取 JD 中的公司简称（如「北京字节跳动科技有限公司」→「字节跳动」）；JD 未写公司时为空，导出前要求用户填写，缺省用 `Company`。  
- 岗位缩写：取行业通用英文缩写（前端工程师 → `FE`，后端 → `BE`，产品经理 → `PM`，数据分析 → `DA`，算法工程师 → `MLE` 等）；无通用缩写时用英文职位关键词驼峰简写。  
- 日期取导出时的本地日期；文件名统一 UTF-8，zip 内条目名使用 UTF-8 标记以保证 Windows/macOS 解压中文不乱码。

### 3.7 设置与基础设施（P0）

| ID | 需求 | 优先级 |
|----|------|--------|
| F7.1 | 用户自填 API Key；支持 OpenAI 兼容接口（OpenAI / DeepSeek / 通义等） | P0 |
| F7.2 | Key 仅存浏览器本地，不上传本项目服务器 | P0 |
| F7.3 | 可为「生成」与「翻译」分别指定模型（如翻译用低价模型） | P1 |
| F7.4 | 中英双语 UI（README 双语 P0；UI 文案 i18n P1） | P1 |
| F7.5 | GitHub Pages 或 Vercel 一键部署说明 | P0 |

---

## 4. 用户流程

```
[首次使用]
  打开 Web App → 填写 API Key（设置页）
  → 录入/导入个人资料库（只填中文或英文均可）
  → （可选）一键补译另一语言 → 逐条校对 → 标为已确认
  → （可选）维护专有名词表；选择或微调模板（中/英变体）

[日常投递 — 双语]
  上传 JD 截图 或 粘贴文本
  → OCR/多模态提取文字
  → AI 拆解岗位要求（含中英关键词对照、公司名、岗位缩写，可编辑）
  → 选择主版本语言（默认 = JD 语言）
  → 智能匹配：选经历 + 排序 + 改写 → 生成【主版本】
  → 展示匹配度 & 缺口；用户微调主版本
  → 基于主版本 + 已确认译文缓存 → 本地化生成【副版本】
  → 一致性校验（条目/数字/日期）→ 有差异则高亮
  → 中英并排预览，分别微调版式（照片、标题、日期等走语言变体）
  → 点击「导出」→ 弹窗确认/修改公司名、岗位缩写（预览 zip 与 4 个文件名）
  → 前端生成 CN/EN × PDF/Word → JSZip 打包 → 下载 1 个 zip
  → （可选）解压后在 Word 中微调
  → （可选）导出资料库 JSON 备份
```

异常路径：
- API Key 无效 / 额度不足 → 明确错误提示，保留已解析 JD 与本地资料
- OCR 失败 → 引导改用粘贴文本
- 匹配经历过少 → 缺口提示 + 建议补充资料库
- 副版本超出页数 → 提示精简（同步删减主版本对应条目，保持一致）
- 用户修改了主版本 → 副版本对应条目标记「待同步」，可一键重新本地化
- JD 未识别出公司名 → 导出弹窗要求填写，文件名中的非法字符自动清理
- 某个文件生成失败（如字体加载失败）→ 提示具体文件，可重试或仅导出其余文件

---

## 5. 数据模型

### 5.1 资料库 JSON 结构示例

自然语言字段统一使用 `LocalizedText` 结构：

```json
{
  "zh": "主导简历编辑器重构，首屏加载降低 40%",
  "en": "Led editor rewrite, cutting first-screen load time by 40%",
  "source": "zh",
  "status": { "en": "machine" }
}
```

`source` = 用户原始填写语言；`status` 取值：`manual`（人工填写）、`machine`（机翻待校对）、`confirmed`（已校对）、`stale`（原文已改，译文过期）。

```json
{
  "version": "1.1",
  "primaryLanguage": "zh",
  "glossary": [
    { "zh": "某某科技", "en": "Mouxx Tech" },
    { "zh": "某某大学", "en": "XX University" }
  ],
  "profile": {
    "name": { "zh": "张三", "en": "San Zhang", "source": "zh", "status": { "en": "confirmed" } },
    "headline": { "zh": "全栈工程师", "en": "Full-Stack Engineer", "source": "zh", "status": { "en": "confirmed" } },
    "photoId": "blob:photo-001",
    "contacts": {
      "email": "zhangsan@example.com",
      "phone": "+86-138xxxx",
      "location": { "zh": "上海", "en": "Shanghai, China" },
      "github": "https://github.com/example",
      "linkedin": ""
    },
    "personal": {
      "birth": "1996-05",
      "gender": "男",
      "hometown": "浙江杭州"
    },
    "summary": { "zh": "5 年 Web 开发经验，擅长 React 与系统设计…", "source": "zh", "status": {} }
  },
  "education": [
    {
      "id": "edu-1",
      "school": { "zh": "某某大学", "en": "XX University", "source": "zh", "status": { "en": "confirmed" } },
      "degree": { "zh": "硕士", "en": "M.S." },
      "major": { "zh": "计算机科学", "en": "Computer Science" },
      "start": "2018-09",
      "end": "2021-06",
      "highlights": [
        { "zh": "GPA 3.7/4.0", "en": "GPA 3.7/4.0" }
      ],
      "enabled": true
    }
  ],
  "work": [
    {
      "id": "work-1",
      "company": { "zh": "某某科技", "en": "Mouxx Tech" },
      "title": { "zh": "高级前端工程师", "en": "Senior Frontend Engineer" },
      "start": "2021-07",
      "end": "present",
      "bullets": [
        {
          "id": "work-1-b1",
          "zh": "主导简历编辑器重构，首屏加载降低 40%",
          "en": "Led editor rewrite, cutting first-screen load time by 40%",
          "source": "zh",
          "status": { "en": "machine" }
        }
      ],
      "metrics": [{ "label": { "zh": "性能提升", "en": "Perf gain" }, "value": "40%" }],
      "tags": ["React", "TypeScript", "Vite"],
      "enabled": true
    }
  ],
  "projects": [],
  "skills": [
    { "id": "sk-1", "name": { "zh": "TypeScript", "en": "TypeScript" }, "level": "expert" }
  ],
  "certificates": [],
  "awards": []
}
```

说明：日期统一存 ISO 格式（`YYYY-MM` / `present`），由模板按语言格式化；数字、链接、标签不做翻译。

### 5.2 模板 JSON 结构示例（含语言变体）

共享配置（版式、颜色）写在顶层，语言相关配置写在 `locales.zh` / `locales.en` 中覆盖：

```json
{
  "id": "tpl-modern-two-col",
  "name": { "zh": "现代双栏", "en": "Modern Two Column" },
  "version": "1.1",
  "page": { "size": "A4", "marginMm": { "top": 12, "right": 12, "bottom": 12, "left": 12 }, "targetPages": 2 },
  "layout": { "columns": 2, "sidebarWidthPercent": 32 },
  "moduleOrder": ["summary", "work", "projects", "education", "skills", "certificates", "awards"],
  "colors": { "primary": "#1a365d", "text": "#1a202c", "muted": "#718096", "accent": "#2b6cb0" },
  "spacing": { "sectionGapMm": 4, "itemGapMm": 2.5 },
  "locales": {
    "zh": {
      "sectionTitles": { "summary": "个人简介", "work": "工作经历", "projects": "项目经历",
                         "education": "教育背景", "skills": "专业技能", "certificates": "证书", "awards": "获奖" },
      "dateFormat": "YYYY.MM",
      "presentLabel": "至今",
      "typography": { "fontFamily": "Noto Sans SC, sans-serif", "nameSizePt": 18, "bodySizePt": 10, "lineHeight": 1.45 },
      "photo": { "enabled": true, "position": "sidebar-top", "sizeMm": 28 },
      "personalFields": ["birth", "hometown"],
      "moduleOrderOverride": null
    },
    "en": {
      "sectionTitles": { "summary": "Summary", "work": "Experience", "projects": "Projects",
                         "education": "Education", "skills": "Skills", "certificates": "Certifications", "awards": "Awards" },
      "dateFormat": "MMM YYYY",
      "presentLabel": "Present",
      "typography": { "fontFamily": "Inter, Helvetica, sans-serif", "nameSizePt": 20, "bodySizePt": 10.5, "lineHeight": 1.3 },
      "photo": { "enabled": false },
      "personalFields": [],
      "moduleOrderOverride": ["summary", "work", "education", "projects", "skills", "certificates", "awards"]
    }
  }
}
```

### 5.3 岗位解析结果

```json
{
  "rawText": "…",
  "jdLanguage": "zh",
  "company": { "full": "北京字节跳动科技有限公司", "short": "字节跳动" },
  "roleAbbr": "FE",
  "title": { "zh": "高级前端工程师", "en": "Senior Frontend Engineer" },
  "mustHave": [{ "zh": "React", "en": "React" }, { "zh": "3年以上经验", "en": "3+ years" }],
  "niceToHave": [{ "zh": "设计系统", "en": "Design systems" }],
  "yearsRequired": 3,
  "keywords": [{ "zh": "性能优化", "en": "performance optimization" }],
  "summary": "负责 B 端中后台…"
}
```

### 5.4 生成结果（一份岗位简历 = 主版本 + 副版本）

```json
{
  "id": "resume-20261016-01",
  "jobId": "job-01",
  "templateId": "tpl-modern-two-col",
  "primaryLanguage": "zh",
  "matchScore": 82,
  "gaps": ["Kubernetes"],
  "items": [
    {
      "sourceId": "work-1-b1",
      "zh": "主导简历编辑器重构，首屏加载降低 40%，提升性能优化能力",
      "en": "Led editor rewrite with a focus on performance optimization, cutting first-screen load by 40%",
      "syncStatus": "in-sync"
    }
  ],
  "consistency": { "checkedAt": "2026-10-16T00:10:00+08:00", "issues": [] }
}
```

`items` 以 `sourceId` 一一对应资料库条目，两版共用同一列表、同一顺序，是保证一致性的核心约束；`syncStatus` 取值 `in-sync` / `pending`（主版本修改后待同步）。

### 5.5 导出记录（v1.2 新增，用于命名去重）

```json
{
  "id": "export-001",
  "resumeId": "resume-20261016-01",
  "company": "字节跳动",
  "roleAbbr": "FE",
  "date": "20261016",
  "seq": 1,
  "zipName": "字节跳动_FE_20261016.zip",
  "files": ["字节跳动_FE_CN.pdf", "字节跳动_FE_CN.docx", "字节跳动_FE_EN.pdf", "字节跳动_FE_EN.docx"],
  "exportedAt": "2026-10-16T00:20:00+08:00"
}
```

序号计算：查询同 `company + roleAbbr + date` 的记录数，`seq = count + 1`；`seq > 1` 时 zip 名追加 `_seq`。zip 内 4 个文件名不带序号。

模板 JSON 无需新增字段：PDF 与 Word 渲染器共同读取 5.2 中的版式与语言变体；如需 Word 专属微调，可在模板中可选增加 `docxOverrides`（如段落间距换算、表格列宽），默认不填。

---

## 6. AI 提示词设计要点

### 6.1 通用原则

1. **事实约束**：仅使用用户资料库中的事实；禁止编造公司、职位、时间、成果数字。  
2. **可追溯**：改写后的每条 bullet 必须携带原始条目 `sourceId`。  
3. **岗位对齐**：优先覆盖 `mustHave` 与 `keywords`；无法覆盖则进入「缺口」而非虚构。  
4. **篇幅控制**：按目标页数/字数裁剪，宁缺毋滥。  
5. **输出结构化**：强制 JSON Schema，便于前端校验与渲染。

### 6.2 关键 Prompt 职责拆分

| 步骤 | 输入 | 输出要点 |
|------|------|----------|
| OCR / 多模态 | 截图 | 纯文本 JD + 语言识别 |
| 岗位拆解 | JD 文本 | mustHave / niceToHave / years / keywords（中英对照）/ summary / 公司简称 / 岗位缩写 |
| 资料补译 | 单个字段原文 + glossary | 译文；只翻译不润色，不增删信息 |
| 匹配挑选 | 资料库（主语言）+ 拆解结果 | 选中条目 ids + 排序理由 |
| 主版本改写 | 选中经历原文 + 主语言 keywords | 改写 bullets（不增事实）+ 匹配度 + gaps |
| 副版本本地化 | **主版本全文** + 资料库已确认译文 + glossary + 副语言 keywords | 逐条对应译文；保持条目数、顺序、数字不变 |
| 一致性复核（可选） | 两版 items | 列出数字/实体/含义不一致的条目 |

### 6.3 双语本地化要点

- **以主版本为唯一事实源**：副版本 Prompt 明确「逐条翻译/本地化下列条目，不得新增、删除、合并条目，不得改动数字、日期、专有名词」。  
- **优先复用已确认译文**：资料库中 `confirmed` 的译文作为参考译法，仅在主版本措辞变动处调整，减少漂移和费用。  
- **术语表强制**：glossary 内的词必须原样采用。  
- **本地化而非直译**：英文用强动词开头、过去时、省略主语、量化前置；中文去翻译腔、简洁书面语；岗位关键词使用副语言 JD 习惯说法（来自 F2.5 对照表）。  
- **命名提炼**：公司取常用简称、去掉「有限公司 / 科技」等后缀；岗位缩写优先行业通用英文缩写；不确定时返回空值，由用户在导出弹窗填写，禁止臆造公司名。  
- **输出校验**：前端规则检查 `sourceId` 集合相同、数字 token 集合相同；不通过则自动重试 1 次，仍失败则高亮交给用户。

### 6.4 安全与降级

- 模型拒绝或超时：回退为「规则匹配」（关键词重叠打分）+ 原文经历，不改写；副版本直接使用资料库已有译文。  
- 输出校验失败：重试 1 次；仍失败则展示原文并提示用户手动编辑。

---

## 7. 技术架构与目录结构

### 7.1 技术选型

| 层级 | 方案 |
|------|------|
| 框架 | React + TypeScript + Vite |
| 本地存储 | IndexedDB（推荐 Dexie） |
| AI | 用户自带 API Key；OpenAI 兼容 Chat Completions + 多模态 |
| PDF | @react-pdf/renderer（纯前端生成，支持自定义字体嵌入；备选 pdfmake） |
| Word | `docx`（纯前端生成 .docx） |
| 打包下载 | JSZip + `file-saver`（或原生 `<a download>`） |
| 字体 | 内置开源字体子集：思源黑体/宋体（中文）、Inter（英文）；预览用 `@font-face`，PDF 生成时按需加载并嵌入 |
| 部署 | GitHub Pages 或 Vercel |
| 协议 | MIT |

### 7.2 分层设计

```
存储层 (storage)  →  Profile / Template / Resume / Settings CRUD，IndexedDB；翻译缓存与状态
AI 层 (ai)        →  Provider 抽象、Prompt、匹配、改写、翻译/本地化、校验
i18n 层 (locale)  →  LocalizedText 读取与回退、日期/标题格式化、模板语言变体合并
渲染层 (render)   →  模板 + 语言变体 → 中间排版模型（Layout Model），供预览 / PDF / Word 共用
导出层 (export)   →  PDF 渲染器、Word 渲染器、文件命名与去重、JSZip 打包
UI 层 (pages/components) → 资料编辑、翻译校对、JD 上传、生成向导、并排预览、设置
```

便于将来替换存储层为云端 API、增加账号体系，而不改 AI/渲染核心。

### 7.3 导出方案（zip：CN/EN × PDF/Word）

1. **统一中间模型**：渲染层把「生成结果 + 模板 + 语言变体」转换为与输出格式无关的 Layout Model（页面、栏、模块、段落、文本样式、图片），网页预览、PDF、Word 共用，从源头保证内容与结构一致。  
2. **PDF**：@react-pdf/renderer 将 Layout Model 映射为 `<Page>/<View>/<Text>`，注册字体子集嵌入；在 Web Worker 中生成，避免阻塞 UI。  
3. **Word**：`docx` 将 Layout Model 映射为段落、标题样式、无边框表格（双栏）、行内图片（照片）；使用 Word 内置样式（标题 1/2、正文、列表）以便用户全局调整；不使用文本框、绝对定位或整页图片。  
4. **打包**：4 个 Blob 由 JSZip 打包（UTF-8 文件名），生成 zip 名并写入导出记录，触发一次下载。  
5. **体积与性能**：中文字体子集按文档实际字符动态裁剪（或预置常用 7000 字子集），首次导出时懒加载字体与导出库，不影响首屏。

### 7.4 建议目录结构

```
resume-tool/
├── README.md / README.zh-CN.md
├── package.json
├── vite.config.ts
├── public/fonts/            # 开源字体子集（预览 + PDF 嵌入）
├── src/
│   ├── types/               # Profile、LocalizedText、Template、Resume 等类型
│   ├── storage/             # IndexedDB、import/export、翻译缓存
│   ├── ai/                  # providers、prompts、match、rewrite、localize、validate
│   ├── locale/              # 日期格式化、模板变体合并、文案回退
│   ├── render/              # 模板 + 语言变体 → Layout Model、网页预览
│   ├── export/              # pdf/（react-pdf 渲染器）、docx/（Word 渲染器）、naming.ts（命名/非法字符/序号）、zip.ts
│   ├── templates/           # 内置 2–3 套 JSON 模板（各含 zh/en 变体）
│   ├── pages/               # Profile / Translate / Job / Generate / Editor / Settings
│   ├── components/
│   ├── i18n/                # UI 文案
│   └── utils/
├── docs/PRD.md
└── LICENSE
```

---

## 8. 隐私与安全

| 项 | 策略 |
|----|------|
| 数据位置 | 默认仅浏览器本地（IndexedDB）；无强制账号 |
| API Key | 本地存储；请求直连用户配置的 AI 服务商，**不经本项目后端** |
| 简历内容 | 调用 AI（含翻译）时会发送资料与 JD 至用户所选服务商，需在 UI 明确告知 |
| 敏感个人信息 | 照片、出生年月、性别、籍贯等默认不随 AI 请求发送（翻译与改写不需要）；英文版默认隐藏 |
| 照片 | 本地 blob；导出 PDF/Word 时嵌入，不上传第三方 |
| 导出文件 | 全部在浏览器本地生成并下载，不经任何服务器；文件名不含用户姓名 |
| 开源审计 | 无隐匿网络请求；可提供「关闭 AI」仅用本地规则匹配 + 手动双语 |
| 后续云端 | 若产品化，需单独隐私政策、加密传输、数据删除权 |

---

## 9. 版本路线图

### v1 — MVP（先自用 + 开源）

- 资料库 CRUD + JSON 导入导出，**字段双语 + AI 补译 + 校对缓存 + 术语表**  
- JD 截图/文本解析 + 岗位拆解（中英关键词对照）  
- 智能匹配改写 + 匹配度/缺口  
- **主版本生成 → 副版本本地化 → 一致性校验**  
- 2–3 套 JSON 可调模板，**每套含中/英语言变体**  
- 纯前端生成 PDF + Word，**一键下载 zip（CN/EN × PDF/Word 4 个文件）**，AI 提炼命名、非法字符处理、重复加序号  
- API Key 设置（OpenAI 兼容）；GitHub 开源、中英 README、Pages/Vercel 部署  

### v2 — 体验与社区

- 拖拽自由排版  
- 中英并排实时预览、逐条联动编辑  
- 导出记录与一键重新导出；Word 排版还原度提升（更多模板的 docx 适配）  
- 生成与翻译模型分开配置；英文本地化风格增强  
- 更多模板与社区贡献通道；UI 完整 i18n；历史 JD；批量岗位对比  

### 产品化阶段（视开源反馈）

- 可选云端同步与账号  
- 更多语言（日语、德语等）与地区化模板（如 Letter 纸张、日本履历书）  
- 团队/职业顾问多用户  
- 增值模板或托管 AI 额度（仍保留 BYOK）  
- 合规：隐私政策、ToS、数据导出删除  

---

## 10. 开源运营建议

1. **README**：中英双语；GIF 演示「一个岗位 → 一个 zip（中英 PDF + Word）」全流程；一键部署徽章。  
2. **Issue 模板**：Bug / 模板贡献 / Prompt 改进 / 翻译质量反馈。  
3. **Good first issues**：新模板 JSON（须含 zh/en 变体，并通过 PDF/Word 渲染快照测试）、i18n 文案、Word 样式适配、术语表示例。  
4. **贡献指南**：模板 Schema 文档 + 示例；AI Prompt 变更需附测试用例（固定 JD + 资料 fixture，含双语一致性断言）。  
5. **发布节奏**：小步 Tag；Changelog 记录破坏性 Schema 变更（如 v1.0 → v1.1 的 LocalizedText 迁移）。  
6. **社区触达**：V2EX / Reddit r/opensource / 即刻 / 相关中文技术群，突出「隐私 + BYOK + 中英双版」卖点。  
7. **指标**：Star、有效 Issue、模板 PR 数，作为是否产品化的输入。  

---

## 11. 风险与待定问题

### 11.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 模型编造经历 | 诚信风险 | 强约束 Prompt + `sourceId` 映射校验 + 原文对照 UI |
| 中英两版内容不一致 | 同一候选人两份简历事实冲突，面试失信 | 主→副单向本地化；条目/数字自动比对；主版本改动后副版本标「待同步」 |
| 机翻质量差 / 翻译腔 | 英文简历不专业 | 术语表 + 已确认译文复用 + 本地化风格 Prompt + 人工校对状态 |
| 英文版篇幅溢出 | 超出页数 | 两版分别页数检测；精简时两版同步删减 |
| Word / PDF 排版不一致 | 两种格式观感差异，用户困惑 | 同一 Layout Model 驱动；Word 以可编辑性优先并在 README 说明差异；内置模板逐一做 PDF/Word 对照快照测试 |
| Word 在不同软件中显示差异 | Office / WPS / Pages 字体、表格渲染不同 | 使用常见 fallback 字体与内置样式；避免文本框与复杂嵌套；在 Office 与 WPS 中回归测试 |
| 中文字体嵌入体积 | 思源字体完整版 >10MB，PDF 与加载体积过大 | 按文档用字动态子集化 / 常用字子集；懒加载；Word 不嵌字体 |
| 纯前端 PDF 库排版能力有限 | 分页、断行、中文标点禁则不理想 | 限定模板复杂度；中文断行做预处理；保留切换 pdfmake 的适配层 |
| 前端生成性能 | 4 个文件生成卡顿 | Web Worker 生成；进度提示；导出库与字体懒加载 |
| AI 提炼公司名/缩写错误 | 文件名不准确 | 导出前弹窗确认可修改；不确定时留空要求用户填写 |
| 多模态 OCR 成本/兼容性 | 解析失败 | 文本粘贴兜底；多 Provider |
| 翻译额外 API 成本 | 用户费用上升 | 译文缓存、仅翻译变动条目、可选低价翻译模型 |
| IndexedDB 被清 | 数据丢失 | 强调 JSON 备份；导出提醒 |
| v1.0 → v1.1 数据结构变更 | 旧备份无法导入 | 导入时自动迁移：纯字符串字段转为 `LocalizedText`（推断 source 语言） |

### 11.2 待定问题

1. OCR：纯多模态（GPT-4o 等）vs 接入本地/第三方 OCR？  
2. PDF 库最终选型：@react-pdf/renderer 与 pdfmake 在中文断行、字体子集化上的实测对比？  
3. 主版本默认语言：跟随 JD 语言，还是跟随用户资料库主语言？  
4. 中文版个人信息（年龄、籍贯、政治面貌等）默认开关策略及合规提示文案？  
5. 模板生态：社区模板如何审核与版本兼容？是否强制要求双语变体？  
6. 匹配度算法：纯 LLM 打分 vs 关键词重叠 + LLM 解释的混合？两版是否共享同一分数？  
7. 产品化触发条件：Star / 活跃 Issue / 付费意愿调研的具体阈值？  

---

## 附录 A. 非目标（v1 不做）

- 账号系统与云端同步  
- 拖拽自由画布排版  
- 中英以外的其他语言  
- 自动投递 / 爬取招聘网站  
- 移动端原生 App  

## 附录 B. 术语

| 术语 | 含义 |
|------|------|
| BYOK | Bring Your Own Key，用户自备 API Key |
| JD | Job Description，岗位描述 |
| 资料库 | 用户结构化履历数据的本地集合 |
| 缺口 | JD 要求中资料库未能覆盖的技能或条件 |
| LocalizedText | 同一字段的多语言值 + 来源语言 + 翻译状态 |
| 主版本 / 副版本 | 针对岗位先生成的语言版本 / 据其本地化得到的另一语言版本 |
| 语言变体 | 同一模板下按语言覆盖的标题、日期、字体、照片等配置 |
| Glossary | 专有名词固定译法表 |
| Layout Model | 与输出格式无关的中间排版模型，供预览 / PDF / Word 共用 |
| 岗位缩写 | 用于文件命名的岗位英文简称，如 FE、PM |
