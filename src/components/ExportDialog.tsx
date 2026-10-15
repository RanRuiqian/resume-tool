import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { buildExportNames, formatDateStamp } from '../export/naming';
import { countExports, db } from '../storage/db';
import { downloadBytes } from '../utils/download';
import { uid } from '../locale/text';
import { FEATURES } from '../features';
import type { Lang } from '../types';

/** 导出前确认公司名 / 岗位缩写，预览 zip 与 4 个文件名（F6.6–F6.9） */
export function ExportPanel({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const { profile, template, resume, job } = useApp();
  const [company, setCompany] = useState(job?.company.short ?? '');
  const [abbr, setAbbr] = useState(job?.roleAbbr ?? '');
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [date] = useState(() => formatDateStamp(new Date()));
  const names = buildExportNames(company, abbr, date, count);
  const [withKit, setWithKit] = useState(() => localStorage.getItem('zipKit') !== '0');
  const ex = resume?.extras;
  const hasKit = (FEATURES.coverLetter || FEATURES.prepDirections) && !!(ex?.coverLetter || ex?.selfIntro || ex?.prep?.length);
  const stem = names.base;
  const kitNames = hasKit && withKit ? (['zh', 'en'] as Lang[]).map((l) => `${stem}_CoverLetter_Prep_${l === 'zh' ? 'CN' : 'EN'}.docx`) : [];
  const buildKit = async (): Promise<Record<string, Uint8Array>> => {
    if (!kitNames.length || !ex) return {};
    const { textDocxBytes } = await import('../export/docx/textDocx');
    const out: Record<string, Uint8Array> = {};
    for (const [i, l] of (['zh', 'en'] as Lang[]).entries()) {
      const T = (z: string, e: string) => (l === 'zh' ? z : e);
      const secs = [
        ...(ex.coverLetter?.[l] ? [{ title: T('求职信', 'Cover Letter'), body: ex.coverLetter[l] }] : []),
        ...(ex.selfIntro?.[l] ? [{ title: T('1 分钟自我介绍', '1-Minute Self-Introduction'), body: ex.selfIntro[l] }] : []),
        ...(ex.prep?.length ? [{ title: T('备考大方向', 'What to Prepare'), body: ex.prep.map((q, n) => `${n + 1}. ${q.area[l]}：${q.why[l]}\n${T('岗位原文：', 'From the JD: ')}“${q.source}”`).join('\n') }] : []),
      ];
      if (secs.length) out[kitNames[i]] = await textDocxBytes(l, secs);
    }
    return out;
  };
  useEffect(() => { countExports(names.company, names.roleAbbr, date).then(setCount); }, [names.company, names.roleAbbr, date]);

  const warnings: string[] = [];
  if (!company.trim()) warnings.push('未填写公司名，将使用 "Company"');
  if (resume?.consistency.issues.length) warnings.push(`存在 ${resume.consistency.issues.length} 个中英一致性问题`);
  if (resume?.items.some((i) => /演示机翻/.test(i.zh + i.en))) warnings.push('包含「演示机翻」占位文本，请先人工校对');
  if (!resume) warnings.push('尚未针对岗位生成，将导出资料库全部启用条目');

  const run = async () => {
    setErr(''); setBusy('加载导出组件…');
    try {
      const { exportZip } = await import('../export/client');
      const r = await exportZip(profile, template, resume, names, (f) => setBusy(`生成 ${f} …`), await buildKit());
      downloadBytes(r.zip, names.zipName, 'application/zip');
      await db.exports.put({ id: uid('export'), resumeId: resume?.id ?? '', company: names.company, roleAbbr: names.roleAbbr, date, seq: names.seq, zipName: names.zipName, files: Object.keys(r.files), exportedAt: new Date().toISOString(), jobId: job?.id, zip: r.zip, blobs: r.files });
      setCount((c) => c + 1);
      setDone(`已下载 ${names.zipName}（中文 ${r.pages.zh} 页 / 英文 ${r.pages.en} 页${r.fitLevel.zh || r.fitLevel.en ? '，已自动缩排以控制页数' : ''}）`);
      if (r.errors.length) { setErr('部分文件生成失败（已导出其余文件）：\n' + r.errors.join('\n')); setBusy(''); return; }
      if (!inline) onClose?.();
    } catch (e) { setErr('导出失败：' + (e as Error).message); } finally { setBusy(''); }
  };

  return (
    <div>
        {!inline && <h3>导出 zip（中/英 × PDF/Word）</h3>}
        <div className="grid2">
          <label>公司名（会出现在文件名里）<input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="如：字节跳动" /></label>
          <label>岗位缩写<input value={abbr} onChange={(e) => setAbbr(e.target.value)} placeholder="如：FE、PM、DA" /></label>
        </div>
        <div className="names">
          <div>📦 <b>{names.zipName}</b></div>
          {Object.values(names.files).map((f) => <div key={f} className="indent">📄 {f}</div>)}
          {kitNames.map((f) => <div key={f} className="indent">📝 {f}</div>)}
        </div>
        {hasKit && <label className="check"><input type="checkbox" checked={withKit} onChange={(e) => { setWithKit(e.target.checked); localStorage.setItem('zipKit', e.target.checked ? '1' : '0'); }} /> 同时打包求职信 / 自我介绍 / 备考方向（Word）</label>}
        <div className="muted small">PDF 直接投递；Word 版方便你再微调。文件名不含姓名，投递前可自行改名。</div>
        {warnings.map((w) => <div key={w} className="notice warn">⚠ {w}</div>)}
        {busy && <div className="notice">{busy}</div>}
        {done && <div className="notice ok">✓ {done}</div>}
        {err && <pre className="notice error">{err}</pre>}
        <div className="row end">{!inline && <button onClick={onClose}>取消</button>}<button className="primary big" disabled={!!busy} onClick={run}>⬇ 下载 zip（{4 + kitNames.length} 个文件）</button></div>
    </div>
  );
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}><ExportPanel onClose={onClose} /></div>
    </div>
  );
}
