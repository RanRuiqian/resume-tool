import type { Bi, JobParse, PrepDirection, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson } from './provider';
import { SYS_FACTS } from './prompts';
import { buildLayout } from '../render/layout';
import { ALL_TEMPLATES } from '../templates';
import type { LayoutModel } from '../render/layout';

/** 把简历版式模型压成纯文本（作为求职信/面试准备的唯一事实来源） */
export function layoutToText(m: LayoutModel): string {
  const out = [m.header.name, m.header.headline];
  for (const s of [...m.main, ...m.side]) {
    out.push(`## ${s.title}`);
    for (const b of s.blocks) out.push([b.title, b.subtitle, b.date].filter(Boolean).join(' | '), ...(b.text ? [b.text] : []), ...b.bullets.map((x) => `- ${x}`));
  }
  return out.filter(Boolean).join('\n');
}
const resumeText = (p: ProfileDoc, r: ResumeDoc) => layoutToText(buildLayout(p, ALL_TEMPLATES[0], 'zh', r)) + '\n\n' + layoutToText(buildLayout(p, ALL_TEMPLATES[0], 'en', r));
const jobBrief = (j: JobParse) => JSON.stringify({ company: j.company.short || j.company.full, title: j.title, mustHave: j.mustHave, keywords: j.keywords, summary: j.summary });

export async function generateCoverKit(s: Settings, p: ProfileDoc, job: JobParse, r: ResumeDoc): Promise<{ coverLetter: Bi; selfIntro: Bi }> {
  const out = await chatJson<{ coverLetter?: Bi; selfIntro?: Bi }>(s, [{ role: 'system', content: SYS_FACTS }, { role: 'user', content:
`根据下面这份简历（唯一事实来源）和目标岗位，撰写：
1. coverLetter：求职信，中文 250–350 字、英文 180–250 words；开头点明应聘岗位，中间用 2–3 个简历中的具体经历和数字说明匹配度，结尾表达意愿。不写简历中没有的事实，不写姓名以外的个人敏感信息。
2. selfIntro：面试开场 1 分钟自我介绍，中文约 200 字、英文约 150 words，口语化。
中英文内容要对应一致。输出 JSON：{"coverLetter":{"zh":"","en":""},"selfIntro":{"zh":"","en":""}}
岗位：${jobBrief(job)}
简历：
${resumeText(p, r)}` }]);
  return { coverLetter: { zh: out.coverLetter?.zh ?? '', en: out.coverLetter?.en ?? '' }, selfIntro: { zh: out.selfIntro?.zh ?? '', en: out.selfIntro?.en ?? '' } };
}

const norm = (t: string) => t.replace(/\s+/g, '').toLowerCase();
/** 备考大方向：只依据 JD 原文；每条必须给出 JD 原句，校验不在原文中的条目直接丢弃 */
export async function generatePrep(s: Settings, job: JobParse): Promise<PrepDirection[]> {
  const out = await chatJson<{ items?: PrepDirection[] }>(s, [{ role: 'system', content: '你是严谨的求职辅导顾问。只依据给出的岗位描述原文，不推测公司内部情况、面试流程或题目。只输出 JSON。' }, { role: 'user', content:
`阅读下面的岗位描述，归纳候选人应重点准备的知识/技能大方向（3–6 条，宁少勿滥）。
要求：
- 每条必须对应 JD 中明确写出的要求，source 字段逐字摘抄该要求所在的原句（不可改写、不可拼接）。
- area 是方向名称（如“SQL 与数据建模”），why 用一句话说明为什么要准备、准备到什么程度，只基于原句内容。
- 不要写具体面试题，不要写公司特定的猜测。
- 中英对应。
输出 JSON：{"items":[{"area":{"zh":"","en":""},"why":{"zh":"","en":""},"source":"JD 原句"}]}
岗位描述原文：
${job.rawText}` }]);
  const raw = norm(job.rawText);
  return (out.items ?? []).filter((x) => x?.area && x.source && norm(x.source).length >= 4 && raw.includes(norm(x.source))).slice(0, 6);
}
