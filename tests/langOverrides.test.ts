import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { personalFixture } from './helpers/v112PersonalFixture';
import { buildLayout } from '../src/render/layout';
import { withLangOverrides } from '../src/render/langOverrides';
import { fitTemplate } from '../src/export/fit';
import { pageBudget } from '../src/ai/contentStrategy';

const base = () => structuredClone(BUILTIN_TEMPLATES[0]);
describe('中英文各自的页边距 / 间距覆盖', () => {
  it('没有覆盖时原样返回', () => { const t = base(); expect(withLangOverrides(t, 'en')).toBe(t); });
  it('只对设置了覆盖的语言生效', () => {
    const t = base(); t.locales.en.marginMm = { top: 9, right: 10, bottom: 9, left: 10 }; t.locales.en.spacing = { sectionGapMm: 1, itemGapMm: 0.5 };
    const p = personalFixture();
    const en = buildLayout(p, t, 'en'), zh = buildLayout(p, t, 'zh');
    expect(en.marginMm).toEqual({ top: 9, right: 10, bottom: 9, left: 10 });
    expect(en.spacing).toEqual({ sectionGapMm: 1, itemGapMm: 0.5 });
    expect(zh.marginMm).toEqual(t.page.marginMm);
    expect(zh.spacing).toEqual(t.spacing);
    expect(pageBudget(1, 'en', t).marginMm).toEqual(t.locales.en.marginMm);
  });
  it('自动适配在覆盖值基础上收紧，不会被覆盖值盖回去', () => {
    const t = base(); t.locales.en.marginMm = { top: 20, right: 20, bottom: 20, left: 20 };
    const fitted = fitTemplate(t, 'en', 2);
    expect(fitted.locales.en.marginMm).toBeUndefined();
    expect(fitted.page.marginMm.left).toBeLessThan(20); expect(fitted.page.marginMm.left).toBeGreaterThan(14);
    expect(buildLayout(personalFixture(), fitted, 'en').marginMm.left).toBe(fitted.page.marginMm.left);
  });
});
