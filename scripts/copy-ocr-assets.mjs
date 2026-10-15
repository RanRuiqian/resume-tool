// 构建前把 tesseract.js 的 worker 与 wasm core 复制到 public/ocr（自托管，不依赖 CDN）
import { cpSync, mkdirSync } from 'node:fs';
const out = 'public/ocr/core';
mkdirSync(out, { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
for (const v of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) cpSync(`node_modules/tesseract.js-core/tesseract-core-${v}.wasm.js`, `${out}/tesseract-core-${v}.wasm.js`);
console.log('OCR assets copied');
