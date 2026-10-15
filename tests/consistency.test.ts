import { describe, it, expect } from 'vitest';
import { checkConsistency, numberTokens } from '../src/ai/consistency';
import type { GenItem } from '../src/types';
import { editText, formatRange } from '../src/locale/text';

const it_ = (sourceId: string, zh: string, en: string): GenItem => ({ sourceId, zh, en, syncStatus: 'in-sync' });

describe('consistency check', () => {
  it('passes when numbers match', () => {
    expect(checkConsistency([it_('a', '首屏加载从 3.2 秒降到 1.9 秒（降低 40%）', 'Cut load time from 3.2s to 1.9s (40% faster)')])).toEqual([]);
  });
  it('flags differing numbers', () => {
    const r = checkConsistency([it_('a', '提升 30%', 'Improved by 35%')]);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('number');
  });
  it('ignores digits inside words like B2B, normalizes full-width and thousands', () => {
    expect(numberTokens('B2B 平台')).toEqual([]);
    expect(numberTokens('１２ 个团队')).toEqual(['12']);
    expect(numberTokens('1,200 users')).toEqual(['1200']);
  });
  it('flags empty side, duplicates, missing and extra ids', () => {
    const r = checkConsistency([it_('a', '中文', ''), it_('b', 'x', 'x'), it_('b', 'y', 'y')], ['a', 'c']);
    const types = r.map((x) => x.type).sort();
    expect(types).toEqual(['empty', 'extra', 'extra', 'missing']);
  });
});

describe('locale helpers', () => {
  it('formats dates per language', () => {
    expect(formatRange('2021-07', 'present', 'YYYY.MM', '至今')).toBe('2021.07 – 至今');
    expect(formatRange('2021-07', 'present', 'MMM YYYY', 'Present')).toBe('Jul 2021 – Present');
  });
  it('marks translation stale when source changes', () => {
    const t = { zh: '原文', en: 'Original', source: 'zh' as const, status: { en: 'confirmed' as const } };
    expect(editText(t, 'zh', '新原文').status?.en).toBe('stale');
    expect(editText(t, 'en', 'Edited').status?.en).toBe('manual');
  });
});
