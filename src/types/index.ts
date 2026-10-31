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

export interface BaseEntry {
  id: string; enabled: boolean;
  /** 智能导入时 AI 不确定的地方，需人工核对（v1.3） */
  uncertain?: string[];
  /** 相关但独立的条目（同公司其它职位 / 同项目其它阶段）（v1.4） */
  relatedIds?: string[];
  /** 智能导入新增时的来源记录（v1.4） */
  importedFrom?: { importTag: string; incomingId: string; at: string };
  /** 智能导入合并记录：被合并内容快照、覆盖字段、追加要点 id（v1.4） */
  /** 用户在资料库中确认「这条 AI 导入 / 合并的内容属实」的时间；早于最近一次导入则视为未确认（v1.5） */
  userConfirmedAt?: string;
  /** 同一条记录的其它称呼（另一语言写法、论文题目、简称等），用于去重与检索，不直接打印（v1.6） */
  aliases?: string[];
  /** 原文中的备注 / 待核实 / 证据说明：只作内部素材，不进入简历正文（v1.6） */
  notes?: string[];
  mergeHistory?: { at: string; importTag: string; incomingId: string; incomingTitle: string; fieldsOverwritten: { field: string; old: string; new: string }[]; pointsAdded: string[]; incomingSnapshot: string }[];
}

/** 学位证明状态 */
export type DegreeProofStatus = '' | 'not-yet' | 'pending' | 'issued' | 'n/a';
/** 实际掌握程度：用户自填，绝不根据专业名称推断；'' = 未填写 */
export type Proficiency = '' | 'aware' | 'used' | 'proficient' | 'expert';

/** 项目阶段（v1.3） */
export interface ProjectPhase { id: string; name: string; start?: string; end?: string; work?: string; outcome?: string }
/** 失败方案与原因 */
export interface FailedAttempt { id: string; approach: string; reason: string }
/** 项目详细档案：原始素材，只用于积累与追溯，不直接打印到简历（v1.3） */
export interface ProjectDossier {
  background?: string; need?: string; responsibility?: string; technicalWork?: string;
  /** 软件 / 硬件 / 工具 */
  tools?: string[];
  problems?: string; failedAttempts?: FailedAttempt[]; solution?: string; methods?: string;
  quantResults?: string; finalOutcome?: string; keywords?: string[]; publications?: string;
  phases?: ProjectPhase[];
}

export type EvidenceType = 'paper' | 'patent' | 'certificate' | 'transcript' | 'code' | 'report' | 'photo' | 'video' | 'award' | 'other';
/** 证据：只记录"在哪里、证明什么"。本地路径仅作位置说明，程序不会读取或上传该文件（v1.3） */
export interface Evidence {
  id: string;
  fileName: string;
  type: EvidenceType;
  /** 网址，或本地位置说明（如 "D:/证书/xx.pdf"、"导师邮箱里"） */
  location: string;
  /** 'url' 可点击打开；'note' 只是文字说明 */
  locationKind: 'url' | 'note';
  projectIds: string[];
  skillIds: string[];
  /** 这份证据证明了什么具体事实 */
  proves: string;
  /** 用户已人工核对 */
  confirmed: boolean;
  /** 可以对外展示（如附在作品集里） */
  publicOk: boolean;
  note?: string;
}

export interface EducationEntry extends BaseEntry {
  school: LocalizedText; degree: LocalizedText; major: LocalizedText;
  start: string; end: string; highlights: LocalizedText[];
  /** 以下日期分别保存，不能合并为"毕业日期"（v1.3，YYYY-MM 或 YYYY-MM-DD） */
  courseCompletionDate?: string;
  expectedConferralDate?: string;
  actualConferralDate?: string;
  availableFullTimeDate?: string;
  degreeProofStatus?: DegreeProofStatus;
  /** 相关课程（每门一项） */
  courses?: string[];
  /** 智能导入时 AI 报告的原文课程数，用于检查课程是否被漏掉（v1.6） */
  coursesInText?: number;
  /** 通过学习获得的专业能力（自填，仅作素材） */
  abilities?: string;
}
/** 经历类型（v1.6）：正式工作、实习、兼职、社团任职、志愿服务等，便于按岗位挑选；未填 = 未区分 */
export type WorkKind = '' | 'fulltime' | 'internship' | 'parttime' | 'club' | 'volunteer' | 'other';
export const WORK_KIND_LABEL: Record<WorkKind, string> = { '': '未区分', fulltime: '正式工作', internship: '实习', parttime: '兼职', club: '社团 / 学生工作', volunteer: '志愿服务', other: '其它经历' };
export interface WorkEntry extends BaseEntry {
  company: LocalizedText; title: LocalizedText; start: string; end: string;
  bullets: LocalizedText[]; tags: string[];
  kind?: WorkKind;
}
/** 项目性质（v1.6）：core = 核心研究 / 毕业设计 / 主要项目；auxiliary = 课程实验、教学实训、个人小工具等辅助项目 */
export type ProjectKind = '' | 'core' | 'auxiliary';
export interface ProjectEntry extends BaseEntry {
  name: LocalizedText; role: LocalizedText; start: string; end: string;
  bullets: LocalizedText[]; tags: string[]; link?: string;
  /** 详细档案；简历用的表述仍是 bullets（v1.3） */
  dossier?: ProjectDossier;
  evidenceIds?: string[];
  kind?: ProjectKind;
  /** 项目性质说明，如「课程实验」「教学实训」「本科毕业设计」（原文写出时才填） */
  nature?: string;
}
export interface SkillEntry extends BaseEntry {
  name: LocalizedText; level?: string; category?: LocalizedText;
  /** v1.3 技能档案 */
  proficiency?: Proficiency;
  /** 用过这项技能的项目 / 工作条目 id */
  usedIn?: string[];
  scenarios?: string;
  evidenceIds?: string[];
  /** 最近使用时间 YYYY-MM */
  lastUsed?: string;
}
export interface SimpleEntry extends BaseEntry { name: LocalizedText; issuer: LocalizedText; date: string }

