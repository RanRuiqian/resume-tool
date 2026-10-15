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
  colors: TemplateConfig['colors'];
  spacing: TemplateConfig['spacing'];
  typography: Typography;
  photo: { dataUrl: string; position: Exclude<PhotoPosition, 'none'>; sizeMm: number } | null;
  header: { name: string; headline: string; contacts: string[]; personal: string[] };
  main: LSection[];
  side: LSection[];
}

/** 生成结果为空时（仅预览），按资料库全部启用条目构造 */
export function selectionFromProfile(p: ProfileDoc): ResumeDoc['selection'] {
  const ids = <T extends { id: string; enabled: boolean }>(a: T[]) => a.filter((e) => e.enabled).map((e) => e.id);
  return { work: ids(p.work), projects: ids(p.projects), education: ids(p.education), skills: ids(p.skills), certificates: ids(p.certificates), awards: ids(p.awards) };
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
    const chosen = arr.filter((b) => b.id && itemMap.has(b.id));
    return (chosen.length ? chosen : arr).map(B).filter(Boolean);
  };
  const range = (s: string, e: string) => formatRange(s, e, loc.dateFormat, loc.presentLabel);
  const byIds = <X extends { id: string }>(arr: X[], ids: string[]) => ids.map((id) => arr.find((x) => x.id === id)).filter((x): x is X => !!x);

  const sections: Partial<Record<ModuleKey, LSection>> = {};
  const title = (k: ModuleKey) => loc.sectionTitles[k];
  const summaryText = itemMap.get('summary')?.[lang]?.trim() || T(p.profile.summary);
  if (summaryText) sections.summary = { key: 'summary', title: title('summary'), blocks: [{ bullets: [], text: summaryText }] };
  const sep = lang === 'zh' ? ' | ' : ', ';
  const w = byIds(p.work, sel.work).map((e) => ({ title: T(e.company), subtitle: T(e.title), date: range(e.start, e.end), bullets: pickBullets(e.bullets) }));
  if (w.length) sections.work = { key: 'work', title: title('work'), blocks: w };
  const pr = byIds(p.projects, sel.projects).map((e) => ({ title: T(e.name), subtitle: T(e.role), date: range(e.start, e.end), bullets: pickBullets(e.bullets), tags: e.tags }));
  if (pr.length) sections.projects = { key: 'projects', title: title('projects'), blocks: pr };
  const ed = byIds(p.education, sel.education).map((e) => ({ title: T(e.school), subtitle: [T(e.major), T(e.degree)].filter(Boolean).join(sep), date: range(e.start, e.end), bullets: pickBullets(e.highlights) }));
  if (ed.length) sections.education = { key: 'education', title: title('education'), blocks: ed };
  const sk = byIds(p.skills, sel.skills);
  if (sk.length) {
    // 按分类分组
    const groups = new Map<string, string[]>();
    sk.forEach((s) => { const c = T(s.category); groups.set(c, [...(groups.get(c) ?? []), T(s.name)]); });
    sections.skills = { key: 'skills', title: title('skills'), blocks: [...groups].map(([c, names]) => ({ title: c || undefined, bullets: [], text: names.join(lang === 'zh' ? '、' : ', ') })) };
  }
  const simple = (k: 'certificates' | 'awards') => {
    const arr = byIds(p[k], sel[k]).map((e) => ({ title: T(e.name), subtitle: T(e.issuer), date: formatDate(e.date, loc.dateFormat, loc.presentLabel), bullets: [] }));
    if (arr.length) sections[k] = { key: k, title: title(k), blocks: arr };
  };
  simple('certificates'); simple('awards');

  const order = moduleOrderFor(tpl, lang);
  const side = tpl.layout.columns === 2 ? tpl.layout.sidebarModules : [];
  const main: LSection[] = [], sideS: LSection[] = [];
  order.forEach((k) => { const s = sections[k]; if (s) (side.includes(k) ? sideS : main).push(s); });

  const c = p.profile.contacts;
  const contacts = [c.phone, c.email, T(c.location), c.github, c.linkedin, c.website].filter((x): x is string => !!x && !!x.trim());
  const personal = loc.personalFields.map((f) => (p.profile.personal[f] ? `${PERSONAL_LABEL[lang][f]}: ${p.profile.personal[f]}` : '')).filter(Boolean);
  const photo = loc.photo.enabled && loc.photo.position !== 'none' && p.profile.photo
    ? { dataUrl: p.profile.photo, position: loc.photo.position, sizeMm: loc.photo.sizeMm } : null;

  return {
    lang, pageSize: tpl.page.size, marginMm: tpl.page.marginMm, columns: tpl.layout.columns, sidebarWidthPercent: tpl.layout.sidebarWidthPercent,
    headerStyle: tpl.layout.headerStyle, colors: tpl.colors, spacing: tpl.spacing, typography: loc.typography, photo,
    header: { name: T(p.profile.name), headline: T(p.profile.headline), contacts, personal },
    main, side: sideS,
  };
}

export const MM = 72 / 25.4; // pt per mm
