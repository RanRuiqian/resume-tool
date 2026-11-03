import type { Bi, JobParse, ProfileDoc } from '../types';
import { jdHash } from './jd';
import { lt } from '../locale/text';

export const GENERIC_JOB_ID = 'generic-resume';
const bi = (zh: string, en: string): Bi => ({ zh, en });

/**
 * 2026-11：公版简历。没有具体岗位时，用一个合成岗位走同一条生成流程：
 * 要求是各类工科岗位都看重的通用能力，AI 据此挑「最有代表性」的经历（提示词里 job.generic 会要求精炼、覆盖面广、不偏向某个岗位）。
 */
export function makeGenericJob(p: ProfileDoc): JobParse {
  const keywords = p.skills.filter((x) => x.enabled).slice(0, 8).map((x) => ({ zh: lt(x.name, 'zh') || lt(x.name, 'en'), en: lt(x.name, 'en') || lt(x.name, 'zh') })).filter((x) => x.zh);
  const rawText = '公版简历：不针对具体岗位。挑选最有代表性、适用面最广的经历，内容精炼。';
  return {
    id: GENERIC_JOB_ID, createdAt: new Date().toISOString(), rawText, textHash: jdHash(rawText), jdLanguage: 'zh', generic: true,
    company: { full: 'General', short: 'General' }, roleAbbr: 'GEN',
    title: bi('通用简历（公版）', 'General Resume'),
    mustHave: [
      bi('工程类专业教育背景与扎实的专业基础', 'Engineering education with solid fundamentals'),
      bi('有代表性的实践项目或实习，能说明做了什么、用了什么工具、结果如何', 'Representative projects or internships with clear actions, tools and results'),
      bi('常用专业工具与软件能力', 'Proficiency with common professional tools and software'),
      bi('团队协作与沟通能力', 'Teamwork and communication'),
      bi('英语读写与沟通能力', 'English reading, writing and communication'),
    ],
    niceToHave: [bi('借助 AI 工具提升工作效率', 'Using AI tools to improve productivity'), bi('竞赛、证书等第三方认可', 'Third-party recognition such as competitions and certificates')],
    responsibilities: [], yearsRequired: null, keywords, summary: '公版简历',
  };
}
