import type { Lang, LocalizedText, ProfileDoc, ProjectDossier, Settings } from '../types';
import { chatJson } from '../ai/provider';
import { ORGANIZE_PROMPT, ORGANIZE_RETRY } from '../ai/prompts';
import { numberTokens } from '../ai/consistency';
import { extractTechTerms, normTerm, isUnconfirmedImport } from '../audit/techTerms';
import { checkAgainstSource, CRITICAL } from '../ai/sourceCheck';
import { lossReport, equivalent, crossCheck, trivialOnly, lowValue } from './factCheck';
import { QUALITY_VERSION } from './contentQuality';
import { detectMeta, META_LABEL, noteOf, sentences, splitMeta, stripFirstPerson } from './contentQuality';

/**
 * v1.9「AI 整理现有资料」：对 IndexedDB 中已有资料生成整理计划（只是预览，不写库）。
 * 本地规则 → （可选）分批调用 AI 规范化 → AI 输出再过一遍独立的元信息检测 → 改写与原文一致性核对 → 原文证据复核（sourceTexts）。
 * 计划里每条建议标为 safe（可批量接受）或 high（高风险事实，必须单独确认，绝不自动写入）。
 */
export type Risk = 'safe' | 'high';
export interface Proposal {
  id: string; section: string; entryId: string; entryTitle: string;
  /** text = 文字规范化；drop = 整条移出简历要点；field = 事实字段（日期 / 类型 / 机构） */
  kind: 'text' | 'drop' | 'field';
  target: string; // 'b:<bulletId>' | 'summary' | 'headline' | 'name' | 字段名
  before: { zh?: string; en?: string } | string;
  after: { zh?: string; en?: string } | string;
  notes: string[]; archive: string[]; uncertain: string[];
  risk: Risk; reasons: string[]; source: 'local' | 'ai' | 'source-check';
}
export interface OrganizePlan { proposals: Proposal[]; fingerprints: { section: string; entryId: string; target: string; hash: string }[]; aiCalls: number; aiItems: number; createdAt: string; /** 指纹盐：规则版本 + 模型；任一变化即视为未整理 */ salt?: string; /** 失败的 AI 批次（其余批次与本地清洗照常保留） */ aiErrors?: string[]; /** v1.9.3 报告统计（按文字条目计） */ stats?: OrganizeStats; /** AI 建议因事实不完整（含重试后）被拒绝、保持原文的条目 */ rejectedItems?: { entryTitle: string; text: string; reasons: string[] }[] }

export interface OrganizeStats { total: number; metaCleaned: number; improved: number; unchanged: number; rejected: number; review: number; aiSkipped: number }
export const hashText = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const fp = (t: { zh?: string; en?: string }, salt = '') => hashText(`${salt}\u0002${t.zh ?? ''}\u0001${t.en ?? ''}`);
export const saltOf = (s: Pick<Settings, 'model'>) => `${QUALITY_VERSION}|${s.model ?? ''}`;
type Entry = Record<string, unknown> & { id: string; notes?: string[]; uncertain?: string[]; userConfirmedAt?: string; factualContent?: string[]; dossier?: ProjectDossier; tags?: string[]; kind?: string; nature?: string };
interface Unit { section: string; entryId: string; entryTitle: string; target: string; lt: LocalizedText; entry: Entry; isName: boolean }
const ltk = (t?: LocalizedText) => (t ? t.zh || t.en || '' : '');
const FAILED = /失败|未能|未成功|没有成功|放弃|不可行|行不通|failed|abandoned|did not work|unsuccessful/i;
const LIMIT = /局限|不足之处|误差较大|仅在实验室|limitation|only tested/i;
/** 明显的格式问题（多余空白、重复标点、行首项目符号、整句重复） */
const FORMAT = /\s{2,}|[。，,.]{2,}|^\s*[-•·*]\s*|(.{8,})\1/;

