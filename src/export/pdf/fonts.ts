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
  // v1.7：Arimo（与 Arial 等宽度度量，OFL）用于英文正式版，PDF 内嵌，Word 端映射为 Arial
  Font.register({
    family: 'Arimo',
    fonts: [{ src: `${b}Arimo-Regular.ttf` }, { src: `${b}Arimo-Bold.ttf`, fontWeight: 700 }],
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

/** Helvetica / Times 为 PDF 标准字体（WinAnsi 编码），希腊字母（μ、Ω）、≤ ≥ → 等符号会缺字；这类文本改用内嵌的 NotoSansSC */
// oxlint-disable-next-line no-control-regex -- 需要匹配 WinAnsi 之外的字符
const NON_WINANSI = /[^\u0000-\u00ff\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc]/;
export function fontFor(m: { lang: string; typography: { fontFamily: string } }, s: string) {
  const f = m.typography.fontFamily;
  if (m.lang === 'zh' || hasCJK(s) || f === 'Noto Sans SC') return 'NotoSansSC';
  if ((f === 'Helvetica' || f === 'Times-Roman') && NON_WINANSI.test(s)) return 'NotoSansSC';
  return f;
}

