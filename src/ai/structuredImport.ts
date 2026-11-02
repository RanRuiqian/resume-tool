import type { BaseEntry, ImportIntegrity, LocalizedText, ProfileDoc } from '../types';
import { emptyProfile, normalizeProfile } from '../storage/profileIO';
import { normalizeCourse } from '../storage/courses';
import { parseFactLibrary } from './factLibrary';

/** 本地编号母库解析。每个编号是一个不可拆分的事实块；不执行原文中的指令，不生成事实。 */
interface RecordBlock { id: string; section: string; title: string; raw: string; reviewed: boolean; columns?: Record<string, string>; ambiguousColumns?: boolean }
interface SectionBlock { title: string; preamble: string[]; records: RecordBlock[] }
export interface StructuredImport { profile: ProfileDoc; integrity: ImportIntegrity }
const ID = '[A-Z]{2,8}-(?:[A-Z0-9]{1,16}-)*[A-Z0-9]{1,16}';
const START = new RegExp(`^\\s*(?:(?:#{1,6}|[-*+])\\s*|\\|\\s*|\\d+[.)、]\\s*)*(?:\\[[xX✓ ]\\]\\s*)?(?:[【[(]\\s*)?(?:(?:来源|记录|课程|事实)?编号\\s*[:：]\\s*)?(${ID})(?![A-Z0-9])(?:[】)\\]]|\\s|[|｜:：、.—-]|$)`);
const SECTION = /^\s*(?:#{1,6}\s*)?(0[1-9]|1[0-4])(?:[.、:：)）\s]|章)\s*(.+)$/;
const tidy = (s: string) => s.replace(/^\s*(?:[-*]\s*)?\[[xX✓ ]\]\s*/, '').trim();
const localized = (s: string, reviewed = false): LocalizedText => !s ? {} : {
  [/[\u3400-\u9fff]/.test(s) ? 'zh' : 'en']: s,
  source: /[\u3400-\u9fff]/.test(s) ? 'zh' : 'en',
  status: { [/[\u3400-\u9fff]/.test(s) ? 'zh' : 'en']: reviewed ? 'confirmed' : 'manual' },
};
const unknown = /未知|不详|未公布|尚未|未发布|遮挡|隐去|未提供|待定|待公布|unknown|not (?:yet )?(?:released|available)|pending|[*＊]{2,}|[?？]{2,}/i;
// 日期字段只接收原文已明确给出的完整数值，不从项目内容或预计授予日期推断起止。
const date = (s: string) => unknown.test(s) ? '' : /^\d{4}(?:[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)?$/.test(s.trim()) ? s.trim().replace(/[/.年]/g, '-').replace(/月|日/g, '') : /^(?:至今|present)$/i.test(s.trim()) ? 'present' : '';
const fieldPairs = (r: RecordBlock): [string, string][] => {
  const fields: [string, string][] = Object.entries(r.columns ?? {});
  for (const line of r.raw.split('\n')) for (const part of tidy(line).split(/[|｜\t；;]/)) {
    const m = /^\s*(?:[-*]\s*)?([^:：]{1,32})\s*[:：]\s*(.*?)\s*$/.exec(part);
    if (m) fields.push([m[1].replace(/\*\*|`/g, '').trim().toLowerCase(), m[2]]);
  }
  return fields;
};
const fieldsOf = (r: RecordBlock) => {
  const fields = new Map(fieldPairs(r));
  return (...names: string[]) => names.map((n) => fields.get(n.toLowerCase())).find((x) => !!x) ?? '';
};
const nameOf = (r: RecordBlock, ...keys: string[]) => {
  const v = fieldsOf(r)(...keys);
  if (v) return v;
  const s = tidy(r.title).replace(/^(?:[-:：、|｜—\s])+/, '').split(/[|｜\t；;]/)[0].replace(/\s+(?:课程代码|学分|成绩)\s*[:：].*$/, '').trim();
  return /^(?:\[x\]|编号|学分|成绩|课程代码|已审核|已确认)?$/i.test(s) || /[:：]/.test(s) ? '' : s;
};

function scan(text: string): SectionBlock[] {
  const sections: SectionBlock[] = [{ title: '未分栏', preamble: [], records: [] }];
  let sec = sections[0], active: RecordBlock | undefined;
  let tableHeaders: string[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const plain = line.replace(/\*\*|`/g, '');
    const h = SECTION.exec(plain);
    if (h) { sec = { title: `${h[1]} ${h[2]}`, preamble: [], records: [] }; sections.push(sec); active = undefined; tableHeaders = []; continue; }
    const cells = line.split(/[|｜\t]/).map((s) => s.trim()).filter((s, i, a) => !(s === '' && (i === 0 || i === a.length - 1)));
    const labels = cells.map((s) => s.replace(/\*\*|`/g, ''));
    if (cells.length > 1 && labels.some((s) => /^(?:来源编号|课程编号|编号|ID)$/i.test(s)) && labels.some((s) => /^(?:课程名称|中文名称|英文名称|名称|name)$/i.test(s))) { tableHeaders = labels.map((s) => s.toLowerCase()); active = undefined; continue; }
    if (cells.length > 1 && cells.every((s) => /^:?-+:?$/.test(s))) continue;
    const m = START.exec(plain);
    if (m) {
      active = { id: m[1].toUpperCase(), section: sec.title, title: plain.slice(m.index + m[0].length), raw: line, reviewed: /\[[xX✓]\]/.test(line), ...(tableHeaders.length ? { columns: Object.fromEntries(tableHeaders.map((h, i) => [h, cells[i] ?? ''])) } : {}), ambiguousColumns: cells.length > 2 && !tableHeaders.length && cells.slice(2).some((s) => s && !/[:：]/.test(s)) };
      sec.records.push(active);
    } else if (active) active.raw += `\n${line}`;
    else sec.preamble.push(line);
  }
  for (const s of sections) for (const r of s.records) r.reviewed = /\[[xX✓]\]/.test(r.raw);
  return sections;
}

export function isStructuredLibrary(text: string): boolean {
  if (/^\s*0[1-9][｜|]/m.test(text) && /^\s*\[[xX✓ ]\]\s+(?:ID|EDU|BSC|MSC)-/m.test(text)) return true;
  const records = scan(text).flatMap((s) => s.records);
  return records.some((r) => /^(?:BSC|MSC|EDU|PRO|LRN|SKL)-/.test(r.id));
}

/** 全量扫描不设条数/字符/token上限。不能映射的编号显式列入遗漏，绝不交给模型编造。 */
export function parseStructuredLibrary(text: string): StructuredImport | null {
  const facts = parseFactLibrary(text); if (facts) return facts;
  if (!isStructuredLibrary(text)) return null;
  const sections = scan(text), records = sections.flatMap((s) => s.records);
  const profile = emptyProfile(); profile.courses = [];
  const issues: ImportIntegrity['issues'] = [];
  const recognized = new Set<string>(); const seen = new Map<string, RecordBlock>();
  const now = new Date().toISOString();
  const extra = (r: RecordBlock): BaseEntry => ({
    id: `library-${r.id}`, enabled: true,
    sourceRecord: { format: 'numbered-library', id: r.id, section: r.section, raw: r.raw.trim(), reviewed: r.reviewed },
    ...(r.reviewed ? { userConfirmedAt: now } : {}),
  });
  const fail = (r: RecordBlock, reason: string) => issues.push({ id: r.id, reason });
  const cleanBody = (r: RecordBlock) => r.raw.split('\n').slice(1).map(tidy).filter(Boolean);
  const bullets = (r: RecordBlock) => {
    const f = fieldsOf(r); const s = f('实际操作', '个人贡献', '职责', '工作内容', '实践内容', '项目内容', '成果', '内容', '说明');
    return s ? [{ ...localized(s, r.reviewed), id: `library-${r.id}-b1` }] : [];
  };
  const links = (s: string) => [...new Set(s.toUpperCase().match(new RegExp(`\\b${ID}\\b`, 'g')) ?? [])].map((x) => `library-${x}`);
  for (const r of records) {
    const prior = seen.get(r.id);
    if (prior) {
      if (tidy(prior.raw) !== tidy(r.raw)) { recognized.delete(r.id); fail(r, '同一来源编号出现不同内容，需核对；未自动覆盖'); }
      continue;
    }
    seen.set(r.id, r);
    if (r.ambiguousColumns) { fail(r, '表格列没有可确定的表头，不能猜测学分、成绩或说明的对应列'); continue; }
    const values = new Map<string, string>(); let contradiction = false;
    for (const [key, value] of fieldPairs(r)) {
      if (value && values.get(key) && values.get(key) !== value) { fail(r, `字段「${key}」有互相不同的原文值，需核对；未自动选择`); contradiction = true; }
      if (value) values.set(key, value);
    }
    if (contradiction) continue;
    const f = fieldsOf(r), base = extra(r), lt = (s: string) => localized(s, r.reviewed);
    const bilingualName = (fallback: string) => {
      const zh = f('中文名称', '中文名'), en = f('英文名称', '英文名');
      const out = lt(fallback);
      for (const [lang, value] of [['zh', zh], ['en', en]] as const) if (value) { out[lang] = value; out.status = { ...out.status, [lang]: r.reviewed ? 'confirmed' : 'manual' }; }
      return out;
    };
    const range = { start: date(f('开始', '开始日期', '开始时间', 'start')), end: date(f('结束', '结束日期', '结束时间', 'end')) };
    if (/^EDU-/.test(r.id)) {
      const title = nameOf(r, '教育经历');
      const school = f('学校', '院校', '学校名称', 'school') || (/大学|学院|university|college|institute|school/i.test(title) ? title : '');
      if (!school) { fail(r, '没有可确定的学校名称；原文保留，需补充映射'); continue; }
      profile.education.push({ ...base, school: lt(school), degree: lt(f('学位', '学历', 'degree')), major: lt(f('专业', 'major')), ...range, highlights: [],
        ...Object.fromEntries(([
          ['courseCompletionDate', f('课程完成日期', '课程完成时间')], ['expectedConferralDate', f('预计授予日期', '预计毕业日期', '预计授予学位日期')],
          ['actualConferralDate', f('实际授予日期', '实际授予学位日期')], ['availableFullTimeDate', f('可全职入职日期')],
        ] as const).filter(([, v]) => date(v)).map(([k, v]) => [k, date(v)])),
      });
    } else if (/^(?:BSC|MSC)-/.test(r.id)) {
      const name = nameOf(r, '课程名称', '名称', '中文名称', '英文名称', 'course', 'name');
      if (!name) { fail(r, '课程名称未识别，不能把编号或学分当作课程名称'); continue; }
      const grade = f('成绩', '分数', 'grade', 'mark'), synopsis = f('课程内容', '课程说明', '原文说明', '说明', '内容', 'synopsis');
      profile.courses.push(normalizeCourse({ ...base, name: bilingualName(name), code: f('课程代码', '课程编号', '代码', 'code'), school: f('学校', 'school'),
        educationId: links(f('教育编号', '所属教育', 'educationId'))[0] ?? '', level: r.id.startsWith('MSC-') ? 'master' : 'bachelor',
        credits: f('学分', 'credits'), grade: { raw: grade, status: /未公布|尚未|未发布|not (?:yet )?released/i.test(grade) ? 'not-released' : !grade || unknown.test(grade) ? 'unverified' : 'recorded' },
        term: f('学期', 'term'), synopsis: lt(synopsis), evidenceLevel: 'unverified',
        sources: [{ id: r.id, label: '编号母库原文', reference: r.id }], confirmation: r.reviewed ? 'confirmed' : 'pending',
        projectIds: links(f('关联项目', '项目编号', 'projectIds')), defaultGradeVisible: false,
      }));
    } else if (/^(?:PRO|LRN|PUB|PAP|AI)-/.test(r.id) || (!/^(?:SKL|WRK|WORK|INT|ORG|EXP|VOL|CER|CERT|AWD|AWARD)-/.test(r.id) && /核心项目|课程实验|课程实践|学术论文|个人.*工具/.test(r.section))) {
      const name = nameOf(r, '项目名称', '实验名称', '作业名称', '论文题目', '工具名称', '名称', 'name');
      if (!name) { fail(r, '项目/实践名称未识别'); continue; }
      profile.projects.push({ ...base, name: bilingualName(name), role: lt(f('角色', '职责', 'role')), ...range, bullets: bullets(r), tags: [],
        kind: /^PRO-/.test(r.id) || /核心项目/.test(r.section) ? 'core' : 'auxiliary', nature: f('性质', '类型'),
        dossier: { technicalWork: cleanBody(r).join('\n'), tools: f('实际使用工具', '软件工具', '工具', '软件').split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean) },
        courseIds: links(f('关联课程', '课程编号', 'courseIds')),
      });
    } else if (/^SKL-/.test(r.id) || /工程技能/.test(r.section)) {
      const name = nameOf(r, '技能名称', '名称', '工具名称', 'name');
      if (!name) { fail(r, '技能名称未识别'); continue; }
      profile.skills.push({ ...base, name: bilingualName(name), category: lt(f('分类', 'category')), scenarios: f('实际能力', '实际使用', '能力说明', '说明'), usedIn: links(f('关联经历', '关联项目', '使用于', 'usedIn')) });
    } else if (/^(?:WRK|WORK|INT|ORG|EXP|VOL)-/.test(r.id) || /工作|组织经历|实习/.test(r.section)) {
      const company = f('公司', '单位', '组织', 'company'), title = f('职位', '职务', '部门', 'title') || nameOf(r, '名称');
      if (!company && !title) { fail(r, '单位与职位均未识别'); continue; }
      profile.work.push({ ...base, company: lt(company), title: lt(title), ...range, bullets: bullets(r), tags: [], kind: /组织|学生会/.test(r.section) ? 'club' : /实习/.test(r.section) ? 'internship' : '' });
    } else if (/^(?:CER|CERT|AWD|AWARD)-/.test(r.id) || /证书|奖项/.test(r.section)) {
      const name = nameOf(r, '证书名称', '奖项名称', '名称', 'name');
      if (!name) { fail(r, '证书/奖项名称未识别'); continue; }
      const sec = /^AW/.test(r.id) || /奖项/.test(r.title) ? 'awards' : 'certificates';
      profile[sec].push({ ...base, name: lt(name), issuer: lt(f('颁发机构', '机构', 'issuer')), date: date(f('日期', '颁发日期', 'date')) });
    } else { fail(r, '尚未支持此编号的实体类型，原文保留；需补充映射'); continue; }
    recognized.add(r.id);
  }
  // 无编号的基本资料/简介也只按明确字段读取；其它未分块内容不能声称已完整识别。
  for (const sec of sections) {
    const raw = sec.preamble.join('\n').trim(); if (!raw) continue;
    const basic = /个人信息|基本信息|个人简介|自我介绍/.test(sec.title);
    if (basic) {
      const f = fieldsOf({ id: '', section: sec.title, raw, title: '', reviewed: false });
      for (const [key, keys] of [['name', ['姓名', 'name']], ['headline', ['求职方向', '个人标题']]] as const) {
        const v = f(...keys); if (v) profile.profile[key] = localized(v);
      }
      for (const [key, keys] of [['email', ['邮箱', 'email']], ['phone', ['电话', '手机']], ['github', ['github']], ['linkedin', ['linkedin']], ['website', ['网站', '个人网站']]] as const) { const v = f(...keys); if (v) profile.profile.contacts[key] = v; }
      const loc = f('所在地', '居住地', 'location'); if (loc) profile.profile.contacts.location = localized(loc);
      for (const [key, keys] of [['birth', ['出生日期', '出生年月']], ['gender', ['性别']], ['hometown', ['籍贯']], ['politics', ['政治面貌']]] as const) { const v = f(...keys); if (v) profile.profile.personal[key] = v; }
      if (/个人简介|自我介绍/.test(sec.title)) profile.profile.summary = localized(tidy(raw));
      else profile.profile.notes = [...(profile.profile.notes ?? []), raw];
    } else if (sec.title !== '未分栏' && !sec.records.length) issues.push({ id: sec.title, reason: '栏目内容没有可映射的稳定记录编号，尚未识别；原文将保存' });
  }
  // 仅关联原文指定 ID；没有明确归属时只在唯一匹配学历时关联，不制造教育记录。
  for (const c of profile.courses) {
    if (!c.educationId) {
      const candidates = profile.education.filter((e) => (c.level === 'master' ? /硕士|master|m\.?eng|m\.?sc/i : /本科|学士|bachelor|b\.?eng|b\.?sc/i).test(`${e.degree.zh ?? ''} ${e.degree.en ?? ''}`));
      if (candidates.length === 1) c.educationId = candidates[0].id;
    }
    const e = profile.education.find((e) => e.id === c.educationId);
    if (!e) issues.push({ id: c.sourceRecord!.id, reason: '课程所属教育经历尚未确定；课程已保留，未新建教育经历' });
    else c.school ||= e.school.zh || e.school.en || '';
  }
  for (const p of profile.projects) for (const id of p.courseIds ?? []) { const c = profile.courses.find((c) => c.id === id); if (c) c.projectIds = [...new Set([...c.projectIds, p.id])]; }
  for (const c of profile.courses) for (const id of c.projectIds) { const p = profile.projects.find((p) => p.id === id); if (p) p.courseIds = [...new Set([...(p.courseIds ?? []), c.id])]; }
  // 精确名称的、明确写在工具字段中的实操关联；从不因正文碰巧提及某词而生成技能。
  for (const p of profile.projects) for (const tool of p.dossier?.tools ?? []) for (const s of profile.skills) {
    if ([s.name.zh, s.name.en].some((n) => n?.trim().toLowerCase() === tool.toLowerCase())) s.usedIn = [...new Set([...(s.usedIn ?? []), p.id])];
  }
  const ids = new Set(records.map((r) => r.id));
  // 全文中的已知事实编号也进入清单，避免不支持的标题写法让一条记录连统计都消失。
  for (const m of text.matchAll(/\b(?:BSC|MSC|EDU|PRO|LRN|SKL)-(?:[A-Z0-9]{1,16}-)*[A-Z0-9]{1,16}\b/g)) ids.add(m[0]);
  // 显式编号范围也是原文的数量承诺，可发现整条被删掉的课程，而不固定写死76/6。
  for (const m of text.matchAll(/\b(BSC|MSC)-(\d{1,4})\s*[～~—–至-]\s*(?:\1-)?(\d{1,4})\b/gi)) {
    const from = +m[2], to = +m[3]; if (to < from || to - from > 1000) continue;
    for (let n = from; n <= to; n++) ids.add(`${m[1].toUpperCase()}-${String(n).padStart(m[2].length, '0')}`);
  }
  const groups: ImportIntegrity['groups'] = [];
  for (const [label, re] of [['本科课程', /^BSC-/], ['硕士课程', /^MSC-/], ['核心项目', /^PRO-/], ['其他编号事实', /^(?!BSC-|MSC-|PRO-)/]] as const) {
    const expected = [...ids].filter((id) => re.test(id)); const found = expected.filter((id) => recognized.has(id));
    const declared = (label === '本科课程' || label === '硕士课程') ? sections.filter((s) => s.title.includes(label.slice(0, 2))).map((s) => /(?:共\s*)?(\d+)\s*门/.exec(s.title)).find(Boolean)?.[1] : undefined;
    groups.push({ label, expected, recognized: found, missing: expected.filter((id) => !recognized.has(id)), ...(declared ? { declared: +declared } : {}) });
  }
  for (const g of groups) for (const id of g.missing) if (!issues.some((x) => x.id === id)) issues.push({ id, reason: '原文声明的编号范围中没有找到可识别的记录' });
  for (const g of groups) if (g.declared && g.declared !== g.recognized.length) issues.push({ id: g.label, reason: `栏目声明 ${g.declared} 门，识别 ${g.recognized.length} 门；不能确认完整` });
  // 所有悬空引用必须可见，不让 normalizeProfile 的过滤静默掩盖关联丢失。
  const actualIds = new Set([...profile.education, ...profile.work, ...profile.projects, ...profile.skills, ...profile.courses].map((e) => e.id));
  for (const e of [...profile.projects, ...profile.skills, ...profile.courses]) {
    const refs = [...('usedIn' in e ? e.usedIn ?? [] : []), ...('courseIds' in e ? e.courseIds ?? [] : []), ...('projectIds' in e ? e.projectIds : [])];
    for (const id of refs) if (!actualIds.has(id)) issues.push({ id: e.sourceRecord!.id, reason: `关联编号 ${id.replace(/^library-/, '')} 不存在，未建立虚假关联` });
  }
  return { profile: normalizeProfile(profile), integrity: { format: 'numbered-library', groups, issues, complete: !issues.length } };
}
