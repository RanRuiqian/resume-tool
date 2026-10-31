import type { Evidence, LocalizedText, ProfileDoc } from '../types';
import type { Uncertain } from './importProfile';

/** 智能导入的「导入计划」：先对照、再由用户逐条选择，最后纯函数应用（出错不改原资料） */

export type PlanSection = 'education' | 'work' | 'projects' | 'skills' | 'certificates' | 'awards' | 'evidence';
export type PlanStatus = 'new' | 'duplicate' | 'maybe' | 'conflict';
export type PlanAction = 'add' | 'merge' | 'skip';
export interface FieldConflict { field: string; label: string; old: string; new: string; useNew: boolean }
export interface PlanItem {
  key: string; section: PlanSection; incomingId: string; title: string;
  status: PlanStatus; matchId?: string; matchTitle?: string; similarity: number;
  conflicts: FieldConflict[]; newPoints: string[]; samePoints: number; uncertain: string[]; action: PlanAction;
}
export interface BasicChange { path: string; label: string; old: string; new: string; useNew: boolean }
export interface ImportPlan { items: PlanItem[]; basics: BasicChange[]; otherUncertain: Uncertain[] }

const ltk = (t?: LocalizedText) => (t ? t.zh || t.en || '' : '');
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

type AnyEntry = Record<string, unknown> & { id: string };
const SEC_LABEL: Record<PlanSection, string> = { education: '教育', work: '工作', projects: '项目', skills: '技能', certificates: '证书', awards: '获奖', evidence: '证据' };
export const sectionLabel = (s: PlanSection) => SEC_LABEL[s];

function titleOf(sec: PlanSection, e: AnyEntry): string {
  const g = (k: string) => ltk(e[k] as LocalizedText);
  if (sec === 'work') return [g('company'), g('title')].filter(Boolean).join(' · ');
  if (sec === 'education') return [g('school'), g('major'), g('degree')].filter(Boolean).join(' · ');
  if (sec === 'evidence') return (e.fileName as string) || (e.location as string) || '';
  return g('name');
}
function matchScore(sec: PlanSection, a: AnyEntry, b: AnyEntry): number {
  const g = (e: AnyEntry, k: string) => ltk(e[k] as LocalizedText);
  if (sec === 'work') { const c = similarity(g(a, 'company'), g(b, 'company')); return c < 0.5 ? c * 0.6 : c * 0.6 + similarity(g(a, 'title'), g(b, 'title')) * 0.4 + (a.start && a.start === b.start ? 0.15 : 0); }
  if (sec === 'education') { const s = similarity(g(a, 'school'), g(b, 'school')); return s < 0.5 ? s * 0.6 : s * 0.6 + (g(a, 'major') && g(b, 'major') ? similarity(g(a, 'major'), g(b, 'major')) * 0.4 : 0.3); }
  if (sec === 'evidence') return Math.max(similarity(String(a.fileName ?? ''), String(b.fileName ?? '')), a.location && a.location === b.location ? 1 : 0);
  return similarity(g(a, 'name'), g(b, 'name'));
}
const SCALARS: Partial<Record<PlanSection, [string, string][]>> = {
  work: [['title', '职位'], ['start', '开始'], ['end', '结束']],
  projects: [['role', '角色'], ['start', '开始'], ['end', '结束'], ['link', '链接']],
  education: [['degree', '学位'], ['major', '专业'], ['start', '开始'], ['end', '结束']],
  skills: [['category', '分类'], ['level', '熟练度']],
  certificates: [['issuer', '颁发机构'], ['date', '日期']],
  awards: [['issuer', '颁发机构'], ['date', '日期']],
  evidence: [['location', '位置'], ['proves', '证明事实']],
};
const val = (v: unknown) => (typeof v === 'string' ? v : ltk(v as LocalizedText)).trim();
const pointsOf = (e: AnyEntry): LocalizedText[] => ((e.bullets ?? e.highlights ?? []) as LocalizedText[]);

