import type { BaseEntry, ImportIntegrity, LocalizedText, ProfileDoc, ProjectEntry } from '../types';
import { emptyProfile, normalizeProfile } from '../storage/profileIO';
import { normalizeCourse } from '../storage/courses';

interface Fact { id: string; section: string; context: string; body: string; raw: string; reviewed: boolean }
const UNKNOWN = /未知|不详|未公布|尚未|未发布|遮挡|隐去|未提供|待定|待复核|unknown|pending/i;
const SEC = /^\s*(?:#{1,6}\s*)?(0[1-9]|1[0-4])[｜|]\s*(.+)$/;
const ROW = /^\s*(?:[-*]\s*)?\[([xX✓ ])\]\s+([A-Z]{2,8}-(?:[A-Z0-9]+-)*[A-Z0-9]+)[｜|](.*)$/;
const lt = (s: string, reviewed = true): LocalizedText => !s ? {} : { [/[\u3400-\u9fff]/.test(s) ? 'zh' : 'en']: s, source: /[\u3400-\u9fff]/.test(s) ? 'zh' : 'en', status: { [/[\u3400-\u9fff]/.test(s) ? 'zh' : 'en']: reviewed ? 'confirmed' : 'manual' } };
const value = (f: Fact) => f.body.replace(/^[^：:\n]{1,40}[：:]\s*/, '').trim();
/** 标量字段（姓名、单位、职位、名称）不带句末标点；正文要点保留原样。 */
export const clean = (s: string) => s.trim().replace(/[。．.；;，,、\s]+$/u, '').trim();
/** 课程性质列（专必 / 通必 / 实践…），不是课程英文名。 */
const COURSE_TYPE = /^(?:专必|通必|专选|通选|任选|方向|实践|课外|必修|选修|公共课|专业课)$/;
const label = (f: Fact) => /^([^：:\n]{1,40})[：:]/.exec(f.body)?.[1] ?? '';
const root = (id: string) => id.replace(/(?:-\d+|(?<=[A-Z])\d+)$/, '');
const parts = (s: string) => s.split(/[｜|]/).map((s) => s.trim());
const text = (t: LocalizedText) => t.zh || t.en || '';
const unique = <T,>(a: T[]) => [...new Set(a)];

/** Read a fact ledger, not a list of entities. Section/context boundaries never belong to the preceding fact. */
export function scanFactLibrary(input: string): Fact[] {
  const out: Fact[] = []; let section = '', context = '', active: Fact | undefined;
  for (const line of input.replace(/\r/g, '').split('\n')) {
    const h = SEC.exec(line);
    if (h) { section = `${h[1]} ${h[2]}`; context = ''; active = undefined; continue; }
    if (/^\s*【.*】\s*$/.test(line)) { context = line.trim().slice(1, -1); active = undefined; continue; }
    if (/^\s*(?:━+|——.*——)\s*$/.test(line)) { active = undefined; continue; }
    const m = ROW.exec(line);
    if (m) { active = { id: m[2], section, context, body: m[3].trim(), raw: line.trim(), reviewed: m[1] !== ' ' }; out.push(active); }
    else if (active && line.trim()) { active.raw += `\n${line}`; active.body += `\n${line.trim()}`; }
  }
  return out;
}

function bilingual(s: string): LocalizedText {
  // Only an explicitly present parenthesized Chinese name is a second name, never a generated translation.
  s = clean(s);
  const m = /^([A-Za-z][^\n（）]+)（([^（）]*[\u3400-\u9fff][^（）]*)）$/.exec(s);
  if (m) return { ...lt(m[1].trim()), zh: m[2].trim(), status: { zh: 'confirmed', en: 'confirmed' } };
  const r = /^([^\n（）]*[\u3400-\u9fff][^\n（）]*)[（(]([A-Za-z][A-Za-z0-9 &,.'/-]+)[）)]$/.exec(s);
  return r ? { ...lt(r[1].trim()), en: r[2].trim(), status: { zh: 'confirmed', en: 'confirmed' } } : lt(s);
}
function dates(s: string): string[] {
  return [...s.matchAll(/\b(\d{4})(?:[年./-](\d{1,2})(?:月|[./-](\d{1,2})日?)?)?/g)].map((m) => [m[1], ...(m[2] ? [m[2].padStart(2, '0')] : []), ...(m[3] ? [m[3].padStart(2, '0')] : [])].join('-'));
}
/** 小标题 → 简历技能分组：去掉「课程实验」「与真实实践」等证据说明，只留领域名。 */
export function skillGroup(context: string): string {
  return clean(context.replace(/^【|】$/g, '').replace(/(?:课程实验|课程项目|课程方法与设备|课程方法|与真实实践|与基础技能|专业方法与技能)$/u, '').replace(/[/／]$/, ''));
}
const escapeRE = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseFactLibrary(input: string): { profile: ProfileDoc; integrity: ImportIntegrity } | null {
  if (!/^\s*0[1-9][｜|]/m.test(input)) return null;
  const rows = scanFactLibrary(input); if (!rows.length) return null;
  const p = emptyProfile(); p.courses = []; p.sourceFacts = [];
  const issues: ImportIntegrity['issues'] = [], byId = new Map<string, Fact>(), mapped = new Map<string, Set<string>>();
  const now = new Date().toISOString();
  for (const f of rows) {
    if (byId.has(f.id) && byId.get(f.id)!.raw !== f.raw) issues.push({ id: f.id, reason: '同一事实编号有不同原文，未自动覆盖' });
    else byId.set(f.id, f);
  }
  const facts = [...byId.values()];
  const select = (re: RegExp) => facts.filter((f) => re.test(f.id));
  const bind = (fs: Fact[], id: string) => fs.forEach((f) => { const ids = mapped.get(f.id) ?? new Set<string>(); ids.add(id); mapped.set(f.id, ids); });
  const base = (id: string, fs: Fact[]): BaseEntry => ({ id: `library-${id}`, enabled: true,
    sourceRecord: { format: 'numbered-library', id: fs[0].id, section: fs[0].section, raw: fs.map((f) => f.raw).join('\n'), reviewed: fs.every((f) => f.reviewed) },
    ...(fs.every((f) => f.reviewed) ? { userConfirmedAt: now } : {}),
  });
  const get = (fs: Fact[], ...keys: string[]) => fs.find((f) => keys.includes(label(f))) ? value(fs.find((f) => keys.includes(label(f)))!) : '';
  const scalarCheck = (fs: Fact[], keys: string[]) => {
    for (const k of keys) {
      const vs = unique(fs.filter((f) => label(f) === k).map(value).filter((v) => !UNKNOWN.test(v)));
      if (vs.length > 1) issues.push({ id: fs[0].id, reason: `同一实体的「${k}」有互相矛盾的原文，需核对` });
    }
  };
  const groupsOf = (fs: Fact[], key: (f: Fact) => string) => {
    const groups = new Map<string, Fact[]>(); for (const f of fs) groups.set(key(f), [...(groups.get(key(f)) ?? []), f]); return groups;
  };
  const basics = select(/^ID-/);
  for (const f of basics) {
    const k = label(f), v = value(f);
    if (/^(?:中文姓名|姓名)$/.test(k)) p.profile.name = { ...p.profile.name, zh: clean(v), source: 'zh', status: { ...p.profile.name.status, zh: f.reviewed ? 'confirmed' : 'manual' } };
    else if (k === '英文姓名') p.profile.name = { ...p.profile.name, en: clean(v), status: { ...p.profile.name.status, en: f.reviewed ? 'confirmed' : 'manual' } };
    else if (/^(?:个人邮箱|邮箱)$/.test(k)) p.profile.contacts.email = v.replace(/[。.]$/, '');
    else if (/^(?:中国手机号|手机|电话)$/.test(k)) p.profile.contacts.phone = clean(v);
    else if (k === '性别') p.profile.personal.gender = v;
    else if (k === '出生日期') p.profile.personal.birth = v;
    else if (k === '籍贯') p.profile.personal.hometown = v;
    else if (k === '求职兴趣方向') p.profile.headline = lt(clean(v), f.reviewed);
    bind([f], 'profile');
  }
  p.profile.notes = basics.map((f) => f.body); // Other numbers, intent and contact variants remain private, never guessed into public fields.
  for (const [key, fs] of groupsOf(select(/^EDU-/), (f) => root(f.id))) {
    scalarCheck(fs, ['学校', '学位', '专业', '专业方向', '入学时间', '修读时间']);
    const school = get(fs, '学校'); if (!school) { issues.push({ id: fs[0].id, reason: '教育事实组没有学校，不能新建学历' }); continue; }
    const start = dates(get(fs, '入学时间', '开始时间', '修读时间')), end = dates(get(fs, '修读时间'));
    const e = { ...base(key, fs), school: bilingual(school), degree: bilingual(get(fs, '学位', '学历')), major: bilingual(get(fs, '专业', '专业方向')),
      start: start[0] ?? '', end: end[1] ?? '', highlights: [], notes: fs.map((f) => f.body),
      ...(get(fs, '预计毕业') && dates(get(fs, '预计毕业'))[0] ? { expectedConferralDate: dates(get(fs, '预计毕业'))[0] } : {}),
    };
    p.education.push(e); bind(fs, e.id);
  }
  for (const f of select(/^(?:BSC-\d+|MSC-\d+)$/)) {
    const cells = parts(f.body.split('\n')[0]), master = f.id.startsWith('MSC-');
    const edu = p.education.filter((e) => (master ? /硕士|master|m\.?eng|m\.?sc/i : /学士|本科|bachelor/i).test(`${e.degree.zh ?? ''} ${e.degree.en ?? ''}`));
    // 本科行：名称｜性质｜学分｜成绩｜概述。第二列是课程性质，不是英文名（旧版本曾把「专必」当英文名导出）。
    const name = master ? bilingual(cells[2] ?? '') : COURSE_TYPE.test(cells[1] ?? '') || /[\u3400-\u9fff]/.test(cells[1] ?? '')
      ? bilingual(cells[0] ?? '') : { ...lt(clean(cells[0] ?? ''), f.reviewed), en: clean(cells[1] ?? ''), status: { zh: f.reviewed ? 'confirmed' as const : 'manual' as const, en: f.reviewed ? 'confirmed' as const : 'manual' as const } };
    if (cells.length < (master ? 4 : 5) || !text(name)) { issues.push({ id: f.id, reason: '课程列不足或名称缺失，不能声明完整' }); continue; }
    const grade = clean(cells[3] ?? ''), synopsis = master ? f.body.split('\n').slice(1).join('\n').replace(/^内容[：:]\s*/, '') : cells.slice(4).join('｜').replace(/^概述[：:]\s*/, '');
    const c = normalizeCourse({ ...base(f.id, [f]), name, level: master ? 'master' : 'bachelor', educationId: edu.length === 1 ? edu[0].id : '', school: edu.length === 1 ? text(edu[0].school) : '',
      code: master ? cells[1] : f.id, term: master ? cells[0] : f.context, credits: master ? '' : cells[2].replace(/\s*学分[。.]?$/, ''),
      grade: { raw: grade, status: /未公布|尚未|未发布/.test(grade) ? 'not-released' : UNKNOWN.test(grade) || !grade ? 'unverified' : 'recorded' },
      synopsis: lt(synopsis, f.reviewed), knowledgeTags: [], evidenceLevel: 'unverified', sources: [{ id: f.id, label: '编号母库原文', reference: f.id }], confirmation: f.reviewed ? 'confirmed' : 'pending', defaultGradeVisible: false, projectIds: [],
    });
    if (!c.educationId) issues.push({ id: f.id, reason: '所属教育实体不唯一或未识别，课程仍保留' });
    p.courses.push(c); bind([f], c.id);
  }
  // Grade-page summaries are education metadata, not two extra taught courses.
  for (const f of select(/^MSC-[A-Z]/)) {
    const es = p.education.filter((e) => /硕士|master/i.test(text(e.degree)));
    if (es.length === 1) { es[0].notes!.push(f.body); bind([f], es[0].id); }
  }
  for (const [key, fs] of groupsOf(select(/^WRK-/), (f) => f.section)) {
    scalarCheck(fs, ['单位', '职位', '时间', '性质']); const ds = dates(get(fs, '时间'));
    const e = { ...base(fs[0].id, fs), company: lt(clean(get(fs, '单位'))), title: lt(clean(get(fs, '职位'))), start: ds[0] ?? '', end: ds[1] ?? '',
      kind: /实习/.test(get(fs, '性质')) ? 'internship' as const : /兼职/.test(get(fs, '性质')) ? 'parttime' as const : '' as const,
      bullets: fs.filter((f) => /内容|职责/.test(label(f))).map((f) => ({ ...lt(value(f), f.reviewed), id: `library-${f.id}-b` })), tags: [], notes: fs.map((f) => f.body) };
    if (!text(e.company) && !text(e.title)) { issues.push({ id: key.slice(0, 2), reason: '工作事实组缺少单位与职位' }); continue; }
    p.work.push(e); bind(fs, e.id);
  }
  const addProject = (key: string, fs: Fact[], kind: 'core' | 'auxiliary', fallback: string, title?: string) => {
    scalarCheck(fs, ['中文名', '英文名', '名称', '论文题目']);
    const name: LocalizedText = title ? lt(clean(title)) : { ...lt(clean(get(fs, '中文名', '名称', '论文题目') || fallback)), ...(get(fs, '英文名') ? { en: clean(get(fs, '英文名')) } : {}) };
    // 「性质」可能写在同一行的其它分句里（如「年份：2026；性质：应用工程硕士毕业项目。」）；不再用栏目标题冒充性质。
    const inline = (key: string) => fs.flatMap((f) => f.body.split(/[；;]/)).map((x) => new RegExp(`^\\s*${key}[：:]\\s*(.+)$`).exec(x)?.[1] ?? '').find(Boolean) ?? '';
    const natureRaw = get(fs, '性质') || inline('性质');
    const natureDates = dates(natureRaw.split(/[；;]/).slice(1).join(' '));
    const nature = clean(natureRaw.split(/[；;]/)[0] ?? '') || (kind === 'auxiliary' ? clean(fs[0].context.split(/[｜|]/)[0]) : '');
    const metadata = /^(?:中文名|英文名|名称|年份|性质|所属单位|主要导师|指导教师|作者|本人作者顺序|会议|单位|仓库)$/;
    const e: ProjectEntry = { ...base(key, fs), name, role: lt(clean(get(fs, '个人角色', '角色'))), kind, nature,
      start: dates(get(fs, '年份') || inline('年份'))[0] ?? natureDates[0] ?? '', end: get(fs, '年份') || inline('年份') ? '' : natureDates[1] ?? '', tags: [], bullets: fs.filter((f) => !metadata.test(label(f))).map((f) => ({ ...lt(f.body, f.reviewed), id: `library-${f.id}-b` })),
      dossier: { technicalWork: fs.map((f) => f.body).join('\n') }, courseIds: [] };
    p.projects.push(e); bind(fs, e.id); return e;
  };
  for (const [key, fs] of groupsOf(select(/^PRO-/), (f) => root(f.id))) addProject(key, fs, 'core', fs[0].section.replace(/^\d+\s*/, ''));
  // A stable course/project prefix is a scope. Explicit Q/Lab/Assignment/Workshop labels define separate tasks inside it.
  for (const [scope, fs] of groupsOf(select(/^LRN-/), (f) => root(f.id))) {
    const tasks = new Map<string, Fact[]>(), shared: Fact[] = []; let active = 'course';
    for (const f of fs) {
      const lead = f.body.slice(0, 55), m = /\b(Q\d+|Lab\s*\d+[AB]?|(?:Lean\s+|MATLAB\s+)?Assignment\s*\d+|Workshop\s*\d+)\b/i.exec(lead);
      const a = /^A(\d+)\s/.exec(lead);
      if (/^(?:课程成果|实验产物|课程边界|表达边界|实践边界)[：:]/.test(lead)) { shared.push(f); continue; }
      if (m) active = m[1].replace(/^(?:Lean|MATLAB)\s+/i, '').replace(/\s/g, '').toUpperCase();
      else if (a) active = `ASSIGNMENT${a[1]}`;
      tasks.set(active, [...(tasks.get(active) ?? []), f]);
    }
    const entries: ProjectEntry[] = [];
    for (const [task, rs] of tasks) {
      const head = rs[0].body.split(/[：:]/)[0];
      const e = addProject(`${scope}-${task}`, rs, 'auxiliary', head, `${rs[0].context || scope} · ${task === 'course' ? head : task}`);
      const hints = (rs[0].context.replace(/^课程[：:]\s*/, '').split(/[、，,/｜]/).map((x) => x.trim())).filter((x) => x.length >= 2);
      const candidates = p.courses.filter((c) => c.level === 'master' && hints.some((h) => [c.name.zh, c.name.en, c.code].some((n) => n && (n.includes(h) || h.includes(n)))));
      if (candidates.length === 1) { e.courseIds = [candidates[0].id]; candidates[0].projectIds.push(e.id); }
      entries.push(e);
    }
    for (const e of entries) { if (shared.length) e.notes = shared.map((f) => f.body); bind(shared, e.id); }
  }
  const papers = select(/^PUB-/); if (papers.length) addProject(papers[0].id, papers, 'auxiliary', papers[0].section);
  const tools = select(/^TOOL-/); if (tools.length) {
    const e = addProject(tools[0].id, tools, 'auxiliary', tools[0].section);
    e.dossier!.tools = unique(tools.flatMap((f) => /技术|架构/.test(label(f)) ? f.body.match(/GitHub Pages|GitHub(?! Pages)|React|TypeScript|Vite|IndexedDB|Dexie|DeepSeek/g) ?? [] : []));
  }
  let orgActive: Fact[] | undefined; const orgGroups: Fact[][] = [], orgShared: Fact[] = [];
  for (const f of select(/^ORG-/)) {
    if (/不同部门|不能合并|不应合并/.test(f.body)) { orgShared.push(f); continue; }
    if (/兼职|志愿活动/.test(f.body) && !/职责[：:]/.test(f.body)) { orgActive = [f]; orgGroups.push(orgActive); continue; }
    if (/职责[：:]/.test(f.body) || /^(?:担任|与|负责|参与)/.test(f.body)) { if (orgActive) { orgActive.push(f); continue; } }
    orgActive = [f]; orgGroups.push(orgActive);
  }
  for (const fs of orgGroups) {
    const ds = dates(fs[0].body), body = fs[0].body, club = /学生会/.test(body);
    const e = { ...base(fs[0].id, fs), company: lt(''), title: lt(clean(body.split(/[；;。]/)[0]), fs[0].reviewed), start: ds[0] ?? '', end: ds[1] ?? '',
      kind: club ? 'club' as const : /志愿/.test(body) ? 'volunteer' as const : /兼职/.test(body) ? 'parttime' as const : 'other' as const,
      bullets: fs.map((f) => ({ ...lt(f.body, f.reviewed), id: `library-${f.id}-b` })), tags: [], notes: club ? orgShared.map((f) => f.body) : [] };
    p.work.push(e); bind(fs, e.id); if (club) bind(orgShared, e.id);
  }
  for (const f of select(/^(?:SKL|LANG)-/)) {
    const m = /^(.*?)【([^】]+)】[：:]?\s*([\s\S]*)$/.exec(f.body);
    const named = m?.[1] || (/^LANG-/.test(f.id) ? (/英语|English/i.test(f.body) ? '英语' : '语言能力') : label(f) || f.body.split(/[：:。；]/)[0]);
    // 【…】是熟练度 / 证据性质（如「基础使用」「课程仿真」），不是简历上的分组名；分组用所在小标题。
    const group = /^LANG-/.test(f.id) ? '语言' : skillGroup(f.context) || clean(m?.[2] ?? '');
    // 纯英文工具名列表（「MATLAB、Computer Vision Toolbox」）在英文简历里不能带中文顿号。
    const toolList = /[\u3400-\u9fff]/.test(named) ? clean(named) : clean(named).replace(/\s*[、，]\s*/g, ', ');
    const e = { ...base(f.id, [f]), name: lt(toolList), category: lt(group), ...(m?.[2] ? { level: clean(m[2]) } : {}), scenarios: m?.[3] || value(f), usedIn: [] as string[] };
    p.skills.push(e); bind([f], e.id);
  }
  // Literal actual-use links only. Longer qualified tool names mask shorter names, e.g. VC Python Commands ≠ Python.
  // 证据性质标签（旧版存在 category，新版存在 level）。
  const tagOf = (s: ProfileDoc['skills'][number]) => s.level || text(s.category ?? {});
  const toolNames = p.skills.map((s) => ({ s, names: text(s.name).split(/[、，,]/).map((n) => n.trim()).filter((n) => n.length > 1) }));
  for (const { s, names } of toolNames) {
    if (/知识|兴趣/.test(tagOf(s)) && !/实操|实践|应用|实验|仿真/.test(tagOf(s))) continue;
    for (const e of [...p.projects, ...p.work]) {
      let raw = e.sourceRecord?.raw ?? '';
      for (const { s: other, names: long } of toolNames) if (other.id !== s.id) for (const n of long) for (const short of names) if (n.length > short.length && n.includes(short)) {
        raw = raw.split(n).join('');
        const qualifiedTail = n.slice(n.indexOf(short));
        if (qualifiedTail.length > short.length) raw = raw.replace(new RegExp(escapeRE(qualifiedTail), 'gi'), '');
      }
      if (names.some((n) => new RegExp(`(?:^|[^A-Za-z0-9])${escapeRE(n)}(?:$|[^A-Za-z0-9])`, 'i').test(raw))) (s.usedIn ??= []).push(e.id);
    }
    const context = tagOf(s).replace(/课程项目|课程实践|课程|软件|工作|实操|基础|使用/g, '').trim();
    const candidates = context.length >= 2 ? p.projects.filter((e) => [text(e.name), e.nature ?? ''].some((n) => n.includes(context))) : [];
    if (candidates.length === 1) s.usedIn = unique([...(s.usedIn ?? []), candidates[0].id]);
    if (tagOf(s) === '工作实践') {
      const work = p.work.filter((e) => e.sourceRecord?.id.startsWith('WRK-'));
      if (work.length === 1) s.usedIn = unique([...(s.usedIn ?? []), work[0].id]);
    }
  }
  for (const f of select(/^(?:CERT|AWD)-/)) {
    const sec = f.id.startsWith('AWD-') ? 'awards' : 'certificates';
    const e = { ...base(f.id, [f]), name: lt(clean(f.body.split(/[；;。]/)[0]), f.reviewed), issuer: {}, date: '', notes: [f.body] };
    p[sec].push(e); bind([f], e.id);
  }
  for (const f of select(/^INTRO-/)) {
    // 「中文个人简介：」「English personal summary:」等是字段名，不是简介正文。
    const introBody = f.body.replace(/^(?:中文个人简介|英文个人简介|个人简介|(?:English\s+)?(?:personal\s+)?(?:summary|profile))\s*[：:]\s*/i, '').trim();
    if (/^中文个人简介[：:]/.test(f.body)) p.profile.summary = { ...p.profile.summary, ...lt(introBody, f.reviewed) };
    else if (/^英文个人简介[：:]/.test(f.body) || !/[\u3400-\u9fff]/.test(introBody)) p.profile.summary = { ...p.profile.summary, en: introBody, status: { ...p.profile.summary.status, en: f.reviewed ? 'confirmed' : 'manual' } };
    else p.profile.notes.push(f.body);
    bind([f], 'profile');
  }
  for (const f of facts) {
    const ids = [...(mapped.get(f.id) ?? [])]; p.sourceFacts.push({ id: f.id, section: f.section, raw: f.raw, reviewed: f.reviewed, entityIds: ids });
    if (!ids.length) issues.push({ id: f.id, reason: '此编号事实尚未映射到资料实体，不能声明完整' });
  }
  const all = facts.map((f) => f.id), core = [...groupsOf(select(/^PRO-/), (f) => root(f.id)).keys()];
  const make = (label: string, expected: string[], recognized: string[], declared?: number) => ({ label, expected, recognized, missing: expected.filter((id) => !recognized.includes(id)), ...(declared !== undefined ? { declared } : {}) });
  const count = (kind: '本科' | '硕士') => { const m = new RegExp(`^0[1-9][｜|].*${kind}.*?([0-9]+)\\s*门`, 'm').exec(input); return m ? +m[1] : undefined; };
  const bachelor = all.filter((id) => /^BSC-\d+$/.test(id)), master = all.filter((id) => /^MSC-\d+$/.test(id));
  const expectedCourses = (ids: string[], declared?: number) => {
    if (!ids.length || declared === undefined || declared > 1000 || !ids.some((id) => +id.split('-')[1] === 1)) return ids;
    const width = ids[0].split('-')[1].length, prefix = ids[0].split('-')[0];
    return unique([...ids, ...Array.from({ length: declared }, (_, n) => `${prefix}-${String(n + 1).padStart(width, '0')}`)]);
  };
  const groups = [make('本科课程', expectedCourses(bachelor, count('本科')), bachelor.filter((id) => mapped.has(id)), count('本科')), make('硕士课程', expectedCourses(master, count('硕士')), master.filter((id) => mapped.has(id)), count('硕士')),
    make('核心项目', core, core.filter((key) => select(/^PRO-/).filter((f) => root(f.id) === key).every((f) => mapped.has(f.id)))), make('全部编号事实', all, all.filter((id) => mapped.has(id)))];
  for (const g of groups) if (g.declared !== undefined && g.declared !== g.recognized.length) issues.push({ id: g.label, reason: `原文声明 ${g.declared} 门，实际识别 ${g.recognized.length} 门` });
  const sections = unique(facts.map((f) => f.section)); if (sections.some((s) => !s)) issues.push({ id: '栏目', reason: '存在未归属栏目的编号事实' });
  return { profile: normalizeProfile(p), integrity: { format: 'numbered-library', groups, issues, complete: !issues.length } };
}
