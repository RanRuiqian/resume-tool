import type { JobParse, Lang, ProfileDoc, ResumeDoc } from '../types';

/** 第三阶段：求职投递管理的数据模型（详见 docs/DATA_SCHEMA.md） */
export const TRACKER_SCHEMA_VERSION = 1;

export type RecruitType = 'campus' | 'intern' | 'social';
export const RECRUIT_LABEL: Record<RecruitType, string> = { campus: '校招', intern: '实习', social: '社招' };
export type Priority = 1 | 2 | 3;
export const PRIORITY_LABEL: Record<Priority, string> = { 1: '高', 2: '中', 3: '低' };

/** 投递状态（顺序即 UI 顺序） */
export const APP_STATUSES = ['screening', 'saved', 'preparing', 'applied', 'assessment', 'interviewing', 'offer', 'rejected', 'withdrawn', 'closed'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];
export const STATUS_LABEL: Record<AppStatus, string> = {
  screening: '待筛选', saved: '已收藏', preparing: '准备材料', applied: '已投递', assessment: '在线测评 / 笔试',
  interviewing: '面试中', offer: 'Offer', rejected: '已拒绝 / 未通过', withdrawn: '已撤回', closed: '已结束',
};
export const STATUS_LABEL_EN: Record<AppStatus, string> = {
  screening: 'To screen', saved: 'Saved', preparing: 'Preparing', applied: 'Applied', assessment: 'Assessment / test',
  interviewing: 'Interviewing', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn', closed: 'Closed',
};

/** 来源信息：导入时保留原始来源与时间，便于追溯与幂等去重 */
export interface SourceInfo { kind: 'manual' | 'csv' | 'json' | 'ran-application-handoff' | 'archive'; fileName?: string; importedAt?: string; rowKey?: string; raw?: Record<string, unknown> }

/** 一个招聘岗位（只是岗位，不代表已申请） */
export interface JobPosting {
  id: string;
  company: string; title: string; city: string;
  companyType?: string; category?: string; recruitType?: RecruitType;
  sourcePlatform?: string; applyUrl?: string; officialUrl?: string; programYear?: string;
  publishedAt?: string; deadline?: string;
  description?: string; jdText?: string; requirements?: string; salary?: string;
  priority: Priority; notes?: string;
  /** 已解析的 JD（复用第一阶段 JobParse），可选 */
  jobParseId?: string;
  source: SourceInfo;
  /** 导入幂等键：同一来源记录再次导入时识别为重复（可多条：合并时追加） */
  importKeys?: string[];
  createdAt: string; updatedAt: string;
}

export interface TodoItem { id: string; text: string; due?: string; done: boolean; createdAt: string }
export interface InterviewItem { id: string; at: string; round: string; mode?: string; notes?: string; createdAt: string }

/** 针对某个岗位的一次具体申请；状态变化写入 ApplicationEvent */
export interface Application {
  id: string; postingId: string;
  status: AppStatus;
  appliedAt?: string;
  result?: string; notes?: string;
  todos: TodoItem[]; interviews: InterviewItem[];
  source: SourceInfo;
  createdAt: string; updatedAt: string;
}

/** 状态历史：只追加，不覆盖 */
export interface ApplicationEvent {
  id: string; applicationId: string;
  from: AppStatus | null; to: AppStatus;
  at: string; note?: string;
  /** 记录方式：手动 / 导入（导入时 at 可能来自原始数据） */
  by: 'user' | 'import';
}

/** 投递时实际使用的简历版本：不可变快照，后续修改资料或重新生成都不会影响 */
export interface ResumeArtifact {
  id: string; applicationId: string;
  kind: 'snapshot' | 'uploaded';
  label: string;
  languages: Lang[];
  createdAt: string;
  /** kind=snapshot：生成时的简历与资料（深拷贝，只读） */
  resumeId?: string; resumeCreatedAt?: string; templateId?: string;
  resume?: ResumeDoc; profile?: ProfileDoc; job?: JobParse | null;
  audit?: { checkedAt: string; total: number; unconfirmed: number; unconfirmedRed: number };
  /** kind=uploaded：对应附件 */
  attachmentId?: string;
  /** 是否为实际提交版本 */
  submitted: boolean;
}

export type AttachmentKind = 'resume-submitted' | 'jd-screenshot' | 'apply-proof' | 'assessment' | 'interview' | 'offer' | 'other';
export const ATTACH_KIND_LABEL: Record<AttachmentKind, string> = {
  'resume-submitted': '实际提交的简历', 'jd-screenshot': 'JD 截图', 'apply-proof': '投递成功截图', assessment: '笔试 / 测评通知',
  interview: '面试通知', offer: '录用通知', other: '其他材料',
};
/** 附件元数据（二进制在 attachmentBlobs 表中，按 id 对应） */
export interface Attachment {
  id: string; postingId?: string; applicationId?: string;
  kind: AttachmentKind;
  name: string; mime: string; size: number; sha256: string;
  uploadedAt: string; note?: string;
}
export interface AttachmentBlob { id: string; data: Uint8Array }
