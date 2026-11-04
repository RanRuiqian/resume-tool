import type { Lang, TemplateConfig } from '../types';
import { withLangOverrides } from '../render/langOverrides';

/**
 * 「自动调整为 1 页」：只动版式参数，不删内容。
 * 把正文字号、行距、板块间距、条目间距、页边距**同比例**从当前值往下限推（调整幅度 t：0 = 不动，1 = 推到下限），
 * 用真实 PDF 页数二分查找「刚好放进目标页数」的最小幅度，所以能不动就不动、动也动得最少。
 * 中文版、英文版分别调（英文同样内容通常更占版面），互不影响。
 *
 * 下限（负责人要求「别为了凑页把字压得太小、行太挤」）：
 *   正文 ≥ 9.5 pt；行距 ≥ 1.12；板块间距 ≥ 1 mm；条目间距 ≥ 0.3 mm；页边距 ≥ 10 mm。
 * 当前值本来就低于下限的项目（例如手动设了 6 mm 页边距）保持原样，绝不反向调高。
 * 推到下限仍放不进 1 页：不做任何修改（压到下限也还是 2 页只会更难看），由界面提示改用「自动删减」。
 */
export const FIT_LIMITS = { bodyPt: 9.5, lineHeight: 1.12, sectionGapMm: 1, itemGapMm: 0.3, marginMm: 10 } as const;

type Mg = { top: number; right: number; bottom: number; left: number };
interface Params { body: number; lh: number; sg: number; ig: number; mg: Mg }
export interface PagesMeasure { zh: { pages: number }; en: { pages: number } }
export type FitStatus = 'already' | 'fitted' | 'failed';
export interface LangFit { status: FitStatus; before: Params; after: Params }
export interface OnePageResult { template: TemplateConfig; zh: LangFit; en: LangFit; changed: boolean }

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const LANGS: Lang[] = ['zh', 'en'];

function current(tpl: TemplateConfig, l: Lang): Params {
  const e = withLangOverrides(tpl, l);
  return { body: tpl.locales[l].typography.bodySizePt, lh: tpl.locales[l].typography.lineHeight, sg: e.spacing.sectionGapMm, ig: e.spacing.itemGapMm, mg: { ...e.page.marginMm } };
}
const floorOf = (c: Params): Params => ({
  body: Math.min(c.body, FIT_LIMITS.bodyPt), lh: Math.min(c.lh, FIT_LIMITS.lineHeight), sg: Math.min(c.sg, FIT_LIMITS.sectionGapMm), ig: Math.min(c.ig, FIT_LIMITS.itemGapMm),
  mg: Object.fromEntries(SIDES.map((s) => [s, Math.min(c.mg[s], FIT_LIMITS.marginMm)])) as Mg,
});
/** 向下取整到步长，保证不会因为四舍五入越过下限 */
const lerp = (a: number, b: number, t: number, step: number) => { const v = a + (b - a) * t; return Math.round(Math.max(b, Math.min(a, Math.round(v / step) * step)) * 1000) / 1000; };
export function paramsAt(c: Params, t: number): Params {
  const f = floorOf(c);
  return { body: lerp(c.body, f.body, t, 0.05), lh: lerp(c.lh, f.lh, t, 0.01), sg: lerp(c.sg, f.sg, t, 0.1), ig: lerp(c.ig, f.ig, t, 0.1), mg: Object.fromEntries(SIDES.map((s) => [s, lerp(c.mg[s], f.mg[s], t, 0.1)])) as Mg };
}

function withParams(tpl: TemplateConfig, l: Lang, p: Params): TemplateConfig {
  const x = structuredClone(tpl);
  x.locales[l].typography.bodySizePt = p.body; x.locales[l].typography.lineHeight = p.lh;
  x.locales[l].spacing = { sectionGapMm: p.sg, itemGapMm: p.ig }; x.locales[l].marginMm = { ...p.mg };
  return x;
}
/** 两种语言的间距 / 页边距相同时，收回成模板本体的值（和快捷版式面板的做法一致），保持模板整洁。 */
function tidy(x: TemplateConfig): TemplateConfig {
  const [a, b] = LANGS.map((l) => withLangOverrides(x, l));
  if (JSON.stringify(a.page.marginMm) === JSON.stringify(b.page.marginMm)) { x.page.marginMm = { ...a.page.marginMm }; for (const l of LANGS) delete x.locales[l].marginMm; }
  if (JSON.stringify(a.spacing) === JSON.stringify(b.spacing)) { x.spacing = { ...a.spacing }; for (const l of LANGS) delete x.locales[l].spacing; }
  return x;
}

/**
 * measure：对给定模板返回中英文实测页数（调用方应让它按「不自动缩排」测量）。返回 null = 测量不可用，抛错中止，不改任何东西。
 */
export async function fitToOnePage(tpl: TemplateConfig, measure: (t: TemplateConfig) => Promise<PagesMeasure | null>, target = 1, steps = 7): Promise<OnePageResult> {
  let work = structuredClone(tpl), changed = false;
  const out = {} as Record<Lang, LangFit>;
  for (const l of LANGS) {
    const cur = current(work, l);
    const pagesAt = async (t: number) => {
      const m = await measure(withParams(work, l, paramsAt(cur, t)));
      if (!m) throw new Error('页数测量不可用，无法自动调整');
      return m[l].pages;
    };
    if (await pagesAt(0) <= target) { out[l] = { status: 'already', before: cur, after: cur }; continue; }
    if (await pagesAt(1) > target) { out[l] = { status: 'failed', before: cur, after: cur }; continue; }
    let lo = 0, hi = 1;                          // lo 放不下，hi 放得下
    for (let i = 0; i < steps; i++) { const mid = (lo + hi) / 2; if (await pagesAt(mid) <= target) hi = mid; else lo = mid; }
    const after = paramsAt(cur, hi);
    work = withParams(work, l, after); changed = true;
    out[l] = { status: 'fitted', before: cur, after };
  }
  return { template: changed ? tidy(work) : tpl, zh: out.zh, en: out.en, changed };
}

/** 给用户看的一句话：这一种语言调成了什么样。 */
export function describeFit(f: LangFit): string {
  const d = (a: number, b: number, unit: string, label: string) => (Math.abs(a - b) < 1e-6 ? '' : `${label} ${a}→${b}${unit}`);
  const parts = [d(f.before.body, f.after.body, ' pt', '正文'), d(f.before.lh, f.after.lh, '', '行距'), d(f.before.sg, f.after.sg, ' mm', '板块间距'), d(f.before.ig, f.after.ig, ' mm', '条目间距'),
    d(f.before.mg.top, f.after.mg.top, ' mm', '页边距')].filter(Boolean);
  return parts.join('，') || '无变化';
}
