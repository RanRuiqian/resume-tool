import JSZip from 'jszip';
import { pdf } from '@react-pdf/renderer';
import { createElement } from 'react';
import type { Lang, ProfileDoc, ResumeDoc, TemplateConfig } from '../types';
import { buildLayout } from '../render/layout';
import { ResumePdf } from './pdf/ResumePdf';
import { registerPdfFonts } from './pdf/fonts';
import { docxBytes } from './docx/resumeDocx';
import type { ExportNames } from './naming';
import { countPdfPages, fitTemplate, MAX_FIT_LEVEL } from './fit';

export async function pdfBytes(p: ProfileDoc, tpl: TemplateConfig, lang: Lang, r: ResumeDoc | null): Promise<Uint8Array> {
  const m = buildLayout(p, tpl, lang, r);
  const inst = pdf(createElement(ResumePdf, { m }) as never);
  const blob = await inst.toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

export interface FitResult { bytes: Uint8Array; pages: number; level: number; tpl: TemplateConfig; overflow: boolean }
/** 渲染 PDF；若开启自动适配且超出目标页数，逐级收紧直到满足或达到下限 */
export async function renderPdfFit(p: ProfileDoc, tpl: TemplateConfig, lang: Lang, r: ResumeDoc | null): Promise<FitResult> {
  const target = tpl.page.targetPages || 1;
  const auto = tpl.page.autoFit !== false;
  let level = 0;
  for (;;) {
    const t = fitTemplate(tpl, lang, level, r?.layoutPolicy === 'readable');
    const bytes = await pdfBytes(p, t, lang, r);
    const pages = countPdfPages(bytes);
    if (!auto || pages <= target) return { bytes, pages, level, tpl: t, overflow: pages > target };
    if (level >= MAX_FIT_LEVEL) {
      // 收紧到下限仍超页：内容本身需要更多页，回到原始字号与间距排版，不做无意义的压缩
      if (level > 0) {
        const raw = await pdfBytes(p, tpl, lang, r);
        const rawPages = countPdfPages(raw);
        if (rawPages <= pages) return { bytes: raw, pages: rawPages, level: 0, tpl, overflow: true };
      }
      return { bytes, pages, level, tpl: t, overflow: true };
    }
    level += pages - target > 1 ? 2 : 1;
    level = Math.min(level, MAX_FIT_LEVEL);
  }
}

export interface BuildZipResult { zip: Uint8Array; files: Record<string, Uint8Array>; errors: string[]; pages: Record<Lang, number>; fitLevel: Record<Lang, number> }

const tick = () => new Promise((r) => setTimeout(r, 0));

/** 生成 4 个文件并打包；单个文件失败时记录错误、仍打包其余文件 */
export async function buildZip(p: ProfileDoc, tpl: TemplateConfig, r: ResumeDoc | null, names: ExportNames, fontBase: string, onProgress?: (s: string) => void, extraFiles: Record<string, Uint8Array> = {}): Promise<BuildZipResult> {
  registerPdfFonts(fontBase);
  const zip = new JSZip();
  const files: Record<string, Uint8Array> = {};
  const errors: string[] = [];
  const pages = { zh: 0, en: 0 }, fitLevel = { zh: 0, en: 0 };
  const langs: [Lang, string, string][] = [['zh', names.files.cnPdf, names.files.cnDocx], ['en', names.files.enPdf, names.files.enDocx]];
  for (const [lang, pdfName, docxName] of langs) {
    let used = tpl;
    onProgress?.(pdfName); await tick();
    try {
      const f = await renderPdfFit(p, tpl, lang, r);
      files[pdfName] = f.bytes; pages[lang] = f.pages; fitLevel[lang] = f.level; used = f.tpl;
      zip.file(pdfName, f.bytes, { binary: true });
    } catch (e) { errors.push(`${pdfName}: ${(e as Error).message}`); }
    onProgress?.(docxName); await tick();
    try { files[docxName] = await docxBytes(buildLayout(p, used, lang, r)); zip.file(docxName, files[docxName], { binary: true }); }
    catch (e) { errors.push(`${docxName}: ${(e as Error).message}`); }
  }
  for (const [n, b] of Object.entries(extraFiles)) { files[n] = b; zip.file(n, b, { binary: true }); }
  // 按 CN.pdf, CN.docx, EN.pdf, EN.docx 顺序；JSZip 对非 ASCII 文件名写入 UTF-8 标志位
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { zip: out, files, errors, pages, fitLevel };
}
