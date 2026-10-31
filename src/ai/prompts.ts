export const SYS_FACTS = `你是专业的中英文简历顾问。铁律：只能使用用户资料库中的事实，严禁编造公司、职位、时间、成果、数字；无法覆盖的岗位要求写进 gaps，而不是虚构。只输出 JSON。`;

/** v1.7 措辞规范（去「AI 味」）：生成、本地化、翻译共用 */
export const WRITING_RULES = `措辞规范：
- 每条写清「做了什么具体任务 + 用了什么方法/工具 + 可核实的结果」；资料库没有结果就只写任务和方法，不要补结果。
- 不得新增或推算百分比、倍数、金额、人数等数字；资料库没有的数字一律不写。
- 课程实验、课程设计、教学实训、个人练习如实写明性质，不得包装成商业项目、公司项目或全职工作；在读或预计毕业不得写成已获学位。
- 禁用空话套话：如「积极主动」「认真负责」「熟练掌握各类」「全面提升」「赋能」「深度参与」「助力」「极大地」「显著」等无依据形容；不写口号式总结。
- 避免每条用同一句式开头；关键词只在与事实吻合的地方自然出现，不得堆砌或把 JD 原句硬塞进经历。
- 宁短勿虚：内容不足时少写一条，不要凑字数。`;

export const OCR_PROMPT = `请完整、逐字提取这张招聘信息截图中的全部文字，保持原有段落和编号，不要总结、不要翻译。只输出提取的纯文本。`;

export const JD_PARSE_PROMPT = `解析下面的岗位描述（JD），输出 JSON：
{
 "jdLanguage": "zh" | "en",
 "company": { "full": "JD 中的公司全称，没有则空字符串", "short": "常用简称，去掉 有限公司/科技/Inc. 等后缀；不确定则空字符串，禁止臆造" },
 "roleAbbr": "行业通用英文岗位缩写，如 前端→FE 后端→BE 产品经理→PM 数据分析→DA 算法→MLE；无通用缩写用英文关键词驼峰简写；不确定则空字符串",
 "title": { "zh": "中文职位名", "en": "English job title" },
 "mustHave": [{ "zh": "...", "en": "..." }],
 "niceToHave": [{ "zh": "...", "en": "..." }],
 "yearsRequired": 数字或 null,
 "keywords": [{ "zh": "中文关键词", "en": "English keyword" }],
 "summary": "一句话岗位摘要（JD 语言）"
}
keywords 取 8–15 个，中英文分别使用该语言招聘中的习惯说法。`;

export const TRANSLATE_PROMPT = (from: string, to: string) => `把下列简历字段从${from}翻译成${to}。要求：只翻译不润色，不增删信息，数字/日期/链接/技术名保持原样；专有名词表（glossary）中的词必须使用给定译法。英文简历 bullet 用具体动词开头、过去时（进行中的用现在时）、省略主语；不要每条都用同一个动词，不要逐字硬译中文结构。
输入 JSON：{"glossary":[...],"items":[{"key":"...","text":"..."}]}
输出 JSON：{"items":[{"key":"同输入","text":"译文"}]}，条目数量与 key 必须与输入完全一致。`;

export const GENERATE_PROMPT = (lang: string, maxBullets: number) => `根据岗位解析结果，从用户资料库中挑选最相关的经历并改写，生成${lang}简历主版本。
要求：
1. selection 中只能出现资料库里已有的条目 id，按与岗位相关度排序；work/education 通常全部保留，projects/skills/certificates/awards 只选相关的。
2. items 为改写后的 bullet / highlight 以及 summary（sourceId 用 "summary"）。每条必须携带资料库原始条目的 sourceId，一个 sourceId 只出现一次；只能调整措辞，在与事实吻合处自然使用 keywords，严禁新增事实或修改任何数字、日期、公司、职位。
3. 每段经历最多保留 ${maxBullets} 条最相关的 bullet；控制总篇幅在目标页数内，宁缺毋滥。
4. summary 只在资料库中有与该岗位直接相关的具体信息（方向、技能、经历）时才写，1–2 句、不写自我评价套话；否则 summary 输出空字符串。
5. matchScore 为 0–100 的匹配度；gaps 列出资料库无法覆盖的 mustHave（${lang}）。
${WRITING_RULES}
输出 JSON：{"selection":{"work":[],"projects":[],"education":[],"skills":[],"certificates":[],"awards":[]},"items":[{"sourceId":"...","text":"..."}],"matchScore":80,"gaps":["..."],"reasons":"简短挑选理由"}`;

