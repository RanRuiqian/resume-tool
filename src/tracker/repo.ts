import type { ResumeDB } from '../storage/db';
import type { JobParse, Lang, ProfileDoc, ResumeDoc } from '../types';
import { auditResume } from '../audit/factAudit';
import { profileForGeneration } from '../privacy/resume';
import type { Application, AppStatus, ApplicationEvent, Attachment, AttachmentKind, JobPosting, Priority, ResumeArtifact, SourceInfo } from './types';

export const nowIso = () => new Date().toISOString();
/** 稳定唯一 ID：前缀 + 时间 + 随机；导入 / 恢复时保持原 ID 不变 */
let uidSeq = 0;
/** 生成 ID：时间 + 本次会话递增序号 + 随机串。同一毫秒内生成的 ID 也按创建顺序排序（状态历史排序依赖它） */
export function uid(prefix: string): string {
  uidSeq = (uidSeq + 1) % 1679616;
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${uidSeq.toString(36).padStart(4, '0')}${r}`;
}

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[\s·・,，.。()（）\-_/|]+/g, '').replace(/(有限公司|股份有限公司|集团|公司|co\.?ltd|inc|ltd|limited)$/g, '');
export function normUrl(u?: string): string {
  if (!u) return '';
  try { const x = new URL(u.trim()); x.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign', 'from', 'spm'].forEach((k) => x.searchParams.delete(k)); return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + (x.search || '')).toLowerCase(); }
  catch { return u.trim().toLowerCase(); }
}
/** 岗位去重键：公司 + 岗位 + 城市（规范化后） */
export const postingKey = (p: Pick<JobPosting, 'company' | 'title' | 'city'>) => `${norm(p.company)}|${norm(p.title)}|${norm(p.city)}`;

export interface DuplicateHit { posting: JobPosting; reason: 'url' | 'same-key' | 'similar' }
/** 检测可能重复的岗位：相同投递链接、相同公司+岗位+城市，或同公司同岗位不同城市（相似） */
export function findDuplicates(all: JobPosting[], c: Partial<JobPosting>, excludeId?: string): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  const u = normUrl(c.applyUrl), k = postingKey({ company: c.company ?? '', title: c.title ?? '', city: c.city ?? '' });
  for (const p of all) {
    if (p.id === excludeId) continue;
    if (u && normUrl(p.applyUrl) === u) hits.push({ posting: p, reason: 'url' });
    else if (norm(c.company) && norm(c.title) && postingKey(p) === k) hits.push({ posting: p, reason: 'same-key' });
    else if (norm(c.company) && norm(p.company) === norm(c.company) && norm(p.title) === norm(c.title)) hits.push({ posting: p, reason: 'similar' });
  }
  return hits;
}

export type PostingInput = Omit<JobPosting, 'id' | 'createdAt' | 'updatedAt' | 'source' | 'priority'> & { priority?: Priority; source?: SourceInfo };
export function newPosting(input: PostingInput, at = nowIso()): JobPosting {
  return { priority: 2, ...input, company: input.company.trim(), title: input.title.trim(), city: (input.city ?? '').trim(), id: uid('job'), source: input.source ?? { kind: 'manual' }, createdAt: at, updatedAt: at };
}
export function newApplication(postingId: string, status: AppStatus, source: SourceInfo = { kind: 'manual' }, at = nowIso()): Application {
  return { id: uid('app'), postingId, status, todos: [], interviews: [], source, createdAt: at, updatedAt: at, ...(status === 'applied' ? { appliedAt: at } : {}) };
}

export async function addPosting(d: ResumeDB, input: PostingInput, initialStatus?: AppStatus, note?: string): Promise<{ posting: JobPosting; application?: Application }> {
  const posting = newPosting(input);
  let application: Application | undefined;
  await d.transaction('rw', d.postings, d.applications, d.appEvents, async () => {
    await d.postings.add(posting);
    if (initialStatus) application = await createApplication(d, posting.id, initialStatus, note);
  });
  return { posting, application };
}
export async function updatePosting(d: ResumeDB, p: JobPosting): Promise<JobPosting> {
  const n = { ...p, updatedAt: nowIso() }; await d.postings.put(n); return n;
}
export async function copyPosting(d: ResumeDB, id: string): Promise<JobPosting> {
  const p = await d.postings.get(id); if (!p) throw new Error('岗位不存在');
  const { id: _i, createdAt: _c, updatedAt: _u, source: _s, ...rest } = p;
  const n = newPosting({ ...rest, title: `${p.title}（副本）`, source: { kind: 'manual' } });
  await d.postings.add(n); return n;
}
/** 删除前的影响评估：关联的申请 / 附件 / 简历快照 */
export async function deleteImpact(d: ResumeDB, postingId: string) {
  const apps = await d.applications.where('postingId').equals(postingId).toArray();
  const ids = apps.map((a) => a.id);
  const atts = (await d.attachments.where('postingId').equals(postingId).toArray()).concat(ids.length ? await d.attachments.where('applicationId').anyOf(ids).toArray() : []);
  const arts = ids.length ? await d.artifacts.where('applicationId').anyOf(ids).count() : 0;
  const events = ids.length ? await d.appEvents.where('applicationId').anyOf(ids).count() : 0;
  return { applications: apps.length, attachments: new Set(atts.map((a) => a.id)).size, artifacts: arts, events, attachmentIds: [...new Set(atts.map((a) => a.id))], applicationIds: ids };
}
export async function deletePosting(d: ResumeDB, postingId: string) {
  await d.transaction('rw', [d.postings, d.applications, d.appEvents, d.artifacts, d.attachments, d.attachmentBlobs], async () => {
    const imp = await deleteImpact(d, postingId);
    await d.attachments.bulkDelete(imp.attachmentIds); await d.attachmentBlobs.bulkDelete(imp.attachmentIds);
    if (imp.applicationIds.length) {
      await d.appEvents.where('applicationId').anyOf(imp.applicationIds).delete();
      await d.artifacts.where('applicationId').anyOf(imp.applicationIds).delete();
    }
    await d.applications.bulkDelete(imp.applicationIds);
    await d.postings.delete(postingId);
  });
}

export async function createApplication(d: ResumeDB, postingId: string, status: AppStatus, note?: string, at = nowIso(), source?: SourceInfo): Promise<Application> {
  const a = newApplication(postingId, status, source, at);
  await d.applications.add(a);
  await d.appEvents.add({ id: uid('evt'), applicationId: a.id, from: null, to: status, at, note, by: source && source.kind !== 'manual' ? 'import' : 'user' });
  return a;
}
/** 修改状态：只追加历史，不覆盖之前的记录 */
export async function changeStatus(d: ResumeDB, appId: string, to: AppStatus, note?: string, at = nowIso()): Promise<Application> {
  return d.transaction('rw', d.applications, d.appEvents, async () => {
    const a = await d.applications.get(appId); if (!a) throw new Error('申请记录不存在');
    const ev: ApplicationEvent = { id: uid('evt'), applicationId: appId, from: a.status, to, at, note, by: 'user' };
    await d.appEvents.add(ev);
    const n: Application = { ...a, status: to, updatedAt: nowIso(), ...(to === 'applied' && !a.appliedAt ? { appliedAt: at } : {}) };
    await d.applications.put(n); return n;
  });
}
/** 状态历史：按时间排序；同一时间按创建顺序（ID）排序 */
export const listEvents = async (d: ResumeDB, appId: string) =>
  (await d.appEvents.where('applicationId').equals(appId).toArray()).sort((a, b) => a.at.localeCompare(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
export async function saveApplication(d: ResumeDB, a: Application) { const n = { ...a, updatedAt: nowIso() }; await d.applications.put(n); return n; }

/** 把当前简历冻结成快照关联到申请（深拷贝；之后改资料 / 重新生成都不影响） */
export async function linkResumeSnapshot(d: ResumeDB, appId: string, args: { resume: ResumeDoc; profile: ProfileDoc; job: JobParse | null; label?: string; languages?: Lang[]; submitted?: boolean }): Promise<ResumeArtifact> {
  const au = auditResume(args.profile, args.resume).summary;
  const art: ResumeArtifact = {
    id: uid('art'), applicationId: appId, kind: 'snapshot',
    label: args.label ?? `${args.job?.company.short || args.job?.company.full || '简历'} · ${args.resume.createdAt.slice(0, 16).replace('T', ' ')}`,
    languages: args.languages ?? ['zh', 'en'], createdAt: nowIso(),
    resumeId: args.resume.id, resumeCreatedAt: args.resume.createdAt, templateId: args.resume.templateId,
    resume: structuredClone(args.resume), profile: profileForGeneration(args.profile), job: args.job ? structuredClone(args.job) : null,
    audit: { checkedAt: nowIso(), total: au.total, unconfirmed: au.unconfirmed, unconfirmedRed: au.unconfirmedRed },
    submitted: args.submitted ?? false,
  };
  await d.artifacts.add(art); return art;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export class StorageError extends Error {}
function quotaMessage(e: unknown): string | null {
  const n = (e as { name?: string; inner?: { name?: string } })?.name, inner = (e as { inner?: { name?: string } })?.inner?.name;
  return n === 'QuotaExceededError' || inner === 'QuotaExceededError' ? '浏览器存储空间不足，附件没有保存。请先导出完整档案备份，再删除不需要的附件后重试。' : null;
}
/** 保存附件：先写二进制再写元数据（同一事务，失败全部回滚，不会出现只有元数据的「幽灵附件」） */
export async function addAttachment(d: ResumeDB, file: { name: string; type: string; data: Uint8Array }, meta: { postingId?: string; applicationId?: string; kind: AttachmentKind; note?: string; id?: string; uploadedAt?: string }): Promise<Attachment> {
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) throw new StorageError(`「${file.name}」有 ${(file.data.byteLength / 1048576).toFixed(1)} MB，超过单个附件 25 MB 的上限，没有保存。`);
  const a: Attachment = { id: meta.id ?? uid('att'), postingId: meta.postingId, applicationId: meta.applicationId, kind: meta.kind, name: file.name, mime: file.type || 'application/octet-stream', size: file.data.byteLength, sha256: await sha256Hex(file.data), uploadedAt: meta.uploadedAt ?? nowIso(), note: meta.note };
  try {
    await d.transaction('rw', d.attachments, d.attachmentBlobs, async () => { await d.attachmentBlobs.put({ id: a.id, data: file.data }); await d.attachments.put(a); });
  } catch (e) { const q = quotaMessage(e); throw q ? new StorageError(q) : e; }
  return a;
}
export async function deleteAttachment(d: ResumeDB, id: string) {
  await d.transaction('rw', d.attachments, d.attachmentBlobs, d.artifacts, async () => {
    await d.attachments.delete(id); await d.attachmentBlobs.delete(id);
    await d.artifacts.filter((x) => x.attachmentId === id).delete();
  });
}
/** 上传「实际提交版本」：附件 + 一条 uploaded 类型的简历版本记录 */
export async function addSubmittedResume(d: ResumeDB, appId: string, postingId: string, file: { name: string; type: string; data: Uint8Array }, languages: Lang[], note?: string) {
  const att = await addAttachment(d, file, { applicationId: appId, postingId, kind: 'resume-submitted', note });
  const art: ResumeArtifact = { id: uid('art'), applicationId: appId, kind: 'uploaded', label: file.name, languages, createdAt: nowIso(), attachmentId: att.id, submitted: true };
  await d.artifacts.add(art); return { att, art };
}
export async function verifyAttachment(d: ResumeDB, id: string): Promise<boolean> {
  const [a, b] = await Promise.all([d.attachments.get(id), d.attachmentBlobs.get(id)]);
  return !!a && !!b && (await sha256Hex(b.data)) === a.sha256;
}

/**
 * v1.11：从「岗位分析历史」加入求职管理。
 * - 自动带入公司、岗位、JD 原文、要求；城市等 JD 没写清的字段留空，不猜测；
 * - 默认建立「待投递」申请（不计入已投递统计）；
 * - 同一岗位分析只关联一次（jobParseId）；同公司同岗位的已有记录由调用方提示用户选择，不自动合并或覆盖。
 */
export function postingFromAnalysis(job: JobParse): PostingInput {
  const lang = job.jdLanguage === 'en' ? 'en' : 'zh';
  const title = (job.title[lang] || job.title.zh || job.title.en || '').trim();
  const req = [...job.mustHave, ...(job.responsibilities ?? [])].map((k) => k[lang] || k.zh || k.en).filter(Boolean).join('\n');
  return { company: (job.company.full || job.company.short || '').trim(), title, city: '', jdText: job.rawText, requirements: req || undefined, jobParseId: job.id, source: { kind: 'analysis', importedAt: nowIso(), externalId: job.id } };
}
export async function findAnalysisLink(d: ResumeDB, jobId: string): Promise<JobPosting | undefined> {
  return (await d.postings.toArray()).find((p) => p.jobParseId === jobId);
}
export async function analysisDuplicates(d: ResumeDB, job: JobParse): Promise<DuplicateHit[]> {
  const c = postingFromAnalysis(job);
  if (!norm(c.company) || !norm(c.title)) return [];
  return (await d.postings.toArray()).filter((p) => norm(p.company) === norm(c.company) && norm(p.title) === norm(c.title)).map((posting) => ({ posting, reason: 'same-key' as const }));
}
export async function addFromAnalysis(d: ResumeDB, job: JobParse, note = '从岗位分析历史加入'): Promise<{ posting: JobPosting; application?: Application; existed: boolean }> {
  const linked = await findAnalysisLink(d, job.id);
  if (linked) return { posting: linked, existed: true };
  const r = await addPosting(d, postingFromAnalysis(job), 'pending', note);
  return { ...r, existed: false };
}
/** 已有同公司同岗位记录时，用户选择「关联到已有记录」：只补 jobParseId（已有字段一律不改） */
export async function linkAnalysis(d: ResumeDB, postingId: string, jobId: string): Promise<JobPosting> {
  const p = await d.postings.get(postingId); if (!p) throw new Error('岗位不存在');
  if (p.jobParseId) return p;
  return updatePosting(d, { ...p, jobParseId: jobId });
}
