import { ocrLocal, ocrStage } from './ocr';

export type Progress = (msg: string, pct?: number) => void;

/** 从 PDF 提取文字；扫描件（几乎没有文字层）则逐页渲染后本地 OCR */
export async function pdfToText(file: File, onProgress?: Progress): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.(`读取 PDF 第 ${i}/${doc.numPages} 页`, i / doc.numPages);
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '', out = '', lastY: number | null = null;
    for (const it of tc.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = it.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) { out += line.trim() + '\n'; line = ''; }
      line += it.str; lastY = y ?? lastY;
      if (it.hasEOL) { out += line.trim() + '\n'; line = ''; lastY = null; }
    }
    pages.push((out + line).trim());
  }
  const text = pages.join('\n\n').trim();
  if (text.replace(/\s/g, '').length >= 40 * doc.numPages * 0.5) return text;
  // 扫描版：渲染为图片后 OCR（最多前 4 页）
  const parts: string[] = [];
  const n = Math.min(doc.numPages, 4);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    parts.push(await ocrLocal(canvas.toDataURL('image/png'), (p, st) => onProgress?.(`扫描件第 ${i}/${n} 页：${ocrStage(st)}`, p)));
  }
  return parts.join('\n\n');
}

export async function docxToText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return r.value.replace(/\n{3,}/g, '\n\n').trim();
}

/** 读取用户上传的旧简历：txt / md / pdf / docx / 图片 */
export async function fileToText(file: File, onProgress?: Progress): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfToText(file, onProgress);
  if (name.endsWith('.docx')) { onProgress?.('读取 Word 文档'); return docxToText(file); }
  if (name.endsWith('.doc')) throw new Error('暂不支持旧版 .doc，请在 Word 中另存为 .docx 或 PDF');
  if (file.type.startsWith('image/')) {
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
    return ocrLocal(url, (p, st) => onProgress?.(ocrStage(st), p));
  }
  return file.text();
}
