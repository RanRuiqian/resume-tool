import type { Evidence, LocalizedText, ProfileDoc } from '../types';
import type { Uncertain } from './importProfile';
import type { SourceText } from '../types';
import { dupMatch, findIncomingDuplicates, mergeEntries, normName, similarity, type DupMatch } from './dedupe';
import { emptyProfile } from '../storage/profileIO';

/** 智能导入的「导入计划」：先对照、再由用户逐条选择，最后纯函数应用（出错不改原资料） */

export type PlanSection = 'education' | 'work' | 'projects' | 'skills' | 'certificates' | 'awards' | 'evidence';
/** internal：与本次识别结果中的另一条重复（如同一段经历的中文 / 英文写法各识别成一条） */
export type PlanStatus = 'new' | 'duplicate' | 'maybe' | 'conflict' | 'internal';
/** undecided：可能重复 / 有冲突时的默认值，必须由用户明确选择后才能导入（A1） */
/** replace：用识别结果替换已有条目（保留条目 id 与合并记录） */
export type PlanAction = 'add' | 'merge' | 'replace' | 'skip' | 'undecided';
export interface FieldConflict { field: string; label: string; old: string; new: string; useNew: boolean; /** 旧值已被用户确认过：覆盖前必须二次确认 */ oldConfirmed?: boolean }
export interface PlanItem {
  key: string; section: PlanSection; incomingId: string; title: string;
  status: PlanStatus; matchId?: string; matchTitle?: string; similarity: number;
  conflicts: FieldConflict[]; newPoints: string[]; samePoints: number; uncertain: string[]; action: PlanAction;
  /** 相关但独立的条目（同公司其它职位 / 同项目其它阶段），只做关联，不合并 */
  relatedId?: string; relatedNote?: string;
  /** status = internal 时：要并入的同批主记录 */
  intoIncomingId?: string; intoTitle?: string;
  /** 判定依据（日期相同、名称一致……） */
  reasons?: string[];
  /** 已有条目被用户确认过：替换前必须勾选 overrideConfirmed */
  matchConfirmed?: boolean; overrideConfirmed?: boolean;
}
export interface BasicChange { path: string; label: string; old: string; new: string; useNew: boolean }
export interface ImportPlan { items: PlanItem[]; basics: BasicChange[]; otherUncertain: Uncertain[] }
/** 合并记录：保留来源 id 与被合并的原始字段，便于追溯 / 撤销（A1） */
export interface MergeRecord { at: string; importTag: string; incomingId: string; incomingTitle: string; fieldsOverwritten: { field: string; old: string; new: string }[]; pointsAdded: string[]; incomingSnapshot: string }
export function undecidedCount(plan: ImportPlan): number { return plan.items.filter((i) => i.action === 'undecided').length; }

const ltk = (t?: LocalizedText) => (t ? t.zh || t.en || '' : '');
export { normName, similarity };

type AnyEntry = Record<string, unknown> & { id: string };
const SEC_LABEL: Record<PlanSection, string> = { education: '教育', work: '工作及社会经历', projects: '项目', skills: '技能', certificates: '证书', awards: '获奖', evidence: '证据' };
export const sectionLabel = (s: PlanSection) => SEC_LABEL[s];

