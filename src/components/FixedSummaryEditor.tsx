import { useState } from 'react';
import type { Lang, LocalizedText, Settings } from '../types';
import { LTField } from './LTField';
import { fixedSummaryText } from '../ai/fixedSummary';
import { translateTexts } from '../ai/translate';
import { crossCheck } from '../quality/factCheck';
import { compareFacts } from '../ai/consistency';

/** 翻译建议只在组件内暂存；用户确认且原文未变时才写入资料字段。 */
export function FixedSummaryEditor({ value, settings, onChange }: { value: LocalizedText; settings: Settings; onChange: (v: LocalizedText) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState<{ to: Lang; source: string; previous: string; text: string; issues: string[] } | null>(null);
  const suggest = async (to: Lang) => {
    const from = to === 'zh' ? 'en' : 'zh', source = fixedSummaryText(value, from);
    if (!source) return;
    setBusy(true); setError(''); setSuggestion(null);
    try {
      const result = (await translateTexts(settings, [{ key: 'fixed-summary', text: source }], to, [])).get('fixed-summary');
      if (!result?.trim()) throw new Error('AI 未返回翻译建议');
      const zh = to === 'zh' ? result : source, en = to === 'en' ? result : source;
      setSuggestion({ to, source, previous: value[to] ?? '', text: result, issues: [...compareFacts(source, result), ...crossCheck(zh, en)] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const changed = suggestion && (fixedSummaryText(value, suggestion.to === 'zh' ? 'en' : 'zh') !== suggestion.source || (value[suggestion.to] ?? '') !== suggestion.previous);
  return <div data-testid="fixed-summary-editor">
    <LTField label="固定个人简介" multiline value={value} onChange={(v) => { setSuggestion(null); onChange(v); }} />
    <p className="muted small">介绍教育身份、专业背景与真实工作实践。所有岗位直接复用这两段文字，不由 AI 按 JD 改写；修改只影响以后生成的简历。机翻或过期内容请核对并标为已确认。</p>
    {(['zh', 'en'] as const).filter((l) => !fixedSummaryText(value, l) && fixedSummaryText(value, l === 'zh' ? 'en' : 'zh')).map((l) =>
      <button key={l} disabled={busy} onClick={() => suggest(l)}>获取{l === 'zh' ? '中文' : '英文'}简介翻译建议（确认后保存）</button>)}
    {busy && <div role="status">正在翻译固定简介；尚未写入资料…</div>}
    {error && <div className="notice error">{error}</div>}
    {suggestion && <div className="notice" data-testid="summary-translation-preview">
      <p>{suggestion.text}</p>
      {suggestion.issues.length > 0 && <div className="err-text">事实核对未通过，请手动编辑并核实：{suggestion.issues.join('；')}</div>}
      {changed && <div className="err-text">简介已修改，请重新获取建议。</div>}
      <button disabled={!!changed || suggestion.issues.length > 0} onClick={() => {
        if (changed || suggestion.issues.length) return;
        onChange({ ...value, [suggestion.to]: suggestion.text, status: { ...value.status, [suggestion.to]: 'confirmed' }, srcSnapshot: suggestion.source });
        setSuggestion(null);
      }}>确认译文并保存到我的资料</button>
      <button onClick={() => setSuggestion(null)}>放弃建议</button>
    </div>}
  </div>;
}
