import type { Lang, LocalizedText, ProfileDoc, Settings } from '../types';
import { chatJson } from './provider';
import { emptyProfile, normalizeEvidence, normalizeProfile } from '../storage/profileIO';

const PROMPT = `把用户粘贴的简历 / 个人经历文字整理成结构化 JSON。规则：
- 只整理原文中出现的信息，严禁补充、推测或美化；原文没有的字段留空字符串或空数组。
- 保持原文语言（中文就输出中文，英文就输出英文），lang 字段标明 "zh" 或 "en"。
- 日期统一为 "YYYY-MM"（只有年份写 "YYYY"），至今写 "present"。
- 每段工作/项目经历的要点拆成 bullets 数组，每条一句，保留所有数字与成果；tags 填该经历用到的技术/工具名。
- headline 只写职位名称本身（如「数据分析师」），不要带「求职意向：」等前缀；education.highlights 只写成绩/奖项等亮点，不要重复学校、专业、学位。
- 文字可能杂乱无序、混合口语，请自行归类；birth（出生年月 YYYY-MM）、gender、hometown（籍贯）、politics（政治面貌）只在原文明确写出时填写。
- uncertain：列出你不确定的归类或字段（如日期只给了大概、无法判断是工作还是项目、学位不明），每项 {"field":"如 work[0].end","note":"原因"}；确定的不要列。
- skills 每个技能一项，category 为分类（如 前端 / 后端 / 语言 / 工具），没有则空。只列原文明确写出会用/用过的技能，严禁根据专业、课程或岗位名称推断技能。
- evidence：原文提到的证明材料（论文、专利、证书、成绩单、代码仓库链接、报告、获奖证书、照片等）各一项：fileName 名称，type 取 paper/patent/certificate/transcript/code/report/photo/video/award/other，location 原文给出的链接或存放位置（没有就空），proves 它证明的具体事实，project/skill 填它关联的项目名/技能名（原文看得出才填）。没有提到就输出空数组。
输出 JSON：
{"lang":"zh","name":"","headline":"","summary":"","email":"","phone":"","location":"","github":"","linkedin":"","website":"",
"birth":"","gender":"","hometown":"","politics":"","uncertain":[{"field":"","note":""}],
"education":[{"school":"","degree":"","major":"","start":"","end":"","highlights":[""]}],
"work":[{"company":"","title":"","start":"","end":"","bullets":[""],"tags":[""]}],
"projects":[{"name":"","role":"","start":"","end":"","bullets":[""],"tags":[""],"link":""}],
"skills":[{"name":"","category":""}],
"certificates":[{"name":"","issuer":"","date":""}],
"awards":[{"name":"","issuer":"","date":""}],
"evidence":[{"fileName":"","type":"other","location":"","proves":"","project":"","skill":""}]}`;

