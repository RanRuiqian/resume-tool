# 数据结构（DATA_SCHEMA）

## PR #16：自由编辑简历（当前规则）
数据库仍为版本 6，个人资料与来源账本不迁移、不覆盖。仅给 ResumeDoc 增加可选字段，旧简历缺省为空：
- `deselectedItems?: GenItem[]`：本简历取消项的最新 AI/人工文字、译文与来源 ID。
- `entrySelectionMemory?: Record<string,{sourceIds:string[],index:number}>`：整项取消前选择与位置（key 为 section:id）。
- `itemOrder?: string[]`：包括取消项的要点顺序，恢复不重排 AI 选择。
- `entryEdits?: Record<string,ResumeEntryEdit>`：本简历的名称/标题/学位等双语文字及 start/end/date 编辑；渲染临时副本，母库 ID 和数据不变。

`GenItem.manual?: true` 仅在用户编辑/明确单独选用时设置，用于尊重人工显示决定，AI 输出映射不设置此字段；自动生成的成绩仍默认隐藏。

所有可选字段已包含在现有备份 `resumes` / `resumeVersions` / `artifacts` section 的完整序列化范围，不新增归档 section。自动保存、重载、撤销与投递快照均保留；清空个人资料时同简历一起定向清除，epoch 防旧请求恢复。

旧 `audit` / `riskAck` / `evidence` / `kitReview` 数据保留兼容，不作为编辑、导出或共同版本关联的资格门槛。人工选择替换/覆盖即生效，无第二个风险确认。课程不需要认证标记才能选用；未给出/遮挡成绩仍不猜测，成绩默认隐藏。AI 生成端来源及事实校验继续保留。后文历史描述与此不一致时以本节为准。


数据库：真实数据 `resume-tool`，演示数据 `resume-tool-demo`。Dexie 版本 **6**（浏览器里 `indexedDB` 版本显示为 60）。

## 版本历史
| 版本 | 变化 |
|---|---|
| v1 | `profile, jobs, resumes, exports, settings, state, templates` |
| v2 | 新增 `backups`（资料快照）；升级前自动快照旧资料，再规范化资料结构 |
| v3 | 历史简历条目补齐 `syncStatus`；事实审查 `audit` 为可选字段 |
| v6 | 仅新增 jdGroups / resumeVersions；旧数据原样保留 |
| v5 | 事务内原始资料备份后追加空 courses，其他表原样保留；失败整体回滚 |
| v4 | 新增 `postings, applications, appEvents, artifacts, attachments, attachmentBlobs`（只新增，不改旧表） |

## v1.11.0（无结构变更，仍为 version 4）
- `applications.status` 新增可选值 **`pending`（待投递）**，排在 `saved` 之后；统计中单独计数，**不计入**已投递 / 等待回复。旧记录不受影响。
- `postings.source.kind` 新增 **`analysis`**（来自岗位分析历史）；`postings.jobParseId` 指向 `jobs` 表中的岗位分析记录（已有可选字段）。「关联到已有」只写入 `jobParseId`，不改写已有岗位的其他字段。
- `ResumePlan`（`relevance.ts`，仅内存，不写入 IndexedDB）新增可选 `budgets`、`dropped`、`model`、`ranked`；落选原因写入简历 `notes`（已有字段）。

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
- `JobParse.explain?: { createdAt; items: { id; text; meaning; abilities; experience }[] }`：岗位要求解读（2026-11）。`id` = `jobRequirements(job)` 的 id；`text` 为解读时的原文，不一致视为过期。只读说明，不参与选材和简历；可选字段，无需迁移。
- 旧记录没有这些字段时按旧行为处理（哈希按 `rawText` 现算）。

## 求职信人工核对（v1.10.1，可选，不升级 Dexie，仍为 version 4）
- `ResumeDoc.extras.kitReview?: { overrideAt; textHash; issues; profileHash?; jobHash?; resumeHash? }`：用户对逐句核对未通过的求职信 / 自我介绍人工核对并允许导出。只有四项指纹全部一致才有效：文本（`textHash`）、资料事实集合（`profileHash`）、当前岗位（`jobHash`：id + JD 文字 + 分析结果）、当前简历（`resumeHash`：id + 生成时间）。任一变化即失效（历史元数据，不再拦截导出）；缺少指纹的旧记录视为无效。逐句核对明细不持久化，打开时按当前资料现算（旧数据兼容）。

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

## v1.12 固定简介与多来源概括（可选字段，Dexie 仍为 version 4）

