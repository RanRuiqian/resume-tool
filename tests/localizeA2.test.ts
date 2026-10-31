import { describe, expect, it } from 'vitest';
import { compareFacts, factTokens } from '../src/ai/consistency';
import { decideTranslation, runConsistency } from '../src/ai/generate';
import type { ResumeDoc } from '../src/types';

// 模拟数据（A2）
describe('A2 中英文事实一致性', () => {
  it('识别数字、百分比、单位、日期、金额差异', () => {
    expect(compareFacts('召回率提升 30%', 'Improved recall by 30%')).toEqual([]);
    expect(compareFacts('召回率提升 30%', 'Improved recall by 35%').length).toBeGreaterThan(0);
    expect(compareFacts('营收 20 万元', 'Revenue of RMB 200K')).toEqual([]);
    expect(compareFacts('营收 20 万元', 'Revenue of $200K').join()).toContain('币种');
    expect(compareFacts('2024年3月上线', 'Launched in Mar 2024')).toEqual([]);
    expect(compareFacts('2024年3月上线', 'Launched in May 2024').length).toBeGreaterThan(0);
    expect(compareFacts('提升 3 个百分点', 'up 3 percentage points')).toEqual([]);
    expect(factTokens('延迟降低 40%').pct).toEqual(['40']);
  });
  it('AI 译文数字不一致：不标记已同步，保留原文与 AI 译文', () => {
    const d = decideTranslation('召回率提升 30%', 'Improved recall by 35%', undefined, undefined);
    expect(d.syncStatus).toBe('needs-review');
    expect(d.text).toBe('Improved recall by 35%'); // 不删除数字来"消除"问题
    expect(d.translation.aiText).toBe('Improved recall by 35%');
    expect(d.translation.factIssues.length).toBeGreaterThan(0);
  });
  it('重试失败后优先使用已确认的历史译文', () => {
    const d = decideTranslation('召回率提升 30%', 'Improved recall by 35%', 'Raised recall by 30%', 'x');
    expect(d.syncStatus).toBe('in-sync'); expect(d.text).toBe('Raised recall by 30%'); expect(d.translation.source).toBe('confirmed');
  });
  it('没有可靠译文时标记需人工检查', () => {
    const d = decideTranslation('召回率提升 30%', undefined, undefined, 'Improved recall by 25%');
    expect(d.syncStatus).toBe('needs-review'); expect(d.translation.source).toBe('profile');
  });
  it('只是措辞变化 → in-sync，无事实差异', () => {
    const d = decideTranslation('负责缺陷检测模型训练', 'Trained defect-detection models', undefined, undefined);
    expect(d.syncStatus).toBe('in-sync'); expect(d.translation.factIssues).toEqual([]);
  });
  it('runConsistency 兜底：任何路径下数字不一致都不会保持 in-sync', () => {
    const r = { primaryLanguage: 'zh', items: [{ sourceId: 'a', zh: '提升 30%', en: 'Up 35%', syncStatus: 'in-sync' }] } as unknown as ResumeDoc;
    expect(runConsistency(r).items[0].syncStatus).toBe('needs-review');
  });
});
