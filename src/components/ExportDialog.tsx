import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { buildExportNames, formatDateStamp } from '../export/naming';
import { countExports, db } from '../storage/db';
import { downloadBytes } from '../utils/download';
import { uid } from '../locale/text';

/** 导出前确认公司名 / 岗位缩写，预览 zip 与 4 个文件名（F6.6–F6.9） */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { profile, template, resume, job } = useApp();
  const [company, setCompany] = useState(job?.company.short ?? '');
  const [abbr, setAbbr] = useState(job?.roleAbbr ?? '');
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [date] = useState(() => formatDateStamp(new Date()));
  const names = buildExportNames(company, abbr, date, count);
  useEffect(() => { countExports(names.company, names.roleAbbr, date).then(setCount); }, [names.company, names.roleAbbr, date]);

  const warnings: string[] = [];
  if (!company.trim()) warnings.push('未填写公司名，将使用 "Company"');
  if (resume?.consistency.issues.length) warnings.push(`存在 ${resume.consistency.issues.length} 个中英一致性问题`);
  if (resume?.items.some((i) => /演示机翻/.test(i.zh + i.en))) warnings.push('包含「演示机翻」占位文本，请先人工校对');
  if (!resume) warnings.push('尚未针对岗位生成，将导出资料库全部启用条目');

  const run = async () => {
    setErr(''); setBusy('加载导出组件…');
    try {
      const { buildZip } = await import('../export/zip');
      const r = await buildZip(profile, template, resume, names, `${import.meta.env.BASE_URL}fonts/`, (f) => setBusy(`生成 ${f} …`));
      downloadBytes(r.zip, names.zipName, 'application/zip');
      await db.exports.put({ id: uid('export'), resumeId: resume?.id ?? '', company: names.company, roleAbbr: names.roleAbbr, date, seq: names.seq, zipName: names.zipName, files: Object.keys(r.files), exportedAt: new Date().toISOString() });
      if (r.errors.length) { setErr('部分文件生成失败（已导出其余文件）：\n' + r.errors.join('\n')); setBusy(''); return; }
      onClose();
    } catch (e) { setErr('导出失败：' + (e as Error).message); } finally { setBusy(''); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>导出 zip（中/英 × PDF/Word）</h3>
        <div className="grid2">
          <label>公司（≤20 字）<input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="如：字节跳动" /></label>
          <label>岗位缩写（≤12 字符）<input value={abbr} onChange={(e) => setAbbr(e.target.value)} placeholder="如：FE" /></label>
        </div>
        <div className="names">
          <div>📦 <b>{names.zipName}</b></div>
          {Object.values(names.files).map((f) => <div key={f} className="indent">📄 {f}</div>)}
        </div>
        {warnings.map((w) => <div key={w} className="notice warn">⚠ {w}</div>)}
        {busy && <div className="notice">{busy}</div>}
        {err && <pre className="notice error">{err}</pre>}
        <div className="row end"><button onClick={onClose}>取消</button><button className="primary" disabled={!!busy} onClick={run}>下载 zip</button></div>
      </div>
    </div>
  );
}