- `profile.summary` 继续使用现有 `LocalizedText` 和 `status`，不新增用户默认简介或用户专属内容。生成时复制人工/已确认的双语原文到 `ResumeDoc.items[sourceId='summary']`，不按岗位改写，不修改旧简历。
- `GenItem.sourceIds?: string[]`：同一工作/项目内多个已选事实的概括，包含主 `sourceId`。所有来源必须有效、同父条目、唯一且未被其它生成要点使用；缺省表示旧单来源。审查/恢复使用全部来源，手动取消其中一条时拆回其它原文。
- `ResumeDoc.layoutPolicy?: 'readable'`：仅新 AI 简历设置；适配间距时不缩小正文和行距。缺省保持旧简历的布局行为。
- 数据库表、版本、资料 JSON 和备份格式均不变。`backup.ts` 的既有 `resumes` / `artifacts` sections 已完整序列化这些可选字段，`tests/dataSafety.test.ts` 验证 IndexedDB、JSON、备份恢复及旧快照不变；不需要新增 section。

## v1.13 P0/P1 增量（profile 1.4，Dexie 5）

- 数据库 v5（IndexedDB 50）不增加/删除表：在同一升级事务里先写 `bk-premigrate-v4-me` 原始资料快照，再给缺少 courses 的旧文档追加 `courses: []`。不会重写旧经历、历史简历、密钥或求职记录。任意升级写入失败整体回滚 v4；重开可重试。成功升级后的资料回退使用快照，不降低数据库版本。升级前快照永久保留，不参与普通最近 20 份的轮替。
- `ProfileDoc.courses?: CourseEntry[]` 是独立课程实体（不复用 projects）。字段：稳定 id、enabled、educationId、school、level=bachelor/master、term、kind=taught/project-credit、name 双语官方原名、code、credits 原文、grade={raw,status=recorded/not-released/unverified}、synopsis 双语一句概述、knowledgeTags、evidenceLevel=official/inferred/recalled/unverified、sources[{id,label,reference?}]、confirmation=pending/confirmed、defaultGradeVisible=false、projectIds、aliases。另一语言原名缺失允许留空，不批量机翻官方名称。`ProjectEntry.courseIds?` 可保存反向关联；本轮编辑入口以课程的 projectIds 为准，不自动迁移/删改旧项目。
- 课程草稿 JSON 为课程数组或 `{courses:[...]}`，完整母库 JSON 仍可 roundtrip。TXT 为 UTF-8 带表头的 `|` 或 Tab 表格；列名和虚构示例见 `src/storage/courses.ts` 的 COURSE_TXT_EXAMPLE。不支持在单元格中转义分隔符/换行，复杂内容用 JSON。未知列、格式冲突整批拒绝，不能悄悄丢列。
- 有官方代码时身份由教育（ID 优先）、层次、学期、代码构成；无代码使用官方名。相同身份的互补双语可合并，冲突不覆盖；无共同 ID/代码的疑似异语同课进入人工核对。以后换正式学校名/教育 ID 时请沿用稳定课程 ID。导入先预览，新内容一律待确认，默认全部跳过；明确选择 add/fill/replace 才写入，先保存完整资料快照。fill 不覆盖人类已有内容；replace 保持原 ID 并退回 pending。未提供 V5 文本格式，不能把本通用 TXT 接口当作已适配 V5 自由文本。
- `ResumeDoc.courseSelection?={ids,gradeIds,snapshots?}` 每份简历独立，snapshots 只存 id、教育关联、课程官方名、代码；明确开启的单课才存 gradeRaw。未公布/待核实成绩不能公开，项目学分不计授课课程、不打印为新项目。课程概述不输出；本轮没有接通 AI 自动选课或语义报告。
- `Contacts.portfolio?` 与 github/linkedin/website 各自有 `visibility?` 开关，缺省隐藏。`ResumeDoc.contactVisibility?` 保存新简历当时的开关。开关不授予任何项目证据资格。
- `ResumeDoc.summaryBaseline?` 保留本份简历固定简介；人工变体显式确认后只改本份 resume，进入事实审查，支持恢复固定版/撤销。母库 manual/旧无状态/machine/stale 简介不再消失，而是原样显示并标待确认；只有真实 confirmed 状态才显示已确认。
- 生成副本去掉结构化课程成绩、原文全文及教育学术分数亮点；语言考试证据不换算。新申请快照不复制隐藏的课程成绩。母库 JSON/完整档案备份和本地回滚快照**仍完整保存私人成绩**，请勿公开它们。已有 artifacts 保持不可变，不迁移/脱敏旧内容。自由文本中没有学术标签的任意分数不属于自动识别保证范围，投递前仍需人工审阅。
- 现有 `SECTIONS` 已包含 profile/resumes/artifacts，不新增归档 section；旧归档无 courses 时默认空，旧记录原样保留。

