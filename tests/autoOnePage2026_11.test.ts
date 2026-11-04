import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { withLangOverrides } from '../src/render/langOverrides';
import { fitToOnePage, FIT_LIMITS, describeFit } from '../src/export/autoOnePage';
import type { Lang, TemplateConfig } from '../src/types';

// 假的页数测量：内容「高度」≈ 字号 × 行距 × 行数 + 间距；高度超过页面可用高度就算 2 页。全部虚构。
const LINES = { zh: 70, en: 70 } as Record<Lang, number>;
function pagesOf(t: TemplateConfig, l: Lang, lines = LINES[l]): number {
  const e = withLangOverrides(t, l), ty = t.locales[l].typography;
  const h = lines * ty.bodySizePt * ty.lineHeight * 0.3528 + 8 * e.spacing.sectionGapMm + 12 * e.spacing.itemGapMm;
  const avail = 297 - e.page.marginMm.top - e.page.marginMm.bottom;
  return h <= avail ? 1 : 2;
}
const measure = (lines: Partial<Record<Lang, number>> = {}) => async (t: TemplateConfig) => ({ zh: { pages: pagesOf(t, 'zh', lines.zh) }, en: { pages: pagesOf(t, 'en', lines.en) } });
const base = () => { const t = structuredClone(BUILTIN_TEMPLATES[0]); for (const l of ['zh', 'en'] as const) { t.locales[l].typography.bodySizePt = 10.5; t.locales[l].typography.lineHeight = 1.4; } t.spacing = { sectionGapMm: 4, itemGapMm: 2 }; t.page.marginMm = { top: 16, right: 16, bottom: 16, left: 16 }; return t; };

describe('自动调整为 1 页', () => {
  it('本来就放得下：原样返回，不改任何东西', async () => {
    const t = base(); const r = await fitToOnePage(t, measure({ zh: 20, en: 20 }));
    expect(r.changed).toBe(false); expect(r.template).toBe(t); expect(r.zh.status).toBe('already');
  });
  it('能调进去：放进 1 页，且所有参数都不越过下限', async () => {
    const t = base(); let n = 0;
    const r = await fitToOnePage(t, async (x) => { n++; return measure({ zh: 60, en: 60 })(x); });
    expect(r.changed).toBe(true);
    for (const l of ['zh', 'en'] as const) {
      expect(r[l].status).toBe('fitted'); expect(pagesOf(r.template, l, 60)).toBe(1);
      const ty = r.template.locales[l].typography, e = withLangOverrides(r.template, l);
      expect(ty.bodySizePt).toBeGreaterThanOrEqual(FIT_LIMITS.bodyPt); expect(ty.lineHeight).toBeGreaterThanOrEqual(FIT_LIMITS.lineHeight);
      expect(e.spacing.sectionGapMm).toBeGreaterThanOrEqual(FIT_LIMITS.sectionGapMm); expect(e.spacing.itemGapMm).toBeGreaterThanOrEqual(FIT_LIMITS.itemGapMm);
      expect(Math.min(...Object.values(e.page.marginMm))).toBeGreaterThanOrEqual(FIT_LIMITS.marginMm);
    }
    expect(n).toBeLessThan(30);
  });
  it('调得尽量少：比刚好放得下再松一点点就放不下了（二分查找的最小幅度）', async () => {
    const t = base(); const r = await fitToOnePage(t, measure({ zh: 60, en: 20 }));
    expect(r.zh.status).toBe('fitted'); expect(r.en.status).toBe('already');
    const eased = structuredClone(r.template); eased.locales.zh.typography.bodySizePt = Math.min(10.5, eased.locales.zh.typography.bodySizePt + 0.4);
    expect(pagesOf(eased, 'zh', 60)).toBe(2);
  });
  it('推到下限仍放不下：不做任何修改，状态为 failed', async () => {
    const t = base(); const r = await fitToOnePage(t, measure({ zh: 400, en: 400 }));
    expect(r.changed).toBe(false); expect(r.template).toBe(t); expect(r.zh.status).toBe('failed'); expect(r.en.status).toBe('failed');
  });
  it('中英文分别处理：中文能调进去、英文调不进去 → 只改中文', async () => {
    const t = base(); const r = await fitToOnePage(t, measure({ zh: 60, en: 400 }));
    expect(r.zh.status).toBe('fitted'); expect(r.en.status).toBe('failed');
    expect(r.template.locales.en.typography.bodySizePt).toBe(10.5); expect(r.template.locales.zh.typography.bodySizePt).toBeLessThan(10.5);
  });
  it('当前值本来就低于下限的项不会被调高（手动 6 mm 页边距保持 6 mm）', async () => {
    const t = base(); t.page.marginMm = { top: 6, right: 6, bottom: 6, left: 6 }; t.locales.zh.typography.bodySizePt = 9;
    const r = await fitToOnePage(t, measure({ zh: 60, en: 20 }));
    const e = withLangOverrides(r.template, 'zh');
    expect(e.page.marginMm.top).toBeLessThanOrEqual(6); expect(r.template.locales.zh.typography.bodySizePt).toBeLessThanOrEqual(9);
  });
  it('测量不可用时中止且不改任何东西；describeFit 给出人话', async () => {
    await expect(fitToOnePage(base(), async () => null)).rejects.toThrow(/测量不可用/);
    const r = await fitToOnePage(base(), measure({ zh: 60, en: 20 }));
    expect(describeFit(r.zh)).toMatch(/正文|行距|间距|页边距/); expect(describeFit(r.en)).toBe('无变化');
  });
});
