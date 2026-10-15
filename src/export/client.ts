import type { Lang, ProfileDoc, ResumeDoc, TemplateConfig } from '../types';
import type { ExportNames } from './naming';
import type { BuildZipResult } from './zip';

let worker: Worker | null = null;
let seq = 0;
let broken = false;
const pending = new Map<number, (e: Error) => void>();
const fontBase = () => new URL(`${import.meta.env.BASE_URL}fonts/`, location.href).href;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('error', (e) => { console.warn('pdf worker error', e.message); broken = true; pending.forEach((rej) => rej(new Error('worker-crashed'))); pending.clear(); worker?.terminate(); worker = null; });
  } catch { worker = null; }
  return worker;
}

function call<T>(type: string, args: unknown, onProgress?: (s: string) => void): Promise<T> {
  const w = broken ? null : getWorker();
  if (!w) return Promise.reject(new Error('no-worker'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, reject);
    // 超时保护：Worker 卡住时回退主线程
    const timer = setTimeout(() => { pending.delete(id); w.removeEventListener('message', h); reject(new Error('worker-timeout')); }, 90000);
    const h = (ev: MessageEvent) => {
      if (ev.data.id !== id) return;
      if (ev.data.progress) { onProgress?.(ev.data.progress); return; }
      clearTimeout(timer); pending.delete(id);
      w.removeEventListener('message', h);
      if (ev.data.error) reject(new Error(ev.data.error)); else resolve(ev.data.result as T);
    };
    w.addEventListener('message', h);
    w.postMessage({ id, type, args });
  });
}

/** 优先在 Worker 中生成；Worker 不可用时回退主线程 */
export async function exportZip(profile: ProfileDoc, tpl: TemplateConfig, resume: ResumeDoc | null, names: ExportNames, onProgress?: (s: string) => void, extraFiles: Record<string, Uint8Array> = {}): Promise<BuildZipResult> {
  try { return await call<BuildZipResult>('zip', { profile, tpl, resume, names, fontBase: fontBase(), extraFiles }, onProgress); }
  catch (e) {
    if ((e as Error).message !== 'no-worker') console.warn('worker export failed, fallback', e);
    const { buildZip } = await import('./zip');
    return buildZip(profile, tpl, resume, names, fontBase(), onProgress, extraFiles);
  }
}

export type PageInfo = Record<Lang, { pages: number; level: number; overflow: boolean }>;
export async function measurePages(profile: ProfileDoc, tpl: TemplateConfig, resume: ResumeDoc | null): Promise<PageInfo | null> {
  try { return await call<PageInfo>('pages', { profile, tpl, resume, langs: ['zh', 'en'], fontBase: fontBase() }); }
  catch { return null; }
}
