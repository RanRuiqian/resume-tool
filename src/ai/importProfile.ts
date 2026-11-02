import type { Lang, LocalizedText, ProfileDoc, ProjectKind, Settings, WorkKind } from '../types';
const WORK_KINDS: WorkKind[] = ['fulltime', 'internship', 'parttime', 'club', 'volunteer', 'other'];
import { chatJson } from './provider';
import { checkAgainstSource } from './sourceCheck';
import { MASTER_WRITING_RULES } from './prompts';
import { cleanProfile } from '../quality/contentQuality';
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
- education 的 courseCompletionDate（课程结束）、expectedConferralDate（预计拿学位）、actualConferralDate（已拿学位）、availableFullTimeDate（可全职入职）分别填写，只在原文明确写出时填，不能互相推断；courses 为原文列出的课程。
- evidence：原文提到的证明材料（论文、专利、证书、成绩单、代码仓库链接、报告、获奖证书、照片等）各一项：fileName 名称，type 取 paper/patent/certificate/transcript/code/report/photo/video/award/other，location 原文给出的链接或存放位置（没有就空），proves 它证明的具体事实，project/skill 填它关联的项目名/技能名（原文看得出才填）。没有提到就输出空数组。
- 去重（非常重要）：同一段真实经历只输出一条。同一学校 / 学位 / 专业的中文与英文写法属于同一条 education，主语言写在 school/degree/major，另一语言写法填在 schoolOther/degreeOther/majorOther；同一单位同一时间段的同一职位只输出一条 work，原文写了「实习」就是实习（kind 填 internship），严禁据此推断另有一份正式工作；同一项目的中文名、英文名、论文题目、课程说明与成果归并到同一个 project，另一语言名称填 nameOther，论文题目 / 其它称呼放 aliases，成果写进 bullets。只有原文明确是不同的经历（单位、时间或内容不同）才分开，不要因为出现相同关键词就合并不同经历。
- work.kind：fulltime 正式工作 / internship 实习 / parttime 兼职 / club 社团或学生工作任职 / volunteer 志愿服务 / other；看不出就留空，不要猜。社团、志愿、兼职也放在 work 里并标注 kind。
- projects.kind：core（毕业设计、学位论文、核心研究或主要项目）/ auxiliary（课程实验、教学实训、个人小工具等辅助项目）；nature 写原文给出的性质（如「本科毕业设计」「课程实验」），没写就留空。
- 独立课程及成绩单不是项目或任职：只有原文明示了具体实践任务/作业/成果才建立 projects。Industry-based project A/B 等项目学分单元不新建、拆分或复制项目；有关课程仍完整保存在 education.courses，待用户通过独立「课程」模块审核导入，不能推断软件实操或职业经验。
- 课程：courses 必须完整列出原文中的全部课程（成绩单可能有几十门，一门都不能省略），每门一项，原文有学分 / 成绩就原样附在课程名后，如「高等数学 A（5 学分，88）」；coursesInText 填原文这一段里出现的课程总数。
- 日期：四种日期严格区分——courseCompletionDate 课程结束、expectedConferralDate 预计毕业 / 预计授予、actualConferralDate 已实际授予、availableFullTimeDate 可全职入职。原文写「预计 / 在读 / expected」的日期只能填 expectedConferralDate，绝不能填 actualConferralDate，也不要填进 end；只有原文明确写「已授予 / 已获得学位」才填 actualConferralDate；未知的日期、分数、单位名称、证书编号一律留空，严禁补全或推测。
- 第一人称（「我负责…」）、第三人称档案（「该生 / 他负责…」）、旧简历要点都整理成以本人为主体的客观要点，不保留「我 / 本人 / 该生」主语。
- projects.archive：失败方案、测试局限、背景说明、过细的技术参数等真实技术事实，原样放进 archive（项目档案），bullets 只保留简洁的简历要点；不得因为句子里有「不确定 / 失败」就丢弃。
- notes：原文里的备注、待核实说明、证据说明（如「需补充证明」「待核实」「证书在邮箱里」）放进对应条目的 notes 数组，不要写进 bullets / highlights / summary。
${MASTER_WRITING_RULES}
输出 JSON：
{"lang":"zh","name":"","headline":"","summary":"","email":"","phone":"","location":"","github":"","linkedin":"","website":"",
"birth":"","gender":"","hometown":"","politics":"","uncertain":[{"field":"","note":""}],
"education":[{"school":"","schoolOther":"","degree":"","degreeOther":"","major":"","majorOther":"","start":"","end":"","highlights":[""],"courseCompletionDate":"","expectedConferralDate":"","actualConferralDate":"","availableFullTimeDate":"","courses":[""],"coursesInText":0,"notes":[""]}],
"work":[{"company":"","companyOther":"","title":"","titleOther":"","kind":"","start":"","end":"","bullets":[""],"tags":[""],"notes":[""]}],
"projects":[{"name":"","nameOther":"","aliases":[""],"kind":"","nature":"","role":"","start":"","end":"","bullets":[""],"tags":[""],"link":"","archive":[""],"notes":[""]}],
"skills":[{"name":"","category":""}],
"certificates":[{"name":"","issuer":"","date":""}],
"awards":[{"name":"","issuer":"","date":""}],
"evidence":[{"fileName":"","type":"other","location":"","proves":"","project":"","skill":""}]}`;

type S = string | undefined;
/** entryId：分段导入时解析出的稳定条目 id（A3）；segment：来自第几段；都无法解析的进入「未分配」 */
export interface Uncertain { field: string; note: string; entryId?: string; segment?: number }
export interface Raw {
  lang?: Lang; name?: S; birth?: S; gender?: S; hometown?: S; politics?: S; uncertain?: { field?: S; note?: S }[]; headline?: S; summary?: S; email?: S; phone?: S; location?: S; github?: S; linkedin?: S; website?: S;
  education?: { school?: S; schoolOther?: S; degree?: S; degreeOther?: S; major?: S; majorOther?: S; start?: S; end?: S; highlights?: S[]; courseCompletionDate?: S; expectedConferralDate?: S; actualConferralDate?: S; availableFullTimeDate?: S; courses?: S[]; coursesInText?: number; notes?: S[] }[];
  work?: { company?: S; companyOther?: S; title?: S; titleOther?: S; kind?: S; start?: S; end?: S; bullets?: S[]; tags?: S[]; notes?: S[] }[];
  projects?: { name?: S; nameOther?: S; aliases?: S[]; kind?: S; nature?: S; role?: S; start?: S; end?: S; bullets?: S[]; tags?: S[]; link?: S; notes?: S[]; archive?: S[] }[];
  skills?: { name?: S; category?: S }[];
  certificates?: { name?: S; issuer?: S; date?: S }[];
  awards?: { name?: S; issuer?: S; date?: S }[];
  evidence?: { fileName?: S; type?: S; location?: S; proves?: S; project?: S; skill?: S }[];
}

/** 把 AI 输出的单语结构转为双语资料库（另一语言留空，后续补译） */
export function rawToProfile(r: Raw): ProfileDoc {
  const lang: Lang = r.lang === 'en' ? 'en' : 'zh';
  const L = (v: S): LocalizedText => (v && v.trim() ? { [lang]: v.trim(), source: lang, status: { [lang]: 'manual' } } : {});
  const isZh = (v: string) => /[\u4e00-\u9fff]/.test(v);
  /** 主语言写法 + 原文里的另一语言写法 → 一个双语字段（两种写法都来自原文，均标为人工） */
  const L2 = (v: S, o: S): LocalizedText => {
    // 主写法的文字与文档语言不一致（如中文资料里 AI 把英文题目放在主字段）：放到对应语言位置，避免中英文混放
    const vv = (v ?? '').trim(); const vl: Lang = vv && isZh(vv) !== (lang === 'zh') ? (isZh(vv) ? 'zh' : 'en') : lang;
    const t: LocalizedText = vl === lang ? L(v) : { [vl]: vv, source: vl, status: { [vl]: 'manual' } };
    const ov = (o ?? '').trim(); if (!ov || ov === vv) return t;
    const ol: Lang = isZh(ov) ? 'zh' : 'en';
    if (t[ol]) return t;
    return { ...t, [ol]: ov, source: t.source ?? ol, status: { ...(t.status ?? {}), [ol]: 'manual' } };
  };
  const extra = (e: { notes?: S[]; aliases?: S[] }) => ({ ...(strs(e.notes).length ? { notes: strs(e.notes) } : {}), ...(strs(e.aliases).length ? { aliases: strs(e.aliases) } : {}) });
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
  p.education = arr(r.education).filter((e) => e.school).map((e) => { const i = id('edu'); return { id: i, enabled: true, school: L2(e.school, e.schoolOther), degree: L2(e.degree, e.degreeOther), major: L2(e.major, e.majorOther), start: d(e.start), end: d(e.end), ...extra(e), ...(Number(e.coursesInText) > 0 ? { coursesInText: Number(e.coursesInText) } : {}), highlights: strs(e.highlights).map((h, j) => ({ ...L(h), id: `${i}-h${j + 1}` })),
    ...Object.fromEntries((['courseCompletionDate', 'expectedConferralDate', 'actualConferralDate', 'availableFullTimeDate'] as const).filter((k) => d(e[k])).map((k) => [k, d(e[k])])), ...(strs(e.courses).length ? { courses: strs(e.courses) } : {}) }; });
  p.work = arr(r.work).filter((e) => e.company || e.title).map((e) => { const i = id('work'); return { id: i, enabled: true, company: L2(e.company, e.companyOther), title: L2(e.title, e.titleOther), ...(WORK_KINDS.includes(d(e.kind) as WorkKind) ? { kind: d(e.kind) as WorkKind } : /实习|intern/i.test(`${e.title ?? ''} ${e.titleOther ?? ''}`) ? { kind: 'internship' as WorkKind } : {}), ...extra(e), start: d(e.start), end: d(e.end), tags: strs(e.tags), bullets: strs(e.bullets).map((h, j) => ({ ...L(h), id: `${i}-b${j + 1}` })) }; });
  p.projects = arr(r.projects).filter((e) => e.name).map((e) => { const i = id('proj'); return { id: i, enabled: true, name: L2(e.name, e.nameOther), role: L(e.role), ...(d(e.kind) === 'core' || d(e.kind) === 'auxiliary' ? { kind: d(e.kind) as ProjectKind } : {}), ...(d(e.nature) ? { nature: d(e.nature) } : {}), ...extra(e), start: d(e.start), end: d(e.end), tags: strs(e.tags), link: d(e.link), ...(strs(e.archive).length ? { dossier: archiveToDossier(strs(e.archive)) } : {}), bullets: strs(e.bullets).map((h, j) => ({ ...L(h), id: `${i}-b${j + 1}` })) }; });
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

/** AI 给出的项目档案句子 → 项目详细档案：失败方案进 failedAttempts，局限进 problems，其余进 technicalWork */
function archiveToDossier(xs: string[]) {
  const failed = xs.filter((x) => /失败|未能|未成功|放弃|不可行|failed|abandoned|did not work/i.test(x));
  const limit = xs.filter((x) => !failed.includes(x) && /局限|不足|误差|仅在|limitation|only tested/i.test(x));
  const rest = xs.filter((x) => !failed.includes(x) && !limit.includes(x));
  return { ...(failed.length ? { failedAttempts: failed.map((a, i) => ({ id: `fa${i + 1}`, approach: a, reason: '' })) } : {}), ...(limit.length ? { problems: limit.join('\n') } : {}), ...(rest.length ? { technicalWork: rest.join('\n') } : {}) };
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
    const r = await chatJson<Raw>(s, [{ role: 'system', content: '你是严谨的简历整理助手，只输出 JSON。' }, { role: 'user', content: `${PROMPT}${hint}\n\n原文：\n"""\n${chunks[i]}\n"""` }], { maxTokens: 8000, timeoutMs: 240_000 });
    // 本地证据检查：日期 / 任职性质 / 证书信息必须能在本段原文中找到依据（v1.6.1）
    // v1.9：AI 输出后独立的元信息污染检测与规范化（首次导入即执行，不依赖后续「整理」按钮）
    const p = cleanProfile(checkAgainstSource(rawToProfile(r), chunks[i])).profile;
    // 先在「本段」内用本段下标解析成稳定 id，再随合并映射到最终条目（A3：不依赖跨段会错位的局部下标）
    const segU: Uncertain[] = [];
    for (const u of Array.isArray(r.uncertain) ? r.uncertain : []) if (u?.field || u?.note) segU.push(resolveUncertain({ field: (u.field ?? '').trim(), note: (u.note ?? '').trim() }, p, i + 1));
    const idMap = new Map<string, string>();
    acc = acc ? mergeProfiles(acc, p, idMap) : p;
    for (const u of segU) uncertain.push(u.entryId ? { ...u, entryId: idMap.get(u.entryId) ?? u.entryId } : u);
  }
  return { profile: acc ?? rawToProfile({}), uncertain };
}

export async function importProfileFromText(s: Settings, text: string): Promise<ProfileDoc> {
  return (await importProfileDetailed(s, text)).profile;
}

/** 把单段内 "work[0].end" 解析成该段资料里的条目 id；越界 / 无法识别时不设 entryId（留作未分配） */
export function resolveUncertain(u: Uncertain, seg: ProfileDoc, segment: number): Uncertain {
  const m = /^(education|work|projects?|skills?|certificates?|awards?|evidence)\s*\[(\d+)\]/i.exec(u.field);
  if (!m) return { ...u, segment };
  let sec = m[1].toLowerCase(); if (!sec.endsWith('s') && sec !== 'work' && sec !== 'education' && sec !== 'evidence') sec += 's';
  const list = (seg as unknown as Record<string, { id: string }[]>)[sec] ?? [];
  const e = list[Number(m[2])];
  return e ? { ...u, entryId: e.id, segment } : { ...u, segment };
}
const nk = (...v: (string | undefined)[]) => v.map((x) => (x ?? '').toLowerCase().replace(/[\s·,，.。()（）-]/g, '')).join('|');
const ltk = (t: LocalizedText) => t.zh || t.en || '';

/** 合并（去重）：基本信息只补空白；同一段经历（公司+职位 / 学校+专业 / 项目名 / 技能名 / 证书名）合并要点，不重复追加 */
export function mergeProfiles(base: ProfileDoc, add: ProfileDoc, idMap?: Map<string, string>): ProfileDoc {
  const isEmpty = !base.profile.name.zh && !base.profile.name.en && !base.work.length && !base.education.length && !base.projects.length && !base.skills.length;
  if (isEmpty) { for (const k of ['education', 'work', 'projects', 'skills', 'certificates', 'awards', 'evidence'] as const) for (const e of (add[k] ?? []) as { id: string }[]) idMap?.set(e.id, e.id); return { ...add, glossary: base.glossary }; }
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
      if (!hit) { const n = re(e); idMap?.set(e.id, n.id); dst.push(n); continue; }
      idMap?.set(e.id, hit.id);
      for (const f of ['bullets', 'highlights'] as const) {
        const a = hit[f], b = e[f]; if (!a || !b) continue;
        const seen = new Set(a.map((x) => nk(ltk(x))));
        b.forEach((x, j) => { if (!seen.has(nk(ltk(x)))) a.push({ ...x, id: `${hit.id}-${tag}-${j}` } as never); });
      }
      const h = hit as unknown as Record<string, unknown>, s2 = e as unknown as Record<string, unknown>;
      for (const f of ['start', 'end', 'date', 'link', 'kind', 'nature', 'courseCompletionDate', 'expectedConferralDate', 'actualConferralDate', 'availableFullTimeDate']) if (!h[f] && s2[f]) h[f] = s2[f];
      // 分段导入：课程 / 别名 / 备注取并集（长成绩单可能被切到不同段，不能只保留第一段）
      for (const f of ['courses', 'aliases', 'notes', 'uncertain']) if (Array.isArray(s2[f])) h[f] = [...new Set([...((h[f] as string[]) ?? []), ...(s2[f] as string[])])];
      if (typeof s2.coursesInText === 'number') h.coursesInText = ((h.coursesInText as number) ?? 0) + s2.coursesInText;
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
    const dupEv = out.evidence.find((x) => nk(x.fileName, x.location) === nk(ev.fileName, ev.location));
    if (dupEv) { idMap?.set(ev.id, dupEv.id); continue; }
    idMap?.set(ev.id, `${tag}-${ev.id}`);
    out.evidence.push({ ...ev, id: `${tag}-${ev.id}`, projectIds: remap(ev.projectIds, add.projects, out.projects), skillIds: remap(ev.skillIds, add.skills, out.skills) });
  }
  return out;
}
