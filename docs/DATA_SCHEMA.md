# 数据结构（DATA_SCHEMA）

数据库：真实数据 `resume-tool`，演示数据 `resume-tool-demo`。Dexie 版本 **4**（浏览器里 `indexedDB` 版本显示为 40）。

## 版本历史
| 版本 | 变化 |
|---|---|
| v1 | `profile, jobs, resumes, exports, settings, state, templates` |
| v2 | 新增 `backups`（资料快照）；升级前自动快照旧资料，再规范化资料结构 |
| v3 | 历史简历条目补齐 `syncStatus`；事实审查 `audit` 为可选字段 |
| v4 | 新增 `postings, applications, appEvents, artifacts, attachments, attachmentBlobs`（只新增，不改旧表） |

## v4 新表
| 表 | 索引 | 说明 |
|---|---|---|
| `postings` | `id, company, city, recruitType, priority, deadline, updatedAt, *importKeys` | 岗位：公司、岗位、城市、类别、企业类型、招聘类型(campus/intern/social)、届别、来源平台、投递链接、官网链接、截止、优先级(1高2中3低)、JD 原文、备注、`source`、`importKeys` |
| `applications` | `id, postingId, status, updatedAt` | 申请：状态、投递时间、结果、备注、待办 `todos[]`、面试 `interviews[]` |
| `appEvents` | `id, applicationId, at` | 状态历史：`from → to`、时间、备注、`by: user/import` |
| `artifacts` | `id, applicationId, createdAt` | 简历版本：`snapshot`（生成结果深拷贝 + 审查摘要）或 `uploaded`（实际提交的文件，指向附件），`submitted` 标记 |
| `attachments` | `id, postingId, applicationId, sha256, uploadedAt` | 附件元数据：名称、类型、大小、SHA-256、种类（简历/JD 截图/笔试/Offer/其他） |
| `attachmentBlobs` | `id` | 附件二进制，与元数据同 id，同一事务写入 |

## 资料库可选字段（v1.6 / v1.6.1，存于 `profile` 表的同一条 JSON，不升级 Dexie）
| 位置 | 字段 | 说明 |
|---|---|---|
| 所有条目 | `aliases?: string[]` | 其他写法（公司简称、论文题目、另一语言名称），参与去重 |
| 所有条目 | `notes?: string[]` | 备注 / 待核实说明，**不进入简历正文** |
| 所有条目 | `uncertain?: string[]` | 待核对说明；以 `【严重】` 开头的在导入审核页列为重要问题 |
| 所有条目 | `mergeHistory?` | 合并记录（时间、来源、被合并条目快照） |
| `work` | `kind?: '' \| 'fulltime' \| 'internship' \| 'parttime' \| 'club' \| 'volunteer' \| 'other'` | 经历类型；需原文依据，否则留空 |
| `projects` | `kind?: 'core' \| 'auxiliary'`、`nature?: string` | 核心 / 辅助项目及原文性质 |
| `education` | `courses?: string[]`、`coursesInText?: number` | 全部课程；原文课程数用于漏项检查 |
| `education` | `start` / `end` | 就读起止；`end` 只填已结束或原文非「预计」的日期 |
| `education` | `courseCompletionDate?` | 课程结束 |
| `education` | `expectedConferralDate?` | 预计毕业 / 预计授予学位（原文「预计 / expected / 在读」） |
| `education` | `actualConferralDate?` | 已实际授予；必须有原文「已授予 / 已获得」证据，否则留空 |
| `education` | `availableFullTimeDate?` | 可全职入职 |
| 顶层 | `sourceTexts?: {id, at, files, text}[]` | 智能导入的完整原始文本，可检索 |

四种学历日期互不推断。

## 内容质量字段（v1.9，可选，不升级 Dexie，仍为 version 4）
- `LocalizedText.organized?: string`：AI 整理时的文字指纹（防重复改写）。
- v1.9.1：指纹带盐 `QUALITY_VERSION|model`（当前 q2），规则版本或模型变化时自动重新检查；无新增持久字段，Dexie 仍为 version 4。A 类机械清洗不再把另一语言的机翻标为 stale；只有 B 类语义改写被接受后才标 stale（界面显示「待更新（原文已改）」）。
- `BaseEntry.factualContent?: string[]`：被移出要点的原句（事实原文，保留备查）。
- `profile.profile.notes?: string[]`：从简介 / 求职意向移出的内部说明。
- 四类内容映射：factual_content = `factualContent`；resume_ready_content = `bullets` / `highlights`；internal_notes = `notes`；uncertain_facts = `uncertain`。
- 旧 JSON 导入 / 导出兼容：字段全部可选，缺省即旧行为。

