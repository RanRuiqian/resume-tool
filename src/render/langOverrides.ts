import type { Lang, TemplateConfig } from '../types';

/** 把某语言自己的页边距 / 间距覆盖（locales[lang].marginMm / spacing）折进 page.marginMm / spacing。没有覆盖就原样返回。 */
export function withLangOverrides(tpl: TemplateConfig, lang: Lang): TemplateConfig {
  const loc = tpl.locales[lang];
  if (!loc?.marginMm && !loc?.spacing) return tpl;
  return { ...tpl, page: loc.marginMm ? { ...tpl.page, marginMm: loc.marginMm } : tpl.page, spacing: loc.spacing ?? tpl.spacing };
}