## v1.13 P2（Dexie 6 / IndexedDB 60，归档格式 v2）

- 迁移 v6 只新增 `jdGroups: id,updatedAt` 与 `resumeVersions: id,digest,createdAt`，不重写任何 v5 行。v5 的迁移前备份、资料、设置/Key、历史/投递/附件原样保留；DB 事务失败不清库。
- `JointGroup` 保存企业、1–3 个 `JointRole`、归档岗位及创建/修改时间。每个 role 独立 ID、名称、正文、链接、截图+OCR 原文；`analyses[]` 只追加 `{jobId,revision,inputHash,at}`，`analysisId` 指向当前解析。角色移除归档可恢复，强制重解析产生新 JD ID，旧 job 不覆盖。companyConfirmed 仅表示用户明确核对了异语/简称的同一企业，不由模型猜测授权。
- `JobParse.joint?: {groupId,company,targets:[{roleId,revision,name,url,job}]}` 是公司级协调快照。每个 target.job 是独立 JD 的完整快照，不嵌套其他 joint。不把多段 JD 拼成一个 rawText。文本不变复用独立解析，协调内容相同复用协调 ID；内容改变生成新的协调版本，旧简历不自动覆盖。
- 联合岗位每条要求使用 `<job.id>:<must|responsibility|preferred>:<index>`。AI 必须逐条完整引用 requirementId、原 text/tier、evidenceIds 和 reason；本地校验 ID、岗位归属、重复、遗漏、共同/互补覆盖及跨岗冲突引用。原有效要求 ID/层级/文本在局部修复中不得挪用或降低。
- 已确认授课课程进入同一精确证据白名单（不含成绩/来源位置）；候选包含名称、内容概述、知识域、概述证据等级和关联真实项目。仅允许 `learning` 引用课程，不能用课程作为 `direct/transferable` 实操证明；学习判断仍保留实践缺口。`courses[]` 由 AI 决定打印哪些课程名，正文写作 facts 仍仅实际工作/项目事实，不复制课程概述。母库与成绩开关继续沿用 P0/P1。
- `ResumeDoc.evidenceReport?` 保存逐岗判断、程序派生的来源类别/原文/证据等级/风险、AI 选材原因及共同/互补/冲突归纳。当前采用状态随手动勾选/排序现算，来源在母库但未选入正文时明确标注；不伪称为当前正文亮点。报告不再自动附于简历 ZIP；UI 折叠展示，可单独下载；不是官方 ATS 或录用保证。
- `SharedResumeVersion` 内容寻址 ID=`version-<SHA256>`，digest 覆盖规范化 profile/template/resume/job（排序使用固定字符串顺序，不依赖地区）。profile 使用隐私副本，隐藏课程分数不复制；明确开启的原始成绩只在 resume.courseSelection 保存。冻结完整模板，旧导出不受后来模板修改影响。哈希只验证内容完整性，不证明用户事实本身真实。
- `Application.resumeVersionId?` 指向同一共同版本；`ResumeArtifact.versionId?` 是只读引用，不各复制一份正文。批量关联事务创建/复用该组角色的岗位/申请、共同版本与引用，默认新状态 pending、没有 appliedAt；已有状态/手工岗位不覆盖，已有 artifacts 不修改。重复关联同内容幂等；编辑后显式关联产生新版本，旧内容和实际提交标记仍保留。删除一条申请不删除其他申请共用的版本。
- 归档新增 jdGroups/resumeVersions sections，archiveVersion=2（旧 v1 可读，旧客户端应拒绝新版以免漏掉关联）。恢复前检查版本哈希；不可变版本同 ID 冲突拒绝，artifacts/版本已有记录不覆盖。选中有关联指针的记录时，必须一并恢复共用版本或确保本机已有该版本，防止静默悬空。
- **archiveVersion=3（2026-11-03，换设备备份）**：新增 `templates` section（`data/templates.json`，用户自己的版式模板，恢复时 `normalizeTemplate`）；可选 `data/settings.json`（`SettingsArchive`：uiLang、ocrMode、activeProfileId、apiProfiles **去掉 apiKey**）；可选 `data/keys.enc.json`（`EncryptedKeys`：`{alg:'AES-GCM-256', kdf:'PBKDF2-SHA256', iterations:250000, salt, iv, data, count}`，base64，明文为 `{profileId: apiKey}`）。轻量 JSON 对应顶层字段 `settings` / `encryptedKeys`。manifest 新增 `settings`、`encryptedKeys`（条数）。Key **只在用户勾选并设置 ≥6 位密码时**以密文导出，明文永不进入备份。恢复：`restoreSettings` + `keyPassword`；先解密（密码错误抛错、不写任何数据），再在同一事务写入；同 id 配置按 `overwrite`（覆盖时备份无 Key 则保留本机 Key）；本机无可用启用配置时启用备份的启用配置。v2 备份缺 templates 文件不报警告。代码：`src/tracker/backupSettings.ts`、`backup.ts`；测试 `tests/backupSettings.test.ts`、`tests/e2e/backup_settings_e2e.py`。

