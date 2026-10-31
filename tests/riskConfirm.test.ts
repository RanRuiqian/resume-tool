import { describe, expect, it } from 'vitest';
import { applyDecision, auditResume, confirmImportedEntries, isDecided, summarize } from '../src/audit/factAudit';
import { buildAllowlist, isUnconfirmedImport, normTerm } from '../src/audit/techTerms';
import { rawToProfile } from '../src/ai/importProfile';
import { normalizeProfile } from '../src/storage/profileIO';
import type { GenItem, ProfileDoc, ResumeDoc } from '../src/types';

// 全部为虚构资料
function mock(): ProfileDoc {
  const p = normalizeProfile(rawToProfile({
    name: '测试用户壬',
    work: [{ company: '模拟装备有限公司', title: '算法实习生', start: '2025-03', end: '2025-08', tags: ['Python', 'OpenCV'], bullets: ['使用 OpenCV 开发视觉检测程序', '参与团队搭建检测流程，耗时降低 30%'] }],
    projects: [{ name: '模拟分拣项目', start: '2025-09', end: '2025-12', tags: ['PyTorch'], bullets: ['训练分拣分类模型'] }],
    skills: [{ name: 'Python' }, { name: 'OpenCV' }, { name: 'CUDA' }],
  }));
  // 模拟「AI 智能导入新增、尚未确认」的项目与技能
  p.projects[0].importedFrom = { importTag: 'imp-1', incomingId: 'x', at: '2026-10-30T10:00:00.000Z' };
  p.skills[2].importedFrom = { importTag: 'imp-1', incomingId: 'y', at: '2026-10-30T10:00:00.000Z' };
  return p;
}
const resume = (items: GenItem[]): ResumeDoc => ({ id: 'r', jobId: 'j', templateId: 't', primaryLanguage: 'zh', createdAt: '2026-10-31', matchScore: 80, gaps: [], selection: { work: [], projects: [], education: [], skills: [], certificates: [], awards: [] }, items, consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai' });
const gi = (sourceId: string, zh: string): GenItem => ({ sourceId, zh, en: '', syncStatus: 'in-sync' });
const codes = (a: { findings: { code: string }[] }) => a.findings.map((f) => f.code);

describe('红色风险二次确认', () => {
  it('误点「接受改写」不会让红色风险被视为已处理', () => {
    const p = mock(); const w0 = p.work[0].bullets[0].id!;
    const r0 = resume([gi(w0, '使用 TensorFlow 与 OpenCV 开发视觉检测程序')]);
    expect(auditResume(p, r0).items[0].zh.level).toBe('red');
    const r1 = applyDecision(p, r0, w0, 'zh', 'accepted');
    expect(isDecided(r1, w0, 'zh', 'red')).toBe(false);
    expect(auditResume(p, r1).summary.unconfirmedRed).toBe(1);
  });
  it('二次确认并关联证据后才算处理，确认记录与证据可追溯', () => {
    const p = mock(); const w0 = p.work[0].bullets[0].id!;
    const r0 = resume([gi(w0, '使用 TensorFlow 与 OpenCV 开发视觉检测程序')]);
    const r1 = applyDecision(p, r0, w0, 'zh', 'accepted', undefined, { riskAck: { statement: '我确认', evidenceIds: ['ev-1'] } });
    const d = r1.audit!.decisions[w0].zh!;
    expect(d.riskAck).toMatchObject({ statement: '我确认', evidenceIds: ['ev-1'] });
    expect(d.riskAck!.at).toBeTruthy();
    expect(isDecided(r1, w0, 'zh', 'red')).toBe(true);
    expect(auditResume(p, r1).summary.unconfirmedRed).toBe(0);
    expect(p.work[0].bullets[0].zh).not.toContain('TensorFlow'); // 资料库不被修改
  });
  it('恢复原文无需二次确认；手动编辑后若仍为红色，仍需确认', () => {
    const p = mock(); const w0 = p.work[0].bullets[0].id!;
    const r0 = resume([gi(w0, '使用 TensorFlow 与 OpenCV 开发视觉检测程序')]);
    const rr = applyDecision(p, r0, w0, 'zh', 'restored');
    expect(auditResume(p, rr).summary.unconfirmedRed).toBe(0);
    const re = applyDecision(p, r0, w0, 'zh', 'edited', '使用 TensorFlow 开发视觉检测程序');
    expect(auditResume(p, re).summary.unconfirmedRed).toBe(1);
  });
  it('黄色 / 灰色风险仍可直接人工处理（不需要二次确认）', () => {
    const p = mock(); const w1 = p.projects[0].bullets[0].id!;
    const r0 = resume([gi(w1, '训练分拣分类模型。'), gi('missing-id', '某段无来源的描述')]);
    const a = auditResume(p, r0);
    expect(a.items[0].zh.level).toBe('yellow'); expect(a.items[1].zh.level).toBe('gray');
    let r1 = applyDecision(p, r0, w1, 'zh', 'accepted');
    r1 = applyDecision(p, r1, 'missing-id', 'zh', 'accepted');
    expect(summarize(auditResume(p, r1).items, r1, ['zh']).unconfirmed).toBe(0);
  });
});

describe('技术词白名单不采信未确认的 AI 导入内容', () => {
  it('AI 导入未确认的技能 / 标签只进入「未确认来源」', () => {
    const p = mock(); const a = buildAllowlist(p);
    expect(a.terms.has(normTerm('PyTorch'))).toBe(false);
    expect(a.terms.has(normTerm('CUDA'))).toBe(false);
    expect(a.unconfirmed.get(normTerm('PyTorch'))![0].entryId).toBe(p.projects[0].id);
    expect(a.terms.has(normTerm('OpenCV'))).toBe(true);
  });
  it('改写使用未确认来源的技术 → 红色「未确认来源」，确认资料后降为借用提示', () => {
    const p = mock(); const w0 = p.work[0].bullets[0].id!;
    const r = resume([gi(w0, '使用 OpenCV 与 CUDA 开发视觉检测程序')]);
    const z = auditResume(p, r).items[0].zh;
    expect(z.level).toBe('red'); expect(codes(z)).toContain('unconfirmed-source');
    expect(z.findings.find((f) => f.code === 'unconfirmed-source')!.entryIds).toEqual([p.skills[2].id]);
    const p2 = confirmImportedEntries(p, [p.skills[2].id]);
    const z2 = auditResume(p2, r).items[0].zh;
    expect(codes(z2)).not.toContain('unconfirmed-source'); expect(z2.level).toBe('yellow');
  });
  it('未确认导入条目的要点：原文标为未确认来源（黄色，可人工处理），其标签不作为本条依据', () => {
    const p = mock(); const b = p.projects[0].bullets[0].id!;
    const z = auditResume(p, resume([gi(b, '使用 PyTorch 训练分拣分类模型')])).items[0].zh;
    expect(codes(z)).toContain('source-unconfirmed');
    expect(codes(z)).toContain('unconfirmed-source');
    expect(z.level).toBe('red');
  });
  it('确认时间早于最近一次合并 → 重新视为未确认；确认时间可随 JSON 往返保存', () => {
    const e = { importedFrom: { at: '2026-10-01T00:00:00Z' }, userConfirmedAt: '2026-10-02T00:00:00Z', mergeHistory: [{ at: '2026-10-03T00:00:00Z' }] };
    expect(isUnconfirmedImport(e)).toBe(true);
    expect(isUnconfirmedImport({ ...e, userConfirmedAt: '2026-10-04T00:00:00Z' })).toBe(false);
    expect(isUnconfirmedImport({})).toBe(false); // 用户手填的内容
    const p = confirmImportedEntries(mock(), [mock().projects[0].id]);
    const back = normalizeProfile(JSON.parse(JSON.stringify(p)));
    expect(back.projects[0].userConfirmedAt).toBeTruthy();
    expect(isUnconfirmedImport(back.projects[0])).toBe(false);
  });
});
