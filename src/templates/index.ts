import { FEATURES } from '../features';
import type { TemplateConfig, TemplateLocale, ModuleKey } from '../types';

const zhTitles: Record<ModuleKey, string> = { summary: '个人简介', work: '工作经历', projects: '项目经历', education: '教育背景', skills: '专业技能', campus: '校园经历', certificates: '证书', awards: '获奖' };
const enTitles: Record<ModuleKey, string> = { summary: 'Summary', work: 'Experience', projects: 'Projects', education: 'Education', skills: 'Skills', campus: 'Leadership & Activities', certificates: 'Certifications', awards: 'Awards' };

const zh = (o: Partial<TemplateLocale> = {}): TemplateLocale => ({
  sectionTitles: zhTitles, dateFormat: 'YYYY.MM', presentLabel: '至今',
  typography: { fontFamily: 'Noto Sans SC', nameSizePt: 20, bodySizePt: 10, lineHeight: 1.45 },
  photo: { enabled: true, position: 'right', sizeMm: 28 }, personalFields: [], moduleOrderOverride: null, ...o,
});
const en = (o: Partial<TemplateLocale> = {}): TemplateLocale => ({
  sectionTitles: enTitles, dateFormat: 'MMM YYYY', presentLabel: 'Present',
  typography: { fontFamily: 'Helvetica', nameSizePt: 20, bodySizePt: 10, lineHeight: 1.3 },
  photo: { enabled: false, position: 'none', sizeMm: 28 }, personalFields: [],
  moduleOrderOverride: ['summary', 'work', 'education', 'projects', 'skills', 'certificates', 'awards'], ...o,
});

export const BUILTIN_TEMPLATES: TemplateConfig[] = [
  {
    id: 'tpl-classic', name: { zh: '经典单栏', en: 'Classic' }, version: '1.2', builtin: true,
    page: { size: 'A4', marginMm: { top: 14, right: 16, bottom: 14, left: 16 }, targetPages: 1 },
    layout: { columns: 1, sidebarWidthPercent: 30, sidebarModules: [], headerStyle: 'plain' },
    moduleOrder: ['summary', 'education', 'work', 'projects', 'skills', 'certificates', 'awards'],
    colors: { primary: '#1a365d', text: '#1a202c', muted: '#5a6575', accent: '#2b6cb0' },
    spacing: { sectionGapMm: 4, itemGapMm: 2.5 },
    locales: { zh: zh(), en: en() },
  },
  {
    id: 'tpl-modern-two-col', name: { zh: '现代双栏', en: 'Modern Two Column' }, version: '1.2', builtin: true,
    page: { size: 'A4', marginMm: { top: 12, right: 12, bottom: 12, left: 12 }, targetPages: 2 },
    layout: { columns: 2, sidebarWidthPercent: 32, sidebarModules: ['education', 'skills', 'certificates', 'awards'], headerStyle: 'band' },
    moduleOrder: ['summary', 'work', 'projects', 'education', 'skills', 'certificates', 'awards'],
    colors: { primary: '#0f4c5c', text: '#1f2933', muted: '#62707d', accent: '#e36414' },
    spacing: { sectionGapMm: 4, itemGapMm: 2.5 },
    locales: { zh: zh({ photo: { enabled: true, position: 'left', sizeMm: 30 } }), en: en() },
  },
  {
    id: 'tpl-compact', name: { zh: '紧凑一页', en: 'Compact One Page' }, version: '1.2', builtin: true,
    page: { size: 'A4', marginMm: { top: 10, right: 12, bottom: 10, left: 12 }, targetPages: 1 },
    layout: { columns: 1, sidebarWidthPercent: 30, sidebarModules: [], headerStyle: 'band' },
    moduleOrder: ['summary', 'work', 'projects', 'education', 'skills', 'certificates', 'awards'],
    colors: { primary: '#3c096c', text: '#222222', muted: '#666666', accent: '#7b2cbf' },
    spacing: { sectionGapMm: 3, itemGapMm: 1.5 },
    locales: {
      zh: zh({ typography: { fontFamily: 'Noto Sans SC', nameSizePt: 18, bodySizePt: 9.5, lineHeight: 1.35 } }),
      en: en({ typography: { fontFamily: 'Times-Roman', nameSizePt: 18, bodySizePt: 10, lineHeight: 1.25 } }),
    },
  },
];