function titleOf(sec: PlanSection, e: AnyEntry): string {
  const g = (k: string) => ltk(e[k] as LocalizedText);
  if (sec === 'work') return [g('company'), g('title')].filter(Boolean).join(' · ');
  if (sec === 'education') return [g('school'), g('major'), g('degree')].filter(Boolean).join(' · ');
  if (sec === 'evidence') return (e.fileName as string) || (e.location as string) || '';
  return g('name');
}
const both = (t?: LocalizedText) => [t?.zh, t?.en].filter((x): x is string => !!x && !!x.trim());
/** 中英文名称取最高相似度（如「焊缝检测系统」与 "Weld Inspection System" 已有双语时可匹配） */
function simLT(a?: LocalizedText, b?: LocalizedText): number {
  let m = 0; for (const x of both(a)) for (const y of both(b)) m = Math.max(m, similarity(x, y)); return m;
}
const PHASE = /(一期|二期|三期|四期|第[一二三四五六七八九十\d]+(?:期|阶段|版)|v\d+(?:\.\d+)?|phase\s*\d+|stage\s*\d+|[ⅠⅡⅢⅣ]期?|\b(?:i{1,3}|iv)\b)/gi;
export const phaseOf = (s: string) => (s.match(PHASE) ?? []).map((x) => x.toLowerCase().replace(/\s/g, '')).join(',');
const stripPhase = (s: string) => s.replace(PHASE, '');
/** 判断两条是否为「相关但独立」：同公司不同职位 / 同项目不同阶段 */
export function relatedButDistinct(sec: PlanSection, a: AnyEntry, b: AnyEntry): string {
  const g = (e: AnyEntry, k: string) => e[k] as LocalizedText;
  if (sec === 'work') {
    if (simLT(g(a, 'company'), g(b, 'company')) >= DUP && both(g(a, 'title')).length && both(g(b, 'title')).length && simLT(g(a, 'title'), g(b, 'title')) < 0.6)
      return '同一公司的不同职位，按独立工作经历处理';
  }
  if (sec === 'projects') {
    const ph = (e: AnyEntry) => [...new Set(both(g(e, 'name')).map(phaseOf).filter(Boolean))].sort().join(';');
    const pa = ph(a), pb = ph(b);
    if (pa !== pb && (pa || pb)) {
      const na = both(g(a, 'name')).map(stripPhase), nb = both(g(b, 'name')).map(stripPhase);
      if (na.some((x) => nb.some((y) => similarity(x, y) >= DUP))) return '同一项目的不同阶段，作为独立条目保留并关联';
    }
  }
  return '';
}
function matchScore(sec: PlanSection, a: AnyEntry, b: AnyEntry): number {
  const g = (e: AnyEntry, k: string) => e[k] as LocalizedText;
  if (sec === 'work') { const c = simLT(g(a, 'company'), g(b, 'company')); return c < 0.5 ? c * 0.6 : c * 0.6 + simLT(g(a, 'title'), g(b, 'title')) * 0.4 + (a.start && a.start === b.start ? 0.15 : 0); }
  if (sec === 'education') { const s = simLT(g(a, 'school'), g(b, 'school')); return s < 0.5 ? s * 0.6 : s * 0.6 + (both(g(a, 'major')).length && both(g(b, 'major')).length ? simLT(g(a, 'major'), g(b, 'major')) * 0.4 : 0.3); }
  if (sec === 'evidence') return Math.max(similarity(String(a.fileName ?? ''), String(b.fileName ?? '')), a.location && a.location === b.location ? 1 : 0);
  return simLT(g(a, 'name'), g(b, 'name'));
}
const SCALARS: Partial<Record<PlanSection, [string, string][]>> = {
  work: [['title', '职位'], ['start', '开始'], ['end', '结束']],
  projects: [['role', '角色'], ['start', '开始'], ['end', '结束'], ['link', '链接']],
  education: [['degree', '学位'], ['major', '专业'], ['start', '开始'], ['end', '结束'], ['courseCompletionDate', '课程完成'], ['expectedConferralDate', '预计授予学位'], ['actualConferralDate', '实际授予学位'], ['availableFullTimeDate', '可全职入职']],
  skills: [['category', '分类'], ['level', '熟练度']],
  certificates: [['issuer', '颁发机构'], ['date', '日期']],
  awards: [['issuer', '颁发机构'], ['date', '日期']],
  evidence: [['location', '位置'], ['proves', '证明事实']],
};
const val = (v: unknown) => (typeof v === 'string' ? v : ltk(v as LocalizedText)).trim();
const pointsOf = (e: AnyEntry): LocalizedText[] => ((e.bullets ?? e.highlights ?? []) as LocalizedText[]);

const SEC_RE = /^(education|work|projects?|skills?|certificates?|awards?|evidence)\s*\[(\d+)\]/i;
export function parseUncertainField(field: string): { sec: PlanSection; idx: number; rest: string } | null {
  const m = SEC_RE.exec(field); if (!m) return null;
  let sec = m[1].toLowerCase(); if (sec === 'project') sec = 'projects'; if (sec === 'skill') sec = 'skills'; if (sec === 'certificate') sec = 'certificates'; if (sec === 'award') sec = 'awards';
  return { sec: sec as PlanSection, idx: Number(m[2]), rest: field.replace(/^[^.]*\.?/, '') || '整条' };
}
/**
 * 不确定字段 → 条目（A3）：优先用分段导入时已解析好的稳定 entryId；
 * 没有 entryId 的（单段导入）才按本次导入资料的下标解析；都解析不了的进入「未分配」。
 */
