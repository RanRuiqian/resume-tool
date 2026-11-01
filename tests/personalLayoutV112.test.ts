import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import type { GenItem } from '../src/types';
import { personalFixture } from './helpers/v112PersonalFixture';
import { jobs } from './helpers/v110Fixture';
import { generateRules } from '../src/ai/generate';
import { fixedSummaryItem } from '../src/ai/fixedSummary';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { renderPdfFit } from '../src/export/zip';
import { docxBytes } from '../src/export/docx/resumeDocx';
import { buildLayout } from '../src/render/layout';
import { registerPdfFonts } from '../src/export/pdf/fonts';

registerPdfFonts(resolve('public/fonts'));
function sample(size: 'small' | 'medium' | 'rich') {
  const p = personalFixture();
  if (size === 'small') { p.work = [p.work[0]]; p.projects[0].bullets = [p.projects[0].bullets[0]]; }
  if (size === 'rich') {
    const base = p.projects[0];
    p.projects = Array.from({ length: 12 }, (_, i) => ({ ...structuredClone(base), id: `rich-${i}`, name: { zh: `模拟工程课程项目 ${i + 1}`, en: `Fictional Engineering Course Project ${i + 1}` },
      bullets: base.bullets.map((b, j) => ({ ...b, id: `rich-${i}-b${j}` })) }));
  }
  p.work = p.work.filter((w) => w.kind !== 'parttime');
  const r = generateRules(p, jobs().A, 'zh');
  r.generatedBy = 'ai'; r.layoutPolicy = 'readable';
  r.selection = { work: p.work.map((x) => x.id), projects: p.projects.map((x) => x.id), education: p.education.map((x) => x.id), skills: p.skills.slice(0, 3).map((x) => x.id), certificates: p.certificates.slice(0, 1).map((x) => x.id), awards: [] };
  const facts: GenItem[] = [...p.work, ...p.projects].flatMap((x) => x.bullets.map((b) => ({ sourceId: b.id!, zh: b.zh!, en: b.en!, syncStatus: 'in-sync' as const })));
  r.items = [fixedSummaryItem(p)!, ...facts];
  return { p, r };
}

describe('E: small/medium/rich bilingual PDF and Word with readable typography', () => {
  it.each(['small', 'medium', 'rich'] as const)('%s: exports both languages and never shrinks body text or line height', async (size) => {
    const { p, r } = sample(size), t = structuredClone(BUILTIN_TEMPLATES[0]);
    t.page.targetPages = size === 'rich' ? 2 : 1;
    for (const lang of ['zh', 'en'] as const) {
      const result = await renderPdfFit(p, t, lang, r);
      expect(result.pages).toBe(size === 'rich' ? 2 : 1);
      expect(result.tpl.locales[lang].typography.bodySizePt).toBe(t.locales[lang].typography.bodySizePt);
      expect(result.tpl.locales[lang].typography.lineHeight).toBe(t.locales[lang].typography.lineHeight);
      expect(result.overflow).toBe(result.pages > t.page.targetPages);
      const model = buildLayout(p, result.tpl, lang, r), word = await docxBytes(model);
      const xml = await (await JSZip.loadAsync(word)).file('word/document.xml')!.async('string');
      const sections = [...model.main, ...model.side];
      for (const section of sections) expect(xml).toContain(section.title.replace(/&/g, '&amp;'));
      expect(xml).toContain(lang === 'zh' ? '目前就读于虚构工程大学' : 'Currently pursuing');
      if (process.env.V112_LAYOUT_OUT) {
        const dir = process.env.V112_LAYOUT_OUT; mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'e2e-personal-profile.json'), JSON.stringify(personalFixture()));
        writeFileSync(resolve(dir, 'e2e-jobs.json'), JSON.stringify(jobs()));
        writeFileSync(resolve(dir, `${size}-${lang}.pdf`), result.bytes);
        writeFileSync(resolve(dir, `${size}-${lang}.docx`), word);
        writeFileSync(resolve(dir, `${size}-${lang}.json`), JSON.stringify({ pages: result.pages, overflow: result.overflow, bodyPt: t.locales[lang].typography.bodySizePt,
          expected: sections.flatMap((s) => [s.title, ...s.blocks.flatMap((b) => [b.title, b.subtitle, b.text, ...b.bullets].filter(Boolean))]) }));
      }
    }
  }, 30000);
});