## 岗位分析字段（v1.10.0，可选，不升级 Dexie，仍为 version 4）
- `JobParse.responsibilities?: Bi[]`：岗位职责（与 mustHave / niceToHave 分开）。
- `JobParse.textHash?: string`：规范化 JD 文字的哈希，用于复用分析结果、判断分析是否过期。
- `JobParse.ocrRawText?: string`：截图识别原文（去噪声前），只存本机。
- 旧记录没有这些字段时按旧行为处理（哈希按 `rawText` 现算）。

## 状态（10 种）
`screening` 待筛选 · `saved` 已收藏 · `preparing` 准备材料 · `applied` 已投递 · `assessment` 在线测评/笔试 · `interviewing` 面试中 · `offer` Offer · `rejected` 已拒绝/未通过 · `withdrawn` 已撤回 · `closed` 已结束

## 限制
单个附件上限 25 MB；浏览器存储空间不足时给出中文提示，不会写入半条数据。

## 导入格式

### CSV / 通用 JSON
列名自动识别（中英文别名见 `importers.ts` 的 `ALIASES`），可手动修改映射。幂等键：`<来源>:hash(公司|岗位|城市|链接)`。

### ran-application-handoff 1.0（旧「2027 求职投递导航」）
> ⚠ 以下结构来自用户描述，**尚未用真实导出文件验证**。测试 fixture `tests/fixtures/handoff-1.0-mock.json` 为虚构样本（40 校招 + 8 实习 + 21 招聘网站）。

```json
{ "format": "ran-application-handoff", "schemaVersion": "1.0", "exportedAt": "...",
  "jobs": [ {记录} ], "internships": [ {记录} ], "portals": [ {招聘网站} ] }
```
记录字段 → 本工具：

| 导航工具字段 | 本工具 | 说明 |
|---|---|---|
| `id` | `source.externalId`，幂等键 `ran-application-handoff:id:<id>` | 同一 id 再次导入识别为重复；内容变化识别为冲突 |
| `kind` | 保留在 `source.raw` | |
| `priority` | `priority`（高/中/低 → 1/2/3）+ 备注「原优先级：…」 | 原文始终保留 |
| `type` | 招聘类型（若是校招/实习/社招），否则为「类别」 | `jobs` 默认校招，`internships` 一律实习 |
| `company` / `city` / `title` | 同名字段 | |
| `description` | `jdText` | |
| `url` | `applyUrl` | 原样保留 |
| `source` | `sourcePlatform` | |
| `elig` | 备注「报名条件：…」 | |
| `deadline` | `deadline`（无法解析时写入备注「原截止日期」） | |
| `evidence` | 备注「依据：…」 | |
| `notes` | `notes`（放在最前） | |
| `status` | 见下表；原文写入备注与状态历史 | |
| 其他未知字段 | 不导入为字段，**预览中列出**；原始记录完整保存在 `source.raw` | |

状态转换：

| 导航工具 | 本工具 | 理由 |
|---|---|---|
| 未投 | **不建立申请**（岗位显示为「仅岗位」） | 最忠实：没有投递就没有申请；避免把收藏/待筛选强加给用户，也绝不变成已投递 |
| 已投递 | 已投递 | |
| 等待反馈 | 已投递 + 历史备注「原始状态『等待反馈』」 | 本工具「等待回复」由已投递状态统计得出 |
| 笔试/面试 | 在线测评 / 笔试 + 原文保留 | 原文无法区分笔试还是面试，取较早阶段，不夸大进度；用户可手动改为「面试中」 |
| 已结束 | 已结束 | |
| 其他 | 不建立申请，预览中标红提示 | 不猜测 |

导入的申请**不填写投递时间**（原数据没有投递日期）。`portals` 是招聘网站，不导入为岗位，只在预览中列出供参考。


## AI 整理计划（v1.9.3，仅内存）
`OrganizePlan.stats`（total / metaCleaned / improved / unchanged / rejected / review / aiSkipped）与 `OrganizePlan.rejectedItems`（entryTitle / text / reasons）只存在于整理预览的内存中，**不写入 IndexedDB**；Dexie 仍为 version 4，资料结构没有变化。
