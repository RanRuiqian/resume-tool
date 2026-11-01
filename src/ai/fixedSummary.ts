import type { GenItem, Lang, LocalizedText, ProfileDoc } from '../types';

/** 人工输入、已确认或无状态的旧资料可直接复用；机翻与过期译文需先在资料页确认。 */
export function fixedSummaryText(t: LocalizedText, lang: Lang): string {
  return t[lang]?.trim() && t.status?.[lang] !== 'machine' && t.status?.[lang] !== 'stale' ? t[lang]! : '';
}

export function fixedSummaryItem(p: ProfileDoc): GenItem | null {
  const zh = fixedSummaryText(p.profile.summary, 'zh'), en = fixedSummaryText(p.profile.summary, 'en');
  return zh || en ? { sourceId: 'summary', zh, en, syncStatus: zh && en ? 'in-sync' : 'needs-review' } : null;
}

export function fixedSummaryNotes(p: ProfileDoc): string[] {
  return (['zh', 'en'] as const).filter((l) => !fixedSummaryText(p.profile.summary, l))
    .map((l) => `固定简介缺少已确认${l === 'zh' ? '中文' : '英文'}：请在「我的资料 → 个人简介」填写或确认翻译建议；本次不自动生成或覆盖。`);
}
