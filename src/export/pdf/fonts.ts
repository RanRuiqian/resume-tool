import { Font } from '@react-pdf/renderer';

let registered = false;
/** 注册 Noto Sans SC 子集（GB2312 常用字 + 拉丁），PDF 嵌入时 fontkit 会再按实际用字子集化 */
export function registerPdfFonts(base: string) {
  if (registered) return;
  registered = true;
  const b = base.endsWith('/') ? base : base + '/';
  Font.register({
    family: 'NotoSansSC',
    fonts: [{ src: `${b}NotoSansSC-Regular.otf` }, { src: `${b}NotoSansSC-Bold.otf`, fontWeight: 700 }],
  });
  // 中文断行：CJK 片段逐字可断；拉丁单词保持整体，不加连字符
  Font.registerHyphenationCallback((word) => (/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(word) ? Array.from(word).flatMap((c) => [c, '']) : [word]));
}

export const hasCJK = (s: string) => /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(s);
