import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import type { ProfileDoc } from '../src/types';
import { parseJdRules } from '../src/ai/jd';
import { generateRules, runConsistency } from '../src/ai/generate';
import { buildZip } from '../src/export/zip';
import { buildExportNames } from '../src/export/naming';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { SAMPLE_JD } from '../src/sample/sampleJd';

const profile = JSON.parse(readFileSync(resolve(__dirname, '../src/sample/sample-profile.json'), 'utf8')) as ProfileDoc;

describe('export pipeline', () => {
  it('parses sample JD with rules', () => {
    const j = parseJdRules(SAMPLE_JD);
    expect(j.company.short).toBe('字节跳动');
    expect(j.roleAbbr).toBe('FE');
    expect(j.yearsRequired).toBe(3);
  });
  it('rule generation only references library ids and is consistent', () => {
    const r = runConsistency(generateRules(profile, parseJdRules(SAMPLE_JD), 'zh'));
    const ids = new Set(['summary', ...profile.work.flatMap((w) => w.bullets.map((b) => b.id)), ...profile.projects.flatMap((w) => w.bullets.map((b) => b.id)), ...profile.education.flatMap((w) => w.highlights.map((b) => b.id))]);
    r.items.forEach((i) => expect(ids.has(i.sourceId)).toBe(true));
    expect(r.consistency.issues).toEqual([]);
  });
  it('builds a zip with 4 UTF-8 named files', async () => {
    const job = parseJdRules(SAMPLE_JD);
    const names = buildExportNames(job.company.short, job.roleAbbr, '20261016', 0);
    const r = await buildZip(profile, BUILTIN_TEMPLATES[1], generateRules(profile, job, 'zh'), names, resolve(__dirname, '../public/fonts'));
    expect(r.errors).toEqual([]);
    const z = await JSZip.loadAsync(r.zip);
    expect(Object.keys(z.files).sort()).toEqual(['字节跳动_FE_CN.docx', '字节跳动_FE_CN.pdf', '字节跳动_FE_EN.docx', '字节跳动_FE_EN.pdf']);
    const pdfHead = new TextDecoder().decode((await z.file('字节跳动_FE_CN.pdf')!.async('uint8array')).slice(0, 5));
    expect(pdfHead).toBe('%PDF-');
    // general purpose bit 11 (UTF-8) set on the first local file header
    expect(r.zip[7] & 0x08).toBeTruthy();
  }, 60000);
});
