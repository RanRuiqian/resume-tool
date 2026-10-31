import { resolve } from 'node:path';
import type { ProfileDoc, ResumeDoc } from '../../src/types';
import { buildZip } from '../../src/export/zip';
import { buildExportNames } from '../../src/export/naming';
import { BUILTIN_TEMPLATES } from '../../src/templates';

/** 用真实导出流程导出一次（CN/EN PDF + DOCX），返回结果；用于确认导出不改动简历与审查记录 */
export async function buildExportItems(p: ProfileDoc, r: ResumeDoc) {
  const snap = JSON.stringify(r);
  const out = await buildZip(p, BUILTIN_TEMPLATES[0], r, buildExportNames('模拟公司', 'CV', '20261031', 0), resolve(__dirname, '../../public/fonts'));
  if (out.errors.length) throw new Error(out.errors.join(';'));
  if (JSON.stringify(r) !== snap) throw new Error('导出修改了简历对象');
  return out;
}