export interface ProfileDoc {
  version: string;
  primaryLanguage: Lang;
  glossary: GlossaryEntry[];
  profile: {
    name: LocalizedText; headline: LocalizedText; summary: LocalizedText;
    photo?: string; // data URL
    /** 照片宽高比（宽/高），裁剪时写入；默认 0.75 */
    photoAspect?: number;
    contacts: Contacts;
    personal: PersonalInfo;
  };
  education: EducationEntry[];
  work: WorkEntry[];
  projects: ProjectEntry[];
  skills: SkillEntry[];
  certificates: SimpleEntry[];
  awards: SimpleEntry[];
  /** v1.3 证据库 */
  evidence: Evidence[];
  /** v1.6 智能导入的完整原始文本（母库原件），可检索；不参与简历生成 */
  sourceTexts?: SourceText[];
}
export interface SourceText { id: string; at: string; files: string[]; text: string }

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
  layout: { columns: 1 | 2; sidebarWidthPercent: number; sidebarModules: ModuleKey[]; headerStyle: 'band' | 'plain'; titleStyle?: 'underline' | 'bar' | 'band'; headerAlign?: 'left' | 'center' };
  moduleOrder: ModuleKey[];
  colors: { primary: string; text: string; muted: string; accent: string };
  spacing: { sectionGapMm: number; itemGapMm: number };
  locales: Record<Lang, TemplateLocale>;
}

export interface Bi { zh: string; en: string }
/** 备考大方向：每条必须引用 JD 原文 */
export interface PrepDirection { area: Bi; why: Bi; source: string }
export interface JobParse {
  id: string;
  /** 原始岗位截图（data URL，仅存本机） */
  screenshots?: string[];
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

/** needs-review：副版本未通过数字 / 事实一致性校验，需要人工核对（A2） */
export type SyncStatus = 'in-sync' | 'pending' | 'needs-review';
export interface TranslationCheck {
  /** 副版本来自：ai 新译文 / 已确认的历史译文 / 资料库译文 / 无 */
  source: 'ai' | 'confirmed' | 'profile' | 'none';
  /** AI 原始译文（未通过校验时保留，便于人工核对） */
  aiText?: string;
  /** 事实差异（数字、百分比、单位、日期、金额）；为空表示只是措辞变化 */
  factIssues: string[];
  checkedAt: string;
}
export interface GenItem {
  sourceId: string; zh: string; en: string; syncStatus: SyncStatus;
  translation?: TranslationCheck;
  /** 用户人工确认过的语言版本：重新本地化时优先保留（B6） */
  confirmedLangs?: Lang[];
}
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
  /** 求职信 / 自我介绍 / 面试准备（可选功能） */
  extras?: { coverLetter?: Bi; selfIntro?: Bi; prep?: PrepDirection[] };
  /** 事实审查记录（v1.4，第二阶段）：逐条逐语言的接受 / 恢复 / 编辑；不影响资料库 */
  audit?: { decisions: Record<string, Partial<Record<Lang, { decision: 'pending' | 'accepted' | 'restored' | 'edited'; at: string; aiText: string; editedText?: string; recheck?: boolean; recheckReason?: string; riskAck?: { at: string; statement: string; evidenceIds: string[]; note?: string } }>>>; updatedAt: string };
}

export interface ExportRecord {
  id: string; resumeId: string; company: string; roleAbbr: string; date: string; seq: number;
  zipName: string; files: string[]; exportedAt: string;
  /** 投递记录用：生成文件本体（仅存本机 IndexedDB） */
  jobId?: string; zip?: Uint8Array; blobs?: Record<string, Uint8Array>;
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
  /** 多 API 配置（v1，存于同一条 settings 记录，无数据库结构变更）。上面的 baseUrl/apiKey/model 等平铺字段始终 = 当前启用配置的副本，供所有 AI 调用读取 */
  apiProfiles?: ApiProfile[];
  /** 当前启用的配置 id；null = 尚未配置 / 已删除当前配置且未选择新配置 */
  activeProfileId?: string | null;
}

export type ApiProvider = 'deepseek' | 'openai' | 'qwen' | 'custom';
/** 一套已保存的 AI API 配置（Key 仅保存在本浏览器 IndexedDB） */
export interface ApiProfile {
  id: string;
  name: string;
  provider: ApiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  translateModel: string;
  visionModel: string;
  createdAt: string;
  updatedAt: string;
}
