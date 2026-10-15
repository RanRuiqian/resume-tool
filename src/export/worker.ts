/// <reference lib="webworker" />
import { buildZip, renderPdfFit } from './zip';
import { registerPdfFonts } from './pdf/fonts';

/** PDF/Word 在 Web Worker 中生成，避免阻塞界面 */
self.onmessage = async (ev: MessageEvent) => {
  const { id, type, args } = ev.data;
  try {
    if (type === 'zip') {
      const r = await buildZip(args.profile, args.tpl, args.resume, args.names, args.fontBase, (f) => self.postMessage({ id, progress: f }), args.extraFiles ?? {});
      self.postMessage({ id, result: r }, [r.zip.buffer]);
    } else if (type === 'pages') {
      registerPdfFonts(args.fontBase);
      const out: Record<string, { pages: number; level: number; overflow: boolean }> = {};
      for (const lang of args.langs) { const f = await renderPdfFit(args.profile, args.tpl, lang, args.resume); out[lang] = { pages: f.pages, level: f.level, overflow: f.overflow }; }
      self.postMessage({ id, result: out });
    }
  } catch (e) { self.postMessage({ id, error: (e as Error).message }); }
};
