import type { GenItem, LocalizedText, ProfileDoc } from '../types';

export const sourceIdsOf = (item: Pick<GenItem, 'sourceId' | 'sourceIds'>): string[] => Array.isArray(item.sourceIds) ? item.sourceIds : [item.sourceId];

export function sourceText(p: ProfileDoc, item: Pick<GenItem, 'sourceId' | 'sourceIds'>): LocalizedText {
  if (item.sourceId === 'summary') return p.profile.summary;
  const facts = [...p.work, ...p.projects].flatMap((x) => x.bullets).concat(p.education.flatMap((x) => x.highlights));
  const selected = sourceIdsOf(item).map((id) => facts.find((b) => b.id === id)).filter((x): x is LocalizedText => !!x);
  if (selected.length === 1) return selected[0];
  const state = (l: 'zh' | 'en') => selected.some((x) => x.status?.[l] === 'stale') ? 'stale'
    : selected.some((x) => x.status?.[l] === 'machine') ? 'machine' : selected.every((x) => x.status?.[l] === 'confirmed') ? 'confirmed' : 'manual';
  return { zh: selected.map((x) => x.zh ?? '').filter(Boolean).join('\n'), en: selected.map((x) => x.en ?? '').filter(Boolean).join('\n'), status: { zh: state('zh'), en: state('en') } };
}
