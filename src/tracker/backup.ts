import JSZip from 'jszip';
import { snapshotProfile, type ResumeDB } from '../storage/db';
import { normalizeProfile } from '../storage/profileIO';
import type { JobParse, ProfileDoc, ResumeDoc } from '../types';
import { sha256Hex } from './repo';
import type { Application, ApplicationEvent, Attachment, JobPosting, ResumeArtifact } from './types';
import { TRACKER_SCHEMA_VERSION } from './types';

export const ARCHIVE_FORMAT = 'resume-tool-archive';
export const ARCHIVE_VERSION = 1;
/** 绝不进入备份的字段名（任何层级） */
const SECRET_KEYS = /^(apikey|api_key|authorization|token|secret|password)$/i;
export function scrubSecrets<T>(v: T): T {
  if (Array.isArray(v)) return v.map(scrubSecrets) as T;
  if (v instanceof Uint8Array || !v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEYS.test(k)).map(([k, x]) => [k, scrubSecrets(x)])) as T;
}

export interface ArchiveData {
  profile: ProfileDoc | null;
  postings: JobPosting[]; applications: Application[]; events: ApplicationEvent[];
  artifacts: ResumeArtifact[]; attachments: Attachment[];
  jobs: JobParse[]; resumes: ResumeDoc[];
}
// resumes / artifacts 已完整保留可选 sourceIds 与 layoutPolicy；它们不是新表，无需新增 section。
export const SECTIONS = ['profile', 'postings', 'applications', 'events', 'artifacts', 'attachments', 'jobs', 'resumes'] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = { profile: '个人事实档案', postings: '岗位库', applications: '申请记录', events: '状态历史', artifacts: '简历版本', attachments: '附件', jobs: '已解析 JD', resumes: '生成的简历' };
export interface Manifest {
  format: typeof ARCHIVE_FORMAT; archiveVersion: number; trackerSchemaVersion: number; dbVersion: number;
  generatedAt: string; light: boolean; counts: Record<Section, number>;
  files: Record<Exclude<Section, 'profile'> | 'profile', string>;
  attachmentFiles: { id: string; path: string; sha256: string; size: number }[];
  excluded: string[]; note: string;
}