## 用户明确清空个人资料（不升级 schema，仍为 Dexie 6）

「我的资料」顶部的「🔴 清空所有个人资料」须在确认窗口点击「确认清空」才执行。事务内清空 profile（写回 emptyProfile）、backups（含升级前快照）、resumes、exports，重置 state.resumeId 并更新 state.profileClearEpoch；不建立删除前快照，所以不可撤销。所有母库字段、双语内容、课程/证据/关联、sourceTexts 及导入记录一并移除，不删整个数据库。

保留 settings（全部 API 配置、Key、模型、语言）、templates、jobs/jdGroups、postings/applications/appEvents、artifacts/resumeVersions、attachments/attachmentBlobs 及其他界面设置。**投递记录内已关联的只读历史简历/附件可能含旧个人信息，按求职记录要求原样保留，确认窗口明确说明；它们不自动恢复母库。** 用户自己保存的外部备份/已下载文件不由网页删除，主动重新导入外部文件属于新操作。

清空提交后丢弃内存里的导入/整理/翻译草稿和撤销栈，向导回到第一步。清空代次在同一事务里校验：旧标签页、旧异步导入/翻译/生成/导出和快照写入不能跨代恢复旧资料；初始化也一致读取 profile 与代次。演示库清空后刷新不自动重新注入示例。新代次允许重新上传 TXT 识别并保存全新资料，API 调用方式不变。

自动化只在虚构的独立测试库执行删除：`tests/clearPersonalData.test.ts` 与 `tests/e2e/clear_personal_data_e2e.py`。复现浏览器测试先运行 `CLEAR_OUT=/tmp/clear-profile npx vitest run tests/clearPersonalData.test.ts` 生成虚构 fixture，再启动 4173 预览并执行 `CLEAR_OUT=/tmp/clear-profile python3 tests/e2e/clear_personal_data_e2e.py`。不向真实库播种或执行删除测试。

## 编号母库 TXT 智能导入（PR #15 后续）

无数据库版本变更。`BaseEntry.sourceRecord? = {format:'numbered-library', id, section, raw, reviewed}` 保存母库来源编号、栏目、完整事实块及原文 `[x]` 标记；它的 `id` 不是数据库实体 ID，不能随导入时的内部 ID 重分配而改变。`SourceText.integrity?` 保存逐类 expected / recognized / missing 编号及 issues，`complete` 仅表示当前文本的编号与映射完整，不能证明外部文件完整或事实真实性。

「智能识别并填入」检测到 BSC-/MSC-/EDU-/PRO-/LRN-/SKL- 等行首编号后，使用本地确定性路径，不自动调用 AI/翻译。支持 01–14 栏目、Markdown 标题/复选标记、带中文字段标签的记录及带表头的课程竖线表/TSV。缺少可确定列映射的表格、未知实体类型、重复编号内容冲突、未识别课程名、悬空引用均明确报告，完整性未通过时不写入。非编号旧资料继续走原有 AI 分段导入。

课程直接进入 `profile.courses`，不再要求通过第二个课程导入流程搬移教育文本。来源 BSC/MSC 编号保存在 sourceRecord/sources；原文课程代码单独存入 code，学分为字符串，成绩 grade.raw 原样保留；遮挡/未知为 unverified，未公布为 not-released，绝不补数。`[x]` 只确认原文记录，不能把课程概述升级为官方大纲或实操（evidenceLevel 仍为 unverified），成绩仍默认隐藏。原文完整保存在 sourceRecord.raw 与 sourceTexts。

EDU 只建立能确认学校名称的教育记录；项目学分单元不创建教育/工作/核心项目。课程↔项目、技能→经历按原文明示编号或明确工具字段精确名称关联；内部实体 ID 在应用计划后统一映射。相同来源编号再次导入不会新增条目，不同编号不按子串/相似度自动合并；同校、同学位专业、同开始日期且结束不矛盾的教育补充片段可以合并。真正的字段/原文矛盾仍要求决定，已确认字段覆盖由用户明确选择，不再二次确认。

