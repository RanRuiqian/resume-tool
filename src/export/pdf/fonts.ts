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
  Font.registerHyphenationCallback((word) => (hasCJK(word) ? splitCJK(word).flatMap((c) => [c, '']) : [word]));
}

export const hasCJK = (s: string) => /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(s);

const CLOSE = /^[）)】」』》〉。，、；：！？…%’”·.,;:!?]$/;
const OPEN = /^[（(【「『《〈‘“]$/;
/** 中文断行切分：汉字逐字可断；拉丁/数字连续片段不拆；避头尾标点（闭合标点不出现在行首，开标点不出现在行尾） */
export function splitCJK(word: string): string[] {
  const out: string[] = [];
  let pendingOpen = '';
  for (const ch of Array.from(word)) {
    const cjk = hasCJK(ch) && !CLOSE.test(ch) && !OPEN.test(ch);
    if (OPEN.test(ch)) { pendingOpen += ch; continue; }
    if (CLOSE.test(ch) && out.length) { out[out.length - 1] += ch; continue; }
    const last = out[out.length - 1];
    if (!pendingOpen && !cjk && last !== undefined && !hasCJK(last.slice(-1)) && !CLOSE.test(last.slice(-1))) { out[out.length - 1] += ch; continue; }
    out.push(pendingOpen + ch); pendingOpen = '';
  }
  if (pendingOpen) out.push(pendingOpen);
  return out;
}