function uncertainIndex(u: Uncertain[], inc: ProfileDoc) {
  const map = new Map<string, string[]>(); const other: Uncertain[] = [];
  for (const x of u) {
    const pf = parseUncertainField(x.field);
    let id = x.entryId;
    if (!id && pf && !x.segment) id = ((inc[pf.sec] ?? []) as unknown as AnyEntry[])[pf.idx]?.id;
    if (!id || !pf) { other.push(x); continue; }
    map.set(id, [...(map.get(id) ?? []), `${pf.rest}：${x.note}`]);
  }
  return { map, other };
}

export const DUP = 0.8, MAYBE = 0.55;
const isConfirmed = (v: unknown) => !!v && typeof v === 'object' && Object.values((v as LocalizedText).status ?? {}).includes('confirmed');
const ym = (s: unknown) => (typeof s === 'string' && /^\d{4}/.test(s) ? s : s === 'present' ? '9999' : '');
function overlap(a: AnyEntry, b: AnyEntry): boolean {
  const as = ym(a.start), ae = ym(a.end) || '9999', bs = ym(b.start), be = ym(b.end) || '9999';
  if (!as || !bs) return true;
  return as <= be && bs <= ae;
}

export function buildImportPlan(base: ProfileDoc, inc: ProfileDoc, uncertain: Uncertain[] = []): ImportPlan {
  const { map: um, other } = uncertainIndex(uncertain, inc);
  const items: PlanItem[] = [];
  const internal = new Map(findIncomingDuplicates(inc).map((d) => [`${d.section}:${d.id}`, d]));
  for (const sec of ['education', 'work', 'projects', 'skills', 'certificates', 'awards', 'evidence'] as PlanSection[]) {
    const olds = base[sec] as unknown as AnyEntry[]; const news = (inc[sec] ?? []) as unknown as AnyEntry[];
    news.forEach((e) => {
      const dup = internal.get(`${sec}:${e.id}`);
      if (dup) {
        const into = news.find((x) => x.id === dup.intoId)!;
        items.push({ key: `${sec}:${e.id}`, section: sec, incomingId: e.id, title: titleOf(sec, e) || '（未命名）', status: 'internal', similarity: dup.match.score,
          conflicts: [], newPoints: pointsOf(e).map(ltk).filter(Boolean), samePoints: 0, uncertain: um.get(e.id) ?? [], action: dup.match.strong ? 'merge' : 'undecided',
          intoIncomingId: into.id, intoTitle: titleOf(sec, into), reasons: dup.match.reasons });
        return;
      }
      let best: AnyEntry | undefined, bs = 0, bm: DupMatch | undefined;
      for (const o of olds) { const m = dupMatch(sec, e, o); const s = Math.max(matchScore(sec, e, o), m.strong ? m.score : 0); if (s > bs) { bs = s; best = o; bm = m; } }
      const it: PlanItem = { key: `${sec}:${e.id}`, section: sec, incomingId: e.id, title: titleOf(sec, e) || '（未命名）', status: 'new', similarity: Math.round(bs * 100) / 100,
        conflicts: [], newPoints: pointsOf(e).map(ltk).filter(Boolean), samePoints: 0, uncertain: um.get(e.id) ?? [], action: 'add' };
      const rel = best && bs >= MAYBE ? relatedButDistinct(sec, e, best) : '';
      if (rel && best) { it.relatedId = best.id; it.relatedNote = `${rel}（相关：「${titleOf(sec, best)}」）`; it.matchTitle = titleOf(sec, best); }
      else if (best && bs >= MAYBE) {
        it.matchId = best.id; it.matchTitle = titleOf(sec, best); it.reasons = bm?.reasons;
        it.matchConfirmed = !!best.userConfirmedAt || best.confirmed === true || Object.values(best).some(isConfirmed);
        const oldPts = pointsOf(best).map(ltk).filter(Boolean);
        it.newPoints = pointsOf(e).map(ltk).filter(Boolean).filter((p) => !oldPts.some((q) => similarity(p, q) >= 0.75));
        it.samePoints = pointsOf(e).length - it.newPoints.length;
        for (const [f, label] of SCALARS[sec] ?? []) {
          const a = val(best[f]), b = val(e[f]);
          if (a && b && normName(a) !== normName(b)) it.conflicts.push({ field: f, label, old: a, new: b, useNew: false, oldConfirmed: isConfirmed(best[f]) || best.confirmed === true });
        }
        // 同公司同职位但时间段不重叠：很可能是两段经历
        if (sec === 'work' && e.start && best.start && e.start !== best.start && !overlap(e, best)) it.uncertain = [...it.uncertain, '同公司同职位但时间段不重叠，可能是两段独立经历'];
        const exact = bs >= DUP && !it.conflicts.length && !(sec === 'work' && e.start && best.start && !overlap(e, best));
        it.status = it.conflicts.length ? 'conflict' : exact ? 'duplicate' : 'maybe';
        // 只有完全重复才默认合并（且合并只补空白、追加新要点）；可能重复 / 有冲突必须由用户选择
        it.action = exact ? 'merge' : 'undecided';
        if (bs < DUP) it.uncertain = [...it.uncertain, `与已有「${it.matchTitle}」相似度 ${Math.round(bs * 100)}%，请确认是否同一段经历`];
      }
      items.push(it);
    });
  }
  // entryId 没对上任何导入条目的不确定项：保留为「未分配」，不丢失（A3）
  const used = new Set(items.map((i) => i.incomingId));
  for (const x of uncertain) if (x.entryId && !used.has(x.entryId)) other.push(x);
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
export function applyImportPlan(base: ProfileDoc, inc: ProfileDoc, plan: ImportPlan, source?: SourceText): ProfileDoc {
  const pending = plan.items.filter((i) => i.action === 'undecided');
  if (pending.length) throw new Error(`还有 ${pending.length} 条可能重复 / 有冲突的条目未选择处理方式：${pending.map((i) => i.title).join('、')}`);
  for (const it of plan.items) if (it.action === 'replace' && it.matchConfirmed && !it.overrideConfirmed) throw new Error(`「${it.matchTitle ?? it.title}」已被你确认过，替换前需要再次确认`);
  for (const it of plan.items) for (const c of it.conflicts) if (c.useNew && c.oldConfirmed && !(c as FieldConflict & { overrideConfirmed?: boolean }).overrideConfirmed)
    throw new Error(`「${it.title}」的${c.label}已确认过，覆盖前需要再次确认`);
  const out = structuredClone(base); const src = structuredClone(inc);
  const tag = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const idMap = new Map<string, string>();
  // 第一步：本次识别结果内部的重复，先并入同批主记录（不丢弃差异：别名、差异提示、合并记录都保留）
  const internalTo = new Map<string, string>();
  for (const it of plan.items) {
    if (it.status !== 'internal' || it.action !== 'merge' || !it.intoIncomingId) continue;
    const list = src[it.section] as unknown as AnyEntry[];
    const ri = list.findIndex((x) => x.id === it.intoIncomingId), di = list.findIndex((x) => x.id === it.incomingId);
    if (ri < 0 || di < 0) continue;
    list[ri] = mergeEntries(it.section, list[ri], list[di], tag);
    if (it.uncertain.length) list[ri].uncertain = [...new Set([...((list[ri].uncertain as string[]) ?? []), ...it.uncertain])];
    list.splice(di, 1); internalTo.set(it.incomingId, it.intoIncomingId);
  }
  if (internalTo.size) for (const ev of src.evidence) { ev.projectIds = [...new Set(ev.projectIds.map((x) => internalTo.get(x) ?? x))]; ev.skillIds = [...new Set(ev.skillIds.map((x) => internalTo.get(x) ?? x))]; }
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
    if (it.status === 'internal' && it.action === 'merge') continue;
    const e = (src[it.section] as unknown as AnyEntry[]).find((x) => x.id === it.incomingId);
    if (!e || it.action === 'skip') continue;
    if (it.action === 'replace' && it.matchId) {
      const i = dst.findIndex((x) => x.id === it.matchId);
      if (i >= 0) {
        const old = dst[i];
        const rec: MergeRecord = { at: new Date().toISOString(), importTag: tag, incomingId: e.id, incomingTitle: it.title, fieldsOverwritten: [{ field: '*', old: JSON.stringify(old), new: '' }], pointsAdded: [], incomingSnapshot: JSON.stringify(e) };
        const fresh = JSON.parse(JSON.stringify(e).replace(/"id":"([^"]+)"/g, `"id":"${tag}-$1"`)) as AnyEntry;
        dst[i] = { ...fresh, id: old.id, enabled: old.enabled, ...(it.uncertain.length ? { uncertain: it.uncertain } : {}), mergeHistory: [...((old.mergeHistory as MergeRecord[]) ?? []), rec] };
        idMap.set(e.id, old.id); continue;
      }
    }
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
      if (it.relatedId) { fresh.relatedIds = [...new Set([...((fresh.relatedIds as string[]) ?? []), it.relatedId])]; const r = dst.find((x) => x.id === it.relatedId); if (r) r.relatedIds = [...new Set([...((r.relatedIds as string[]) ?? []), fresh.id])]; }
      fresh.importedFrom = { importTag: tag, incomingId: e.id, at: new Date().toISOString() };
      idMap.set(e.id, fresh.id); dst.push(fresh); continue;
    }
    idMap.set(e.id, hit.id);
    const rec: MergeRecord = { at: new Date().toISOString(), importTag: tag, incomingId: e.id, incomingTitle: it.title, fieldsOverwritten: [], pointsAdded: [], incomingSnapshot: JSON.stringify(e) };
    const listKey = 'bullets' in hit ? 'bullets' : 'highlights' in hit ? 'highlights' : null;
    if (listKey) {
      const a = hit[listKey] as LocalizedText[]; const b = (e[listKey] ?? []) as LocalizedText[];
      b.forEach((x, j) => { if (!a.some((y) => similarity(ltk(x), ltk(y)) >= 0.75)) { a.push({ ...x, id: `${hit.id}-${tag}-${j}` }); rec.pointsAdded.push(`${hit.id}-${tag}-${j}`); } });
    }
    for (const c of it.conflicts) if (c.useNew) { rec.fieldsOverwritten.push({ field: c.field, old: c.old, new: c.new }); hit[c.field] = e[c.field]; }
    for (const f of ['start', 'end', 'date', 'link', 'location', 'proves', 'fileName', 'courseCompletionDate', 'expectedConferralDate', 'actualConferralDate', 'availableFullTimeDate']) if (f in e && !val(hit[f]) && val(e[f])) hit[f] = e[f];
    for (const f of ['degree', 'major', 'role', 'title', 'issuer', 'category']) if (f in e && !val(hit[f]) && val(e[f])) hit[f] = e[f];
    for (const f of ['aliases', 'notes']) if (Array.isArray(e[f])) hit[f] = [...new Set([...((hit[f] as string[]) ?? []), ...(e[f] as string[])])];
    if (e.kind && !hit.kind) hit.kind = e.kind;
    if (Array.isArray(e.courses)) hit.courses = [...new Set([...((hit.courses as string[]) ?? []), ...(e.courses as string[])])];
    if (Array.isArray(hit.tags) && Array.isArray(e.tags)) hit.tags = [...new Set([...(hit.tags as string[]), ...(e.tags as string[])])];
    if (Array.isArray(e.evidenceIds)) hit.evidenceIds = [...new Set([...((hit.evidenceIds as string[]) ?? []), ...(e.evidenceIds as string[]).map((x) => idMap.get(x) ?? x)])];
    if (it.uncertain.length) hit.uncertain = [...((hit.uncertain as string[]) ?? []), ...it.uncertain];
    hit.mergeHistory = [...((hit.mergeHistory as MergeRecord[]) ?? []), rec];
  }
  // 证据关联：回写到项目 / 技能
  for (const it of plan.items) {
    if (it.section !== 'evidence' || it.action === 'skip') continue;
    const ev = (out.evidence as Evidence[]).find((x) => x.id === idMap.get(it.incomingId)); if (!ev) continue;
    for (const pid of ev.projectIds) { const p = out.projects.find((x) => x.id === pid); if (p) p.evidenceIds = [...new Set([...(p.evidenceIds ?? []), ev.id])]; }
    for (const sid of ev.skillIds) { const k = out.skills.find((x) => x.id === sid); if (k) k.evidenceIds = [...new Set([...(k.evidenceIds ?? []), ev.id])]; }
  }
  if (source?.text.trim()) out.sourceTexts = [...(out.sourceTexts ?? []), source];
  return out;
}