/** uncertain 的 field 形如 "work[0].end" → 对应条目 */
function uncertainIndex(u: Uncertain[]) {
  const map = new Map<string, string[]>(); const other: Uncertain[] = [];
  for (const x of u) {
    const m = /^(education|work|projects?|skills?|certificates?|awards?|evidence)\s*\[(\d+)\]/i.exec(x.field);
    if (!m) { other.push(x); continue; }
    let sec = m[1].toLowerCase(); if (sec === 'project') sec = 'projects'; if (sec === 'skill') sec = 'skills'; if (sec === 'certificate') sec = 'certificates'; if (sec === 'award') sec = 'awards';
    const k = `${sec}#${m[2]}`; map.set(k, [...(map.get(k) ?? []), `${x.field.replace(/^[^.]*\.?/, '') || '整条'}：${x.note}`]);
  }
  return { map, other };
}

export const DUP = 0.8, MAYBE = 0.55;

export function buildImportPlan(base: ProfileDoc, inc: ProfileDoc, uncertain: Uncertain[] = []): ImportPlan {
  const { map: um, other } = uncertainIndex(uncertain);
  const items: PlanItem[] = [];
  for (const sec of ['education', 'work', 'projects', 'skills', 'certificates', 'awards', 'evidence'] as PlanSection[]) {
    const olds = base[sec] as unknown as AnyEntry[]; const news = (inc[sec] ?? []) as unknown as AnyEntry[];
    news.forEach((e, idx) => {
      let best: AnyEntry | undefined, bs = 0;
      for (const o of olds) { const s = matchScore(sec, e, o); if (s > bs) { bs = s; best = o; } }
      const it: PlanItem = { key: `${sec}:${e.id}`, section: sec, incomingId: e.id, title: titleOf(sec, e) || '（未命名）', status: 'new', similarity: Math.round(bs * 100) / 100,
        conflicts: [], newPoints: pointsOf(e).map(ltk).filter(Boolean), samePoints: 0, uncertain: um.get(`${sec}#${idx}`) ?? [], action: 'add' };
      if (best && bs >= MAYBE) {
        it.matchId = best.id; it.matchTitle = titleOf(sec, best);
        const oldPts = pointsOf(best).map(ltk).filter(Boolean);
        it.newPoints = pointsOf(e).map(ltk).filter(Boolean).filter((p) => !oldPts.some((q) => similarity(p, q) >= 0.75));
        it.samePoints = pointsOf(e).length - it.newPoints.length;
        for (const [f, label] of SCALARS[sec] ?? []) {
          const a = val(best[f]), b = val(e[f]);
          if (a && b && normName(a) !== normName(b)) it.conflicts.push({ field: f, label, old: a, new: b, useNew: false });
        }
        it.status = it.conflicts.length ? 'conflict' : bs >= DUP ? 'duplicate' : 'maybe';
        it.action = 'merge'; // 合并只追加新要点、补空白；冲突字段默认保留旧值
        if (bs < DUP) it.uncertain = [...it.uncertain, `与已有「${it.matchTitle}」相似度 ${Math.round(bs * 100)}%，请确认是否同一段经历`];
      }
      items.push(it);
    });
  }
  const basics: BasicChange[] = [];
  const bp = base.profile, ip = inc.profile;
  const pair: [string, string, string, string][] = [
    ['name', '姓名', ltk(bp.name), ltk(ip.name)], ['headline', '职业头衔', ltk(bp.headline), ltk(ip.headline)], ['summary', '个人简介', ltk(bp.summary), ltk(ip.summary)],
    ['location', '所在城市', ltk(bp.contacts.location), ltk(ip.contacts.location)],
    ...(['email', 'phone', 'github', 'linkedin', 'website'] as const).map((k): [string, string, string, string] => [`contacts.${k}`, k, bp.contacts[k] ?? '', ip.contacts[k] ?? '']),
    ...([['birth', '出生年月'], ['gender', '性别'], ['hometown', '籍贯'], ['politics', '政治面貌']] as const).map(([k, l]): [string, string, string, string] => [`personal.${k}`, l, bp.personal?.[k] ?? '', ip.personal?.[k] ?? '']),
  ];
  for (const [path, label, o, n] of pair) if (n.trim() && normName(o) !== normName(n)) basics.push({ path, label, old: o, new: n, useNew: !o.trim() });
  return { items, basics, otherUncertain: other };
}