type S = string | undefined;
export interface Uncertain { field: string; note: string }
export interface Raw {
  lang?: Lang; name?: S; birth?: S; gender?: S; hometown?: S; politics?: S; uncertain?: { field?: S; note?: S }[]; headline?: S; summary?: S; email?: S; phone?: S; location?: S; github?: S; linkedin?: S; website?: S;
  education?: { school?: S; degree?: S; major?: S; start?: S; end?: S; highlights?: S[] }[];
  work?: { company?: S; title?: S; start?: S; end?: S; bullets?: S[]; tags?: S[] }[];
  projects?: { name?: S; role?: S; start?: S; end?: S; bullets?: S[]; tags?: S[]; link?: S }[];
  skills?: { name?: S; category?: S }[];
  certificates?: { name?: S; issuer?: S; date?: S }[];
  awards?: { name?: S; issuer?: S; date?: S }[];
  evidence?: { fileName?: S; type?: S; location?: S; proves?: S; project?: S; skill?: S }[];
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
  p.profile.personal = { birth: d(r.birth), gender: d(r.gender), hometown: d(r.hometown), politics: d(r.politics) };
  let n = 0;
  const id = (k: string) => `${k}-${++n}`;
  p.education = arr(r.education).filter((e) => e.school).map((e) => { const i = id('edu'); return { id: i, enabled: true, school: L(e.school), degree: L(e.degree), major: L(e.major), start: d(e.start), end: d(e.end), highlights: strs(e.highlights).map((h, j) => ({ ...L(h), id: `${i}-h${j + 1}` })) }; });
  p.work = arr(r.work).filter((e) => e.company || e.title).map((e) => { const i = id('work'); return { id: i, enabled: true, company: L(e.company), title: L(e.title), start: d(e.start), end: d(e.end), tags: strs(e.tags), bullets: strs(e.bullets).map((h, j) => ({ ...L(h), id: `${i}-b${j + 1}` })) }; });
  p.projects = arr(r.projects).filter((e) => e.name).map((e) => { const i = id('proj'); return { id: i, enabled: true, name: L(e.name), role: L(e.role), start: d(e.start), end: d(e.end), tags: strs(e.tags), link: d(e.link), bullets: strs(e.bullets).map((h, j) => ({ ...L(h), id: `${i}-b${j + 1}` })) }; });
  p.skills = arr(r.skills).filter((e) => e.name).map((e) => ({ id: id('sk'), enabled: true, name: L(e.name), category: L(e.category) }));
  p.certificates = arr(r.certificates).filter((e) => e.name).map((e) => ({ id: id('cert'), enabled: true, name: L(e.name), issuer: L(e.issuer), date: d(e.date) }));
  p.awards = arr(r.awards).filter((e) => e.name).map((e) => ({ id: id('award'), enabled: true, name: L(e.name), issuer: L(e.issuer), date: d(e.date) }));
  const byName = <T extends { id: string; name: LocalizedText }>(list: T[], name: S) => { const n = (name ?? '').trim().toLowerCase(); return n ? list.filter((x) => (x.name.zh || x.name.en || '').toLowerCase() === n).map((x) => x.id) : []; };
  p.evidence = arr(r.evidence).filter((e) => e.fileName || e.location || e.proves).map((e) => normalizeEvidence({
    id: id('ev'), fileName: d(e.fileName), type: d(e.type), location: d(e.location), proves: d(e.proves),
    projectIds: byName(p.projects, e.project), skillIds: byName(p.skills, e.skill), confirmed: false, publicOk: false,
  }));
  return normalizeProfile(p);
}

const CHUNK = 6000;
/** 长文本按段落切块（每块 ≤ CHUNK 字），避免超出模型上下文/输出长度 */
export function chunkText(text: string, size = CHUNK): string[] {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n|\n(?=\S)/);
  const out: string[] = []; let cur = '';
  for (const p of paras) {
    if (p.length > size) { if (cur) out.push(cur); for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size)); cur = ''; continue; }
    if ((cur + '\n' + p).length > size && cur) { out.push(cur); cur = p; } else cur = cur ? cur + '\n' + p : p;
  }
  if (cur.trim()) out.push(cur);
  return out.filter((x) => x.trim());
}

export async function importProfileDetailed(s: Settings, text: string, onProgress?: (i: number, n: number) => void): Promise<{ profile: ProfileDoc; uncertain: Uncertain[] }> {
  const chunks = chunkText(text);
  let acc: ProfileDoc | null = null; const uncertain: Uncertain[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i + 1, chunks.length);
    const hint = chunks.length > 1 ? `（这是全部资料的第 ${i + 1}/${chunks.length} 段，可能只含部分信息）` : '';
    const r = await chatJson<Raw>(s, [{ role: 'system', content: '你是严谨的简历整理助手，只输出 JSON。' }, { role: 'user', content: `${PROMPT}${hint}\n\n原文：\n"""\n${chunks[i]}\n"""` }]);
    for (const u of Array.isArray(r.uncertain) ? r.uncertain : []) if (u?.field || u?.note) uncertain.push({ field: (u.field ?? '').trim(), note: (u.note ?? '').trim() });
    const p = rawToProfile(r);
    acc = acc ? mergeProfiles(acc, p) : p;
  }
  return { profile: acc ?? rawToProfile({}), uncertain };
}

export async function importProfileFromText(s: Settings, text: string): Promise<ProfileDoc> {
  return (await importProfileDetailed(s, text)).profile;
}

const nk = (...v: (string | undefined)[]) => v.map((x) => (x ?? '').toLowerCase().replace(/[\s·,，.。()（）-]/g, '')).join('|');
const ltk = (t: LocalizedText) => t.zh || t.en || '';

