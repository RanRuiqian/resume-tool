import type { Bi, GenItem, JobParse, Lang, LocalizedText, ProfileDoc, ResumeDoc } from '../types';
import { lt } from '../locale/text';
import { runConsistency } from './generate';
import { fixedSummaryItem } from './fixedSummary';
import { sourceIdsOf } from './provenance';

export type SelKey = keyof ResumeDoc['selection'];
export const SEL_KEYS: SelKey[] = ['work', 'projects', 'education', 'skills', 'certificates', 'awards'];

/** 某条目的可选要点 */
export function entryBullets(p: ProfileDoc, k: SelKey, id: string): LocalizedText[] {
  if (k === 'work') return p.work.find((x) => x.id === id)?.bullets ?? [];
  if (k === 'projects') return p.projects.find((x) => x.id === id)?.bullets ?? [];
  if (k === 'education') return p.education.find((x) => x.id === id)?.highlights ?? [];
  return [];
}
const dateOf = (p: ProfileDoc, k: SelKey, id: string): string => {
  const e = (p[k] as unknown as { id: string; start?: string; end?: string; date?: string }[]).find((x) => x.id === id);
  const d = e?.end === 'present' ? '9999' : e?.start || e?.date || e?.end || '';
  return d;
};
/** 段内排序：有日期的按时间倒序，技能保持资料库顺序 */
export function sortSection(p: ProfileDoc, k: SelKey, ids: string[]): string[] {
  if (k === 'skills') { const order = p.skills.map((s) => s.id); return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)); }
  return [...ids].sort((a, b) => dateOf(p, k, b).localeCompare(dateOf(p, k, a)));
}

const mkItem = (b: LocalizedText, id: string): GenItem => ({ sourceId: id, zh: lt(b, 'zh', false), en: lt(b, 'en', false), syncStatus: 'in-sync' });

/** 勾选 / 取消整条经历（同时带上或移除其全部要点） */
export function toggleEntry(p: ProfileDoc, r: ResumeDoc, k: SelKey, id: string, on: boolean): ResumeDoc {
  const sel = { ...r.selection };
  const bullets = entryBullets(p, k, id).filter((b) => b.id);
  let items = r.items.filter((i) => !bullets.some((b) => sourceIdsOf(i).includes(b.id!)));
  if (on) {
    sel[k] = sortSection(p, k, [...new Set([...sel[k], id])]);
    const existing = r.items.filter((i) => sourceIdsOf(i).every((id) => bullets.some((b) => b.id === id)));
    const covered = new Set(existing.flatMap(sourceIdsOf));
    items = [...items, ...existing, ...bullets.filter((b) => !covered.has(b.id!)).map((b) => mkItem(b, b.id!))];
  } else sel[k] = sel[k].filter((x) => x !== id);
  return runConsistency({ ...r, selection: sel, items: orderItems(p, items) });
}

/** 勾选 / 取消单条要点；勾选要点时自动选中其所属经历 */
export function toggleBullet(p: ProfileDoc, r: ResumeDoc, k: SelKey, entryId: string, b: LocalizedText, on: boolean): ResumeDoc {
  const sel = { ...r.selection };
  const grouped = r.items.find((i) => sourceIdsOf(i).includes(b.id!));
  if (on && grouped) return r;
  let items = r.items.filter((i) => !sourceIdsOf(i).includes(b.id!));
  if (!on && grouped?.sourceIds) {
    const remaining = new Set(grouped.sourceIds.filter((id) => id !== b.id));
    items.push(...entryBullets(p, k, entryId).filter((x) => x.id && remaining.has(x.id)).map((x) => mkItem(x, x.id!)));
  }
  if (on) { items.push(mkItem(b, b.id!)); if (!sel[k].includes(entryId)) sel[k] = sortSection(p, k, [...sel[k], entryId]); }
  return runConsistency({ ...r, selection: sel, items: orderItems(p, items) });
}

export function toggleSummary(p: ProfileDoc, r: ResumeDoc, on: boolean): ResumeDoc {
  const items = r.items.filter((i) => i.sourceId !== 'summary');
  const summary = r.items.find((i) => i.sourceId === 'summary') ?? r.summaryBaseline ?? fixedSummaryItem(p);
  if (on && summary) items.unshift(summary);
  return runConsistency({ ...r, items });
}

/** 条目按资料库中的顺序排列（简介在前） */
function orderItems(p: ProfileDoc, items: GenItem[]): GenItem[] {
  const order = ['summary', ...p.work.flatMap((w) => w.bullets.map((b) => b.id)), ...p.projects.flatMap((w) => w.bullets.map((b) => b.id)), ...p.education.flatMap((w) => w.highlights.map((b) => b.id))];
  return [...items].sort((a, b) => order.indexOf(a.sourceId) - order.indexOf(b.sourceId));
}

/** 与岗位关键词的匹配提示（最多 3 个） */
export function matchHints(text: string, job: JobParse | null): string[] {
  if (!job) return [];
  const low = text.toLowerCase();
  const kws: Bi[] = [...job.mustHave, ...job.keywords, ...job.niceToHave];
  const out: string[] = [];
  for (const k of kws) {
    const hit = (k.zh && k.zh.length > 1 && low.includes(k.zh.toLowerCase())) || (k.en && k.en.length > 1 && low.includes(k.en.toLowerCase()));
    const label = k.zh || k.en;
    if (hit && !out.includes(label)) out.push(label);
    if (out.length >= 3) break;
  }
  return out;
}

/** 新勾选、缺少某语言的条目 */
export function missingLang(r: ResumeDoc): { id: string; to: Lang; text: string }[] {
  return r.items.filter((i) => i.sourceId !== 'summary').flatMap((i) => (!i.zh.trim() && i.en.trim() ? [{ id: i.sourceId, to: 'zh' as Lang, text: i.en }] : i.zh.trim() && !i.en.trim() ? [{ id: i.sourceId, to: 'en' as Lang, text: i.zh }] : []));
}

/** AI 不可用时：缺失语言直接使用原文 */
export function fillWithOriginal(r: ResumeDoc): ResumeDoc {
  return runConsistency({ ...r, items: r.items.map((i) => i.sourceId === 'summary' ? i : ({ ...i, zh: i.zh || i.en, en: i.en || i.zh })) });
}

/** 本份简历的人工条目顺序；不改变母库，也不重新调用 AI。 */
export function reorderEntry(r: ResumeDoc, key: SelKey, id: string, direction: -1 | 1): ResumeDoc {
  const ids = [...r.selection[key]], at = ids.indexOf(id), next = at + direction;
  if (at < 0 || next < 0 || next >= ids.length) return r;
  [ids[at], ids[next]] = [ids[next], ids[at]];
  return { ...r, selection: { ...r.selection, [key]: ids } };
}
