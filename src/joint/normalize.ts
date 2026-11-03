import type { JobParse } from '../types';
import type { AiSelectionOutput } from '../ai/aiPlanner';
import type { JointSynthesis } from '../types/joint';
import { jobRequirements } from './jobs';

/** 自动补位的岗位要求：AI 本次没有逐条判断。它不进入「不得写进简历」的缺口列表，报告里明确提示请自行核对。 */
export const UNJUDGED = '【未判断】';
export const isUnjudged = (r: { reason?: string }) => typeof r.reason === 'string' && r.reason.startsWith(UNJUDGED);

const norm = (s: unknown) => String(s ?? '').replace(/^\s*\d+\s*[.、．)）]?\s*/, '').replace(/[\s，,。.；;：:（）()、"“”'‘’]/g, '').toLowerCase();

/**
 * 2026-11：联合岗位的「逐条对账」是记账工作，不应让整份简历失败（负责人实测：AI 漏写 requirementId、漏判几条要求，
 * 局部修复也失败，整次生成被拒）。这里在本地校验之前做确定性整理：
 * ① 缺失 / 无效 / 重复的 requirementId 按原文匹配补上（只认唯一且未被占用的匹配）；有效 ID 的 text、tier 统一回原 JD 原文；
 * ② 匹配不到任何原 JD 要求的条目丢弃；缺少 reason 的补一句说明；
 * ③ 漏判的要求补为 gap + 【未判断】（不进入写作禁用列表，报告提示核对）；
 * ④ 共同 / 互补归纳去掉无效与重复 ID，遗漏的要求补进互补，共同组跨岗不足两个时降为互补。
 * 选材（entries / skills 等）完全不动，仍由 AI 决定并通过原有严格校验。
 */
export function normalizeJointOutput(raw: AiSelectionOutput, job: JobParse): AiSelectionOutput {
  if (!job.joint || !raw || typeof raw !== 'object') return raw;
  const refs = jobRequirements(job), byId = new Map(refs.map((r) => [r.id, r]));
  const used = new Set<string>();
  const input = Array.isArray(raw.requirements) ? raw.requirements : [];
  const out: NonNullable<AiSelectionOutput['requirements']> = [];
  // 先收下 ID 有效且未重复的，再给其余按原文匹配，避免后者抢占前者的 ID。
  const pending: typeof input = [];
  for (const r of input) {
    if (!r || typeof r !== 'object') continue;
    const ref = byId.get(String(r.requirementId ?? ''));
    if (ref && !used.has(ref.id)) { used.add(ref.id); out.push({ ...r, requirementId: ref.id, text: ref.text.zh.trim() || ref.text.en.trim(), tier: ref.tier }); }
    else pending.push(r);
  }
  for (const r of pending) {
    const t = norm(r.text);
    if (!t) continue;
    const hits = refs.filter((x) => !used.has(x.id) && (norm(x.text.zh) === t || norm(x.text.en) === t));
    const loose = hits.length ? hits : refs.filter((x) => !used.has(x.id) && t.length >= 6 && [x.text.zh, x.text.en].some((v) => { const n = norm(v); return n.length >= 6 && (n.includes(t) || t.includes(n)); }));
    if (loose.length !== 1) continue;
    const ref = loose[0]; used.add(ref.id);
    out.push({ ...r, requirementId: ref.id, text: ref.text.zh.trim() || ref.text.en.trim(), tier: ref.tier });
  }
  for (const r of out) if (typeof r.reason !== 'string' || !r.reason.trim()) r.reason = 'AI 未给出具体说明，请结合证据自行核对';
  for (const ref of refs) if (!used.has(ref.id))
    out.push({ requirementId: ref.id, text: ref.text.zh.trim() || ref.text.en.trim(), tier: ref.tier, assessment: 'gap', evidenceIds: [], reason: `${UNJUDGED}AI 本次没有逐条判断这条要求，不代表你不具备，请自行核对` });
  // 按原 JD 顺序排列，报告更好读
  const order = new Map(refs.map((r, i) => [r.id, i]));
  out.sort((a, b) => (order.get(a.requirementId!) ?? 0) - (order.get(b.requirementId!) ?? 0));

  const s = raw.jointSummary && typeof raw.jointSummary === 'object' ? raw.jointSummary : ({} as Partial<JointSynthesis>);
  const clean = (rows: unknown) => (Array.isArray(rows) ? rows : []).filter((x) => x && typeof x === 'object')
    .map((x: { requirementIds?: unknown; reason?: unknown }) => ({ requirementIds: [...new Set((Array.isArray(x.requirementIds) ? x.requirementIds : []).map(String).filter((id) => byId.has(id)))], reason: typeof x.reason === 'string' && x.reason.trim() ? x.reason : 'AI 未给出具体依据' }))
    .filter((x) => x.requirementIds.length);
  const grouped = new Set<string>();
  const common: JointSynthesis['common'] = [], complementary: JointSynthesis['complementary'] = [];
  for (const row of clean(s.common)) {
    const ids = row.requirementIds.filter((id) => !grouped.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => grouped.add(id));
    if (new Set(ids.map((id) => byId.get(id)!.jobId)).size >= 2) common.push({ ...row, requirementIds: ids });
    else complementary.push({ ...row, requirementIds: ids });
  }
  for (const row of clean(s.complementary)) {
    const ids = row.requirementIds.filter((id) => !grouped.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => grouped.add(id));
    complementary.push({ ...row, requirementIds: ids });
  }
  for (const ref of refs) if (!grouped.has(ref.id)) { grouped.add(ref.id); complementary.push({ requirementIds: [ref.id], reason: '该岗位的独立要求（AI 未归纳，已按独立要求处理）' }); }
  const conflicts = clean(s.conflicts).filter((row) => new Set(row.requirementIds.map((id) => byId.get(id)!.jobId)).size >= 2);
  return { ...raw, requirements: out, jointSummary: { common, complementary, conflicts } };
}
