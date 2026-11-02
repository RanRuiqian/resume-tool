import { useState } from 'react';
import { useApp } from '../store';

export function ClearPersonalDataButton() {
  const { clearPersonalData, clearingProfile } = useApp();
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  return <>
    <button className="danger" data-testid="clear-personal-data" disabled={clearingProfile} onClick={() => { setError(''); setOpen(true); }}>🔴 清空所有个人资料</button>
    {open && <div className="modal-bg"><div className="modal" role="dialog" onKeyDown={(e) => { if (e.key === 'Escape' && !clearingProfile) { e.stopPropagation(); setOpen(false); } }} aria-modal="true" aria-labelledby="clear-personal-data-title" data-testid="clear-personal-data-dialog">
      <h3 id="clear-personal-data-title">清空所有个人资料</h3>
      <p>确定清空所有个人资料吗？这将删除已导入的教育、工作、项目、课程、技能等个人信息。此操作无法撤销，但不会影响 API 设置和求职投递记录。</p>
      <p className="muted small">同时清除资料原文、翻译、资料快照、生成简历与导出缓存。求职记录中已关联的只读投递版本和附件仍保留，不会自动恢复到个人资料库。</p>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="row"><span className="spacer" /><button autoFocus disabled={clearingProfile} onClick={() => setOpen(false)}>取消</button>
        <button className="danger" data-testid="confirm-clear-personal-data" disabled={clearingProfile} onClick={async () => {
          setError('');
          try { await clearPersonalData(); setOpen(false); }
          catch { setError('清空失败，现有资料没有被部分删除。请重试或检查浏览器存储状态。'); }
        }}>{clearingProfile ? '清空中…' : '确认清空'}</button>
      </div>
    </div></div>}
  </>;
}