/**
 * 「替换现有资料」：清空现有条目后按计划写入识别结果（本批内部的合并 / 跳过选择仍然生效）。
 * 保留照片、术语表与以往保存的原始资料；调用方负责在写入前创建快照。
 */
export function applyReplace(base: ProfileDoc, inc: ProfileDoc, plan: ImportPlan, source?: SourceText): ProfileDoc {
  const empty = emptyProfile();
  empty.glossary = base.glossary; empty.primaryLanguage = inc.primaryLanguage;
  empty.profile.photo = base.profile.photo; empty.profile.photoAspect = base.profile.photoAspect;
  if (base.sourceTexts?.length) empty.sourceTexts = base.sourceTexts;
  const p2: ImportPlan = {
    otherUncertain: plan.otherUncertain,
    basics: [],
    items: plan.items.map((it) => (it.status === 'internal' || it.action === 'skip' ? it : { ...it, action: 'add', matchId: undefined, conflicts: [], newPoints: it.newPoints })),
  };
  const out = applyImportPlan(empty, inc, p2, source);
  out.profile = { ...structuredClone(inc.profile), photo: base.profile.photo, photoAspect: base.profile.photoAspect };
  return out;
}

export type ImportMode = 'merge' | 'replace';
export interface PlanSummary { add: number; merge: number; skip: number; overwrite: number; pending: number; removed: number }
/** 提交前汇总：新增 / 合并 / 跳过 / 覆盖 / 待决定 */
export function planSummary(plan: ImportPlan, mode: ImportMode, base?: ProfileDoc): PlanSummary {
  const s: PlanSummary = { add: 0, merge: 0, skip: 0, overwrite: 0, pending: 0, removed: 0 };
  for (const it of plan.items) {
    if (it.action === 'undecided' && (mode === 'merge' || it.status === 'internal')) s.pending++;
    else if (mode === 'replace' && it.status !== 'internal' && it.action !== 'skip') s.add++;
    else if (it.action === 'skip') s.skip++;
    else if (it.action === 'merge' && (it.status === 'internal' || mode === 'merge')) s.merge++;
    else if (it.action === 'replace' && mode === 'merge') s.overwrite++;
    else s.add++;
    if (mode === 'merge' && it.action === 'merge') s.overwrite += it.conflicts.filter((c) => c.useNew).length;
  }
  if (mode === 'merge') s.overwrite += plan.basics.filter((b) => b.useNew && b.old.trim()).length;
  if (mode === 'replace' && base) s.removed = (['education', 'work', 'projects', 'skills', 'certificates', 'awards', 'evidence'] as const).reduce((n, k) => n + (base[k]?.length ?? 0), 0);
  return s;
}