function units(p: ProfileDoc): Unit[] {
  const out: Unit[] = [];
  const me = { id: 'profile', ...(p.profile as object) } as unknown as Entry;
  out.push({ section: 'profile', entryId: 'profile', entryTitle: '基本信息', target: 'summary', lt: p.profile.summary, entry: me, isName: false });
  out.push({ section: 'profile', entryId: 'profile', entryTitle: '基本信息', target: 'headline', lt: p.profile.headline, entry: me, isName: false });
  const title = (sec: string, e: Entry) => sec === 'education' ? ltk(e.school as LocalizedText) : sec === 'work' ? [ltk(e.company as LocalizedText), ltk(e.title as LocalizedText)].filter(Boolean).join(' · ') : ltk(e.name as LocalizedText);
  for (const [sec, f] of [['work', 'bullets'], ['projects', 'bullets'], ['education', 'highlights']] as const) for (const e of p[sec] as unknown as Entry[])
    for (const b of (e[f] as LocalizedText[]) ?? []) if (b.id) out.push({ section: sec, entryId: e.id, entryTitle: title(sec, e), target: `b:${b.id}`, lt: b, entry: e, isName: false });
  for (const sec of ['skills', 'certificates', 'awards'] as const) for (const e of p[sec] as unknown as Entry[]) out.push({ section: sec, entryId: e.id, entryTitle: ltk(e.name as LocalizedText), target: 'name', lt: e.name as LocalizedText, entry: e, isName: true });
  return out;
}
const confirmedLang = (u: Unit, l: Lang) => u.lt.status?.[l] === 'confirmed' || (!!u.entry.userConfirmedAt && !isUnconfirmedImport(u.entry) && u.lt.status?.[l] !== 'machine');

/** 改写 vs 原文一致性核对：返回高风险原因（空 = 只是措辞变化） */
export function factGuard(before: string, after: string, ctx: { tags?: string[]; kind?: string; nature?: string; section: string; workKind?: string }): string[] {
  const r: string[] = []; if (!after.trim()) return r;
  const nb = numberTokens(before), na = numberTokens(after);
  const added = na.filter((x) => !nb.includes(x)); if (added.length) r.push(`新增了原文没有的数字：${[...new Set(added)].join('、')}`);
  const lost = nb.filter((x) => !na.includes(x)); if (lost.length) r.push(`删去了原文的数字 / 成果：${[...new Set(lost)].join('、')}`);
  const tb = new Set([...extractTechTerms(before), ...(ctx.tags ?? [])].map(normTerm));
  const newT = extractTechTerms(after).filter((t) => !tb.has(normTerm(t))); if (newT.length) r.push(`新增了原文没有的工具 / 技术：${newT.join('、')}`);
  const lab = ctx.kind === 'auxiliary' || /课程|实验|实训|练习|course|lab/i.test(`${ctx.nature ?? ''} ${before}`);
  const COMM = /商业|客户|公司项目|企业项目|量产|上线|commercial|client|customer|production/i;
  if (lab && COMM.test(after) && !COMM.test(before)) r.push('把课程实验 / 实训写成了商业或公司项目');
  const FT = /正式员工|全职|转正|full[- ]time|permanent/i;
  if (FT.test(after) && !FT.test(before)) r.push('出现了原文没有的「正式 / 全职」');
  const DEG = /已获得|已授予|已毕业|获得.{0,4}学位|conferred|graduated|awarded the degree/i;
  if (DEG.test(after) && !DEG.test(before)) r.push('出现了原文没有的「已获得学位 / 已毕业」');
  const ORG = /[\u4e00-\u9fff]{2,12}(?:公司|集团|大学|学院|研究院|研究所|医院|实验室)|\b[A-Z][\w&]+(?:\s[A-Z][\w&]+)*\s(?:Inc|Ltd|LLC|University|Institute|Lab)\b/g;
  const ob = new Set(before.match(ORG) ?? []); const on = (after.match(ORG) ?? []).filter((x) => ![...ob].some((y) => y.includes(x) || x.includes(y)));
  if (on.length) r.push(`出现了原文没有的单位名称：${on.join('、')}`);
  return r;
}

