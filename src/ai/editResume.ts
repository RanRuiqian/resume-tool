import type { GenItem, Lang, ResumeDoc } from '../types';
import { compareFacts } from './consistency';
import { runConsistency } from './generate';

/** 人工编辑立即生效；一致性信息只是提示，不限制预览或导出。 */
export function editResumeItem(r: ResumeDoc, sourceId: string, lang: Lang, text: string): ResumeDoc {
  const items = r.items.map((item): GenItem => {
    if (item.sourceId !== sourceId) return item;
    if (lang === r.primaryLanguage) return { ...item, manual: true, [lang]: text, syncStatus: 'pending', confirmedLangs: [lang] };
    const factIssues = compareFacts(item[r.primaryLanguage], text);
    return { ...item, manual: true, [lang]: text, confirmedLangs: [...new Set([...(item.confirmedLangs ?? []), lang])], syncStatus: factIssues.length ? 'needs-review' : 'in-sync', translation: { source: item.translation?.source ?? 'ai', aiText: item.translation?.aiText, factIssues, checkedAt: new Date().toISOString() } };
  });
  return runConsistency({ ...r, items });
}
