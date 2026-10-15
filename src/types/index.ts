export type Lang = 'zh' | 'en';
export const LANGS: Lang[] = ['zh', 'en'];
export type TransStatus = 'manual' | 'machine' | 'confirmed' | 'stale';

/** 双语字段（PRD 5.1） */
export interface LocalizedText {
  id?: string;
  zh?: string;
  en?: string;
  source?: Lang;
  status?: Partial<Record<Lang, TransStatus>>;
  /** 生成译文时的原文快照，用于检测"过期" */
  srcSnapshot?: string;
}

export interface GlossaryEntry { zh: string; en: string }

export interface Contacts {
  email?: string;
  phone?: string;
  location?: LocalizedText;
  github?: string;
  linkedin?: string;
  website?: string;
}

export interface PersonalInfo { birth?: string; gender?: string; hometown?: string; politics?: string }

export interface BaseEntry { id: string; enabled: boolean }

export interface EducationEntry extends BaseEntry {
  school: LocalizedText; degree: LocalizedText; major: LocalizedText;
  start: string; end: string; highlights: LocalizedText[];
}
export interface WorkEntry extends BaseEntry {
  company: LocalizedText; title: LocalizedText; start: string; end: string;
  bullets: LocalizedText[]; tags: string[];
}
export interface ProjectEntry extends BaseEntry {
  name: LocalizedText; role: LocalizedText; start: string; end: string;
  bullets: LocalizedText[]; tags: string[]; link?: string;
}
export interface SkillEntry extends BaseEntry { name: LocalizedText; level?: string; category?: LocalizedText }
export interface SimpleEntry extends BaseEntry { name: LocalizedText; issuer: LocalizedText; date: string }

export interface ProfileDoc {
  version: string;
  primaryLanguage: Lang;
  glossary: GlossaryEntry[];
  profile: {
    name: LocalizedText; headline: LocalizedText; summary: LocalizedText;
    photo?: string; // data URL
    contacts: Contacts;
    personal: PersonalInfo;
  };
  education: EducationEntry[];
  work: WorkEntry[];
  projects: ProjectEntry[];
  skills: SkillEntry[];
  certificates: SimpleEntry[];
  awards: SimpleEntry[];
}

export type ModuleKey = 'summary' | 'work' | 'projects' | 'education' | 'skills' | 'certificates' | 'awards';
export const MODULE_KEYS: ModuleKey[] = ['summary', 'work', 'projects', 'education', 'skills', 'certificates', 'awards'];

export type PhotoPosition = 'left' | 'right' | 'none';
export interface Typography { fontFamily: string; nameSizePt: number; bodySizePt: number; lineHeight: number }
export interface TemplateLocale {
  sectionTitles: Record<ModuleKey, string>;
  dateFormat: 'YYYY.MM' | 'MMM YYYY' | 'YYYY-MM' | 'MM/YYYY';
  presentLabel: string;
  typography: Typography;
  photo: { enabled: boolean; position: PhotoPosition; sizeMm: number };
  personalFields: (keyof PersonalInfo)[];
  moduleOrderOverride: ModuleKey[] | null;
}
export interface TemplateConfig {
  id: string;
  name: { zh: string; en: string };
  version: string;
  builtin?: boolean;
  page: { size: 'A4' | 'LETTER'; marginMm: { top: number; right: number; bottom: number; left: number }; targetPages: number; autoFit?: boolean };
  layout: { columns: 1 | 2; sidebarWidthPercent: number; sidebarModules: ModuleKey[]; headerStyle: 'band' | 'plain' };
  moduleOrder: ModuleKey[];
  colors: { primary: string; text: string; muted: string; accent: string };
  spacing: { sectionGapMm: number; itemGapMm: number };
  locales: Record<Lang, TemplateLocale>;
}

export interface Bi { zh: string; en: string }
export interface JobParse {
  id: string;
  createdAt: string;
  rawText: string;
  jdLanguage: Lang;
  company: { full: string; short: string };
  roleAbbr: string;
  title: Bi;
  mustHave: Bi[];
  niceToHave: Bi[];
  yearsRequired: number | null;
  keywords: Bi[];
  summary: string;
}

export interface GenItem { sourceId: string; zh: string; en: string; syncStatus: 'in-sync' | 'pending' }
export interface ConsistencyIssue { sourceId?: string; type: 'missing' | 'extra' | 'number' | 'empty' | 'count'; message: string }
export interface ResumeDoc {
  id: string;
  jobId: string;
  templateId: string;
  primaryLanguage: Lang;
  createdAt: string;
  matchScore: number;
  gaps: string[];
  /** 选中的资料库条目 id（按顺序） */
  selection: Record<Exclude<ModuleKey, 'summary'>, string[]>;
  /** 改写后的条目：summary / bullet / highlight，按 sourceId 对应资料库 */
  items: GenItem[];
  consistency: { checkedAt: string; issues: ConsistencyIssue[] };
  generatedBy: 'ai' | 'rules';
  notes?: string[];
}

export interface ExportRecord {
  id: string; resumeId: string; company: string; roleAbbr: string; date: string; seq: number;
  zipName: string; files: string[]; exportedAt: string;
}

export interface Settings {
  id: 'settings';
  demoMode: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
  translateModel: string;
  uiLang: Lang;
  provider: 'deepseek' | 'openai' | 'qwen' | 'custom';
  ocrMode: 'local' | 'vision';
  setupDone: boolean;
}