export const LOCALIZE_PROMPT = (from: string, to: string) => `把下面的${from}简历主版本逐条本地化为${to}副版本。主版本是唯一事实源：
- 逐条翻译/本地化，不得新增、删除、合并条目，sourceId 与顺序完全不变；
- 不得改动数字、日期、百分比、专有名词；glossary 中的词必须原样采用；
- reference 中是用户已确认的参考译法，措辞未变处优先复用；
- 使用目标语言岗位关键词（keywords）的习惯说法，但只在与原句事实吻合处使用；英文用具体动词开头、过去时、省略主语，原句有数字才保留数字，不要为了「量化」补数字或调整结构；中文去翻译腔、简洁书面语。
${WRITING_RULES}
输出 JSON：{"items":[{"sourceId":"...","text":"..."}]}`;

/** v1.9 资料规范化（「AI 整理现有资料」与首次导入共用的写作规范） */
export const MASTER_WRITING_RULES = `母库写作规范：
- 以用户本人为事实主体，客观、自然地叙述；原文可能是第一人称、第三人称档案、旧简历、学术材料或零散笔记，统一成同一种客观表述。
- 简历要点（bullets / highlights）只写本人实际做的事：具体动作 + 任务 / 对象 + 工具 / 方法 + 原文已有的结果。中文直接简洁，不加「我 / 本人」；英文用动词开头，不加 "I"。
- 以下内容不是经历，绝不能出现在要点里，放进 notes：核验说明（「以本人核实为准」「请自行确认」「有待确认」）、写作 / 投递建议（「建议在简历中强调」「可作为求职材料」「可能适用于某些岗位」）、证据说明（「尚需补充证据」「证书在邮箱」）、免责说明（「以上信息仅供参考」）、空泛自我评价。
- 原文无法确定的事实写进 uncertain（说明原因），不要猜。
- 不得新增或修改任何数字、日期、单位名称、职位、学位、工具名；不得把课程实验 / 教学实训写成商业或公司项目，不得把实习写成正式工作，不得把「预计」授予写成已授予。
- 项目里的失败方案、测试局限、背景信息是真实技术事实，不要删除：放进 archive（项目档案），简历要点保持简洁。`;

export const ORGANIZE_PROMPT = `你在整理一位求职者已经导入的个人资料母库。下面每一项是资料库中的一段文字（key 唯一）。请逐项判断并规范化：
- category：resume（可直接作为简历要点的客观经历描述）/ internal（核验说明、写作建议、证据说明、免责说明，不属于经历）/ mixed（事实与说明混在一起）。
- zh / en：规范化后的简历表述（category=internal 时留空）。只调整措辞、语序、去掉主语和套话，不增删事实；原文没有的数字、日期、工具、单位、成果一律不写。en 只在输入给了英文或要求 needEn=true 时输出，英文用动词开头。
- notes：从这段文字中移出的说明性句子（原样或轻微整理），没有就空数组。
- archive：失败方案、测试局限、过细的技术细节等不必进入简历、但应保留在项目档案中的原文句子（只对项目），没有就空数组。
- uncertain：无法根据原文确定的事实（说明原因），没有就空数组。
${MASTER_WRITING_RULES}
输入 JSON：{"items":[{"key":"...","section":"work|projects|education|profile","context":"所属经历（单位 / 项目名 / 性质）","zh":"...","en":"...","needEn":true}]}
输出 JSON：{"items":[{"key":"同输入","category":"resume","zh":"...","en":"...","notes":[],"archive":[],"uncertain":[]}]}，条目数量与 key 必须与输入完全一致。`;