export async function collect(d: ResumeDB): Promise<ArchiveData> {
  const [p, postings, applications, events, artifacts, attachments, jobs, resumes] = await Promise.all([
    d.profile.get('me'), d.postings.toArray(), d.applications.toArray(), d.appEvents.toArray(), d.artifacts.toArray(), d.attachments.toArray(), d.jobs.toArray(), d.resumes.toArray(),
  ]);
  return scrubSecrets({ profile: p?.doc ?? null, postings, applications, events, artifacts, attachments, jobs, resumes });
}
function manifestOf(d: ResumeDB, data: ArchiveData, light: boolean, attachmentFiles: Manifest['attachmentFiles']): Manifest {
  return {
    format: ARCHIVE_FORMAT, archiveVersion: ARCHIVE_VERSION, trackerSchemaVersion: TRACKER_SCHEMA_VERSION, dbVersion: d.verno, generatedAt: new Date().toISOString(), light,
    counts: Object.fromEntries(SECTIONS.map((s) => [s, s === 'profile' ? (data.profile ? 1 : 0) : (data[s] as unknown[]).length])) as Record<Section, number>,
    files: Object.fromEntries(SECTIONS.map((s) => [s, `data/${s}.json`])) as Manifest['files'],
    attachmentFiles, excluded: ['API Key（永不导出）', '设置与界面状态', '资料快照（backups）', '导出历史中的文件本体'],
    note: '本文件包含个人求职资料，请勿上传到公开仓库。',
  };
}
/** 完整求职档案 ZIP：manifest.json + data/*.json + attachments/<id>/<文件名> */
export async function exportArchiveZip(d: ResumeDB): Promise<Uint8Array> {
  const data = await collect(d); const zip = new JSZip(); const af: Manifest['attachmentFiles'] = [];
  for (const a of data.attachments) {
    const b = await d.attachmentBlobs.get(a.id); if (!b) continue;
    const path = `attachments/${a.id}/${a.name.replace(/[\\/:*?"<>|]/g, '_')}`;
    zip.file(path, b.data); af.push({ id: a.id, path, sha256: a.sha256, size: a.size });
  }
  const m = manifestOf(d, data, false, af);
  zip.file('manifest.json', JSON.stringify(m, null, 2));
  for (const s of SECTIONS) zip.file(m.files[s], JSON.stringify(data[s], null, 2));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
/** 轻量 JSON：不含附件二进制，只含元数据 */
export async function exportLightJson(d: ResumeDB): Promise<string> {
  const data = await collect(d);
  return JSON.stringify({ manifest: manifestOf(d, data, true, []), ...data }, null, 2);
}

export interface ArchiveCheck {
  manifest: Manifest | null; data: ArchiveData; blobs: Map<string, Uint8Array>;
  errors: string[]; warnings: string[];
  existing: Record<Section, number>; incoming: Record<Section, number>;
}
const asArr = <T,>(v: unknown, name: string, errs: string[]): T[] => { if (v === undefined) return []; if (!Array.isArray(v)) { errs.push(`${name} 不是列表，已忽略`); return []; } return v as T[]; };
/** 先完整验证，再写数据库：结构、引用关系、附件是否缺失 / 校验值是否一致、与现有数据的重复 */
export async function readArchive(d: ResumeDB, file: Uint8Array | string): Promise<ArchiveCheck> {
  const errors: string[] = [], warnings: string[] = []; const blobs = new Map<string, Uint8Array>();
  let manifest: Manifest | null = null; let raw: Record<string, unknown> = {};
  if (typeof file === 'string' || file[0] === 0x7b) {
    try { raw = JSON.parse(typeof file === 'string' ? file : new TextDecoder().decode(file)); } catch (e) { throw new Error(`备份文件损坏：JSON 无法解析（${(e as Error).message}）`); }
    manifest = (raw.manifest as Manifest) ?? null;
  } else {
    let zip: JSZip; try { zip = await JSZip.loadAsync(file); } catch { throw new Error('备份文件损坏：不是有效的 ZIP'); }
    const mf = zip.file('manifest.json'); if (!mf) throw new Error('备份缺少 manifest.json，不是本工具导出的完整档案');
    try { manifest = JSON.parse(await mf.async('string')); } catch { throw new Error('manifest.json 损坏'); }
    for (const s of SECTIONS) {
      const f = zip.file(manifest!.files?.[s] ?? `data/${s}.json`);
      if (!f) { warnings.push(`缺少 ${SECTION_LABEL[s]} 数据文件`); continue; }
      try { raw[s] = JSON.parse(await f.async('string')); } catch { errors.push(`${SECTION_LABEL[s]} 数据文件损坏，无法读取`); }
    }
    for (const a of manifest!.attachmentFiles ?? []) { const f = zip.file(a.path); if (f) blobs.set(a.id, await f.async('uint8array')); }
  }
  if (manifest?.format !== ARCHIVE_FORMAT) throw new Error('不是「完整求职档案」格式（manifest.format 不匹配）');
  if (manifest.archiveVersion > ARCHIVE_VERSION) errors.push(`备份来自更新版本的工具（档案版本 ${manifest.archiveVersion}），请先升级本工具`);
  const data: ArchiveData = scrubSecrets({
    profile: raw.profile && typeof raw.profile === 'object' ? normalizeProfile(raw.profile) : null,
    postings: asArr<JobPosting>(raw.postings, '岗位库', errors), applications: asArr<Application>(raw.applications, '申请记录', errors), events: asArr<ApplicationEvent>(raw.events, '状态历史', errors),
    artifacts: asArr<ResumeArtifact>(raw.artifacts, '简历版本', errors), attachments: asArr<Attachment>(raw.attachments, '附件', errors), jobs: asArr<JobParse>(raw.jobs, '已解析 JD', errors), resumes: asArr<ResumeDoc>(raw.resumes, '生成的简历', errors),
  });
  for (const s of SECTIONS) if (s !== 'profile') for (const x of data[s] as { id?: unknown }[]) if (!x || typeof x.id !== 'string') { errors.push(`${SECTION_LABEL[s]} 中有记录缺少 id`); break; }
  const pIds = new Set(data.postings.map((p) => p.id)), aIds = new Set(data.applications.map((a) => a.id));
  const orphanApps = data.applications.filter((a) => !pIds.has(a.postingId)).length; if (orphanApps) warnings.push(`${orphanApps} 条申请记录找不到对应岗位（仍可导入）`);
  const orphanEv = data.events.filter((e) => !aIds.has(e.applicationId)).length; if (orphanEv) warnings.push(`${orphanEv} 条状态历史找不到对应申请`);
  if (!manifest.light) for (const a of data.attachments) {
    const b = blobs.get(a.id);
    if (!b) warnings.push(`附件缺失：${a.name}（将只导入说明，不含文件）`);
    else if ((await sha256Hex(b)) !== a.sha256) { warnings.push(`附件校验失败（文件可能损坏）：${a.name}，将跳过`); blobs.delete(a.id); }
  }
  else if (data.attachments.length) warnings.push(`轻量 JSON 不含附件文件：${data.attachments.length} 个附件只有说明信息`);
  const existing = {} as Record<Section, number>, incoming = {} as Record<Section, number>;
  const tbl = tables(d);
  for (const s of SECTIONS) {
    if (s === 'profile') { incoming[s] = data.profile ? 1 : 0; existing[s] = (await d.profile.get('me')) && data.profile ? 1 : 0; continue; }
    const ids = (data[s] as { id: string }[]).map((x) => x.id); incoming[s] = ids.length;
    existing[s] = ids.length ? (await tbl[s].bulkGet(ids)).filter(Boolean).length : 0;
  }
  const dupIds = SECTIONS.filter((s) => existing[s] && s !== 'profile').map((s) => `${SECTION_LABEL[s]} ${existing[s]} 条`);
  if (dupIds.length) warnings.push(`以下记录在本机已存在（同一 ID）：${dupIds.join('、')}。默认跳过，不覆盖。`);
  return { manifest, data, blobs, errors, warnings, existing, incoming };
}
const tables = (d: ResumeDB) => ({ postings: d.postings, applications: d.applications, events: d.appEvents, artifacts: d.artifacts, attachments: d.attachments, jobs: d.jobs, resumes: d.resumes }) as const;

export interface RestoreOptions { sections: Section[]; overwrite: boolean; replaceProfile: boolean }
export interface RestoreResult { written: Record<Section, number>; skipped: Record<Section, number>; profileSnapshotId: string | null }
/** 恢复：单个事务写入，任一步失败整体回滚；覆盖资料前先存快照 */
export async function restoreArchive(d: ResumeDB, chk: ArchiveCheck, opt: RestoreOptions): Promise<RestoreResult> {
  if (chk.errors.length) throw new Error(`备份验证未通过，未写入任何数据：${chk.errors.join('；')}`);
  const written = Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Record<Section, number>, skipped = { ...written };
  let profileSnapshotId: string | null = null;
  const tbl = tables(d);
  await d.transaction('rw', [d.profile, d.backups, d.postings, d.applications, d.appEvents, d.artifacts, d.attachments, d.attachmentBlobs, d.jobs, d.resumes], async () => {
    for (const s of opt.sections) {
      if (s === 'profile') {
        if (!chk.data.profile) continue;
        const cur = await d.profile.get('me');
        if (cur && !opt.replaceProfile) { skipped.profile++; continue; }
        if (cur) profileSnapshotId = await snapshotProfile(d, cur.doc, '导入完整求职档案前的资料');
        await d.profile.put({ id: 'me', doc: chk.data.profile }); written.profile++; continue;
      }
      const t = tbl[s] as unknown as { bulkGet: (k: string[]) => Promise<unknown[]>; bulkPut: (x: unknown[]) => Promise<unknown> };
      const rows = chk.data[s] as { id: string }[];
      const ex = await t.bulkGet(rows.map((r) => r.id));
      const put = rows.filter((_, i) => opt.overwrite || !ex[i]);
      skipped[s] += rows.length - put.length;
      if (s === 'attachments') for (const a of put as Attachment[]) { const b = chk.blobs.get(a.id); if (b) await d.attachmentBlobs.put({ id: a.id, data: b }); }
      await t.bulkPut(put); written[s] += put.length;
    }
  });
  return { written, skipped, profileSnapshotId };
}
