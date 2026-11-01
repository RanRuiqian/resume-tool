import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JSZip from 'jszip';
import { coursesFixture } from './helpers/v113CoursesFixture';
import { jobs } from './helpers/v110Fixture';
import { generateRules } from '../src/ai/generate';
import { courseSelectionSnapshot } from '../src/privacy/resume';
import { fixedSummaryItem } from '../src/ai/fixedSummary';
import { buildLayout } from '../src/render/layout';
import { Preview } from '../src/render/Preview';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { renderPdfFit } from '../src/export/zip';
import { docxBytes } from '../src/export/docx/resumeDocx';
import { registerPdfFonts } from '../src/export/pdf/fonts';
registerPdfFonts(resolve('public/fonts'));

describe('v1.13 real bilingual PDF/Word/HTML course exports (fictional grades)', () => {
  it.each(['hidden', 'explicit'] as const)('%s grades: identical layout and preserved fixed summary/degree', async (mode) => {
    const p = coursesFixture(), r = generateRules(p, jobs().A, 'zh'), t = structuredClone(BUILTIN_TEMPLATES[0]);
    r.layoutPolicy = 'readable'; r.selection.work = ['career', 'student']; r.selection.projects = ['core'];
    r.items = [fixedSummaryItem(p)!, ...[...p.work, ...p.projects].flatMap((e) => e.bullets.map((b) => ({ sourceId: b.id!, zh: b.zh!, en: b.en!, syncStatus: 'in-sync' as const })))];
    const ids = p.courses!.slice(0, 2).map((c) => c.id);
    r.courseSelection = courseSelectionSnapshot(p, ids, mode === 'explicit' ? [ids[0]] : []);
    const before = structuredClone(p);
    for (const lang of ['zh', 'en'] as const) {
      const fitted = await renderPdfFit(p, t, lang, r), model = buildLayout(p, fitted.tpl, lang, r), word = await docxBytes(model);
      const html = renderToStaticMarkup(createElement(Preview, { m: model }));
      const xml = await (await JSZip.loadAsync(word)).file('word/document.xml')!.async('string');
      expect(fitted.pages).toBe(1); expect(fitted.tpl.locales[lang].typography.bodySizePt).toBe(t.locales[lang].typography.bodySizePt);
      expect(xml).toContain(p.profile.summary[lang]); expect(html).toContain(p.profile.summary[lang]);
      for (const text of [xml, html, JSON.stringify(r)]) {
        expect(text).not.toContain('MOCK-UG-GRADE-2'); expect(text).not.toContain('MOCK-PG-GRADE'); expect(text).not.toContain('GPA 3.6');
        expect(text.includes('MOCK-UG-GRADE-1')).toBe(mode === 'explicit');
      }
      expect(html).not.toContain('example.com/resume-tool'); expect(xml).not.toContain('PLC 内容待核实'); expect(xml).not.toContain('supplier development');
      if (lang === 'en') { expect(html).toContain('Marine Engineering'); expect(xml).not.toContain('Mechanical Engineering'); }
      if (process.env.V113_OUT) {
        const dir = process.env.V113_OUT; mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'fictional-profile.json'), JSON.stringify(p));
        writeFileSync(resolve(dir, 'fictional-job.json'), JSON.stringify(jobs().A));
        writeFileSync(resolve(dir, `${mode}-resume.json`), JSON.stringify(r));
        writeFileSync(resolve(dir, `${mode}-${lang}.pdf`), fitted.bytes); writeFileSync(resolve(dir, `${mode}-${lang}.docx`), word); writeFileSync(resolve(dir, `${mode}-${lang}.html`), html);
      }
    }
    expect(p).toEqual(before);
  }, 30000);
});
