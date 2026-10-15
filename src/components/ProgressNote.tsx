/** 带进度条的提示；pct 为 0–1，未知时显示旋转图标 */
export function ProgressNote({ msg, pct }: { msg: string; pct?: number }) {
  return (
    <div className="notice progress-note">
      {pct === undefined ? <span className="spinner" /> : null}{msg}{pct !== undefined && <span className="pct">{Math.round(pct * 100)}%</span>}
      {pct !== undefined && <div className="bar"><div style={{ width: `${Math.max(3, pct * 100)}%` }} /></div>}
    </div>
  );
}
