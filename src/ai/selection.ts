import type { GenItem, LocalizedText, ProfileDoc, ResumeDoc } from '../types';
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

const mkItem = (b: LocalizedText, id: string): GenItem => {
  const zh = lt(b, 'zh', false), en = lt(b, 'en', false);
  return { sourceId: id, zh, en, syncStatus: zh.trim() && en.trim() ? 'in-sync' : 'pending' };
};

/** 保存取消前的最新文案。缓存属于简历，不能改变资料库。 */
function remember(r: ResumeDoc, removed: GenItem[]): GenItem[] {
  const ids = new Set(removed.flatMap(sourceIdsOf));
  return [...(r.deselectedItems ?? []).filter((i) => !sourceIdsOf(i).some((id) => ids.has(id))), ...removed];
}
const hiddenEntries = (r: ResumeDoc, key: SelKey) => Object.entries(r.entrySelectionMemory ?? {})
  .filter(([id]) => id.startsWith(`${key}:`) && !r.selection[key].includes(id.slice(key.length + 1)))
  .map(([id, value]) => ({ id: id.slice(key.length + 1), index: value.index })).sort((a, b) => a.index - b.index);

/** 勾选 / 取消整条经历（同时带上或移除其全部要点） */
export function toggleEntry(p: ProfileDoc, r: ResumeDoc, k: SelKey, id: string, on: boolean): ResumeDoc {
  if (r.selection[k].includes(id) === on) return r;
  const sel = { ...r.selection };
  const bullets = entryBullets(p, k, id).filter((b) => b.id);
  const belongs = (i: GenItem) => bullets.some((b) => sourceIdsOf(i).includes(b.id!));
  const removed = r.items.filter(belongs);
  let items = r.items.filter((i) => !belongs(i));
  let deselectedItems = r.deselectedItems ?? [];
  const memory = { ...r.entrySelectionMemory }, key = `${k}:${id}`;
  const hidden = hiddenEntries(r, k);
  if (on) {
    sel[k] = [...sel[k]];
    if (memory[key]) sel[k].splice(Math.max(0, Math.min(memory[key].index - hidden.filter((e) => e.index < memory[key].index).length, sel[k].length)), 0, id);
    else sel[k] = sortSection(p, k, [...sel[k], id]);
    const wanted = new Set(memory[key]?.sourceIds ?? bullets.map((b) => b.id!));
    const allowed = new Set(bullets.map((b) => b.id!));
    const existing = deselectedItems.filter((i) => belongs(i) && sourceIdsOf(i).every((s) => wanted.has(s) && allowed.has(s)));
    const covered = new Set(existing.flatMap(sourceIdsOf));
    items = [...items, ...existing, ...bullets.filter((b) => wanted.has(b.id!) && !covered.has(b.id!)).map((b) => mkItem(b, b.id!))];
    deselectedItems = deselectedItems.filter((i) => !existing.includes(i));
  } else {
    let index = sel[k].indexOf(id);
    for (const e of hidden) if (e.index <= index) index++;
    memory[key] = { sourceIds: removed.flatMap(sourceIdsOf), index };
    deselectedItems = remember(r, removed);
    sel[k] = sel[k].filter((x) => x !== id);
  }
  return runConsistency({ ...r, selection: sel, ...orderItems(r, items), deselectedItems, entrySelectionMemory: memory });
}

/** 勾选 / 取消单条要点；勾选要点时自动选中其所属经历 */
export function toggleBullet(p: ProfileDoc, r: ResumeDoc, k: SelKey, entryId: string, b: LocalizedText, on: boolean): ResumeDoc {
  const sel = { ...r.selection };
  const grouped = r.items.find((i) => sourceIdsOf(i).includes(b.id!));
  if (on && grouped) return r;
  const items = r.items.filter((i) => i !== grouped);
  let deselectedItems = r.deselectedItems ?? [];
  if (!on && grouped) deselectedItems = remember(r, [grouped]);
  if (on) {
    // 合并后的 AI 句子是一个选择单元，整体恢复，不能留下已取消来源的事实。
    const allowed = new Set(entryBullets(p, k, entryId).map((x) => x.id));
    const saved = deselectedItems.find((i) => sourceIdsOf(i).includes(b.id!) && sourceIdsOf(i).every((s) => allowed.has(s)));
    const restored = { ...(saved ?? mkItem(b, b.id!)), manual: true as const };
    const covered = new Set(sourceIdsOf(restored));
    items.splice(0, items.length, ...items.filter((i) => !sourceIdsOf(i).some((s) => covered.has(s))), restored);
    deselectedItems = deselectedItems.filter((i) => i !== saved);
    if (!sel[k].includes(entryId)) sel[k] = sortSection(p, k, [...sel[k], entryId]);
  }
  return runConsistency({ ...r, selection: sel, ...orderItems(r, items), deselectedItems });
}

export function toggleSummary(p: ProfileDoc, r: ResumeDoc, on: boolean): ResumeDoc {
  const items = r.items.filter((i) => i.sourceId !== 'summary');
  const active = r.items.find((i) => i.sourceId === 'summary');
  const summary = active ?? r.deselectedItems?.find((i) => i.sourceId === 'summary') ?? r.summaryBaseline ?? fixedSummaryItem(p);
  if (on && summary) items.unshift(summary);
  return runConsistency({ ...r, items, deselectedItems: on ? r.deselectedItems?.filter((i) => i.sourceId !== 'summary') : remember(r, active ? [active] : []) });
}

/** 不因切换素材重排 AI 已选要点；暂存项恢复原来的位置。 */
function orderItems(r: ResumeDoc, items: GenItem[]): Pick<ResumeDoc, 'items' | 'itemOrder'> {
  const itemOrder = [...new Set([...(r.itemOrder ?? r.items.map((i) => i.sourceId)), ...items.map((i) => i.sourceId)])];
  return { itemOrder, items: [...items].sort((a, b) => itemOrder.indexOf(a.sourceId) - itemOrder.indexOf(b.sourceId)) };
}

/** 本份简历的人工条目顺序；不改变母库，也不重新调用 AI。 */
export function reorderEntry(r: ResumeDoc, key: SelKey, id: string, direction: -1 | 1): ResumeDoc {
  const ids = [...r.selection[key]], at = ids.indexOf(id), next = at + direction;
  if (at < 0 || next < 0 || next >= ids.length) return r;
  [ids[at], ids[next]] = [ids[next], ids[at]];
  const full = [...ids], memory = { ...r.entrySelectionMemory };
  for (const e of hiddenEntries(r, key)) full.splice(e.index, 0, e.id);
  for (const entryId of ids) if (memory[`${key}:${entryId}`]) memory[`${key}:${entryId}`] = { ...memory[`${key}:${entryId}`], index: full.indexOf(entryId) };
  return { ...r, selection: { ...r.selection, [key]: ids }, entrySelectionMemory: memory };
}