/** 按计划合并。纯函数：不修改 base / inc，任何异常由调用方捕获，原资料保持不变 */
export function applyImportPlan(base: ProfileDoc, inc: ProfileDoc, plan: ImportPlan): ProfileDoc {
  const out = structuredClone(base); const src = structuredClone(inc);
  const tag = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const idMap = new Map<string, string>();
  // 基本信息
  for (const b of plan.basics) {
    if (!b.useNew) continue;
    const [a, k] = b.path.split('.');
    if (a === 'contacts') (out.profile.contacts as Record<string, unknown>)[k] = (src.profile.contacts as Record<string, unknown>)[k];
    else if (a === 'personal') { out.profile.personal = out.profile.personal ?? {}; (out.profile.personal as Record<string, unknown>)[k] = (src.profile.personal as Record<string, unknown>)[k]; }
    else if (a === 'location') out.profile.contacts.location = src.profile.contacts.location;
    else (out.profile as unknown as Record<string, unknown>)[a] = (src.profile as unknown as Record<string, unknown>)[a];
  }
  for (const it of plan.items) {
    const dst = out[it.section] as unknown as AnyEntry[];
    const e = (src[it.section] as unknown as AnyEntry[]).find((x) => x.id === it.incomingId);
    if (!e || it.action === 'skip') continue;
    const hit = it.action === 'merge' && it.matchId ? dst.find((x) => x.id === it.matchId) : undefined;
    if (it.section === 'evidence') {
      // 证据在最后处理：此时项目/技能的最终 id 已确定
      const mapIds = (a: unknown, list: { id: string }[]) => (Array.isArray(a) ? a as string[] : []).map((x) => idMap.get(x) ?? x).filter((x) => list.some((p) => p.id === x));
      e.projectIds = mapIds(e.projectIds, out.projects); e.skillIds = mapIds(e.skillIds, out.skills);
      if (hit) { hit.projectIds = [...new Set([...(hit.projectIds as string[]), ...(e.projectIds as string[])])]; hit.skillIds = [...new Set([...(hit.skillIds as string[]), ...(e.skillIds as string[])])]; }
    }
    if (!hit) {
      const fresh = JSON.parse(JSON.stringify(e).replace(/"id":"([^"]+)"/g, `"id":"${tag}-$1"`)) as AnyEntry;
      if (it.uncertain.length) fresh.uncertain = it.uncertain;
      idMap.set(e.id, fresh.id); dst.push(fresh); continue;
    }
    idMap.set(e.id, hit.id);
    const listKey = 'bullets' in hit ? 'bullets' : 'highlights' in hit ? 'highlights' : null;
    if (listKey) {
      const a = hit[listKey] as LocalizedText[]; const b = (e[listKey] ?? []) as LocalizedText[];
      b.forEach((x, j) => { if (!a.some((y) => similarity(ltk(x), ltk(y)) >= 0.75)) a.push({ ...x, id: `${hit.id}-${tag}-${j}` }); });
    }
    for (const c of it.conflicts) if (c.useNew) hit[c.field] = e[c.field];
    for (const f of ['start', 'end', 'date', 'link', 'location', 'proves', 'fileName']) if (f in e && !val(hit[f]) && val(e[f])) hit[f] = e[f];
    for (const f of ['degree', 'major', 'role', 'title', 'issuer', 'category']) if (f in e && !val(hit[f]) && val(e[f])) hit[f] = e[f];
    if (Array.isArray(hit.tags) && Array.isArray(e.tags)) hit.tags = [...new Set([...(hit.tags as string[]), ...(e.tags as string[])])];
    if (it.uncertain.length) hit.uncertain = [...((hit.uncertain as string[]) ?? []), ...it.uncertain];
  }
  // 证据关联：回写到项目 / 技能
  for (const it of plan.items) {
    if (it.section !== 'evidence' || it.action === 'skip') continue;
    const ev = (out.evidence as Evidence[]).find((x) => x.id === idMap.get(it.incomingId)); if (!ev) continue;
    for (const pid of ev.projectIds) { const p = out.projects.find((x) => x.id === pid); if (p) p.evidenceIds = [...new Set([...(p.evidenceIds ?? []), ev.id])]; }
    for (const sid of ev.skillIds) { const k = out.skills.find((x) => x.id === sid); if (k) k.evidenceIds = [...new Set([...(k.evidenceIds ?? []), ev.id])]; }
  }
  return out;
}
