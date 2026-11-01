import type { GenItem, Lang, LocalizedText, ProfileDoc } from '../types';

/** 已保存原文均保留；确认状态单独提示，不通过隐藏整栏冒充修复。 */
export function fixedSummaryText(t: LocalizedText, lang: Lang): string {
  return t[lang]?.trim() ? t[lang]! : '';
}

export function fixedSummaryItem(p: ProfileDoc): GenItem | null {
  const zh = fixedSummaryText(p.profile.summary, 'zh'), en = fixedSummaryText(p.profile.summary, 'en');
  const confirmedLangs = (['zh', 'en'] as const).filter((l) => p.profile.summary.status?.[l] === 'confirmed' && !!fixedSummaryText(p.profile.summary, l));
  return zh || en ? { sourceId: 'summary', zh, en, syncStatus: confirmedLangs.length === 2 ? 'in-sync' : 'needs-review', confirmedLangs } : null;
}

export function fixedSummaryNotes(p: ProfileDoc): string[] {
  return (['zh', 'en'] as const).filter((l) => p.profile.summary.status?.[l] !== 'confirmed' || !fixedSummaryText(p.profile.summary, l))
    .map((l) => `固定简介${l === 'zh' ? '中文' : '英文'}${fixedSummaryText(p.profile.summary, l) ? '待确认：保留已保存原文，请核对后再投递' : '缺少原文：请填写或确认翻译建议'}；本次不自动生成或覆盖。`);
}
