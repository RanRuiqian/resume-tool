import type { ResumeDB } from '../storage/db';
import type { JobParse, ProfileDoc, ResumeDoc, TemplateConfig } from '../types';
import type { SharedResumeVersion } from '../types/joint';
import type { ResumeArtifact } from '../tracker/types';
import { auditResume } from '../audit/factAudit';
import { profileForGeneration } from '../privacy/resume';
import { createApplication, newPosting, nowIso, sha256Hex, uid } from '../tracker/repo';
import { refreshReportSelection } from './report';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const content = (v: Pick<SharedResumeVersion, 'profile' | 'template' | 'resume' | 'job'>) => ({ profile: v.profile, template: v.template, resume: v.resume, job: v.job });
export const versionDigest = (v: Pick<SharedResumeVersion, 'profile' | 'template' | 'resume' | 'job'>) => sha256Hex(new TextEncoder().encode(canonicalJson(content(v))));
export async function verifySharedVersion(v: SharedResumeVersion): Promise<boolean> {
  try { return !!v && typeof v.digest === 'string' && /^[a-f0-9]{64}$/.test(v.digest) && v.id === `version-${v.digest}`
    && !!v.profile?.profile && Array.isArray(v.resume?.items) && v.resume.jobId === v.job?.id && !!v.template?.locales?.zh && !!v.template?.locales?.en
    && await versionDigest(v) === v.digest; } catch { return false; }
}

/** 由一次显式用户操作原子创建/复用共同版本及 1–3 条待投递关联，绝不伪造投递时间。 */
export async function linkJointApplications(d: ResumeDB, args: { profile: ProfileDoc; template: TemplateConfig; resume: ResumeDoc; job: JobParse }): Promise<{ versionId: string; applicationIds: string[]; postingIds: string[] }> {
  const { job, resume } = args;
  if (!job.joint || !job.joint.targets.length || job.joint.targets.length > 3 || resume.jobId !== job.id) throw new Error('当前共同简历与联合岗位版本不一致，请先检查或重新生成');
  if (new Set(job.joint.targets.map((t) => t.roleId)).size !== job.joint.targets.length) throw new Error('联合岗位重复，未关联');
  if (resume.consistency.issues.length) throw new Error('双语一致性尚有问题，请核对后再冻结共同版本');
  const au = auditResume(args.profile, resume).summary;
  if (au.unconfirmedRed) throw new Error('仍有未处理的高风险事实，请在事实审查中核对后再关联共同版本');
  const payload = { profile: profileForGeneration(args.profile), template: structuredClone(args.template), resume: { ...structuredClone(resume), evidenceReport: refreshReportSelection(resume) }, job: structuredClone(job) };
  const digest = await versionDigest(payload), id = `version-${digest}`;
  const candidate: SharedResumeVersion = { id, digest, createdAt: nowIso(), ...payload };
  return d.transaction('rw', [d.resumeVersions, d.postings, d.applications, d.appEvents, d.artifacts], async () => {
    const existing = await d.resumeVersions.get(id);
    if (existing && canonicalJson(content(existing)) !== canonicalJson(content(candidate))) throw new Error('共同版本内容冲突，未覆盖既有版本');
    if (!existing) await d.resumeVersions.add(candidate);
    const applicationIds: string[] = [], postingIds: string[] = [];
    for (const target of job.joint!.targets) {
      let posting = await d.postings.filter((p) => p.jointGroupId === job.joint!.groupId && p.jointRoleId === target.roleId).first();
      if (!posting) {
        posting = newPosting({ company: job.joint!.company, title: target.name, city: '', applyUrl: target.url, jdText: target.job.rawText, jobParseId: target.job.id,
          jointGroupId: job.joint!.groupId, jointRoleId: target.roleId, source: { kind: 'analysis', externalId: target.roleId } });
        await d.postings.add(posting);
      }
      let app = await d.applications.where('postingId').equals(posting.id).first();
      if (!app) app = await createApplication(d, posting.id, 'pending', '联合岗位共同简历关联：仅准备材料，尚未投递');
      await d.applications.put({ ...app, resumeVersionId: id, updatedAt: nowIso() });
      const linked = await d.artifacts.filter((a) => a.applicationId === app!.id && a.versionId === id).first();
      if (!linked) await d.artifacts.add({ id: uid('art'), applicationId: app.id, kind: 'snapshot', versionId: id, label: `${job.company.short} · 共用简历 ${id.slice(8, 20)}`, languages: ['zh', 'en'], createdAt: candidate.createdAt,
        resumeId: resume.id, resumeCreatedAt: resume.createdAt, templateId: args.template.id, submitted: false, audit: { checkedAt: candidate.createdAt, total: au.total, unconfirmed: au.unconfirmed, unconfirmedRed: au.unconfirmedRed } });
      applicationIds.push(app.id); postingIds.push(posting.id);
    }
    return { versionId: id, applicationIds, postingIds };
  });
}
export async function resolveArtifact(d: ResumeDB, art: ResumeArtifact) {
  if (!art.versionId) return { profile: art.profile, resume: art.resume, job: art.job, template: undefined as TemplateConfig | undefined };
  const v = await d.resumeVersions.get(art.versionId);
  if (!v || !await verifySharedVersion(v)) throw new Error('共用简历版本缺失或校验失败，请恢复含该版本的完整备份；不会用当前资料冒充历史版本');
  return { profile: v.profile, resume: v.resume, job: v.job, template: v.template };
}
