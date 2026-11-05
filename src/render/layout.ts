import { compactGpaNote, tidyProjectTitle } from './resumeText';
import { profileWithResumeEdits } from './resumeEdits';
import { withLangOverrides } from './langOverrides';
import { LANG_TEST } from '../ai/relevance';
import { eduDateText } from './degree';
import { inferWorkKind, isCampusKind } from './classify';
import type { EducationEntry, Lang, ProfileDoc, ResumeDoc, TemplateConfig, ModuleKey, LocalizedText, Typography, PhotoPosition } from '../types';
import { lt, formatRange, formatDate, moduleOrderFor } from '../locale/text';
import { applyEnFill } from './enResidue';
import { academicHighlight, academicGradeText, courseLines, profileForGeneration } from '../privacy/resume';

/** 与输出格式无关的中间排版模型（PRD 7.3），预览 / PDF / Word 共用 */
export interface LBlock { title?: string; subtitle?: string; date?: string; bullets: string[]; text?: string; tags?: string[] }
export interface LSection { key: ModuleKey; title: string; blocks: LBlock[] }
export interface LayoutModel {
  lang: Lang;
  pageSize: 'A4' | 'LETTER';
  marginMm: { top: number; right: number; bottom: number; left: number };
  columns: 1 | 2;
  sidebarWidthPercent: number;
  headerStyle: 'band' | 'plain';
  titleStyle: 'underline' | 'bar' | 'band' | 'rule';
  /** engineering：副标题另起一行（与日期不同行，长名称不会和日期重叠） */
  style: 'default' | 'engineering';
  headerAlign: 'left' | 'center';
  colors: TemplateConfig['colors'];
  spacing: TemplateConfig['spacing'];
  typography: Typography;
  photo: { dataUrl: string; position: Exclude<PhotoPosition, 'none'>; sizeMm: number; aspect: number } | null;
  header: { name: string; headline: string; contacts: string[]; /** 与 contacts 同序，可点击的链接地址（无则 undefined） */ hrefs?: (string | undefined)[]; personal: string[] };
  main: LSection[];
  side: LSection[];
  /** 侧栏放不下、被移到主栏末尾的模块（用于提示，不静默截断） */
  movedFromSide: ModuleKey[];
}

/** 生成结果为空时（仅预览），按资料库全部启用条目构造 */
export function selectionFromProfile(p: ProfileDoc): ResumeDoc['selection'] {
  p = profileForGeneration(p);
  const ids = <T extends { id: string; enabled: boolean }>(a: T[]) => a.filter((e) => e.enabled).map((e) => e.id);
  return { work: ids(p.work), projects: ids(p.projects), education: ids(p.education), skills: ids(p.skills), certificates: ids(p.certificates), awards: ids(p.awards) };
}

/** 项目性质的英文说法；无对应译法时英文版不显示（不把中文混进英文简历，也不自行意译） */
const NATURE_EN: [RegExp, string][] = [
  [/本科毕业设计|毕业设计|毕设/, 'Capstone Project'], [/硕士课题|研究生课题/, "Master's Research"], [/博士课题/, 'Doctoral Research'],
  [/课程设计/, 'Course Project'], [/课程实验|实验课/, 'Course Lab'], [/教学实训|实训/, 'Training Practicum'], [/大创|大学生创新/, 'Student Innovation Project'],
  [/竞赛/, 'Competition Project'], [/个人项目|个人练习/, 'Personal Project'],
];
/** 技能名去重复标签：「Languages: English: CET-6」→「Languages: English CET-6」；名称里重复的分类前缀去掉 */
export function skillName(name: string, cat: string): string {
  let n = name.trim();
  if (cat) { const esc = cat.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); n = n.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, 'i'), ''); }
  const m = n.match(/^([^:：()（）]{1,30}?)\s*[:：]\s*(.+)$/);
  if (m && cat) n = `${m[1]} ${m[2]}`;
  return n;
}

