import { compactGpaNote } from './resumeText';
import { LANG_TEST } from '../ai/relevance';
import { eduDateText } from './degree';
import { inferWorkKind, isCampusKind } from './classify';
import type { Lang, ProfileDoc, ResumeDoc, TemplateConfig, ModuleKey, LocalizedText, Typography, PhotoPosition } from '../types';
import { lt, formatRange, formatDate, moduleOrderFor } from '../locale/text';

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
  header: { name: string; headline: string; contacts: string[]; personal: string[] };
  main: LSection[];
  side: LSection[];
  /** 侧栏放不下、被移到主栏末尾的模块（用于提示，不静默截断） */
  movedFromSide: ModuleKey[];
}

/** 生成结果为空时（仅预览），按资料库全部启用条目构造 */
export function selectionFromProfile(p: ProfileDoc): ResumeDoc['selection'] {
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

export function buildLayout(p: ProfileDoc, tpl: TemplateConfig, lang: Lang, resume?: ResumeDoc | null): LayoutModel {
  const loc = tpl.locales[lang];
  const sel = resume?.selection ?? selectionFromProfile(p);
  const itemMap = new Map((resume?.items ?? []).map((i) => [i.sourceId, i]));
  const T = (t: LocalizedText | undefined) => lt(t, lang);
  /** bullet：生成结果优先，否则资料库原文 */
  const B = (t: LocalizedText) => {
    const it = t.id ? itemMap.get(t.id) : undefined;
    return (it && (it[lang] || '').trim()) || T(t);
  };
  /** 生成结果中若存在某条目的 bullet 子集，则只取已选 bullet */
  const pickBullets = (arr: LocalizedText[]) => {
    if (!resume) return arr.map(B).filter(Boolean);
    // 生成结果中只显示被选中的要点（用户可在素材池中勾选/取消）
    return arr.filter((b) => b.id && itemMap.has(b.id)).map(B).filter(Boolean);
  };
  const range = (s: string, e: string) => formatRange(s, e, loc.dateFormat, loc.presentLabel);
  const byIds = <X extends { id: string }>(arr: X[], ids: string[]) => ids.map((id) => arr.find((x) => x.id === id)).filter((x): x is X => !!x);

  const sections: Partial<Record<ModuleKey, LSection>> = {};
  const DEFAULT_TITLES: Record<Lang, Partial<Record<ModuleKey, string>>> = { zh: { campus: '校园经历' }, en: { campus: 'Leadership & Activities' } };
  const title = (k: ModuleKey) => loc.sectionTitles[k] ?? DEFAULT_TITLES[lang][k] ?? k;
  const engineering = tpl.layout.style === 'engineering';
  const order = moduleOrderFor(tpl, lang);
  /** 只有模板顺序包含 campus 时，社团 / 志愿经历才单列为「校园经历」；旧模板仍归入 work */
  const splitCampus = order.includes('campus');
  /** 学位状态见 degree.ts：就读结束 / 预计授位 / 实际授位分开，不按今天日期推断 */
  const eduRange = (e: ProfileDoc['education'][number]) => eduDateText(e, lang, { range, date: (d) => formatDate(d, loc.dateFormat, loc.presentLabel) });
  const summaryText = resume ? (itemMap.get('summary')?.[lang]?.trim() || (itemMap.has('summary') ? T(p.profile.summary) : '')) : T(p.profile.summary);
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
  const prSub = (e: ProfileDoc['projects'][number]) => engineering ? [T(e.role), natureLabel(e.nature, lang)].filter(Boolean).join(sep) : T(e.role);
  const pr = byIds(p.projects, sel.projects).map((e) => ({ title: T(e.name), subtitle: prSub(e), date: range(e.start, e.end), bullets: pickBullets(e.bullets), tags: engineering ? undefined : e.tags }));
  if (pr.length) sections.projects = { key: 'projects', title: title('projects'), blocks: pr };
  const eduSub = (e: ProfileDoc['education'][number]) => {
    const maj = T(e.major), deg = T(e.degree);
    if (engineering && lang === 'en' && maj && deg) return `${deg} in ${maj}`;
    return [maj, deg].filter(Boolean).join(sep);
  };
  // v1.10：生成的简历副本里，GPA 后的核验说明只保留「估算 / 非官方」等必要限定（资料库原文不变）
  const ed = byIds(p.education, sel.education).map((e) => ({ title: T(e.school), subtitle: eduSub(e), date: eduRange(e), bullets: resume ? pickBullets(e.highlights).map((x) => compactGpaNote(x, lang)) : pickBullets(e.highlights) }));
  if (ed.length) sections.education = { key: 'education', title: title('education'), blocks: ed };
  const sk = byIds(p.skills, sel.skills);
  if (sk.length) {
    // 按分类分组
    const groups = new Map<string, string[]>();
    sk.forEach((s) => { const c = T(s.category); groups.set(c, [...(groups.get(c) ?? []), skillName(T(s.name), c)]); });
    sections.skills = { key: 'skills', title: title('skills'), blocks: [...groups].map(([c, names]) => ({ title: c || undefined, bullets: [], text: names.join(lang === 'zh' ? '、' : ', ') })) };
  }
  // v1.10：PTE / IELTS / CET 等语言考试成绩不是职业资格证书——归入技能里的「语言」组（旧数据兼容：按名称识别）
  const langCerts = !order.includes('skills') ? [] : byIds(p.certificates, sel.certificates).filter((e) => LANG_TEST.test(`${e.name.zh ?? ''} ${e.name.en ?? ''}`));
  if (langCerts.length) {
    const names = langCerts.map((e) => [T(e.name), formatDate(e.date, loc.dateFormat, loc.presentLabel)].filter(Boolean).join(lang === 'zh' ? '，' : ', '));
    const blocks = sections.skills?.blocks ?? [];
    const g = blocks.find((b) => /^(?:语言|语言能力|外语|languages?|language skills)$/i.test((b.title ?? '').trim()));
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
  const contacts = [c.phone, c.email, T(c.location), c.github, c.linkedin, c.website].filter((x): x is string => !!x && !!x.trim());
  const personal = loc.personalFields.map((f) => (p.profile.personal[f] ? `${PERSONAL_LABEL[lang][f]}: ${p.profile.personal[f]}` : '')).filter(Boolean);
  const photo = loc.photo.enabled && loc.photo.position !== 'none' && p.profile.photo
    ? { dataUrl: p.profile.photo, position: loc.photo.position, sizeMm: loc.photo.sizeMm, aspect: p.profile.photoAspect ?? 0.8 } : null;

  return {
    lang, pageSize: tpl.page.size, marginMm: tpl.page.marginMm, columns: tpl.layout.columns, sidebarWidthPercent: tpl.layout.sidebarWidthPercent,
    headerStyle: tpl.layout.headerStyle, titleStyle: tpl.layout.titleStyle ?? 'underline', style: tpl.layout.style ?? 'default', headerAlign: tpl.layout.headerAlign ?? 'left', colors: tpl.colors, spacing: tpl.spacing, typography: loc.typography, photo,
    header: { name: T(p.profile.name), headline: T(p.profile.headline), contacts, personal },
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
