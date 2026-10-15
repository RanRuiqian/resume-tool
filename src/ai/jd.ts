import type { Bi, JobParse, Settings } from '../types';
import { chat, chatJson } from './provider';
import { JD_PARSE_PROMPT, OCR_PROMPT } from './prompts';
import { KEYWORD_DICT } from './keywords';
import { guessRoleAbbr, shortCompanyName } from '../export/naming';
import { uid } from '../locale/text';

export async function ocrImage(s: Settings, dataUrl: string): Promise<string> {
  return (await chat(s, [{ role: 'user', content: [{ type: 'text', text: OCR_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }], { model: s.visionModel || s.model })).trim();
}

const detectLang = (t: string) => ((t.match(/[\u4e00-\u9fff]/g)?.length ?? 0) > t.length * 0.15 ? 'zh' : 'en');
const has = (text: string, k: Bi) => {
  const low = text.toLowerCase();
  const m = (w: string) => (/^[a-z0-9.+# -]+$/i.test(w) ? new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[.+]/g, '\\$&')}([^a-z]|$)`).test(low) : low.includes(w.toLowerCase()));
  return m(k.zh) || m(k.en);
};

/** 规则解析（演示模式 / AI 失败兜底） */
export function parseJdRules(text: string): JobParse {
  const lang = detectLang(text);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const compM = text.match(/([\u4e00-\u9fa5A-Za-z（）()]{2,30}?(?:股份有限公司|有限责任公司|有限公司|集团))/) || text.match(/(?:Company|公司)[:：]\s*(.+)/i) || text.match(/\b([A-Z][\w&]+(?:\s[A-Z][\w&]+)*,?\s(?:Inc\.?|Ltd\.?|LLC|Corp\.?))/);
  const full = compM ? compM[1].trim() : '';
  const titleLine = lines.find((l) => /工程师|经理|设计师|分析师|专家|负责人|engineer|manager|designer|analyst|developer|scientist/i.test(l)) ?? '';
  const title = titleLine.replace(full, '').replace(/^[\s—\-–|:：]+|[\s—\-–|:：]+$/g, '').slice(0, 40);
  const kws = KEYWORD_DICT.filter((k) => has(text, k));
  const niceLines = lines.filter((l) => /优先|加分|plus|preferred|nice to have|bonus/i.test(l)).join('\n');
  const nice = kws.filter((k) => has(niceLines, k));
  const must = kws.filter((k) => !nice.includes(k));
  const yrs = text.match(/(\d+)\s*年(?:以上)?/) || text.match(/(\d+)\+?\s*years/i);
  return {
    id: uid('job'), createdAt: new Date().toISOString(), rawText: text, jdLanguage: lang,
    company: { full, short: full ? shortCompanyName(full) : '' },
    roleAbbr: guessRoleAbbr(title || text.slice(0, 200)),
    title: { zh: lang === 'zh' ? title : '', en: lang === 'en' ? title : '' },
    mustHave: must, niceToHave: nice, yearsRequired: yrs ? parseInt(yrs[1], 10) : null,
    keywords: kws, summary: lines.slice(0, 2).join(' ').slice(0, 120),
  };
}

export async function parseJdAi(s: Settings, text: string): Promise<JobParse> {
  const r = await chatJson<Partial<JobParse>>(s, [{ role: 'system', content: '你是招聘信息解析助手，只输出 JSON。' }, { role: 'user', content: `${JD_PARSE_PROMPT}\n\nJD：\n"""\n${text}\n"""` }]);
  const bi = (a: unknown): Bi[] => (Array.isArray(a) ? a.filter((x) => x && (x.zh || x.en)).map((x) => ({ zh: String(x.zh ?? ''), en: String(x.en ?? '') })) : []);
  return {
    id: uid('job'), createdAt: new Date().toISOString(), rawText: text,
    jdLanguage: r.jdLanguage === 'en' ? 'en' : r.jdLanguage === 'zh' ? 'zh' : detectLang(text),
    company: { full: r.company?.full ?? '', short: r.company?.short ?? '' },
    roleAbbr: (r.roleAbbr ?? '').trim(),
    title: { zh: r.title?.zh ?? '', en: r.title?.en ?? '' },
    mustHave: bi(r.mustHave), niceToHave: bi(r.niceToHave), keywords: bi(r.keywords),
    yearsRequired: typeof r.yearsRequired === 'number' ? r.yearsRequired : null, summary: r.summary ?? '',
  };
}
