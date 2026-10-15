import type { Settings } from '../types';
import { ocrImage } from './jd';

/** 合并中文字符之间被 OCR 插入的空格 */
export function cleanOcrText(t: string): string {
  return t.replace(/([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])[ \t]+(?=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g, '$1').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 浏览器本地 OCR（tesseract.js，中文简体 + 英文）。图片不离开本机；首次使用会下载约 10–20 MB 识别模型并缓存 */
export async function ocrLocal(image: string | Blob, onProgress?: (p: number, status: string) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['chi_sim', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, m.status),
  });
  try { const { data } = await worker.recognize(image); return cleanOcrText(data.text); }
  finally { await worker.terminate(); }
}

/** 选择识别方式：配置了多模态模型且选择 vision 时用 AI，否则本地 OCR；AI 识别失败自动回退本地 */
export async function recognizeScreenshot(s: Settings, dataUrl: string, onProgress?: (msg: string) => void): Promise<{ text: string; via: 'vision' | 'local' }> {
  if (!s.demoMode && s.ocrMode === 'vision' && s.visionModel && s.apiKey) {
    try { onProgress?.('AI 识别截图中…'); return { text: await ocrImage(s, dataUrl), via: 'vision' }; }
    catch { onProgress?.('AI 识别失败，改用本地识别…'); }
  }
  const text = await ocrLocal(dataUrl, (p, st) => onProgress?.(st.includes('recogniz') ? `本地识别文字 ${Math.round(p * 100)}%` : '首次使用：正在加载识别模型（只需一次）…'));
  return { text, via: 'local' };
}
