import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { useL } from '../i18n';
import { FEATURES } from '../features';
import { db } from '../storage/db';
import { downloadBytes } from '../utils/download';
import type { ExportRecord, JobParse, ResumeDoc } from '../types';

interface Row { j: JobParse; r?: ResumeDoc; ex: ExportRecord[] }
const MIME: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', zip: 'application/zip' };
const mimeOf = (n: string) => MIME[n.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
const local = (iso?: string) => (iso ? new Date(iso).toLocaleString('sv-SE').slice(0, 16) : '');
const day = (iso?: string) => local(iso).slice(0, 10);

/** 投递记录：列表「公司 · 岗位（日期）」；详情 = 岗位信息 → 原始截图 → 生成的文件（预览/下载） */
export function JobHistory({ onOpen }: { onOpen: () => void }) {
  const { job, setJob, setResume } = useApp();
  const L = useL();
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const load = async () => {
    const [jobs, rs, ex] = await Promise.all([db.jobs.toArray(), db.resumes.toArray(), db.exports.toArray()]);
    return jobs.map((j) => {
      const mine = rs.filter((x) => x.jobId === j.id);
      const r = mine.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
      const ids = new Set(mine.map((x) => x.id));
      return { j, r, ex: ex.filter((e) => e.jobId === j.id || ids.has(e.resumeId)).sort((a, b) => b.exportedAt.localeCompare(a.exportedAt)) };
    }).sort((a, b) => (b.j.createdAt ?? '').localeCompare(a.j.createdAt ?? ''));
  };
  useEffect(() => { let alive = true; load().then((x) => alive && setRows(x)); return () => { alive = false; }; }, [job?.id]);
  if (!FEATURES.jobHistory || rows.length === 0) return null;
  const del = async (id: string) => {
    if (!confirm(L('删除这条投递记录（岗位、截图与生成的文件）？', 'Delete this application (job, screenshots and files)?'))) return;
    const rids = (await db.resumes.where('jobId').equals(id).toArray()).map((r) => r.id);
    await db.exports.filter((e) => e.jobId === id || rids.includes(e.resumeId)).delete();
    await db.resumes.bulkDelete(rids); await db.jobs.delete(id);
    if (job?.id === id) { setJob(null); setResume(null); }
    setOpen(null); setRows(await load());
  };
  const title = (j: JobParse) => `${j.company.short || j.company.full || L('未知公司', 'Unknown company')} · ${j.title.zh || j.title.en || L('岗位', 'Role')}`;
  return (
    <>
      <div className="card job-history" data-testid="job-history">
        <b>{L(`🗂 投递记录（${rows.length}）`, `🗂 Applications (${rows.length})`)}</b>
        <ul>{rows.map((row) => (
          <li key={row.j.id} className={job?.id === row.j.id ? 'cur' : ''}>
            <button className="link" onClick={() => setOpen(row)}>{title(row.j)}</button>
            <span className="muted small">（{day(row.j.createdAt)}）{row.ex.length ? L(` · 已下载 ${row.ex.length} 次`, ` · ${row.ex.length} downloads`) : ''}</span>
          </li>))}</ul>
      </div>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(null)}>
          <div className="modal history-detail" onClick={(e) => e.stopPropagation()}>
            <div className="row"><h3 className="grow">{title(open.j)} <span className="muted small">{day(open.j.createdAt)}</span></h3><button onClick={() => setOpen(null)}>✕</button></div>
            <section>
              <h4>{L('岗位信息（AI 提取）', 'Job info (extracted)')}</h4>
              <table className="kv"><tbody>
                <tr><td>{L('公司', 'Company')}</td><td>{open.j.company.full || open.j.company.short || '—'}</td></tr>
                <tr><td>{L('岗位', 'Role')}</td><td>{open.j.title.zh}{open.j.title.en && open.j.title.en !== open.j.title.zh ? ` / ${open.j.title.en}` : ''}{open.j.roleAbbr ? `（${open.j.roleAbbr}）` : ''}</td></tr>
                {open.j.yearsRequired != null && <tr><td>{L('经验', 'Experience')}</td><td>{open.j.yearsRequired}+ {L('年', 'yrs')}</td></tr>}
                <tr><td>{L('必备要求', 'Must-have')}</td><td>{open.j.mustHave.map((k) => k.zh || k.en).join('；') || '—'}</td></tr>
                {open.j.niceToHave.length > 0 && <tr><td>{L('加分项', 'Nice-to-have')}</td><td>{open.j.niceToHave.map((k) => k.zh || k.en).join('；')}</td></tr>}
                <tr><td>{L('关键词', 'Keywords')}</td><td>{open.j.keywords.map((k) => k.zh || k.en).join('、') || '—'}</td></tr>
                {open.r && <tr><td>{L('匹配度', 'Match')}</td><td>{open.r.matchScore}</td></tr>}
              </tbody></table>
              <details><summary className="small">{L('岗位原文', 'Original text')}</summary><pre className="small jd-raw">{open.j.rawText}</pre></details>
            </section>
            <section>
              <h4>{L('原始岗位截图', 'Original screenshots')}</h4>
              {open.j.screenshots?.length ? <div className="shots">{open.j.screenshots.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} /></a>)}</div> : <div className="muted small">{L('当时是粘贴的文字，没有截图。', 'Text was pasted; no screenshots.')}</div>}
            </section>
            <section>
              <h4>{L('生成的简历文件', 'Generated files')}</h4>
              {open.ex.length === 0 && <div className="muted small">{L('还没有下载过。打开后在第 ④ 步下载，文件会自动存到这里。', 'Not downloaded yet. Open it and download in step ④; files are saved here.')}</div>}
              {open.ex.map((e) => (
                <div key={e.id} className="export-rec">
                  <div className="row"><b className="grow">📦 {e.zipName}</b><span className="muted small">{local(e.exportedAt)}</span>
                    {e.zip && <button onClick={() => downloadBytes(e.zip!, e.zipName, MIME.zip)}>⬇ zip</button>}</div>
                  {e.blobs ? Object.entries(e.blobs).map(([n, b]) => (
                    <div key={n} className="row indent small">📄 <span className="grow">{n}</span>
                      {n.endsWith('.pdf') && <button className="link" onClick={() => window.open(URL.createObjectURL(new Blob([b as BlobPart], { type: MIME.pdf })), '_blank')}>{L('预览', 'Preview')}</button>}
                      <button className="link" onClick={() => downloadBytes(b, n, mimeOf(n))}>{L('下载', 'Download')}</button>
                    </div>)) : <div className="muted small indent">{L('（旧版本记录，未保存文件本体）', '(older record, files not stored)')}</div>}
                </div>))}
            </section>
            <div className="row end">
              <button className="link danger" onClick={() => del(open.j.id)}>{L('删除记录', 'Delete')}</button><span className="spacer" />
              <button className="primary" onClick={() => { setJob(open.j); setResume(open.r ?? null); setOpen(null); onOpen(); }}>{L('打开继续编辑 / 重新导出', 'Open to edit / re-export')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