新增字段随私有 JSON / ZIP 的 profile section 完整备份（无须新 section）。生成副本和投递快照移除 sourceTexts、sourceRecord 与包含原文快照的 mergeHistory，避免旁路带出隐藏成绩；私有母库仍完整保留它们。PR #15 精准清空整份 profile/原文/快照的行为覆盖上述字段，API 设置与投递记录不受导入影响。

**真实 V7 的事实级格式**：`01｜栏目` / `[x] ID｜事实` 以事实为单位，不能每行建立实体。EDU-M/B 按教育命名空间组装；PRO 按项目前缀组装；LRN 在课程范围内按 Q/Lab/Assignment/Workshop 分组。课程固定列分别读取，不把 MSC-S 汇总当授课课程；缺失的逐门硕士学分留空。新增可选 `ProfileDoc.sourceFacts = {id, section, raw, reviewed, entityIds[]}[]` 保存私有逐条事实账本，实体 ID 写入后统一映射；作为 profile section 备份，无数据库/section 迁移。生成副本移除 sourceFacts 及原件备注中的成绩页摘要，清空个人资料覆盖账本。原件已本地隔离验证 299/299 编号事实（不含标记说明中的 [x]）、本科76/76、硕士6/6、核心项目2/2，详见 V7_STRUCTURED_IMPORT.zh-CN.md。CI 仅用虚构 fixture；历史15/80清单未提供，不伪造逐项对照。

## AI 措辞整理的临时执行报告

`OrganizePlan.ai` 只在预览内存保存 requested/requestedModel/responseModels、实际请求尝试数、eligible、skipped/noCallReason 和逐批状态/错误；不新增数据库表或备份 section。`AiObservation` 为每个 chat/chatJson 请求可选回调，不包含 Key/请求正文；usage.reportedModel 只取服务明确返回的 model，无此字段时不冒充实际模型。原 `LocalizedText.organized` 指纹盐升级，以区分新的主动措辞审阅策略。实体、学历、日期、课程成绩、sourceFacts/sourceRecord 等模式不变，整理只修改经用户选择的正文和既有追溯元数据。

## 2026-11 撰写与导入调整（无 Dexie 升级，仍为 version 6）
- `ResumeDoc.headline?: Bi`（可选）：按岗位定制的姓名下求职方向；缺省时显示 `profile.headline`。旧简历无此字段，行为不变。
- `GenItem` 的 `sourceId: 'summary'` 现在默认是**按岗位定制**的简介（AI 撰写，事实检查不通过时回退固定简介）；`summaryBaseline` 仍记录生成时的版本，取消 / 重新勾选简介时恢复它。
- `SkillEntry.level?: string`（已有字段，现由 V7 导入写入）：【】中的熟练度 / 证据性质（如「基础使用」「课程仿真」）。`category` 改为 V7 小标题派生的领域分组（如「工程/原型」）。
- 选中条目缺另一语言的短字段（学校、学位、专业、单位、职位、项目名、技能名与分组、证书 / 奖项名、课程名）在生成或「同步翻译」时按需机翻，写回母库，状态 `machine`；同时更新本简历 `courseSelection.snapshots` 的课程名。这替代了 v1.13「课程另一语言原名留空、不批量机翻」的约定（只翻译选中的，不批量）。
- V7 导入：标量字段去句末标点；本科课程第二列（课程性质）不再作为英文名；INTRO 去字段名；项目「性质」可从同行分句读取，不再用栏目标题顶替。
- `ResumeDoc.skillGroups?: {zh,en,ids}[]`（第二轮）：AI 按岗位给出的技能分组与顺序，只影响显示；未覆盖的已选技能按 `SkillEntry.category` 分组。旧简历无此字段，行为不变。
- V7 组织 / 兼职 / 志愿条目：`WorkEntry.company` 现为单位（如「X 校学生会」「肯德基（KFC）」），`title` 为职务（「外联部成员」「兼职」）；兼职 `kind=parttime`，不归为实习。

## 求职信 / 备考方向（2026-11-03，无数据库变更）
`PrepDirection.points?: Bi[]`（可选，2–4 个要复习的知识点）；`PrepDirection.source` 现为对应岗位要求原文（多条以「；」连接）。`KitQuality.status` 新增 `review`，附 `removed`（被自动删掉的句子及原因）、`flagged`（保留待核对的句子）；KitQuality 只在内存中，不入库。
