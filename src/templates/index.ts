import { FEATURES } from '../features';
import type { TemplateConfig, TemplateLocale, ModuleKey } from '../types';

const zhTitles: Record<ModuleKey, string> = { summary: '个人简介', work: '工作经历', projects: '项目经历', education: '教育背景', skills: '专业技能', certificates: '证书', awards: '获奖' };
const enTitles: Record<ModuleKey, string> = { summary: 'Summary', work: 'Experience', projects: 'Projects', education: 'Education', skills: 'Skills', certificates: 'Certifications', awards: 'Awards' };

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

export const ALL_TEMPLATES: TemplateConfig[] = [...BUILTIN_TEMPLATES, ...(FEATURES.extraTemplates ? EXTRA_TEMPLATES : [])];

export const FONT_OPTIONS = ['Noto Sans SC', 'Helvetica', 'Times-Roman'];
export const defaultTemplate = BUILTIN_TEMPLATES[0];