const asText = (s: string) => s.trim();
/** 本地规则建议（不调用 AI） */
function localCandidate(u: Unit): { zh?: string; en?: string; notes: string[]; reasons: string[] } {
  const cand: { zh?: string; en?: string } = { zh: u.lt.zh, en: u.lt.en }; const notes: string[] = []; const reasons: string[] = [];
  for (const l of ['zh', 'en'] as Lang[]) {
    const v = u.lt[l]; if (!v?.trim()) continue;
    if (u.isName) {
      const m = /^(.+?)\s*[（(]([^（）()]+)[）)]\s*$/.exec(v); const h = m && detectMeta(m[2]);
      if (m && h) { cand[l] = m[1]; notes.push(noteOf({ text: m[2], ...h })); reasons.push(`名称里的${META_LABEL[h.kind]}移入备注`); }
      continue;
    }
    const { keep, moved } = splitMeta(v); let next = keep;
    for (const m of moved) { notes.push(noteOf(m)); reasons.push(`${META_LABEL[m.kind]}移入备注（${m.reason}）`); }
    if (next && u.target !== 'headline') { const s2 = stripFirstPerson(next, l); if (s2 !== next) { reasons.push('去掉机械的第一人称主语'); next = s2; } }
    cand[l] = next || undefined;
  }
  return { ...cand, notes: [...new Set(notes)], reasons: [...new Set(reasons)] };
}

export interface OrganizeOptions { useAi: boolean; /** 忽略指纹，重新检查之前已整理 / 已拒绝的文字（规则或模型更新后） */ force?: boolean; batchSize?: number; onProgress?: (done: number, total: number, msg: string) => void; timeoutMs?: number; /** 事实不完整时反馈重试次数（默认 1） */ retries?: number }

