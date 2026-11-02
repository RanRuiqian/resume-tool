import type { Bi, JobParse, ProfileDoc, ResumeDoc, TemplateConfig } from './index';

export interface JointRole {
  id: string; name: string; text: string; url: string;
  screenshots: { url: string; raw: string }[];
  analyses: { jobId: string; revision: number; inputHash: string; at: string }[];
  analysisId?: string;
  companyConfirmed?: boolean;
}
export interface JointGroup {
  id: string; company: string; roles: JointRole[]; archivedRoles: JointRole[];
  createdAt: string; updatedAt: string;
}
export interface JointTarget { roleId: string; revision: number; name: string; url: string; job: JobParse }
export interface JointSet { groupId: string; company: string; targets: JointTarget[] }
export interface RequirementRef { id: string; jobId: string; text: Bi; tier: 'must' | 'responsibility' | 'preferred' }
export interface RequirementAssessment {
  requirementId?: string; text: string; tier: RequirementRef['tier'];
  assessment: 'direct' | 'transferable' | 'learning' | 'gap'; evidenceIds: string[]; reason?: string;
}
export interface JointSynthesis {
  common: { requirementIds: string[]; reason: string }[];
  complementary: { requirementIds: string[]; reason: string }[];
  conflicts: { requirementIds: string[]; reason: string }[];
}
export type EvidenceCategory = 'work' | 'project' | 'course' | 'education' | 'skill' | 'certificate' | 'award' | 'campus';
export interface EvidenceRef { id: string; category: EvidenceCategory; label: string; zh: string; en: string; level?: string; selected: boolean }
export interface EvidenceReport {
  createdAt: string; synthesis?: JointSynthesis;
  targets: { jobId: string; title: Bi; requirements: (RequirementAssessment & { evidence: EvidenceRef[]; risks: string[] })[] }[];
  selectionReasons: string[];
}
/** 内容寻址的不可变版本：三个申请持有同一个 ID，不复制三份不同简历。 */
export interface SharedResumeVersion {
  id: string; digest: string; createdAt: string;
  profile: ProfileDoc; template: TemplateConfig; resume: ResumeDoc; job: JobParse;
}
