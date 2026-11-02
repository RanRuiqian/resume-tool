import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import { generateResume } from '../src/ai/generate';
import { sourceText } from '../src/ai/provenance';
import { jointFixture } from './helpers/v113JointFixture';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { buildLayout } from '../src/render/layout';
import { buildZip } from '../src/export/zip';
import { buildExportNames } from '../src/export/naming';
import { registerPdfFonts } from '../src/export/pdf/fonts';
import { linkJointApplications, resolveArtifact } from '../src/joint/versions';
import { ResumeDB } from '../src/storage/db';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import type { Settings } from '../src/types';
registerPdfFonts(resolve('public/fonts'));
it('exports one bilingual company resume and its per-role evidence report, identical across all three application references', async () => {
  const f = jointFixture(); let n = 0; const api = vi.mocked(chatJson); api.mockReset();
  api.mockImplementation(async (_s, messages) => {
    n++; const payload = JSON.parse(String(messages.at(-1)!.content).split('\n\n').at(-1)!);
    return n === 1 ? f.plan : payload.facts ? { items: payload.facts.map((x: { sourceId: string; text: string }) => ({ sourceId: x.sourceId, text: x.text })) }
      : { items: payload.items.map((x: { sourceId: string }) => ({ sourceId: x.sourceId, text: sourceText(f.p, x).en })) };
  });
  const r = await generateResume({ demoMode: false, model: 'mock', provider: 'custom' } as Settings, f.p, f.job, 'zh', 1), template = structuredClone(BUILTIN_TEMPLATES[0]); r.templateId = template.id;
  const d = new ResumeDB('joint-export-test'), linked = await linkJointApplications(d, { profile: f.p, job: f.job, resume: r, template });
  const arts = await d.artifacts.toArray(), a = await resolveArtifact(d, arts[0]);
  for (const art of arts) { const b = await resolveArtifact(d, art); for (const lang of ['zh', 'en'] as const) expect(buildLayout(b.profile!, b.template!, lang, b.resume)).toEqual(buildLayout(a.profile!, a.template!, lang, a.resume)); }
  const names = buildExportNames(f.job.company.short, 'JOINT', new Date('2026-01-01'), 0);
  const result = await buildZip(a.profile!, a.template!, a.resume!, names, resolve('public/fonts'));
  expect(result.errors).toEqual([]); expect(Object.keys(result.files)).toHaveLength(5); expect(result.files['evidence-and-gaps.json']).toBeDefined();
  const report = JSON.parse(new TextDecoder().decode(result.files['evidence-and-gaps.json'])); expect(report.targets).toHaveLength(3); expect(report.synthesis.conflicts).toHaveLength(1);
  for (const [name, bytes] of Object.entries(result.files)) {
    if (name.endsWith('.docx')) { const z = await JSZip.loadAsync(bytes), xml = await z.file('word/document.xml')!.async('string');
      expect(xml).not.toContain('MOCK-UG-GRADE'); expect(xml).not.toContain('example.com/resume-tool'); expect(xml).toContain(name.includes('_CN') ? '轮机工程' : 'Marine Engineering');
      expect(xml).not.toMatch(/熟练 PLC|proficient.*PLC|负责供应商开发/);
    }
    if (process.env.P2_OUT) { mkdirSync(process.env.P2_OUT, { recursive: true }); writeFileSync(resolve(process.env.P2_OUT, name), bytes); }
  }
  if (process.env.P2_OUT) {
    writeFileSync(resolve(process.env.P2_OUT, 'fictional-joint-fixture.json'), JSON.stringify(f)); writeFileSync(resolve(process.env.P2_OUT, 'common-resume.json'), JSON.stringify(r));
    writeFileSync(resolve(process.env.P2_OUT, 'common-content-version.json'), JSON.stringify(await d.resumeVersions.get(linked.versionId)));
  }
  expect(await d.resumeVersions.count()).toBe(1); await d.delete();
}, 30000);