/** 额外模板（FEATURES.extraTemplates 控制） */
export const EXTRA_TEMPLATES: TemplateConfig[] = [
  {
    id: 'tpl-elegant', name: { zh: '简约居中', en: 'Elegant Centered' }, version: '1.2', builtin: true,
    page: { size: 'A4', marginMm: { top: 14, right: 18, bottom: 14, left: 18 }, targetPages: 1 },
    layout: { columns: 1, sidebarWidthPercent: 30, sidebarModules: [], headerStyle: 'plain', titleStyle: 'bar', headerAlign: 'center' },
    moduleOrder: ['summary', 'education', 'work', 'projects', 'skills', 'certificates', 'awards'],
    colors: { primary: '#2d3748', text: '#1a202c', muted: '#6b7280', accent: '#b7791f' },
    spacing: { sectionGapMm: 4, itemGapMm: 2.2 },
    locales: { zh: zh({ photo: { enabled: false, position: 'none', sizeMm: 28 } }), en: en({ typography: { fontFamily: 'Times-Roman', nameSizePt: 22, bodySizePt: 10.5, lineHeight: 1.3 } }) },
  },
  {
    id: 'tpl-business', name: { zh: '商务色块', en: 'Business Blocks' }, version: '1.2', builtin: true,
    page: { size: 'A4', marginMm: { top: 12, right: 14, bottom: 12, left: 14 }, targetPages: 1 },
    layout: { columns: 1, sidebarWidthPercent: 30, sidebarModules: [], headerStyle: 'band', titleStyle: 'band', headerAlign: 'left' },
    moduleOrder: ['summary', 'work', 'projects', 'education', 'skills', 'certificates', 'awards'],
    colors: { primary: '#1e3a5f', text: '#1f2933', muted: '#5f6b7a', accent: '#c05621' },
    spacing: { sectionGapMm: 3.5, itemGapMm: 2 },
    locales: { zh: zh(), en: en() },
  },
];

/* ---------------- v1.7 工科正式版（Engineering Classic） ----------------
 * 两个模板 × 中英文两个语言变体 = 4 套正式预设，全部走 buildLayout → Preview / ResumePdf / resumeDocx 同一条渲染路径。
 * 中英文不是互译：标题、模块顺序、日期格式、字号与密度分别设定。 */
const ENG_COLORS = { primary: '#111111', text: '#1a1a1a', muted: '#4a4a4a', accent: '#333333' };
const engZhTitles: Record<ModuleKey, string> = { summary: '个人简介', education: '教育背景', projects: '项目经历', work: '实习 / 工作经历', skills: '专业技能', campus: '校园经历', certificates: '证书及奖项', awards: '证书及奖项' };
const engEnTitles: Record<ModuleKey, string> = { summary: 'SUMMARY', education: 'EDUCATION', projects: 'PROJECT EXPERIENCE', work: 'PROFESSIONAL EXPERIENCE', skills: 'TECHNICAL SKILLS', campus: 'LEADERSHIP & ACTIVITIES', certificates: 'CERTIFICATIONS AND AWARDS', awards: 'CERTIFICATIONS AND AWARDS' };
export const ENG_ZH_ORDER: ModuleKey[] = ['summary', 'education', 'projects', 'work', 'skills', 'campus', 'certificates', 'awards'];
export const ENG_EN_ORDER: ModuleKey[] = ['summary', 'education', 'projects', 'work', 'skills', 'campus', 'certificates', 'awards'];
const engZh = (photo: boolean): TemplateLocale => ({
  sectionTitles: engZhTitles, dateFormat: 'YYYY.MM', presentLabel: '至今',
  typography: { fontFamily: 'Noto Sans SC', nameSizePt: 20, bodySizePt: 10, lineHeight: 1.42 },
  photo: photo ? { enabled: true, position: 'right', sizeMm: 28 } : { enabled: false, position: 'none', sizeMm: 28 },
  personalFields: [], moduleOrderOverride: null,
});
const engEn = (photo: boolean): TemplateLocale => ({
  sectionTitles: engEnTitles, dateFormat: 'MMM YYYY', presentLabel: 'Present',
  typography: { fontFamily: 'Arimo', nameSizePt: 19, bodySizePt: 10, lineHeight: 1.3 },
  photo: photo ? { enabled: true, position: 'right', sizeMm: 26 } : { enabled: false, position: 'none', sizeMm: 26 },
  personalFields: [], moduleOrderOverride: ENG_EN_ORDER,
});
const eng = (id: string, photo: boolean): TemplateConfig => ({
  id, name: photo ? { zh: '工科正式版 · 有照片', en: 'Engineering Classic · With Photo' } : { zh: '工科正式版 · 无照片', en: 'Engineering Classic · No Photo' },
  version: '1.7', builtin: true,
  page: { size: 'A4', marginMm: { top: 15, right: 16, bottom: 15, left: 16 }, targetPages: 1, minBodyPt: 9.5 },
  layout: { columns: 1, sidebarWidthPercent: 30, sidebarModules: [], headerStyle: 'plain', titleStyle: 'rule', headerAlign: 'left', style: 'engineering' },
  moduleOrder: ENG_ZH_ORDER, colors: ENG_COLORS, spacing: { sectionGapMm: 3.6, itemGapMm: 2 },
  locales: { zh: engZh(photo), en: engEn(photo) },
});
export const ENGINEERING_TEMPLATES: TemplateConfig[] = [eng('tpl-eng', false), eng('tpl-eng-photo', true)];
export const ENG_DEFAULT_ID = 'tpl-eng';

