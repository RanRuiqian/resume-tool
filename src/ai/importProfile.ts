import type { Lang, LocalizedText, ProfileDoc, Settings } from '../types';
import { chatJson } from './provider';
import { emptyProfile, normalizeProfile } from '../storage/profileIO';

const PROMPT = `把用户粘贴的简历 / 个人经历文字整理成结构化 JSON。规则：
- 只整理原文中出现的信息，严禁补充、推测或美化；原文没有的字段留空字符串或空数组。
- 保持原文语言（中文就输出中文，英文就输出英文），lang 字段标明 "zh" 或 "en"。
- 日期统一为 "YYYY-MM"（只有年份写 "YYYY"），至今写 "present"。
- 每段工作/项目经历的要点拆成 bullets 数组，每条一句，保留所有数字与成果；tags 填该经历用到的技术/工具名。
- headline 只写职位名称本身（如「数据分析师」），不要带「求职意向：」等前缀；education.highlights 只写成绩/奖项等亮点，不要重复学校、专业、学位。
- skills 每个技能一项，category 为分类（如 前端 / 后端 / 语言 / 工具），没有则空。
输出 JSON：
{"lang":"zh","name":"","headline":"","summary":"","email":"","phone":"","location":"","github":"","linkedin":"","website":"",
"education":[{"school":"","degree":"","major":"","start":"","end":"","highlights":[""]}],
"work":[{"company":"","title":"","start":"","end":"","bullets":[""],"tags":[""]}],
"projects":[{"name":"","role":"","start":"","end":"","bullets":[""],"tags":[""],"link":""}],
"skills":[{"name":"","category":""}],
"certificates":[{"name":"","issuer":"","date":""}],
"awards":[{"name":"","issuer":"","date":""}]}`;

type S = string | undefined;
interface Raw {
  lang?: Lang; name?: S; headline?: S; summary?: S; email?: S; phone?: S; location?: S; github?: S; linkedin?: S; website?: S;
  education?: { school?: S; degree?: S; major?: S; start?: S; end?: S; highlights?: S[] }[];
  work?: { company?: S; title?: S; start?: S; end?: S; bullets?: S[]; tags?: S[] }[];
  projects?: { name?: S; role?: S; start?: S; end?: S; bullets?: S[]; tags?: S[]; link?: S }[];
  skills?: { name?: S; category?: S }[];
  certificates?: { name?: S; issuer?: S; date?: S }[];
  awards?: { name?: S; issuer?: S; date?: S }[];
}

/** 把 AI 输出的单语结构转为双语资料库（另一语言留空，后续补译） */
export function rawToProfile(r: Raw): ProfileDoc {
  const lang: Lang = r.lang === 'en' ? 'en' : 'zh';
  const L = (v: S): LocalizedText => (v && v.trim() ? { [lang]: v.trim(), source: lang, status: { [lang]: 'manual' } } : {});
  const arr = <T,>(a: T[] | undefined) => (Array.isArray(a) ? a : []);
  const strs = (a: S[] | undefined) => arr(a).filter((x): x is string => !!x && !!x.trim());
  const d = (v: S) => (v ?? '').trim();
  const p = emptyProfile();
  p.primaryLanguage = lang;
  p.profile.name = L(r.name); p.profile.headline = L(r.headline); p.profile.summary = L(r.summary);
  p.profile.contacts = { email: d(r.email), phone: d(r.phone), location: L(r.location), github: d(r.github), linkedin: d(r.linkedin), website: d(r.website) };
  let n = 0;
  const id = (k: string) => `${k}-${++n}`;
  p.education = arr(r.education).filter((e) => e.school).map((e) => { const i = id('edu'); return { id: i, enabled: true, school: L(e.school), degree: L(e.degree), major: L(e.major), start: d(e.start), end: d(e.end), highlights: strs(e.highlights).map((h, j) => ({ ...L(h), id: `${i}-h${j + 1}` })) }; });
  p.work = arr(r.work).filter((e) => e.company || e.title).map((e) => { const i = id('work'); return { id: i, enabled: true, company: L(e.company), title: L(e.title), start: d(e.start), end: d(e.end), tags: strs(e.tags), bullets: strs(e.bullets).map((h, j) => ({ ...L(h), id: `${i}-b${j + 1}` })) }; });
  p.projects = arr(r.projects).filter((e) => e.name).map((e) => { const i = id('proj'); return { id: i, enabled: true, name: L(e.name), role: L(e.role), start: d(e.start), end: d(e.end), tags: strs(e.tags), link: d(e.link), bullets: strs(e.bullets).map((h, j) => ({ ...L(h), id: `${i}-b${j + 1}` })) }; });
  p.skills = arr(r.skills).filter((e) => e.name).map((e) => ({ id: id('sk'), enabled: true, name: L(e.name), category: L(e.category) }));
  p.certificates = arr(r.certificates).filter((e) => e.name).map((e) => ({ id: id('cert'), enabled: true, name: L(e.name), issuer: L(e.issuer), date: d(e.date) }));
  p.awards = arr(r.awards).filter((e) => e.name).map((e) => ({ id: id('award'), enabled: true, name: L(e.name), issuer: L(e.issuer), date: d(e.date) }));
  return normalizeProfile(p);
}

export async function importProfileFromText(s: Settings, text: string): Promise<ProfileDoc> {
  const r = await chatJson<Raw>(s, [{ role: 'system', content: '你是严谨的简历整理助手，只输出 JSON。' }, { role: 'user', content: `${PROMPT}\n\n原文：\n"""\n${text.slice(0, 20000)}\n"""` }]);
  return rawToProfile(r);
}

/** 合并：已有资料为空时直接替换；否则追加经历条目、补齐空白的基本信息（id 加前缀避免冲突） */
export function mergeProfiles(base: ProfileDoc, add: ProfileDoc): ProfileDoc {
  const isEmpty = !base.profile.name.zh && !base.profile.name.en && !base.work.length && !base.education.length;
  if (isEmpty) return { ...add, glossary: base.glossary };
  const out = structuredClone(base);
  const tag = `i${Date.now().toString(36)}`;
  const fill = (a: LocalizedText, b: LocalizedText) => (a.zh || a.en ? a : b);
  out.profile.name = fill(out.profile.name, add.profile.name);
  out.profile.headline = fill(out.profile.headline, add.profile.headline);
  out.profile.summary = fill(out.profile.summary, add.profile.summary);
  for (const k of ['email', 'phone', 'github', 'linkedin', 'website'] as const) out.profile.contacts[k] ||= add.profile.contacts[k];
  const re = <T extends { id: string }>(e: T): T => JSON.parse(JSON.stringify(e).replace(/"id":"([^"]+)"/g, `"id":"${tag}-$1"`));
  out.education.push(...add.education.map(re)); out.work.push(...add.work.map(re)); out.projects.push(...add.projects.map(re));
  out.skills.push(...add.skills.map(re)); out.certificates.push(...add.certificates.map(re)); out.awards.push(...add.awards.map(re));
  return out;
}
