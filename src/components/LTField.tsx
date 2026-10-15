import type { Lang, LocalizedText } from '../types';
import { editText } from '../locale/text';

const STATUS: Record<string, { label: string; cls: string }> = {
  manual: { label: '人工', cls: 'st-manual' }, machine: { label: '机翻待校对', cls: 'st-machine' },
  confirmed: { label: '已确认', cls: 'st-confirmed' }, stale: { label: '原文已改·过期', cls: 'st-stale' },
};

/** 双语字段编辑器：中 / 英两栏 + 翻译状态徽标 + 确认按钮（F5.1–F5.3） */
export function LTField({ label, value, onChange, multiline }: { label?: string; value: LocalizedText | undefined; onChange: (v: LocalizedText) => void; multiline?: boolean }) {
  const v = value ?? {};
  const side = (l: Lang) => {
    const st = v[l]?.trim() ? v.status?.[l] ?? (v.source === l ? 'manual' : undefined) : undefined;
    const s = st ? STATUS[st] : null;
    const props = { value: v[l] ?? '', placeholder: l === 'zh' ? '中文' : 'English', onChange: (e: { target: { value: string } }) => onChange(editText(v, l, e.target.value)) };
    return (
      <div className="lt-side">
        <div className="lt-meta">
          <span className="lang-tag">{l === 'zh' ? '中' : 'EN'}</span>
          {s && <span className={`badge ${s.cls}`}>{s.label}</span>}
          {(st === 'machine' || st === 'stale') && (
            <button className="link" onClick={() => onChange({ ...v, status: { ...v.status, [l]: 'confirmed' }, srcSnapshot: v[l === 'zh' ? 'en' : 'zh'] })}>标为已确认</button>
          )}
        </div>
        {multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
      </div>
    );
  };
  return (
    <div className="lt-field">
      {label && <label>{label}</label>}
      <div className="lt-row">{side('zh')}{side('en')}</div>
    </div>
  );
}
