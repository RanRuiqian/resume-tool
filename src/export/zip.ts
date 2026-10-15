import JSZip from 'jszip';
import { pdf } from '@react-pdf/renderer';
import { createElement } from 'react';
import type { Lang, ProfileDoc, ResumeDoc, TemplateConfig } from '../types';
import { buildLayout } from '../render/layout';
import { ResumePdf } from './pdf/ResumePdf';
import { registerPdfFonts } from './pdf/fonts';
import { docxBytes } from './docx/resumeDocx';
import type { ExportNames } from './naming';

export async function pdfBytes(p: ProfileDoc, tpl: TemplateConfig, lang: Lang, r: ResumeDoc | null): Promise<Uint8Array> {
  const m = buildLayout(p, tpl, lang, r);
  // react-pdf 的 DocumentProps 类型较严格，这里经 createElement 构造
  const inst = pdf(createElement(ResumePdf, { m }) as never);
  const blob = await inst.toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

export interface BuildZipResult { zip: Uint8Array; files: Record<string, Uint8Array>; errors: string[] }

/** 生成 4 个文件并打包；单个文件失败时记录错误、仍打包其余文件（PRD 4 异常路径） */
export async function buildZip(p: ProfileDoc, tpl: TemplateConfig, r: ResumeDoc | null, names: ExportNames, fontBase: string, onProgress?: (s: string) => void): Promise<BuildZipResult> {
  registerPdfFonts(fontBase);
  const zip = new JSZip();
  const files: Record<string, Uint8Array> = {};
  const errors: string[] = [];
  const jobs: [string, () => Promise<Uint8Array>][] = [
    [names.files.cnPdf, () => pdfBytes(p, tpl, 'zh', r)],
    [names.files.cnDocx, () => docxBytes(buildLayout(p, tpl, 'zh', r))],
    [names.files.enPdf, () => pdfBytes(p, tpl, 'en', r)],
    [names.files.enDocx, () => docxBytes(buildLayout(p, tpl, 'en', r))],
  ];
  for (const [name, fn] of jobs) {
    onProgress?.(name);
    try { files[name] = await fn(); zip.file(name, files[name], { binary: true }); }
    catch (e) { errors.push(`${name}: ${(e as Error).message}`); }
  }
  // JSZip 对非 ASCII 文件名默认写入 UTF-8 编码并设置通用标志位 bit 11
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { zip: out, files, errors };
}
