import type { GenItem, ResumeDoc } from '../types';
import { compareFacts } from './consistency';
import { crossCheck } from '../quality/factCheck';
import { guardRewrite } from '../quality/resumeGuard';

export function summaryVariantIssues(base: GenItem, draft: { zh: string; en: string }): string[] {
  const issues: string[] = [];
  for (const l of ['zh', 'en'] as const) {
    if (!base[l].trim() && draft[l].trim()) issues.push(`${l}：没有原始固定版，请先在资料页补充并审核该语言`);
    if (base[l].trim() && !draft[l].trim()) issues.push(`${l}：不能以微调清空固定简介`);
    if (draft[l].trim()) issues.push(...compareFacts(base[l], draft[l]), ...guardRewrite(base[l], draft[l], l));
  }
  if (draft.zh.trim() && draft.en.trim()) issues.push(...crossCheck(draft.zh, draft.en));
  return [...new Set(issues)];
}
export function applySummaryVariant(r: ResumeDoc, draft: { zh: string; en: string }): ResumeDoc {
  const base = r.summaryBaseline ?? r.items.find((i) => i.sourceId === 'summary');
  if (!base) throw new Error('没有固定简介快照，请先在资料页保存简介再生成');
  const issues = summaryVariantIssues(base, draft);
  if (issues.length) throw new Error(issues.join('；'));
  const item: GenItem = { sourceId: 'summary', ...draft, syncStatus: 'needs-review', confirmedLangs: [] };
  // 用户确认应用文案与事实审查接受是两件事；保留待核对，不绕过审查。
  return { ...r, summaryBaseline: structuredClone(base), items: r.items.map((i) => i.sourceId === 'summary' ? item : i) };
}
export function restoreSummaryBaseline(r: ResumeDoc): ResumeDoc {
  return r.summaryBaseline ? { ...r, items: [structuredClone(r.summaryBaseline), ...r.items.filter((i) => i.sourceId !== 'summary')] } : r;
}
