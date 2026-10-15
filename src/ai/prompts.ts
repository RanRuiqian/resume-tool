export const SYS_FACTS = `你是专业的中英文简历顾问。铁律：只能使用用户资料库中的事实，严禁编造公司、职位、时间、成果、数字；无法覆盖的岗位要求写进 gaps，而不是虚构。只输出 JSON。`;

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

export const TRANSLATE_PROMPT = (from: string, to: string) => `把下列简历字段从${from}翻译成${to}。要求：只翻译不润色，不增删信息，数字/日期/链接/技术名保持原样；专有名词表（glossary）中的词必须使用给定译法。英文简历 bullet 用强动词开头、过去时、省略主语。
输入 JSON：{"glossary":[...],"items":[{"key":"...","text":"..."}]}
输出 JSON：{"items":[{"key":"同输入","text":"译文"}]}，条目数量与 key 必须与输入完全一致。`;

export const GENERATE_PROMPT = (lang: string, maxBullets: number) => `根据岗位解析结果，从用户资料库中挑选最相关的经历并改写，生成${lang}简历主版本。
要求：
1. selection 中只能出现资料库里已有的条目 id，按与岗位相关度排序；work/education 通常全部保留，projects/skills/certificates/awards 只选相关的。
2. items 为改写后的 bullet / highlight 以及 summary（sourceId 用 "summary"）。每条必须携带资料库原始条目的 sourceId，一个 sourceId 只出现一次；只能改写措辞以贴合 keywords，严禁新增事实或修改任何数字、日期、公司、职位。
3. 每段经历最多保留 ${maxBullets} 条最相关的 bullet；控制总篇幅在目标页数内，宁缺毋滥。
4. matchScore 为 0–100 的匹配度；gaps 列出资料库无法覆盖的 mustHave（${lang}）。
输出 JSON：{"selection":{"work":[],"projects":[],"education":[],"skills":[],"certificates":[],"awards":[]},"items":[{"sourceId":"...","text":"..."}],"matchScore":80,"gaps":["..."],"reasons":"简短挑选理由"}`;

export const LOCALIZE_PROMPT = (from: string, to: string) => `把下面的${from}简历主版本逐条本地化为${to}副版本。主版本是唯一事实源：
- 逐条翻译/本地化，不得新增、删除、合并条目，sourceId 与顺序完全不变；
- 不得改动数字、日期、百分比、专有名词；glossary 中的词必须原样采用；
- reference 中是用户已确认的参考译法，措辞未变处优先复用；
- 使用目标语言岗位关键词（keywords）的习惯说法；英文用强动词开头、过去时、省略主语、量化前置；中文去翻译腔、简洁书面语。
输出 JSON：{"items":[{"sourceId":"...","text":"..."}]}`;