/** 合并（去重）：基本信息只补空白；同一段经历（公司+职位 / 学校+专业 / 项目名 / 技能名 / 证书名）合并要点，不重复追加 */
export function mergeProfiles(base: ProfileDoc, add: ProfileDoc): ProfileDoc {
  const isEmpty = !base.profile.name.zh && !base.profile.name.en && !base.work.length && !base.education.length && !base.projects.length && !base.skills.length;
  if (isEmpty) return { ...add, glossary: base.glossary };
  const out = structuredClone(base);
  const tag = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const fill = (a: LocalizedText, b: LocalizedText) => (a.zh || a.en ? a : b);
  out.profile.name = fill(out.profile.name, add.profile.name);
  out.profile.headline = fill(out.profile.headline, add.profile.headline);
  out.profile.summary = fill(out.profile.summary, add.profile.summary);
  out.profile.contacts.location = fill(out.profile.contacts.location ?? {}, add.profile.contacts.location ?? {});
  for (const k of ['email', 'phone', 'github', 'linkedin', 'website'] as const) out.profile.contacts[k] ||= add.profile.contacts[k];
  out.profile.personal = out.profile.personal ?? {};
  for (const k of ['birth', 'gender', 'hometown', 'politics'] as const) out.profile.personal[k] ||= add.profile.personal?.[k];
  const re = <T extends { id: string }>(e: T): T => JSON.parse(JSON.stringify(e).replace(/"id":"([^"]+)"/g, `"id":"${tag}-$1"`));
  type WithList = { id: string; bullets?: LocalizedText[]; highlights?: LocalizedText[] };
  const mergeList = <T extends WithList>(dst: T[], src: T[], key: (e: T) => string) => {
    for (const e of src) {
      const k = key(e); const hit = k.replace(/\|/g, '') ? dst.find((d) => key(d) === k) : undefined;
      if (!hit) { dst.push(re(e)); continue; }
      for (const f of ['bullets', 'highlights'] as const) {
        const a = hit[f], b = e[f]; if (!a || !b) continue;
        const seen = new Set(a.map((x) => nk(ltk(x))));
        b.forEach((x, j) => { if (!seen.has(nk(ltk(x)))) a.push({ ...x, id: `${hit.id}-${tag}-${j}` } as never); });
      }
      const h = hit as unknown as Record<string, unknown>, s2 = e as unknown as Record<string, unknown>;
      for (const f of ['start', 'end', 'date', 'link']) if (f in h && !h[f] && s2[f]) h[f] = s2[f];
      if (Array.isArray(h.tags) && Array.isArray(s2.tags)) h.tags = [...new Set([...(h.tags as string[]), ...(s2.tags as string[])])];
    }
  };
  mergeList(out.work, add.work, (e) => nk(ltk(e.company), ltk(e.title)));
  mergeList(out.education, add.education, (e) => nk(ltk(e.school), ltk(e.major)));
  mergeList(out.projects, add.projects, (e) => nk(ltk(e.name)));
  mergeList(out.skills as WithList[], add.skills as WithList[], (e) => nk(ltk((e as unknown as { name: LocalizedText }).name)));
  mergeList(out.certificates as WithList[], add.certificates as WithList[], (e) => nk(ltk((e as unknown as { name: LocalizedText }).name)));
  mergeList(out.awards as WithList[], add.awards as WithList[], (e) => nk(ltk((e as unknown as { name: LocalizedText }).name)));
  // 证据：追加，并按名称把关联的项目/技能指到合并后的条目
  const remap = <T extends { id: string; name: LocalizedText }>(ids: string[], from: T[], to: T[]) => ids.map((pid) => { const n = from.find((x) => x.id === pid); return n ? to.find((x) => nk(ltk(x.name)) === nk(ltk(n.name)))?.id : undefined; }).filter((x): x is string => !!x);
  out.evidence = out.evidence ?? [];
  for (const ev of add.evidence ?? []) {
    if (out.evidence.some((x) => nk(x.fileName, x.location) === nk(ev.fileName, ev.location))) continue;
    out.evidence.push({ ...ev, id: `${tag}-${ev.id}`, projectIds: remap(ev.projectIds, add.projects, out.projects), skillIds: remap(ev.skillIds, add.skills, out.skills) });
  }
  return out;
}