/** 4 套正式预设 = 模板 + 语言。照片版仅面向明确要求照片的单位 */
export interface FormalPreset { id: string; templateId: string; lang: 'zh' | 'en'; photo: boolean; label: string; note: string; recommended: boolean }
export const FORMAL_PRESETS: FormalPreset[] = [
  { id: 'cn-eng', templateId: 'tpl-eng', lang: 'zh', photo: false, label: 'CN 工科正式版 · 无照片', note: '国内网申推荐', recommended: true },
  { id: 'cn-eng-photo', templateId: 'tpl-eng-photo', lang: 'zh', photo: true, label: 'CN 工科正式版 · 有照片', note: '用于明确要求照片的单位', recommended: false },
  { id: 'en-eng', templateId: 'tpl-eng', lang: 'en', photo: false, label: 'EN Engineering Classic · No Photo', note: 'Recommended for online applications', recommended: true },
  { id: 'en-eng-photo', templateId: 'tpl-eng-photo', lang: 'en', photo: true, label: 'EN Engineering Classic · With Photo', note: 'Only for employers that require a photo', recommended: false },
];
/** 模板（含其自定义副本）对应的工科基础模板 id */
export function engineeringBaseOf(t: TemplateConfig | undefined): 'tpl-eng' | 'tpl-eng-photo' | null {
  if (!t) return null;
  if (t.id === 'tpl-eng' || t.id.startsWith('tpl-eng-custom')) return 'tpl-eng';
  if (t.id === 'tpl-eng-photo' || t.id.startsWith('tpl-eng-photo-custom')) return 'tpl-eng-photo';
  return null;
}

export const ALL_TEMPLATES: TemplateConfig[] = [...ENGINEERING_TEMPLATES, ...BUILTIN_TEMPLATES, ...(FEATURES.extraTemplates ? EXTRA_TEMPLATES : [])];

export const FONT_OPTIONS = ['Noto Sans SC', 'Arimo', 'Helvetica', 'Times-Roman'];
export const defaultTemplate = BUILTIN_TEMPLATES[0];

/** 首次启动时的模板：全新用户 → 工科正式版；已有资料的老用户（未保存过选择，旧版默认经典单栏）→ 保持经典单栏，不强制改样式 */
export function initialTemplateId(saved: string | undefined, hasExistingProfile: boolean): string {
  if (saved) return saved;
  return hasExistingProfile ? BUILTIN_TEMPLATES[0].id : ENG_DEFAULT_ID;
}

/** 旧模板 JSON 兼容：补齐 v1.7 新字段的缺省值（不改变旧模板的渲染结果） */
export function normalizeTemplate(t: TemplateConfig): TemplateConfig {
  const n = structuredClone(t);
  n.layout = { ...n.layout, titleStyle: n.layout.titleStyle ?? 'underline', headerAlign: n.layout.headerAlign ?? 'left', style: n.layout.style ?? 'default' };
  (['zh', 'en'] as const).forEach((l) => {
    const loc = n.locales?.[l];
    if (!loc) return;
    loc.sectionTitles = { ...(l === 'zh' ? zhTitles : enTitles), ...loc.sectionTitles };
    loc.personalFields = loc.personalFields ?? [];
    loc.moduleOrderOverride = loc.moduleOrderOverride ?? null;
    // v1.8：v1.7 工科英文顺序没有 campus，社团经历会混进 PROFESSIONAL EXPERIENCE；补到证书前
    const ord = loc.moduleOrderOverride;
    if (n.layout.style === 'engineering' && ord && !ord.includes('campus')) {
      const i = ord.indexOf('certificates');
      ord.splice(i < 0 ? ord.length : i, 0, 'campus');
    }
  });
  return n;
}
