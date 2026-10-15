/**
 * 真实 AI 端到端测试（需要环境变量 DEEPSEEK_API_KEY，切勿写入仓库）
 * 粘贴简历 → AI 整理资料库 → AI 补译英文 → 本地 OCR 岗位截图 → AI 解析岗位 → AI 生成主版本 + 本地化 → 导出 zip
 * 用法：DEEPSEEK_API_KEY=... npm run e2e:ai   （输出到 ../out/e2e/）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/storage/defaults';
import { importProfileFromText } from '../src/ai/importProfile';
import { translateProfile } from '../src/ai/translate';
import { ocrLocal } from '../src/ai/ocr';
import { parseJdAi } from '../src/ai/jd';
import { generateResume } from '../src/ai/generate';
import { buildZip } from '../src/export/zip';
import { buildExportNames } from '../src/export/naming';
import { BUILTIN_TEMPLATES } from '../src/templates';

const key = process.env.DEEPSEEK_API_KEY;
if (!key) { console.error('缺少 DEEPSEEK_API_KEY'); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../out/e2e');
mkdirSync(out, { recursive: true });
const s: Settings = { ...DEFAULT_SETTINGS, apiKey: key, setupDone: true };
const t0 = Date.now();
const lap = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

let profile = await importProfileFromText(s, readFileSync(resolve(here, 'fixtures/resume.txt'), 'utf8'));
lap(`资料库：${profile.profile.name.zh} 工作 ${profile.work.length} 项目 ${profile.projects.length} 技能 ${profile.skills.length} bullets ${profile.work.reduce((a, w) => a + w.bullets.length, 0)}`);
const tr = await translateProfile(s, profile, 'en');
profile = tr.profile;
lap(`补译英文 ${tr.count} 个字段；姓名 EN=${profile.profile.name.en}`);
writeFileSync(resolve(out, 'profile.json'), JSON.stringify(profile, null, 2));

const jdText = await ocrLocal(readFileSync(resolve(here, 'fixtures/jd.png')));
lap(`OCR ${jdText.length} 字：${jdText.slice(0, 60).replace(/\n/g, ' ')}…`);
const job = await parseJdAi(s, jdText);
lap(`岗位：${job.company.short} / ${job.roleAbbr} / ${job.title.zh} | ${job.title.en}；关键词 ${job.keywords.map((k) => k.zh).join('、')}`);
writeFileSync(resolve(out, 'job.json'), JSON.stringify(job, null, 2));

const tpl = BUILTIN_TEMPLATES[1];
const resume = await generateResume(s, profile, job, job.jdLanguage, tpl.page.targetPages, (m) => lap(m));
lap(`生成：${resume.generatedBy} 匹配度 ${resume.matchScore} 缺口 ${resume.gaps.join('、')} 条目 ${resume.items.length} 一致性问题 ${resume.consistency.issues.length}`);
resume.consistency.issues.forEach((i) => console.log('  ⚠', i.message));
resume.notes?.forEach((n) => console.log('  ·', n));
writeFileSync(resolve(out, 'resume.json'), JSON.stringify(resume, null, 2));

const names = buildExportNames(job.company.short, job.roleAbbr, new Date(), 0);
const z = await buildZip(profile, tpl, resume, names, resolve(here, '../public/fonts'));
writeFileSync(resolve(out, names.zipName), z.zip);
for (const [n, b] of Object.entries(z.files)) writeFileSync(resolve(out, n), b);
lap(`导出 ${names.zipName} 页数 CN=${z.pages.zh} EN=${z.pages.en} 适配级别 ${JSON.stringify(z.fitLevel)} 错误 ${z.errors.length}`);
