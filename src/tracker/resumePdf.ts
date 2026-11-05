import type { JobParse, Lang, ProfileDoc, ResumeDoc, TemplateConfig } from '../types';
import { buildExportNames, guessRoleAbbr } from '../export/naming';
import type { FileBytes } from './quickRecord';

/** 生成要存进投递记录的简历 PDF（与「下载」按钮同一套排版与自动适配；走 Worker，失败回退主线程） */
export async function makeResumePdfs(profile: ProfileDoc, tpl: TemplateConfig, resume: ResumeDoc, job: JobParse | null, fallback: { company: string; title: string }, langs: Lang[], when = new Date()): Promise<{ files: (FileBytes & { lang: Lang })[]; errors: string[] }> {
  const company = job?.company.short || job?.company.full || fallback.company || '简历';
  const names = buildExportNames(company, job?.roleAbbr || guessRoleAbbr(fallback.title || ''), when, 0);
  const only = langs.map((l) => (l === 'zh' ? 'cnPdf' : 'enPdf') as 'cnPdf' | 'enPdf');
  const { exportZip } = await import('../export/client');
  const r = await exportZip(profile, tpl, resume, names, undefined, {}, only);
  const files = langs.flatMap((lang) => { const name = lang === 'zh' ? names.files.cnPdf : names.files.enPdf; const data = r.files[name]; return data ? [{ name, type: 'application/pdf', data, lang }] : []; });
  return { files, errors: r.errors };
}
