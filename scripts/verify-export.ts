/**
 * 端到端导出验证：示例资料 + 示例 JD → 规则生成 → 4 个文件 → zip
 * 用法：npm run verify:export  （输出到 ../out/）
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProfileDoc } from '../src/types';
import { parseJdRules } from '../src/ai/jd';
import { generateRules, runConsistency } from '../src/ai/generate';
import { buildZip } from '../src/export/zip';
import { buildExportNames } from '../src/export/naming';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { SAMPLE_JD } from '../src/sample/sampleJd';

const here = dirname(fileURLToPath(import.meta.url));
const profile = JSON.parse(readFileSync(resolve(here, '../src/sample/sample-profile.json'), 'utf8')) as ProfileDoc;
const outDir = resolve(here, '../../out');
mkdirSync(outDir, { recursive: true });

const job = parseJdRules(SAMPLE_JD);
console.log('JD:', job.company, job.roleAbbr, job.mustHave.map((k) => k.zh).join(','), 'years', job.yearsRequired);
const resume = runConsistency(generateRules(profile, job, 'zh'));
console.log('match', resume.matchScore, 'gaps', resume.gaps, 'issues', resume.consistency.issues);

for (const tpl of BUILTIN_TEMPLATES) {
  const names = buildExportNames(job.company.short, job.roleAbbr, new Date(), tpl === BUILTIN_TEMPLATES[0] ? 0 : BUILTIN_TEMPLATES.indexOf(tpl));
  const r = await buildZip(profile, tpl, { ...resume, templateId: tpl.id }, names, resolve(here, '../public/fonts'));
  if (r.errors.length) { console.error(r.errors); process.exitCode = 1; }
  const dir = resolve(outDir, tpl.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(outDir, names.zipName), r.zip);
  for (const [n, b] of Object.entries(r.files)) writeFileSync(resolve(dir, n), b);
  console.log(tpl.id, '->', names.zipName, Object.entries(r.files).map(([n, b]) => `${n}(${b.length})`).join(' '));
}