export async function planOrganize(s: Settings, src: ProfileDoc, o: OrganizeOptions): Promise<OrganizePlan> {
  const p = structuredClone(src);
  const us = units(p); const proposals: Proposal[] = []; const fingerprints: OrganizePlan['fingerprints'] = [];
  const cands = new Map<Unit, ReturnType<typeof localCandidate> & { local: ReturnType<typeof localCandidate>; archive: string[]; uncertain: string[]; source: 'local' | 'ai'; aiFlags: string[]; semantic: string[]; enTrans: boolean; rejected?: string[] }>();
  for (const u of us) { if (!u.lt.zh && !u.lt.en) continue; const lc = localCandidate(u); cands.set(u, { ...lc, local: { zh: lc.zh, en: lc.en, notes: [...lc.notes], reasons: [...lc.reasons] }, archive: [], uncertain: [], source: 'local', aiFlags: [], semantic: [], enTrans: false }); }
  // 项目：失败方案 / 局限 → 档案
  for (const [u, c] of cands) if (u.section === 'projects' && !u.isName) {
    const v = c.zh || c.en || ''; if (!(FAILED.test(v) || LIMIT.test(v))) continue;
    c.archive.push(v); c.reasons.push(FAILED.test(v) ? '失败方案存入项目档案' : '技术局限存入项目档案');
    // v1.9.3：母库是完整记录——失败方案 / 技术局限只复制一份到档案，正式资料里的原句保留（生成简历时再按 JD 取舍）
  }
  // AI 规范化（v1.9.3）：只把确实有问题的条目送 AI（说明句 / 第一人称 / 格式 / 缺英文或英文过期）；
  // 干净、事实完整的条目不送、不改，计为「无需修改」。AI 输出逐条做事实完整性检查，失败则反馈丢失的事实重试，仍失败则保留原文。
  let aiCalls = 0, aiItems = 0, rejected = 0, skipped = 0; const rejectedItems: NonNullable<OrganizePlan['rejectedItems']> = []; const salt = saltOf(s); const aiErrors: string[] = [];
  if (o.useAi) {
    type C = NonNullable<ReturnType<typeof cands.get>>;
    const modeOf = (u: Unit, c: C): 'clean' | 'translate' | null => {
      if (u.isName || u.target === 'headline' || !(c.zh || c.en)) return null;
      if (!o.force && u.lt.organized === fp(u.lt, salt)) return null;
      if ((['zh', 'en'] as Lang[]).every((l) => !u.lt[l] || confirmedLang(u, l))) return null;
      const dirty = (['zh', 'en'] as Lang[]).some((l) => (u.lt[l] ?? '') !== (c.local[l] ?? '') || FORMAT.test(u.lt[l] ?? ''));
      if (dirty) return 'clean';
      const srcL: Lang = u.lt.source ?? 'zh', oL: Lang = srcL === 'zh' ? 'en' : 'zh';
      if (c[srcL] && !confirmedLang(u, oL) && (!u.lt[oL] || u.lt.status?.[oL] === 'stale')) return 'translate';
      return null;
    };
    const todo: [Unit, C, 'clean' | 'translate'][] = [];
    for (const [u, c] of cands) { const m = modeOf(u, c); if (m) todo.push([u, c, m]); else if (!u.isName && u.target !== 'headline' && (c.zh || c.en)) skipped++; }
    const B = o.batchSize ?? 20; const keyOf = new Map<string, [Unit, C, 'clean' | 'translate']>();
    todo.forEach((t, i) => keyOf.set(`k${i}`, t));
    type AiItem = { key?: string; category?: string; zh?: string; en?: string; notes?: string[]; archive?: string[]; uncertain?: string[] };
    type Out = { items?: AiItem[] };
    const strs = (a?: string[]) => (Array.isArray(a) ? a.filter((y) => typeof y === 'string' && y.trim()).map(asText) : []);
    /** 判断一条 AI 输出：loss = 事实不完整（需重试 / 拒绝）；rewrite = 未发现丢失但无法证明等价（B 类）；其余为 A 类或无改动 */
    const judge = (u: Unit, c: C, x: AiItem, mode: 'clean' | 'translate') => {
      const out: { zh?: string; en?: string } = { zh: c.local.zh, en: c.local.en }; const notes: string[] = []; const reasons: string[] = [];
      const loss: string[] = [], rewrite: string[] = []; let trans = false, internal = false;
      const srcL: Lang = u.lt.source ?? 'zh', oL: Lang = srcL === 'zh' ? 'en' : 'zh'; const ctx = { tags: u.entry.tags, kind: u.entry.kind, nature: u.entry.nature, section: u.section };
      if (x.category === 'internal' && mode === 'clean') {
        // 整条是说明：只有本地规则也认可时才移出；否则视为丢失事实
        if (sentences(c.local.zh || c.local.en || '').some((y) => detectMeta(y))) { internal = true; return { out: {}, notes: [c.local.zh, c.local.en].filter((y): y is string => !!y).map((y) => `【说明】${y}`), reasons: ['AI 判断为内部说明，移入备注'], loss, rewrite, trans, internal }; }
        loss.push('AI 想把整条移出简历，但本地规则认为这是事实'); return { out, notes, reasons, loss, rewrite, trans, internal };
      }
      for (const l of [srcL, oL]) {
        const raw = x[l]; const v = (typeof raw === 'string' ? raw : '').trim(); if (!v || confirmedLang(u, l)) continue;
        if (mode === 'translate' && l === srcL) continue; // 只补译：源语言不动
        const L = l === 'zh' ? '中文' : '英文';
        const { keep, moved } = splitMeta(v);
        if (moved.length) { notes.push(...moved.map(noteOf)); reasons.push('AI 输出仍含说明句，已由本地规则移出'); }
        const next = keep ? stripFirstPerson(keep, l) : ''; const loc = c.local[l] ?? '';
        if (!next) { if (loc) loss.push(`${L}：AI 删除了整条内容`); continue; }
        if (loc && (equivalent(loc, next, l) || trivialOnly(loc, next, l))) continue; // 等价或只差「曾 / 了」等虚词：不改
        const isTrans = l === oL && (!u.lt[l] || u.lt.status?.[l] === 'machine' || u.lt.status?.[l] === 'stale') && (out[srcL] ?? '') === (c.local[srcL] ?? '');
        if (isTrans) {
          const srcT = out[srcL] ?? ''; const nb = numberTokens(srcT), na = numberTokens(next);
          const xc = [...(nb.join() !== na.join() ? [`译文数字与原文不一致：${nb.join('、') || '无'} → ${na.join('、') || '无'}`] : []), ...crossCheck(srcL === 'zh' ? srcT : next, srcL === 'zh' ? next : srcT)];
          if (xc.length) loss.push(...xc.map((y) => `${L}译文待核对：${y}`)); else { out[l] = next; trans = true; }
          continue;
        }
        const lr = loc ? [...lossReport(loc, next, l), ...factGuard(loc, next, ctx)] : ['原文没有这一语言的内容，AI 新写'];
        if (lr.length) { loss.push(...[...new Set(lr)].map((y) => `${L}：${y}`)); continue; }
        if (lowValue(loc, next, l)) continue; // 未丢事实但改动价值很低：不产生审核项
        out[l] = next; rewrite.push(`${L}：AI 改写了措辞，未发现事实丢失，但无法证明与原文完全等价`);
      }
      return { out, notes, reasons, loss, rewrite, trans, internal };
    };
    const send = async (items: unknown[], label: string, retry: boolean): Promise<Map<string, AiItem> | null> => {

      try {
        const r = await chatJson<Out>(s, [{ role: 'system', content: '你是严谨的简历资料整理助手，只输出 JSON。' }, { role: 'user', content: `${ORGANIZE_PROMPT}${retry ? `\n\n${ORGANIZE_RETRY}` : ''}\n\n${JSON.stringify({ items })}` }], { maxTokens: 8000, timeoutMs: o.timeoutMs ?? 180_000 }); aiCalls++;
        const got = new Map((Array.isArray(r?.items) ? r.items : []).filter((x) => x && typeof x.key === 'string' && keyOf.has(x.key)).map((x) => [x.key!, x]));
        if (!got.size) { aiErrors.push(`${label}：AI 没有返回可用的整理结果（可能输出被截断）`); return null; }
        return got;
      } catch (e) { aiErrors.push(`${label}：${(e as Error).message}`); return null; }
    };
    const itemOf = (k: string, feedback?: string[]) => { const [u, c, mode] = keyOf.get(k)!; return { key: k, mode, section: u.section, context: [u.entryTitle, u.entry.nature, u.entry.kind].filter(Boolean).join(' · '), zh: c.local.zh ?? '', en: c.local.en ?? '', needEn: mode === 'translate' || (!!c.local.zh && (!u.lt.en || u.lt.status?.en === 'stale')), ...(feedback ? { lostFacts: feedback } : {}) }; };
    const results = new Map<string, ReturnType<typeof judge> & { x: AiItem }>();
    const keys = [...keyOf.keys()]; let failedBatches = 0, firstBatches = 0;
    for (let i = 0; i < keys.length; i += B) {
      const batch = keys.slice(i, i + B); firstBatches++;
      o.onProgress?.(i, keys.length, `AI 规范化第 ${Math.floor(i / B) + 1}/${Math.ceil(keys.length / B)} 批（${batch.length} 条）`);
      const got = await send(batch.map((k) => itemOf(k)), `第 ${Math.floor(i / B) + 1} 批`, false);
      if (!got) { failedBatches++; continue; }
      for (const k of batch) { const x = got.get(k); if (!x) continue; aiItems++; const [u, c, m] = keyOf.get(k)!; results.set(k, { ...judge(u, c, x, m), x }); fingerprints.push({ section: u.section, entryId: u.entryId, target: u.target, hash: '' }); }
    }
    // 重试：把具体丢失的事实反馈给 AI，要求保守版本
    for (let t = 0; t < (o.retries ?? 1); t++) {
      const bad = [...results.entries()].filter(([, r]) => r.loss.length).map(([k]) => k); if (!bad.length) break;
      for (let i = 0; i < bad.length; i += B) {
        const batch = bad.slice(i, i + B);
        o.onProgress?.(i, bad.length, `事实不完整，反馈后重试（${batch.length} 条）`);
        const got = await send(batch.map((k) => itemOf(k, results.get(k)!.loss)), `重试第 ${t + 1} 轮`, true); if (!got) continue;
        for (const k of batch) { const x = got.get(k); if (!x) continue; const [u, c, m] = keyOf.get(k)!; results.set(k, { ...judge(u, c, x, m), x }); }
      }
    }
    for (const [k, r] of results) {
      const [, c] = keyOf.get(k)!;
      if (r.loss.length) { const [u0] = keyOf.get(k)!; rejected++; c.rejected = r.loss; rejectedItems.push({ entryTitle: u0.entryTitle, text: u0.lt.zh || u0.lt.en || '', reasons: [...new Set(r.loss)] }); continue; } // 仍不完整：保留原文（本地机械清洗照常）
      if (r.internal) { c.zh = undefined; c.en = undefined; c.notes = [...new Set([...c.notes, ...r.notes])]; c.reasons.push(...r.reasons); c.source = 'ai'; continue; }
      const changed = (r.out.zh ?? '') !== (c.local.zh ?? '') || (r.out.en ?? '') !== (c.local.en ?? '');
      if (!changed && !r.notes.length) continue;
      c.source = 'ai'; c.zh = r.out.zh; c.en = r.out.en; c.notes = [...new Set([...c.notes, ...r.notes, ...strs(r.x.notes).filter((y) => detectMeta(y))])];
      c.archive = [...new Set([...c.archive, ...strs(r.x.archive)])]; c.uncertain = strs(r.x.uncertain); c.reasons.push(...r.reasons);
      if (r.trans) { c.enTrans = true; c.reasons.push('补译 / 重新机翻（已通过中英交叉核对）'); }
      if (r.rewrite.length) { c.semantic.push(...r.rewrite); c.reasons.push('AI 语义改写'); }
    }
    if (firstBatches && failedBatches === firstBatches) throw new Error(`AI 整理全部失败，资料没有任何改动：${aiErrors.join('；')}`);
    o.onProgress?.(keys.length, keys.length, aiErrors.length ? `AI 规范化完成（${aiErrors.length} 批失败，已仅用本地规则）` : 'AI 规范化完成');
  }
  // 汇总为建议
  let n = 0;
  for (const [u, c] of cands) {
    const before = { zh: u.lt.zh, en: u.lt.en };
    const after = { zh: c.zh, en: c.en };
    const changed = (before.zh ?? '') !== (after.zh ?? '') || (before.en ?? '') !== (after.en ?? '');
    const newNotes = c.notes.filter((x) => !(u.entry.notes ?? []).includes(x));
    const d = u.entry.dossier ?? {}; const inArchive = (x: string) => (d.failedAttempts ?? []).some((f) => f.approach === x) || (d.problems ?? '').includes(x) || (d.technicalWork ?? '').includes(x);
    c.archive = c.archive.filter((x) => !inArchive(x));
    if (!changed && !newNotes.length && !c.archive.length && !c.uncertain.length) continue;
    const reasons = [...c.reasons]; let risk: Risk = 'safe';
    for (const l of ['zh', 'en'] as Lang[]) {
      if ((before[l] ?? '') === (after[l] ?? '')) continue;
      if (confirmedLang(u, l)) { risk = 'high'; reasons.push(`${l === 'zh' ? '中文' : '英文'}是你确认过的内容`); }
      // 补译 / 重新机翻：已在上面与中文做过数字 + 交叉核对，旧译文（或空）不是比较基准
      const g = c.enTrans && l === 'en' ? [] : after[l] ? factGuard(before[l] ?? '', after[l]!, { tags: u.entry.tags, kind: u.entry.kind, nature: u.entry.nature, section: u.section }) : [];
      // 仅移出了说明句 / 去掉主语时，原文数字理应全部保留；factGuard 发现差异即为高风险
      if (g.length) { risk = 'high'; reasons.push(...g); }
    }
    if (c.aiFlags.length) { risk = 'high'; reasons.push(...c.aiFlags); }
    // B 类：任何无法证明与本地机械清洗等价的 AI 改写，一律不默认勾选
    if (c.semantic.length) { risk = 'high'; reasons.push(...c.semantic); }
    const dropped = !after.zh && !after.en;
    // AI 版本有高风险时，仍单独给出「仅本地规则」的安全版本（去套话 / 去主语），避免整条因 AI 夸大而无法批量清理
    if (risk === 'high' && c.source === 'ai') {
      const L = c.local; const la = { zh: L.zh, en: L.en };
      const lChanged = (before.zh ?? '') !== (la.zh ?? '') || (before.en ?? '') !== (la.en ?? '');
      const lSafe = (['zh', 'en'] as Lang[]).every((l) => (before[l] ?? '') === (la[l] ?? '') || (!confirmedLang(u, l) && !(la[l] && factGuard(before[l] ?? '', la[l]!, { tags: u.entry.tags, kind: u.entry.kind, nature: u.entry.nature, section: u.section }).length)));
      if (lChanged && lSafe) proposals.push({ id: `op${++n}`, section: u.section, entryId: u.entryId, entryTitle: u.entryTitle, kind: !la.zh && !la.en ? 'drop' : 'text', target: u.target, before, after: la, notes: L.notes.filter((x) => !(u.entry.notes ?? []).includes(x)), archive: [], uncertain: [], risk: 'safe', reasons: [...L.reasons, 'AI 改写有风险，这里只采用本地规则的安全修正'], source: 'local' });
    }
    proposals.push({ id: `op${++n}`, section: u.section, entryId: u.entryId, entryTitle: u.entryTitle, kind: dropped ? 'drop' : 'text', target: u.target, before, after, notes: newNotes, archive: c.archive, uncertain: c.uncertain, risk, reasons: [...new Set(reasons)], source: c.source });
  }
  // 原文证据复核：已保存的原始资料（sourceTexts）里找不到依据的高风险事实（日期 / 学位 / 任职性质 / 颁发机构）
  const srcText = (p.sourceTexts ?? []).map((x) => x.text).join('\n\n');
  if (srcText.trim()) {
    const checked = checkAgainstSource(structuredClone(p), srcText);
    for (const sec of ['education', 'work', 'projects', 'certificates', 'awards'] as const) {
      const a = p[sec] as unknown as Entry[], b = checked[sec] as unknown as Entry[];
      a.forEach((e, i) => {
        if (!e.importedFrom && !(p.sourceTexts ?? []).length) return;
        if (e.userConfirmedAt && !isUnconfirmedImport(e)) return; // 用户确认过的事实优先保留
        const f2 = b[i]; const newU = (f2.uncertain ?? []).filter((x) => !(e.uncertain ?? []).includes(x));
        for (const f of ['actualConferralDate', 'expectedConferralDate', 'end', 'start', 'kind', 'issuer', 'date']) {
          const x = e[f], y = f2[f]; const sx = typeof x === 'object' ? ltk(x as LocalizedText) : (x as string | undefined) ?? '', sy = typeof y === 'object' ? ltk(y as LocalizedText) : (y as string | undefined) ?? '';
          if (sx === sy) continue;
          proposals.push({ id: `op${++n}`, section: sec, entryId: e.id, entryTitle: ltk((e.school ?? e.company ?? e.name) as LocalizedText), kind: 'field', target: f, before: sx, after: sy, notes: [], archive: [], uncertain: newU.filter((u2) => u2.includes(sx) || u2.startsWith(CRITICAL)), risk: 'high', reasons: newU.length ? newU.map((u2) => u2.replace(CRITICAL, '')) : ['原始资料中找不到依据'], source: 'source-check' });
        }
      });
    }
  }
  const tk = (x: Proposal) => `${x.section}|${x.entryId}|${x.target}`;
  const textP = proposals.filter((x) => x.kind !== 'field'); const total = [...cands.keys()].filter((u) => !u.isName).length;
  const safeT = new Set(textP.filter((x) => x.risk === 'safe').map(tk)), highT = new Set(textP.filter((x) => x.risk === 'high').map(tk));
  const metaT = new Set(textP.filter((x) => x.risk === 'safe' && (x.notes.length || x.kind === 'drop')).map(tk));
  const stats: OrganizeStats = { total, metaCleaned: metaT.size, improved: [...safeT].filter((k) => !metaT.has(k)).length, unchanged: [...cands.keys()].filter((u) => !u.isName && !safeT.has(tk({ section: u.section, entryId: u.entryId, target: u.target } as Proposal)) && !highT.has(tk({ section: u.section, entryId: u.entryId, target: u.target } as Proposal))).length, rejected, review: highT.size + proposals.filter((x) => x.kind === 'field').length, aiSkipped: skipped };
  return { proposals, fingerprints, aiCalls, aiItems, createdAt: new Date().toISOString(), salt: o.useAi ? saltOf(s) : undefined, aiErrors, stats, rejectedItems };
}