const PURE_LANG_LABEL = /^(?:语言|语言能力|外语|外语能力|languages?|language skills)$/i;
/** 语言类技能：自然语言名称或语言考试成绩（编程语言不算）。按名称 / 分类的中英文一起识别。 */
const LANG_SKILL = /(?:^|[^A-Za-z])(?:English|Mandarin|Cantonese|Japanese|German|French|Spanish|Korean|Malay)(?=$|[^A-Za-z])|英语|英文|日语|德语|法语|西班牙语|韩语|马来语|普通话|粤语|母语|口语|听说读写|IELTS|TOEFL|PTE|CET-?[46]|TOEIC|雅思|托福|四级|六级/i;
/** 联系方式里的网址：显示时去掉协议和 www，点击地址补全 https:// */
export function shortUrl(u: string): string { return u.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, ''); }
export function toHref(u?: string): string | undefined {
  const t = (u ?? '').trim();
  if (!t || /\s/.test(t) || !/[a-z0-9-]+\.[a-z]{2,}/i.test(t)) return undefined;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function isLanguageSkill(s: { name: LocalizedText; category?: LocalizedText }): boolean {
  const name = `${s.name?.zh ?? ''} ${s.name?.en ?? ''}`;
  return LANG_SKILL.test(name) || PURE_LANG_LABEL.test((s.category?.zh ?? '').trim()) && !/Python|C\+\+|Java|MATLAB|SQL/i.test(name) || PURE_LANG_LABEL.test((s.category?.en ?? '').trim()) && !/Python|C\+\+|Java|MATLAB|SQL/i.test(name);
}

/** 旧资料导入可能把「编程语言 / Python」误当作口语语言；不修改母库，只修正简历显示分类。 */
export function resumeSkillCategory(category: string, name: string, lang: Lang): string {
  const technicalLanguage = /(?:^|[^A-Za-z0-9])(?:Python|C\+\+|C#|Java(?:Script)?|TypeScript|MATLAB|SQL|R(?:ust)?|Go|Swift|Kotlin|PHP|Ruby)(?=$|[^A-Za-z0-9])/i.test(name);
  const languageCategory = /^(?:语言|语言能力|外语|英语|language|languages|language skills|programming languages|编程语言)$/i.test(category.trim());
  if (technicalLanguage && languageCategory) return lang === 'zh' ? '编程 / 脚本' : 'Programming';
  return category;
}

export function natureLabel(n: string | undefined, lang: Lang): string {
  const v = n?.trim();
  if (!v) return '';
  if (lang === 'zh') return v;
  if (!/[\u2e80-\u9fff]/.test(v)) return v;
  return NATURE_EN.find(([re]) => re.test(v))?.[1] ?? '';
}

const PERSONAL_LABEL: Record<Lang, Record<string, string>> = {
  zh: { birth: '出生年月', gender: '性别', hometown: '籍贯', politics: '政治面貌' },
  en: { birth: 'Born', gender: 'Gender', hometown: 'Hometown', politics: 'Political status' },
};

/** 学校排名：显示在学校名后；英文简历只用英文（或纯 ASCII 的中文栏），避免英文版夹中文 */
function schoolRank(e: EducationEntry, lang: Lang): string {
  const r = e.ranking; if (!r) return '';
  const zh = (r.zh ?? '').trim(), en = (r.en ?? '').trim();
  const t = lang === 'zh' ? (zh || en) : (en || (/^[\x20-\x7e]+$/.test(zh) ? zh : ''));
  return t ? (lang === 'zh' ? `（${t}）` : ` (${t})`) : '';
}
function buildLayoutCore(p: ProfileDoc, tplIn: TemplateConfig, lang: Lang, resume?: ResumeDoc | null): LayoutModel {
  const tpl = withLangOverrides(tplIn, lang);
  p = profileWithResumeEdits(p, resume);
  const loc = tpl.locales[lang];
  const sel = resume?.selection ?? selectionFromProfile(p);
  const itemMap = new Map((resume?.items ?? []).map((i) => [i.sourceId, i]));
  const T = (t: LocalizedText | undefined) => lt(t, lang);
  /** bullet：生成结果优先，否则资料库原文 */
  const B = (t: LocalizedText) => {
    const it = t.id ? itemMap.get(t.id) : undefined;
    if (!it) return T(t);
    // 人工清空主版本不恢复母库原文；新勾选素材缺少译文时先展示原文。
    return it[lang] || (!it.confirmedLangs?.includes(lang) ? it[lang === 'zh' ? 'en' : 'zh'] : '');
  };
  /** 生成结果中若存在某条目的 bullet 子集，则只取已选 bullet */
  const pickBullets = (arr: LocalizedText[]) => {
    if (!resume) return arr.map(B).filter(Boolean);
    // 生成结果中只显示被选中的要点（用户可在素材池中勾选/取消）
    if (resume.layoutPolicy !== 'readable') return arr.filter((b) => b.id && itemMap.has(b.id)).map(B).filter(Boolean);
    const originals = new Map(arr.filter((b) => b.id).map((b) => [b.id!, b]));
    return resume.items.filter((i) => originals.has(i.sourceId)).map((i) => B(originals.get(i.sourceId)!)).filter(Boolean);
  };
  const range = (s: string, e: string) => formatRange(s, e, loc.dateFormat, loc.presentLabel);
  const byIds = <X extends { id: string }>(arr: X[], ids: string[]) => [...new Set(ids)].map((id) => arr.find((x) => x.id === id)).filter((x): x is X => !!x);

  const sections: Partial<Record<ModuleKey, LSection>> = {};
  const DEFAULT_TITLES: Record<Lang, Partial<Record<ModuleKey, string>>> = { zh: { campus: '校园经历' }, en: { campus: 'Leadership & Activities' } };
  const title = (k: ModuleKey) => loc.sectionTitles[k] ?? DEFAULT_TITLES[lang][k] ?? k;
  const engineering = tpl.layout.style === 'engineering';
  const order = [...moduleOrderFor(tpl, lang)];
  // 新生成的简历按性质单列校园背景；旧简历及旧模板的历史预览仍保留原布局。
  if (resume?.layoutPolicy === 'readable' && !order.includes('campus') && p.work.some((w) => sel.work.includes(w.id) && isCampusKind(inferWorkKind(w)))) {
    const before = order.indexOf('certificates');
    order.splice(before < 0 ? order.length : before, 0, 'campus');
  }
  /** 只有模板顺序包含 campus 时，社团 / 志愿经历才单列为「校园经历」；旧模板仍归入 work */
  const splitCampus = order.includes('campus');
  /** 学位状态见 degree.ts：就读结束 / 预计授位 / 实际授位分开，不按今天日期推断 */
  const eduRange = (e: ProfileDoc['education'][number]) => eduDateText(e, lang, { range, date: (d) => formatDate(d, loc.dateFormat, loc.presentLabel) });
  const summaryText = resume ? (itemMap.get('summary')?.[lang] ?? '') : T(p.profile.summary);
  if (summaryText) sections.summary = { key: 'summary', title: title('summary'), blocks: [{ bullets: [], text: summaryText }] };
  const sep = lang === 'zh' ? ' | ' : ', ';
  const wSel = byIds(p.work, sel.work);
  const wBlock = (e: ProfileDoc['work'][number]) => ({ title: T(e.company), subtitle: T(e.title), date: range(e.start, e.end), bullets: pickBullets(e.bullets) });
  const campusOf = (e: ProfileDoc['work'][number]) => isCampusKind(inferWorkKind(e));
  const w = wSel.filter((e) => !(splitCampus && campusOf(e))).map(wBlock);
  if (w.length) sections.work = { key: 'work', title: title('work'), blocks: w };
  const cp = splitCampus ? wSel.filter(campusOf).map(wBlock) : [];
  if (cp.length) sections.campus = { key: 'campus', title: title('campus'), blocks: cp };
  /** engineering：课程实验 / 教学实训等项目性质随角色显示，避免把课程作业包装成商业项目 */
  const prSub = (e: ProfileDoc['projects'][number]) => {
    const nature = natureLabel(e.nature, lang);
    const alreadyNamed = resume?.layoutPolicy === 'readable' && lang === 'en' && nature && T(e.name).toLowerCase().includes(nature.toLowerCase());
    return engineering ? [T(e.role), alreadyNamed ? '' : nature].filter(Boolean).join(sep) : T(e.role);
  };
  const pr = byIds(p.projects, sel.projects).map((e) => ({ title: resume?.layoutPolicy === 'readable' ? tidyProjectTitle(T(e.name), lang) : T(e.name), subtitle: prSub(e), date: range(e.start, e.end), bullets: pickBullets(e.bullets), tags: engineering ? undefined : e.tags }));
  if (pr.length) sections.projects = { key: 'projects', title: title('projects'), blocks: pr };
  const eduSub = (e: ProfileDoc['education'][number]) => {
    const maj = T(e.major), deg = T(e.degree);
    if (engineering && lang === 'en' && maj && deg) return `${deg} in ${maj}`;
    return [maj, deg].filter(Boolean).join(sep);
  };
  // v1.10：生成的简历副本里，GPA 后的核验说明只保留「估算 / 非官方」等必要限定（资料库原文不变）
  const ed = byIds(p.education, sel.education).map((e) => {
    const courses = courseLines(p, resume, e.id, lang);
    // 自动生成仍默认隐藏成绩；用户单独选用或手工编辑的文字应如实预览和导出。
    const highlights = e.highlights.filter((b) => (b.id && itemMap.get(b.id)?.manual) || !academicHighlight(b));
    const bullets = pickBullets(highlights).filter((t) => !academicGradeText(t) || highlights.some((b) => b.id && itemMap.get(b.id)?.manual && B(b) === t));
    return { title: T(e.school) + schoolRank(e, lang), subtitle: eduSub(e), date: eduRange(e), bullets: [...(resume ? bullets.map((x) => compactGpaNote(x, lang)) : bullets), ...(courses.length ? [`${lang === 'zh' ? '相关课程' : 'Relevant coursework'}: ${courses.join(lang === 'zh' ? '、' : '; ')}`] : [])] };
  });
  if (ed.length) sections.education = { key: 'education', title: title('education'), blocks: ed };
  const sk = byIds(p.skills, sel.skills);
  if (sk.length) {
    // 2026-11：先按 AI 给本岗位的分组与顺序；未分组的（如用户后来手动勾选的）再按资料库分类。
    // 2026-11-05：语言类技能（英语、PTE、雅思、CET 等）不论 AI 把它分在哪一组，统一单独成一栏「语言」，不和办公等混在一起。
    type Item = { t: string; lang: boolean };
    const groups = new Map<string, Item[]>();
    const placed = new Set<string>();
    const add = (label: string, it: Item) => groups.set(label, [...(groups.get(label) ?? []), it]);
    for (const g of resume?.skillGroups ?? []) {
      const label = (g[lang] || g[lang === 'zh' ? 'en' : 'zh'] || '').trim();
      for (const s of g.ids.map((id) => sk.find((x) => x.id === id)).filter((x): x is typeof sk[number] => !!x && !placed.has(x.id) && !!placed.add(x.id)))
        add(label, { t: skillName(T(s.name), ''), lang: isLanguageSkill(s) || PURE_LANG_LABEL.test((g.zh || g.en || '').trim()) });
    }
    sk.filter((s) => !placed.has(s.id)).forEach((s) => { const raw = T(s.category), c = resumeSkillCategory(raw, T(s.name), lang);
      add(c, { t: skillName(T(s.name), raw), lang: isLanguageSkill(s) || PURE_LANG_LABEL.test(c.trim()) }); });
    const langItems = [...groups.values()].flat().filter((i) => i.lang);
    const rows: [string, string[]][] = [];
    for (const [label, items] of groups) {
      const rest = items.filter((i) => !i.lang);
      if (!rest.length) continue;
      // 语言已单独成栏：其它组标题里的「与语言」去掉（「办公与语言」→「办公」）
      const stripped = langItems.length ? label.replace(/\s*[与和及&/、,，]\s*(语言|外语|Languages?)(能力|\s*skills)?|(语言|外语|Languages?)(能力|\s*skills)?\s*[与和及&/、,，]\s*/i, '').trim() : label;
      rows.push([stripped || label, rest.map((i) => i.t)]);
    }
    if (langItems.length) rows.push([lang === 'zh' ? '语言' : 'Languages', langItems.map((i) => i.t)]);
    sections.skills = { key: 'skills', title: title('skills'), blocks: rows.map(([c, names]) => ({ title: c || undefined, bullets: [], text: names.join(lang === 'zh' ? '、' : ', ') })) };
  }
  // v1.10：PTE / IELTS / CET 等语言考试成绩不是职业资格证书——归入技能里的「语言」组（旧数据兼容：按名称识别）
  const langCerts = !order.includes('skills') ? [] : byIds(p.certificates, sel.certificates).filter((e) => LANG_TEST.test(`${e.name.zh ?? ''} ${e.name.en ?? ''}`));
  if (langCerts.length) {
    const names = langCerts.map((e) => [T(e.name), formatDate(e.date, loc.dateFormat, loc.presentLabel)].filter(Boolean).join(lang === 'zh' ? '，' : ', '));
    const blocks = sections.skills?.blocks ?? [];
    const g = blocks.find((b) => /语言|外语|languages?/i.test((b.title ?? '').trim()));
    if (g) g.text = [g.text, ...names].filter(Boolean).join(lang === 'zh' ? '；' : '; ');
    else blocks.push({ title: lang === 'zh' ? '语言' : 'Languages', bullets: [], text: names.join(lang === 'zh' ? '；' : '; ') });
    sections.skills = { key: 'skills', title: title('skills'), blocks };
  }
  const simple = (k: 'certificates' | 'awards') => {
    const arr = byIds(p[k], sel[k]).filter((e) => k !== 'certificates' || !langCerts.includes(e as never)).map((e) => ({ title: T(e.name), subtitle: T(e.issuer), date: formatDate(e.date, loc.dateFormat, loc.presentLabel), bullets: [] }));
    if (arr.length) sections[k] = { key: k, title: title(k), blocks: arr };
  };
  simple('certificates'); simple('awards');
  // engineering：证书与奖项合并为一个模块（标题取 certificates 的标题）
  if (engineering && sections.awards && order.includes('certificates')) {
    const c = sections.certificates;
    sections.certificates = { key: 'certificates', title: title('certificates'), blocks: [...(c?.blocks ?? []), ...sections.awards.blocks] };
    delete sections.awards;
  }

  const side = tpl.layout.columns === 2 ? tpl.layout.sidebarModules : [];
  const main: LSection[] = [], sideS: LSection[] = [];
  order.forEach((k) => { const s = sections[k]; if (s) (side.includes(k) ? sideS : main).push(s); });

  // 侧栏只在第一页显示：估算高度，放不下的模块依次移到主栏末尾
  const movedFromSide: ModuleKey[] = [];
  if (sideS.length) {
    const ty = loc.typography;
    const pageW = tpl.page.size === 'A4' ? 595 : 612, pageH = tpl.page.size === 'A4' ? 842 : 792;
    const mg = tpl.page.marginMm;
    const colW = ((pageW - (mg.left + mg.right) * MM) * tpl.layout.sidebarWidthPercent) / 100 - 12;
    const photoH = loc.photo.enabled && p.profile.photo ? loc.photo.sizeMm * MM : 0;
    const headerH = Math.max(photoH, ty.nameSizePt * 1.2 + ty.bodySizePt * ty.lineHeight * 2.4) + 8 + tpl.spacing.sectionGapMm * MM;
    const avail = pageH - (mg.top + mg.bottom) * MM - headerH - 6;
    while (sideS.length && sideS.reduce((h, sec) => h + estimateSectionPt(sec, colW, ty, tpl.spacing), 0) > avail) {
      movedFromSide.unshift(sideS.pop()!.key);
    }
    movedFromSide.forEach((k) => main.push(sections[k]!));
  }

  const c = p.profile.contacts;
  const visibility = resume?.contactVisibility ?? c.visibility ?? {};
  const LINK_KEYS = ['github', 'linkedin', 'website', 'portfolio'] as const;
  const contactEntries: { text: string; href?: string }[] = ([
    ...[c.phone, c.email, T(c.location)].map((x) => ({ text: x as string })),
    ...LINK_KEYS.filter((k) => visibility[k] === true).map((k) => ({ text: c[k] ?? '', href: toHref(c[k]) })),
  ] as { text: string; href?: string }[]).filter((x) => !!x.text && !!x.text.trim()).map((x) => (x.href ? { text: shortUrl(x.text), href: x.href } : x));
  const contacts = contactEntries.map((x) => x.text);
  const hrefs = contactEntries.map((x) => x.href);
  const personal = loc.personalFields.map((f) => (p.profile.personal[f] ? `${PERSONAL_LABEL[lang][f]}: ${p.profile.personal[f]}` : '')).filter(Boolean);
  const photo = loc.photo.enabled && loc.photo.position !== 'none' && p.profile.photo
    ? { dataUrl: p.profile.photo, position: loc.photo.position, sizeMm: loc.photo.sizeMm, aspect: p.profile.photoAspect ?? 0.8 } : null;

  return {
    lang, pageSize: tpl.page.size, marginMm: tpl.page.marginMm, columns: tpl.layout.columns, sidebarWidthPercent: tpl.layout.sidebarWidthPercent,
    headerStyle: tpl.layout.headerStyle, titleStyle: tpl.layout.titleStyle ?? 'underline', style: tpl.layout.style ?? 'default', headerAlign: tpl.layout.headerAlign ?? 'left', colors: tpl.colors, spacing: tpl.spacing, typography: loc.typography, photo,
    header: { name: T(p.profile.name), headline: resume?.headlineHidden ? '' : (resume?.headline?.[lang] ?? '').trim() || T(p.profile.headline), contacts, hrefs, personal },
    main, side: sideS, movedFromSide,
  };
}

export const MM = 72 / 25.4; // pt per mm

/** 粗略估算文本宽度（pt）：中日韩字符按 1em，拉丁字符按 0.52em */
function textWidthPt(t: string, size: number) {
  let w = 0;
  for (const ch of t) w += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? size : size * 0.52;
  return w;
}
/** 估算侧栏（窄栏）模块高度（pt），偏保守 */
export function estimateSectionPt(sec: LSection, colW: number, ty: Typography, sp: TemplateConfig['spacing']): number {
  const lh = ty.bodySizePt * ty.lineHeight;
  const lines = (t: string | undefined, size = ty.bodySizePt, indent = 0) => (t ? Math.max(1, Math.ceil(textWidthPt(t, size) / (colW - indent))) : 0);
  let h = (ty.bodySizePt + 2) * 1.4 + 6;
  for (const b of sec.blocks) {
    h += (lines(b.title) + lines(b.subtitle) + lines(b.text) + (b.tags?.length ? lines(b.tags.join(' · ')) : 0)) * lh;
    if (b.date) h += lh * 0.9;
    for (const x of b.bullets) h += lines(x, ty.bodySizePt, 9) * lh + 1;
    h += sp.itemGapMm * MM;
  }
  return h + sp.sectionGapMm * MM;
}

/** 预览 / PDF / Word 共用的入口：英文版在核心排版之上套用「英文补译」（resume.enFill，只改显示，不改资料库）。 */
export function buildLayout(p: ProfileDoc, tpl: TemplateConfig, lang: Lang, resume?: ResumeDoc | null): LayoutModel {
  const m = buildLayoutCore(p, tpl, lang, resume);
  return lang === 'en' && resume?.enFill ? applyEnFill(m, resume.enFill) : m;
}
