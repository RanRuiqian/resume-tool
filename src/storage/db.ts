import Dexie, { type Table } from 'dexie';
import type { ExportRecord, JobParse, ProfileDoc, ResumeDoc, Settings, TemplateConfig } from '../types';
import { normalizeProfile } from './profileIO';
import { DB_DEMO, DB_REAL, IS_DEMO } from './mode';
import type { Application, ApplicationEvent, Attachment, AttachmentBlob, JobPosting, ResumeArtifact } from '../tracker/types';

export interface ProfileRow { id: 'me'; doc: ProfileDoc }
export interface StateRow { id: string; value: unknown }
/** 资料快照：任何覆盖/合并资料前自动保存，可一键恢复（v2 新增） */
export interface BackupRow { id: string; createdAt: string; reason: string; doc: ProfileDoc }

export class ResumeDB extends Dexie {
  profile!: Table<ProfileRow, string>;
  templates!: Table<TemplateConfig, string>;
  jobs!: Table<JobParse, string>;
  resumes!: Table<ResumeDoc, string>;
  exports!: Table<ExportRecord, string>;
  settings!: Table<Settings, string>;
  state!: Table<StateRow, string>;
  backups!: Table<BackupRow, string>;
  postings!: Table<JobPosting, string>;
  applications!: Table<Application, string>;
  appEvents!: Table<ApplicationEvent, string>;
  artifacts!: Table<ResumeArtifact, string>;
  attachments!: Table<Attachment, string>;
  attachmentBlobs!: Table<AttachmentBlob, string>;
  constructor(name: string = DB_REAL) {
    super(name);
    this.version(1).stores({
      profile: 'id', templates: 'id', jobs: 'id, createdAt', resumes: 'id, jobId, createdAt',
      exports: 'id, [company+roleAbbr+date]', settings: 'id', state: 'id',
    });
    // v2：新增 backups 表；资料文档升级到 1.3（教育日期 / 项目档案 / 技能档案 / 证据），旧字段原样保留
    this.version(2).stores({ backups: 'id, createdAt' }).upgrade(async (tx) => {
      // 升级前自动快照：先把旧版原始资料（未做任何转换）原样存入 backups，可在「资料快照」中一键恢复
      const rows = (await tx.table('profile').toArray()) as ProfileRow[];
      for (const row of rows) if (row?.doc) await tx.table('backups').put({ id: `bk-premigrate-v1-${row.id}`, createdAt: new Date().toISOString(), reason: '升级前自动快照（旧版原始资料，v1 → v2）', doc: structuredClone(row.doc) });
      await tx.table('profile').toCollection().modify((row: ProfileRow) => {
        const before = row.doc;
        row.doc = normalizeProfile(before);
      });
    });
    // v3（第二阶段）：历史简历补齐条目同步状态；事实审查记录 audit 为可选字段，旧简历保持原样即可读取
    this.version(3).stores({}).upgrade(async (tx) => {
      await tx.table('resumes').toCollection().modify((r: ResumeDoc) => {
        r.items = (r.items ?? []).map((i) => ({ ...i, syncStatus: i.syncStatus ?? 'in-sync' }));
      });
    });
    // v4（第三阶段）：求职投递管理——只新增表，不改动、不删除任何旧表和旧数据
    this.version(4).stores({
      postings: 'id, company, city, recruitType, priority, deadline, updatedAt, *importKeys',
      applications: 'id, postingId, status, updatedAt',
      appEvents: 'id, applicationId, at',
      artifacts: 'id, applicationId, createdAt',
      attachments: 'id, postingId, applicationId, sha256, uploadedAt',
      attachmentBlobs: 'id',
    });
    // 同一升级事务先备份再追加课程字段；任意写入失败会由 IndexedDB 整体回滚至 v4。
    // 不重写旧经历、简历、密钥、设置、投递记录或附件，也不碰 localStorage。
    this.version(5).stores({}).upgrade(async (tx) => {
      for (const row of await tx.table<ProfileRow>('profile').toArray()) {
        if (!row?.doc) continue;
        await tx.table('backups').add({ id: `bk-premigrate-v4-${row.id}`, createdAt: new Date().toISOString(), reason: '升级前自动快照（旧版原始资料，v4 → v5 课程模块）', doc: structuredClone(row.doc) });
        if (row.doc.courses === undefined) row.doc.courses = [];
        await tx.table('profile').put(row);
      }
    });
  }
}

/** 当前页面使用的数据库：演示模式下是独立的 resume-tool-demo */
export const db = new ResumeDB(IS_DEMO ? DB_DEMO : DB_REAL);

export { DEFAULT_SETTINGS, PROVIDERS } from './defaults';

export async function countExports(company: string, roleAbbr: string, date: string) {
  return db.exports.where('[company+roleAbbr+date]').equals([company, roleAbbr, date]).count();
}

const MAX_BACKUPS = 20;
/** 覆盖前保存快照；空资料不保存 */
export async function snapshotProfile(d: ResumeDB, doc: ProfileDoc, reason: string): Promise<string | null> {
  const empty = !doc.profile.name.zh && !doc.profile.name.en && !doc.work.length && !doc.education.length && !doc.projects.length && !doc.skills.length && !doc.courses?.length;
  if (empty) return null;
  const id = `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await d.backups.put({ id, createdAt: new Date().toISOString(), reason, doc: structuredClone(doc) });
  const all = (await d.backups.orderBy('createdAt').toArray()).filter((x) => !x.id.startsWith('bk-premigrate-'));
  if (all.length > MAX_BACKUPS) await d.backups.bulkDelete(all.slice(0, all.length - MAX_BACKUPS).map((x) => x.id));
  return id;
}