const addUniq = (a: string[] | undefined, xs: string[]) => { const s = new Set(a ?? []); for (const x of xs) if (x && x.trim()) s.add(x.trim()); return [...s]; };
/** 按用户勾选写入；ID 不变；被改写 / 移出的原句进 factualContent，说明进 notes，失败方案 / 局限进项目档案 */
export function applyOrganize(src: ProfileDoc, plan: OrganizePlan, accepted: Set<string>): ProfileDoc {
  const p = structuredClone(src);
  const entryOf = (sec: string, id: string): Entry | undefined => sec === 'profile' ? (p.profile as unknown as Entry) : (p[sec as 'work'] as unknown as Entry[]).find((e) => e.id === id);
  const ltOf = (e: Entry, sec: string, target: string): { list?: LocalizedText[]; lt?: LocalizedText } => {
    if (target.startsWith('b:')) { const list = (e[sec === 'education' ? 'highlights' : 'bullets'] as LocalizedText[]); return { list, lt: list.find((b) => b.id === target.slice(2)) }; }
    return { lt: e[target] as LocalizedText };
  };
  for (const pr of plan.proposals) {
    if (!accepted.has(pr.id)) continue;
    const e = entryOf(pr.section, pr.entryId); if (!e) continue;
    if (pr.kind === 'field') { if (pr.target === 'issuer') e.issuer = {}; else if (pr.target === 'kind') delete e.kind; else e[pr.target] = pr.after; e.uncertain = addUniq(e.uncertain, pr.uncertain); continue; }
    const { list, lt } = ltOf(e, pr.section, pr.target); if (!lt) continue;
    const b = pr.before as { zh?: string; en?: string }, a = pr.after as { zh?: string; en?: string };
    e.notes = addUniq(e.notes, pr.notes);
    if (pr.section !== 'profile') e.uncertain = addUniq(e.uncertain, pr.uncertain);
    const changedTexts = (['zh', 'en'] as Lang[]).filter((l) => (b[l] ?? '') !== (a[l] ?? '')).map((l) => b[l]).filter((x): x is string => !!x);
    if (pr.section !== 'profile') e.factualContent = addUniq(e.factualContent, changedTexts);
    if (pr.archive.length && pr.section === 'projects') {
      const d: ProjectDossier = (e.dossier ??= {});
      for (const x of pr.archive) {
        if (FAILED.test(x)) { d.failedAttempts ??= []; if (!d.failedAttempts.some((f) => f.approach === x)) d.failedAttempts.push({ id: `${pr.target.slice(2)}-fa${d.failedAttempts.length + 1}`, approach: x, reason: '' }); }
        else if (LIMIT.test(x)) { if (!(d.problems ?? '').includes(x)) d.problems = [d.problems, x].filter(Boolean).join('\n'); }
        else if (!(d.technicalWork ?? '').includes(x)) d.technicalWork = [d.technicalWork, x].filter(Boolean).join('\n');
      }
    }
    if (pr.kind === 'drop') { if (list) list.splice(list.indexOf(lt), 1); else { delete lt.zh; delete lt.en; } continue; }
    for (const l of ['zh', 'en'] as Lang[]) {
      if ((b[l] ?? '') === (a[l] ?? '')) continue;
      if (a[l]) lt[l] = a[l]; else delete lt[l];
      lt.status = { ...(lt.status ?? {}) };
      // AI 新写的另一语言：标为机翻（不冒充确认）；本地只删说明句：保留原状态
      if (pr.source === 'ai' && l !== (lt.source ?? 'zh')) lt.status[l] = 'machine';
      else if (pr.source === 'ai') lt.status[l] = lt.status[l] === 'confirmed' ? 'confirmed' : 'manual';
    }
    // 主语言发生语义改写（B 类）、另一语言没跟着改且是机翻 → 标为待更新；A 类机械清洗事实不变，译文仍有效
    const srcL = lt.source ?? 'zh', o: Lang = srcL === 'zh' ? 'en' : 'zh';
    if (pr.risk === 'high' && (b[srcL] ?? '') !== (a[srcL] ?? '') && (b[o] ?? '') === (a[o] ?? '') && lt[o] && lt.status?.[o] === 'machine') lt.status = { ...lt.status, [o]: 'stale' };
  }
  // 指纹：AI 处理过的文字记录最终指纹，下次文字未变则不再送 AI
  for (const f of plan.fingerprints) {
    const e = entryOf(f.section, f.entryId); if (!e) continue; const { lt } = ltOf(e, f.section, f.target);
    if (lt && (lt.zh || lt.en)) lt.organized = fp(lt, plan.salt ?? '');
  }
  return p;
}
