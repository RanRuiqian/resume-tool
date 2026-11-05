import { assertProfileEpoch } from '../storage/clearProfile';
import { ResumeNotice } from './ResumeNotice';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store';
import { buildExportNames, formatDateStamp } from '../export/naming';
import { countExports, db } from '../storage/db';
import { downloadBytes } from '../utils/download';
import { uid } from '../locale/text';
import { FEATURES } from '../features';
import type { Lang } from '../types';
import { kitExportState } from '../quality/kitVerify';
import type { ZipFileKey } from '../export/zip';

const FILE_KEYS: ZipFileKey[] = ['cnPdf', 'cnDocx', 'enPdf', 'enDocx'];
/** 勾选状态记在本机，下次打开保持（缺省四个都勾）。 */
function loadFileSel(): Record<ZipFileKey, boolean> {
  const all = { cnPdf: true, cnDocx: true, enPdf: true, enDocx: true };
  try { const v = JSON.parse(localStorage.getItem('zipFiles') ?? 'null'); if (v && typeof v === 'object') for (const k of FILE_KEYS) if (typeof v[k] === 'boolean') all[k] = v[k]; } catch { /* 用缺省 */ }
  return all;
}

/** iPhone：zip 不便打开，单独的 PDF 走系统分享面板（存到「文件」或发微信 / 邮件）；不支持时直接下载。 */
async function sharePdf(name: string, bytes: Uint8Array) {
  try {
    const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if ((e as Error).name === 'AbortError') return; }
  downloadBytes(bytes, name, 'application/pdf');
}

/** 导出前确认公司名 / 岗位缩写，预览 zip 与 4 个文件名（F6.6–F6.9） */
export function ExportPanel({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const { profile, profileEpoch, template, resume, job } = useApp();
  const [company, setCompany] = useState(job?.company.short ?? '');
  const [abbr, setAbbr] = useState(job?.roleAbbr ?? '');
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [pdfs, setPdfs] = useState<{ name: string; bytes: Uint8Array }[]>([]);
  const [date] = useState(() => formatDateStamp(new Date()));
  const names = buildExportNames(company, abbr, date, count);
  const [fileSel, setFileSel] = useState(loadFileSel);
  const toggleFile = (k: ZipFileKey, v: boolean) => setFileSel((x) => { const n = { ...x, [k]: v }; try { localStorage.setItem('zipFiles', JSON.stringify(n)); } catch { /* 存不了也不影响本次 */ } return n; });
  const [withKit, setWithKit] = useState(() => localStorage.getItem('zipKit') !== '0');
  const ex = resume?.extras;
  // 人工编辑自由导出；事实检查仅作简短提示。
  const kitState = useMemo(() => kitExportState(profile, job ?? null, ex, resume), [profile, job, ex, resume]);
  const hasKit = (FEATURES.coverLetter || FEATURES.prepDirections) && !!(ex?.coverLetter || ex?.selfIntro || ex?.prep?.length);
  const stem = names.base;
  const chosen = FILE_KEYS.filter((k) => fileSel[k]);
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
        ...(ex.prep?.length ? [{ title: T('备考大方向', 'What to Prepare'), body: ex.prep.map((q, n) => `${n + 1}. ${q.area[l] || q.area.zh}：${q.why[l] || q.why.zh}${(q.points ?? []).map((p) => `\n   · ${p[l] || p.zh}`).join('')}\n${T('岗位原文：', 'From the JD: ')}“${q.source}”`).join('\n') }] : []),
      ];
      if (secs.length) out[kitNames[i]] = await textDocxBytes(l, secs);
    }
    return out;
  };
  useEffect(() => { countExports(names.company, names.roleAbbr, date).then(setCount); }, [names.company, names.roleAbbr, date]);

  const warnings: string[] = [];
  if (!company.trim()) warnings.push('未填写公司名，将使用 "Company"');
  if (resume?.items.some((i) => /演示机翻/.test(i.zh + i.en))) warnings.push('包含「演示机翻」占位文本，请先人工校对');
  if (!resume) warnings.push('尚未针对岗位生成，将导出资料库全部启用条目');

  const run = async () => {
    setErr(''); setBusy('加载导出组件…');
    try {
      const { exportZip } = await import('../export/client');
      const r = await exportZip(profile, template, resume, names, (f) => setBusy(`生成 ${f} …`), await buildKit(), chosen);
      await db.transaction('r', db.state, () => assertProfileEpoch(db, profileEpoch));
      downloadBytes(r.zip, names.zipName, 'application/zip');
      setPdfs([names.files.cnPdf, names.files.enPdf].filter((n) => r.files[n]).map((n) => ({ name: n, bytes: r.files[n] })));
      await db.transaction('rw', db.exports, db.state, async () => { await assertProfileEpoch(db, profileEpoch); await db.exports.put({ id: uid('export'), resumeId: resume?.id ?? '', company: names.company, roleAbbr: names.roleAbbr, date, seq: names.seq, zipName: names.zipName, files: Object.keys(r.files), exportedAt: new Date().toISOString(), jobId: job?.id, zip: r.zip, blobs: r.files }); });
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
          {FILE_KEYS.map((k) => <label key={k} className="indent check" data-testid={`zip-file-${k}`}><input type="checkbox" checked={fileSel[k]} onChange={(e) => toggleFile(k, e.target.checked)} /> 📄 {names.files[k]}</label>)}
          {kitNames.map((f) => <div key={f} className="indent">📝 {f}</div>)}
        </div>
        {chosen.length === 0 && kitNames.length === 0 && <div className="notice warn" data-testid="zip-none">请至少勾选一个文件。</div>}
        {hasKit && <label className="check"><input type="checkbox" checked={withKit} onChange={(e) => { setWithKit(e.target.checked); localStorage.setItem('zipKit', e.target.checked ? '1' : '0'); }} /> 同时打包求职信 / 自我介绍 / 备考方向（Word）</label>}
        <div className="muted small">PDF 直接投递；Word 版方便你再微调。文件名不含姓名，投递前可自行改名。</div>
        {kitState.hasText && !kitState.verdict.passed && <p className="muted small" data-testid="export-kit-note">求职信 / 自我介绍可能有与资料不同的表述，请留意关键事实；当前文字仍会按选择导出。</p>}
        <ResumeNotice />
        {warnings.map((w) => <div key={w} className="notice warn">⚠ {w}</div>)}
        {busy && <div className="notice">{busy}</div>}
        {done && <div className="notice ok">✓ {done}</div>}
        {pdfs.length > 0 && <div className="row" data-testid="export-pdf-share">{pdfs.map((f) => <button key={f.name} onClick={() => sharePdf(f.name, f.bytes)}>📤 {/CN/.test(f.name) ? '中文' : '英文'} PDF（保存 / 分享）</button>)}</div>}
        {err && <pre className="notice error">{err}</pre>}
        <div className="row end">{!inline && <button onClick={onClose}>取消</button>}<button className="primary big" data-testid="zip-download" disabled={!!busy || chosen.length + kitNames.length === 0} onClick={run}>⬇ 下载 zip（{chosen.length + kitNames.length} 个文件）</button></div>
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
