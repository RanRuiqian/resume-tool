import type { Lang, TemplateConfig } from '../types';

export const MAX_FIT_LEVEL = 6;
/** 自动适配页数：逐级收紧字号、行高、间距与页边距（每级约 4–6%） */
export function fitTemplate(tpl: TemplateConfig, lang: Lang, level: number): TemplateConfig {
  if (level <= 0) return tpl;
  const t = structuredClone(tpl);
  const ty = t.locales[lang].typography;
  const minBody = t.page.minBodyPt ?? 9; // v1.10：正文字号下限 9pt，放不下时提示删减低相关内容，而不是继续缩小
  ty.bodySizePt = Math.max(Math.min(minBody, ty.bodySizePt), ty.bodySizePt - 0.25 * level);
  ty.nameSizePt = Math.max(t.page.minBodyPt ? 18 : 15, ty.nameSizePt - 0.5 * level);
  ty.lineHeight = Math.max(t.page.minBodyPt ? 1.25 : 1.15, ty.lineHeight - 0.035 * level);
  const k = Math.pow(0.85, level);
  t.spacing = { sectionGapMm: Math.max(1.5, t.spacing.sectionGapMm * k), itemGapMm: Math.max(0.8, t.spacing.itemGapMm * k) };
  const mk = Math.pow(0.92, level);
  const m = t.page.marginMm;
  const mf = t.page.minBodyPt ? 3 : 0; // 工科正式版：页边距不低于约 11–12mm
  t.page.marginMm = { top: Math.max(8 + mf, m.top * mk), right: Math.max(9 + mf, m.right * mk), bottom: Math.max(8 + mf, m.bottom * mk), left: Math.max(9 + mf, m.left * mk) };
  return t;
}

/** 统计 PDF 页数（react-pdf 输出的对象字典未压缩） */
export function countPdfPages(bytes: Uint8Array): number {
  // latin1 解码，避免大参数展开在 Worker 中栈溢出
  const s = new TextDecoder('latin1').decode(bytes);
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}
