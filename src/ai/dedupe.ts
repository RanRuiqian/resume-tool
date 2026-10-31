import type { LocalizedText, ProfileDoc, WorkKind } from '../types';

/**
 * 通用去重（v1.6）：只依据结构化信号（日期区间、名称在中 / 英文各自的相似度、别名、类型），
 * 不包含任何特定用户、学校或单位的规则。仅凭共同关键词不会判为重复。
 */
export type DedupeSection = 'education' | 'work' | 'projects' | 'skills' | 'certificates' | 'awards' | 'evidence';
type AnyEntry = Record<string, unknown> & { id: string };

const STRIP = /(股份有限公司|有限责任公司|有限公司|集团|公司|科技|技术|\(中国\)|（中国）|co\.?,?\s*ltd\.?|inc\.?|ltd\.?|corp\.?|corporation|limited|company)/gi;
export function normName(s: string): string {
  return s.toLowerCase().replace(STRIP, '').replace(/[\s·,，.。()（）\-_/、:：'"“”]/g, '');
}
/** 字符二元组 Dice 相似度（0–1），对中英文都可用 */
export function similarity(a: string, b: string): number {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return 0.9;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const A = grams(x), B = grams(y); let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const tot = Math.max(1, x.length - 1) + Math.max(1, y.length - 1);
  return (2 * inter) / tot;
}

const NAME_FIELD: Record<DedupeSection, string[]> = { education: ['school'], work: ['company'], projects: ['name'], skills: ['name'], certificates: ['name'], awards: ['name'], evidence: [] };
const isZh = (s: string) => /[\u4e00-\u9fff]/.test(s);
/** 一条记录所有称呼：主字段中英文 + 别名 */
export function namesOf(sec: DedupeSection, e: AnyEntry): string[] {
  const out: string[] = [];
  for (const f of NAME_FIELD[sec]) { const t = e[f] as LocalizedText | undefined; if (t?.zh?.trim()) out.push(t.zh); if (t?.en?.trim()) out.push(t.en); }
  if (sec === 'evidence' && typeof e.fileName === 'string' && e.fileName) out.push(e.fileName);
  for (const a of (Array.isArray(e.aliases) ? e.aliases : []) as string[]) if (a?.trim()) out.push(a);
  return out;
}
/** 只在同一语言的写法之间比较（中文与英文之间字符相似度没有意义） */
function bestNameSim(a: string[], b: string[]): { sim: number; comparable: boolean } {
  let sim = 0, comparable = false;
  for (const x of a) for (const y of b) if (isZh(x) === isZh(y)) { comparable = true; sim = Math.max(sim, similarity(x, y)); }
  return { sim, comparable };
}
const ym = (s: unknown) => (typeof s === 'string' && /^\d{4}/.test(s) ? s.slice(0, 7) : '');
const endOf = (s: unknown) => (s === 'present' ? '9999' : ym(s));
const dateOf = (e: AnyEntry) => ({ s: ym(e.start ?? e.date), e: endOf(e.end ?? e.date) });
/** 日期关系：same 起止都相同；overlap 有交集；disjoint 确定不相交；unknown 缺日期 */
export function dateRelation(a: AnyEntry, b: AnyEntry): 'same' | 'overlap' | 'disjoint' | 'unknown' {
  const x = dateOf(a), y = dateOf(b);
  if (!x.s || !y.s) return 'unknown';
  if (x.s === y.s && x.e && x.e === y.e) return 'same';
  const xe = x.e || x.s, ye = y.e || y.s;
  return x.s <= ye && y.s <= xe ? 'overlap' : 'disjoint';
}
const LEVEL: [RegExp, string][] = [[/博士|ph\.?d|doctor/i, 'phd'], [/硕士|研究生|master|m\.?sc|m\.?eng|mba/i, 'master'], [/学士|本科|bachelor|b\.?sc|b\.?eng|undergraduate/i, 'bachelor'], [/专科|大专|associate|diploma/i, 'associate']];
const degreeLevel = (e: AnyEntry) => { const t = e.degree as LocalizedText | undefined; const s = `${t?.zh ?? ''} ${t?.en ?? ''}`; return LEVEL.find(([r]) => r.test(s))?.[1] ?? ''; };

export interface DupMatch { score: number; strong: boolean; reasons: string[] }
/**
 * 判断两条同类记录是否可能是同一段经历。
 * strong：可直接预设为合并（仍可改）；否则 score ≥ 0.55 时只提示「可能重复」，必须由用户决定。
 */
export function dupMatch(sec: DedupeSection, a: AnyEntry, b: AnyEntry): DupMatch {
  const na = namesOf(sec, a), nb = namesOf(sec, b);
  const { sim, comparable } = bestNameSim(na, nb);
  const rel = dateRelation(a, b);
  const reasons: string[] = [];
  if (rel === 'disjoint') return { score: 0, strong: false, reasons: ['时间段不重叠'] };
  if (sec === 'education') {
    const la = degreeLevel(a), lb = degreeLevel(b);
    if (la && lb && la !== lb) return { score: 0, strong: false, reasons: ['学历层次不同'] };
    // 同校同层次但学位名 / 专业明显不同（如双学位、第二专业）→ 不同的学历，不合并
    const fieldSim = (f: string) => { const x = (a[f] ?? {}) as LocalizedText, y = (b[f] ?? {}) as LocalizedText; return bestNameSim([x.zh, x.en].filter(Boolean) as string[], [y.zh, y.en].filter(Boolean) as string[]); };
    const dg = fieldSim('degree'), mj = fieldSim('major');
    const sameDegree = !dg.comparable || dg.sim >= 0.6, sameMajor = !mj.comparable || mj.sim >= 0.6;
    if (sim >= 0.8 && (!sameDegree || !sameMajor)) return { score: 0.3, strong: false, reasons: ['同一学校的不同学位 / 专业'] };
    if (sim >= 0.8) reasons.push('学校名称一致');
    if (rel === 'same') reasons.push('起止时间相同');
    if (la && la === lb) reasons.push('学历层次相同');
    // 可靠的自动去重：学校名同语言一致（含别名）+ 学位 / 专业不冲突 + 时间吻合
    if (sim >= 0.8 && rel !== 'unknown') return { score: 0.95, strong: true, reasons };
    if (sim >= 0.8) return { score: 0.75, strong: false, reasons: [...reasons, '缺少日期，无法确认'] };
    // 中英文校名无法可靠对应：即使日期相同也只提示「可能重复」，由用户确认
    if ((rel === 'same' || (rel === 'overlap' && ym(a.start) === ym(b.start))) && !comparable && sameDegree && sameMajor) return { score: 0.7, strong: false, reasons: [...reasons, '学校名为不同语言写法，无法自动确认是同一学校'] };
    return { score: 0, strong: false, reasons: [...reasons, ...(comparable && sim < 0.8 ? ['学校名称不同'] : [])] };
  }
  if (sec === 'work') {
    const ta = (a.title as LocalizedText) ?? {}, tb = (b.title as LocalizedText) ?? {};
    const t = bestNameSim([ta.zh, ta.en].filter(Boolean) as string[], [tb.zh, tb.en].filter(Boolean) as string[]);
    const titleSim = t.sim;
    if (sim >= 0.8) reasons.push('单位名称一致');
    if (rel === 'same') reasons.push('起止时间相同');
    if (titleSim >= 0.6) reasons.push('职位名称相近');
    // 同单位、职位明显不同 → 不同职位，不合并
    if (sim >= 0.8 && t.comparable && titleSim < 0.4 && rel !== 'same') return { score: 0.3, strong: false, reasons: ['同一单位的不同职位'] };
    if (sim >= 0.8 && rel === 'same') return { score: 0.95, strong: true, reasons };
    if (sim >= 0.8 && rel === 'overlap' && (titleSim >= 0.6 || !t.comparable)) return { score: 0.85, strong: true, reasons };
    if (rel === 'same' && !comparable) return { score: 0.7, strong: false, reasons: [...reasons, '单位名为不同语言写法'] };
    // 同一单位的另一条只有单位名（无职位、无日期）：是同一段经历的补充片段，不是另一份工作
    const bare = (e: AnyEntry) => !ym(e.start) && !ym(e.end) && !((e.title as LocalizedText | undefined)?.zh?.trim() || (e.title as LocalizedText | undefined)?.en?.trim());
    if (sim >= 0.8 && (bare(a) || bare(b))) return { score: 0.8, strong: true, reasons: [...reasons, '另一条只有单位名称，视为同一段经历的补充'] };
    if (sim >= 0.8) return { score: 0.65, strong: false, reasons: [...reasons, rel === 'unknown' ? '缺少日期，无法确认' : '时间段有交集'] };
    return { score: 0, strong: false, reasons };
  }
  if (sec === 'projects') {
    if (sim >= 0.8) reasons.push(sim === 1 ? '名称 / 别名一致' : '名称高度相似');
    if (rel === 'same') reasons.push('起止时间相同');
    if (sim >= 0.8 && rel !== 'unknown') return { score: 0.92, strong: true, reasons };
    if (sim >= 0.8) return { score: 0.8, strong: sim === 1, reasons };
    if (rel === 'same' && !comparable) return { score: 0.65, strong: false, reasons: [...reasons, '名称为不同语言写法，请确认是否同一项目'] };
    if (rel === 'same' && sim >= 0.35) return { score: 0.6, strong: false, reasons: [...reasons, '名称部分相似'] };
    return { score: 0, strong: false, reasons };
  }
  // 技能 / 证书 / 获奖 / 证据：名称一致才算
  if (sec === 'evidence' && a.location && a.location === b.location) return { score: 1, strong: true, reasons: ['存放位置相同'] };
  if (sim >= 0.95) return { score: 1, strong: true, reasons: ['名称一致'] };
  if (sim >= 0.8) return { score: 0.7, strong: false, reasons: ['名称相似'] };
  return { score: 0, strong: false, reasons: [] };
}

export interface InternalDup { section: DedupeSection; id: string; intoId: string; match: DupMatch }
/** 本次识别结果内部的重复（如中文、英文各识别成一条）。每组保留最早出现的一条为主记录 */
export function findIncomingDuplicates(inc: ProfileDoc): InternalDup[] {
  const out: InternalDup[] = [];
  for (const sec of ['education', 'work', 'projects', 'skills', 'certificates', 'awards', 'evidence'] as DedupeSection[]) {
    const list = ((inc as unknown as Record<string, AnyEntry[]>)[sec] ?? []);
    const roots: AnyEntry[] = [];
    for (const e of list) {
      let best: { r: AnyEntry; m: DupMatch } | null = null;
      for (const r of roots) { const m = dupMatch(sec, e, r); if (m.score >= 0.55 && (!best || m.score > best.m.score)) best = { r, m }; }
      if (best) out.push({ section: sec, id: e.id, intoId: best.r.id, match: best.m }); else roots.push(e);
    }
  }
  return out;
}

const ltk = (t?: LocalizedText) => (t ? t.zh || t.en || '' : '');
const PRIORITY: WorkKind[] = ['internship', 'parttime', 'club', 'volunteer', 'fulltime', 'other', ''];
const KIND_HINT: [RegExp, WorkKind][] = [[/实习|intern/i, 'internship'], [/兼职|part[- ]?time/i, 'parttime'], [/志愿|volunteer/i, 'volunteer'], [/社团|学生会|协会|club|society|student union/i, 'club']];
/** 从职位名推断经历类型（只用于职位名里明确写了「实习 / 兼职」等字样时） */
export function kindFromTitle(e: AnyEntry): WorkKind { const t = e.title as LocalizedText | undefined; const s = `${t?.zh ?? ''} ${t?.en ?? ''}`; return KIND_HINT.find(([r]) => r.test(s))?.[1] ?? ''; }

/**
 * 把 dup 合并进 primary（纯函数）：
 * - 双语字段互补（中文名 + 英文名 → 一条双语记录）；同一语言写法不同 → 保留主记录写法，另一写法进 aliases
 * - 日期等标量只补空白；有差异的不丢弃，写入 uncertain 供核对
 * - 要点 / 课程 / 标签 / 备注取并集
 * - 工作类型：任一条明确是实习 / 兼职等，以更具体的类型为准，绝不推断出另一份正式工作
 */
export function mergeEntries(sec: DedupeSection, primary: AnyEntry, dup: AnyEntry, importTag = 'dedupe'): AnyEntry {
  const out = structuredClone(primary); const d = structuredClone(dup);
  const aliases = new Set<string>((out.aliases as string[]) ?? []);
  const diffs: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (['id', 'enabled', 'mergeHistory', 'importedFrom', 'aliases', 'uncertain', 'notes', 'kind'].includes(k)) continue;
    const cur = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && ('zh' in v || 'en' in v)) {
      const a = (cur ?? {}) as LocalizedText, b = v as LocalizedText;
      const nx: LocalizedText = { ...a, status: { ...(a.status ?? {}) } };
      for (const l of ['zh', 'en'] as const) {
        const bv = b[l]?.trim(); if (!bv) continue;
        const av = a[l]?.trim();
        // 对方是人工原文、本方只是机翻：以原文为准，机翻写法保留为别名
        const aMachine = a.status?.[l] === 'machine' && b.status?.[l] !== 'machine';
        if (!av || aMachine) { if (av && normName(av) !== normName(bv)) aliases.add(av); nx[l] = bv; nx.status![l] = b.status?.[l] ?? 'manual'; if (!nx.source) nx.source = b.source; }
        else if (normName(av) !== normName(bv)) { if (NAME_FIELD[sec].includes(k) || k === 'name') aliases.add(bv); else diffs.push(`${k}：「${av}」/「${bv}」`); }
      }
      out[k] = nx; continue;
    }
    if (Array.isArray(v)) {
      const arr = (Array.isArray(cur) ? cur : []) as unknown[];
      if (k === 'bullets' || k === 'highlights') {
        (v as LocalizedText[]).forEach((x, j) => { if (!(arr as LocalizedText[]).some((y) => similarity(ltk(x), ltk(y)) >= 0.75)) arr.push({ ...x, id: `${out.id}-${importTag}-${j}` }); });
        out[k] = arr;
      } else out[k] = [...new Set([...(arr as string[]), ...(v as string[])])];
      continue;
    }
    if (typeof v === 'string') {
      const a = typeof cur === 'string' ? cur.trim() : '';
      if (!a && v.trim()) out[k] = v;
      else if (a && v.trim() && normName(a) !== normName(v)) diffs.push(`${k}：「${a}」/「${v}」`);
      continue;
    }
    if (cur === undefined) out[k] = v;
  }
  for (const n of namesOf(sec, d)) if (!namesOf(sec, { ...out, aliases: [] }).some((x) => normName(x) === normName(n))) aliases.add(n);
  for (const n of namesOf(sec, { ...out, aliases: [] })) aliases.delete(n);
  if (aliases.size) out.aliases = [...aliases];
  if (sec === 'work') {
    const kinds = [out.kind as WorkKind, d.kind as WorkKind, kindFromTitle(out), kindFromTitle(d)].filter(Boolean) as WorkKind[];
    const k = PRIORITY.find((x) => kinds.includes(x)); if (k) out.kind = k;
    if (kinds.includes('fulltime') && k && k !== 'fulltime') diffs.push(`类型：另一条标为「正式工作」，已按原文「${k === 'internship' ? '实习' : k}」合并为同一段经历`);
  }
  if (sec === 'projects' && (d.kind === 'core' || out.kind === 'core')) out.kind = 'core';
  out.notes = [...new Set([...((out.notes as string[]) ?? []), ...((d.notes as string[]) ?? [])])];
  if (!(out.notes as string[]).length) delete out.notes;
  const unc = [...((out.uncertain as string[]) ?? []), ...((d.uncertain as string[]) ?? []), ...diffs.map((x) => `合并重复记录时发现差异（已保留主记录值，请核对）：${x}`)];
  if (unc.length) out.uncertain = [...new Set(unc)];
  out.mergeHistory = [...((out.mergeHistory as unknown[]) ?? []), { at: new Date().toISOString(), importTag, incomingId: d.id, incomingTitle: namesOf(sec, d)[0] ?? '', fieldsOverwritten: [], pointsAdded: [], incomingSnapshot: JSON.stringify(dup) }];
  return out;
}
