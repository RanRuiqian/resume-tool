import Dexie, { type Table } from 'dexie';
import type { ExportRecord, JobParse, ProfileDoc, ResumeDoc, Settings, TemplateConfig } from '../types';
import { normalizeProfile } from './profileIO';
import { DB_DEMO, DB_REAL, IS_DEMO } from './mode';

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
  constructor(name: string = DB_REAL) {
    super(name);
    this.version(1).stores({
      profile: 'id', templates: 'id', jobs: 'id, createdAt', resumes: 'id, jobId, createdAt',
      exports: 'id, [company+roleAbbr+date]', settings: 'id', state: 'id',
    });
    // v2：新增 backups 表；资料文档升级到 1.3（教育日期 / 项目档案 / 技能档案 / 证据），旧字段原样保留
    this.version(2).stores({ backups: 'id, createdAt' }).upgrade(async (tx) => {
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
  const empty = !doc.profile.name.zh && !doc.profile.name.en && !doc.work.length && !doc.education.length && !doc.projects.length && !doc.skills.length;
  if (empty) return null;
  const id = `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await d.backups.put({ id, createdAt: new Date().toISOString(), reason, doc: structuredClone(doc) });
  const all = await d.backups.orderBy('createdAt').toArray();
  if (all.length > MAX_BACKUPS) await d.backups.bulkDelete(all.slice(0, all.length - MAX_BACKUPS).map((x) => x.id));
  return id;
}