/** 合并预览：返回合并前两条记录与合并后的结果（不修改任何输入） */
export function mergePreview(base: ProfileDoc, inc: ProfileDoc, it: PlanItem): { before: AnyEntry[]; after: AnyEntry } | null {
  const news = inc[it.section] as unknown as AnyEntry[];
  const e = news.find((x) => x.id === it.incomingId); if (!e) return null;
  const target = it.status === 'internal' ? news.find((x) => x.id === it.intoIncomingId) : (base[it.section] as unknown as AnyEntry[]).find((x) => x.id === it.matchId);
  if (!target) return null;
  return { before: [target, e], after: mergeEntries(it.section, target, e, 'preview') };
}

/** 现有资料里残留的内置示例数据条数（示例资料的条目 id 以 sample 内容为准，由调用方传入） */
export function sampleResidue(base: ProfileDoc, sample: ProfileDoc): string[] {
  const hits: string[] = [];
  for (const k of ['education', 'work', 'projects', 'skills', 'certificates', 'awards'] as const) {
    for (const e of base[k] as unknown as AnyEntry[]) {
      const sm = (sample[k] as unknown as AnyEntry[]).find((x) => x.id === e.id);
      if (sm && titleOf(k, sm) === titleOf(k, e)) hits.push(titleOf(k, e));
    }
  }
  const sn = sample.profile.headline; if ((sn.en && base.profile.headline.en === sn.en) || (sn.zh && base.profile.headline.zh === sn.zh)) hits.unshift(ltk(base.profile.headline) || sn.en || '');
  return hits;
}
export { titleOf };
