import Dexie, { type Table } from 'dexie';
import type { ExportRecord, JobParse, ProfileDoc, ResumeDoc, Settings, TemplateConfig } from '../types';

interface ProfileRow { id: 'me'; doc: ProfileDoc }
interface StateRow { id: string; value: unknown }

class ResumeDB extends Dexie {
  profile!: Table<ProfileRow, string>;
  templates!: Table<TemplateConfig, string>;
  jobs!: Table<JobParse, string>;
  resumes!: Table<ResumeDoc, string>;
  exports!: Table<ExportRecord, string>;
  settings!: Table<Settings, string>;
  state!: Table<StateRow, string>;
  constructor() {
    super('resume-tool');
    this.version(1).stores({
      profile: 'id', templates: 'id', jobs: 'id, createdAt', resumes: 'id, jobId, createdAt',
      exports: 'id, [company+roleAbbr+date]', settings: 'id', state: 'id',
    });
  }
}
export const db = new ResumeDB();

export { DEFAULT_SETTINGS, PROVIDERS } from './defaults';

export async function countExports(company: string, roleAbbr: string, date: string) {
  return db.exports.where('[company+roleAbbr+date]').equals([company, roleAbbr, date]).count();
}
