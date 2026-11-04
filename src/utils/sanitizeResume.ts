import type { ResumeDoc } from '../types';

/**
 * 简历进入界面前的「补全」：AI 返回内容或旧版本数据里缺字段 / 类型不对（数组变 undefined、文字变对象等）时，
 * 渲染代码里的 .map / .trim / .startsWith 会直接抛错，整页白屏。这里把这些字段补成安全形状，
 * 只修复形状，不改动任何有效内容；没有需要修复的就原样返回同一个对象。
 */
const str = (v: unknown): string => typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? safeJson(v) : String(v);
const safeJson = (v: unknown) => { try { return JSON.stringify(v); } catch { return ''; } };
const arr = <T,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];
const strs = (v: unknown): string[] => arr<unknown>(v).map(str).filter(Boolean);
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

function items(v: unknown) {
  return arr<Record<string, unknown>>(v).filter((i) => i && typeof i === 'object' && typeof i.sourceId === 'string')
    .map((i) => ({ ...i, zh: str(i.zh), en: str(i.en) }));
}

function report(v: unknown) {
  const r = obj(v);
  if (!Array.isArray(r.targets)) return undefined;
  const targets = arr<Record<string, unknown>>(r.targets).filter((t) => t && typeof t === 'object').map((t) => {
    const title = obj(t.title);
    return { ...t, jobId: str(t.jobId), title: { zh: str(title.zh), en: str(title.en) },
      requirements: arr<Record<string, unknown>>(t.requirements).filter((q) => q && typeof q === 'object').map((q) => ({
        ...q, text: str(q.text), evidenceIds: strs(q.evidenceIds), risks: strs(q.risks),
        evidence: arr<Record<string, unknown>>(q.evidence).filter((e) => e && typeof e === 'object' && typeof e.id === 'string').map((e) => ({ ...e, label: str(e.label), zh: str(e.zh), en: str(e.en) })),
      })) };
  });
  let synthesis: unknown = r.synthesis;
  if (synthesis) {
    const s = obj(synthesis);
    const rows = (k: string) => arr<Record<string, unknown>>(s[k]).filter((x) => x && typeof x === 'object').map((x) => ({ ...x, reason: str(x.reason), requirementIds: strs(x.requirementIds) }));
    synthesis = { ...s, common: rows('common'), complementary: rows('complementary'), conflicts: rows('conflicts') };
  }
  return { ...r, targets, selectionReasons: strs(r.selectionReasons), ...(synthesis ? { synthesis } : {}) };
}

export function sanitizeResume<T extends ResumeDoc | null | undefined>(r: T): T {
  if (!r || typeof r !== 'object') return r;
  const x = r as unknown as Record<string, unknown>;
  const sel = obj(x.selection), consistency = obj(x.consistency), h = x.headline;
  const out: Record<string, unknown> = {
    ...x,
    gaps: strs(x.gaps), items: items(x.items),
    selection: Object.fromEntries([...new Set(['work', 'projects', 'education', 'skills', 'certificates', 'awards', ...Object.keys(sel)])].map((k) => [k, strs(sel[k])])),
    consistency: { ...consistency, checkedAt: str(consistency.checkedAt), issues: arr(consistency.issues) },
  };
  if (x.notes !== undefined) out.notes = strs(x.notes);
  if (x.deselectedItems !== undefined) out.deselectedItems = items(x.deselectedItems);
  if (h !== undefined) {
    const b = obj(h);
    if (h && typeof h === 'object') out.headline = { ...b, zh: str(b.zh), en: str(b.en) }; else delete out.headline;
  }
  if (x.skillGroups !== undefined) {
    const groups = arr<Record<string, unknown>>(x.skillGroups).filter((g) => g && typeof g === 'object' && Array.isArray(g.ids))
      .map((g) => ({ ...g, zh: str(g.zh), en: str(g.en), ids: strs(g.ids) }));
    if (groups.length) out.skillGroups = groups; else delete out.skillGroups;
  }
  if (x.evidenceReport !== undefined) {
    const rep = report(x.evidenceReport);
    if (rep) out.evidenceReport = rep; else delete out.evidenceReport;
  }
  const ex = x.extras;
  if (ex && typeof ex === 'object' && (ex as Record<string, unknown>).prep !== undefined && !Array.isArray((ex as Record<string, unknown>).prep)) out.extras = { ...(ex as object), prep: [] };
  return (safeJson(out) === safeJson(x) ? r : out) as unknown as T;
}

/** 岗位数据同理：四个要求列表缺失 / 类型不对时补成空数组，列表里的项补成 {zh,en} 字符串。 */
export function sanitizeJob<T extends { mustHave?: unknown } | null | undefined>(j: T): T {
  if (!j || typeof j !== 'object') return j;
  const x = j as unknown as Record<string, unknown>;
  const bi = (v: unknown) => arr<unknown>(v).filter((k) => k && typeof k === 'object').map((k) => ({ ...obj(k), zh: str(obj(k).zh), en: str(obj(k).en) }));
  const out: Record<string, unknown> = { ...x, mustHave: bi(x.mustHave), niceToHave: bi(x.niceToHave), keywords: bi(x.keywords) };
  if (x.responsibilities !== undefined) out.responsibilities = bi(x.responsibilities);
  return (safeJson(out) === safeJson(x) ? j : out) as unknown as T;
}
