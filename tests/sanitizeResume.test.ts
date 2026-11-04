import { describe, expect, it } from 'vitest';
import { sanitizeJob, sanitizeResume } from '../src/utils/sanitizeResume';
import type { ResumeDoc } from '../src/types';

const base = (): ResumeDoc => ({ id: 'r', jobId: 'j', templateId: 't', primaryLanguage: 'zh', createdAt: '', matchScore: 0, gaps: [], selection: { work: [], projects: [], education: [], skills: [], certificates: [], awards: [] }, items: [{ sourceId: 'a', zh: '甲', en: 'A', syncStatus: 'in-sync' }], consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai' });
const bad = (patch: Record<string, unknown>) => ({ ...base(), ...patch }) as unknown as ResumeDoc;

describe('sanitizeResume：畸形数据不再导致整页白屏', () => {
  it('正常简历原样返回同一个对象', () => { const r = base(); expect(sanitizeResume(r)).toBe(r); });
  it('notes 里混入对象 → 转成字符串', () => { const r = sanitizeResume(bad({ notes: ['ok', { a: 1 }] })); expect(r.notes!.every((n) => typeof n === 'string')).toBe(true); });
  it('skillGroups 缺 ids → 丢弃该组', () => { expect(sanitizeResume(bad({ skillGroups: [{ zh: 'a', en: 'b' }] })).skillGroups).toBeUndefined(); });
  it('headline 的文字不是字符串 → 补成字符串', () => { const h = sanitizeResume(bad({ headline: { zh: { x: 1 }, en: 'e' } })).headline!; expect(typeof h.zh).toBe('string'); expect(h.en).toBe('e'); });
  it('evidenceReport 缺 targets → 去掉；缺 requirements / evidence → 补空数组', () => {
    expect(sanitizeResume(bad({ evidenceReport: {} })).evidenceReport).toBeUndefined();
    const rep = sanitizeResume(bad({ evidenceReport: { targets: [{ jobId: 'x', title: { zh: 't' } }, { jobId: 'y', title: {}, requirements: [{ text: 'q' }] }], selectionReasons: [] } })).evidenceReport!;
    expect(rep.targets[0].requirements).toEqual([]);
    expect(rep.targets[1].requirements[0].evidence).toEqual([]);
    expect(rep.targets[1].requirements[0].risks).toEqual([]);
  });
  it('items 文字为 null → 补空串；selection / consistency 缺失 → 补默认', () => {
    const r = sanitizeResume(bad({ items: [{ sourceId: 'a', zh: null, en: 'x', syncStatus: 'in-sync' }], selection: undefined, consistency: undefined }));
    expect(r.items[0].zh).toBe(''); expect(r.selection.work).toEqual([]); expect(r.consistency.issues).toEqual([]);
  });
  it('null 原样返回', () => { expect(sanitizeResume(null)).toBeNull(); });
});

describe('sanitizeJob', () => {
  it('缺 mustHave / niceToHave / keywords → 补空数组；列表项缺 en → 补空串', () => {
    const j = sanitizeJob({ id: 'j', mustHave: [{ zh: 'a' }] } as never) as unknown as { mustHave: { zh: string; en: string }[]; niceToHave: unknown[]; keywords: unknown[] };
    expect(j.mustHave).toEqual([{ zh: 'a', en: '' }]); expect(j.niceToHave).toEqual([]); expect(j.keywords).toEqual([]);
  });
});
