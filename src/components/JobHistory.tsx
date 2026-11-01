import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { useL } from '../i18n';
import { FEATURES } from '../features';
import { db } from '../storage/db';
import { downloadBytes } from '../utils/download';
import type { ExportRecord, JobParse, ResumeDoc } from '../types';
import { addFromAnalysis, analysisDuplicates, linkAnalysis } from '../tracker/repo';
import { latestByPosting } from '../tracker/stats';
import { STATUS_LABEL, STATUS_LABEL_EN, type AppStatus, type JobPosting } from '../tracker/types';

interface Row { j: JobParse; r?: ResumeDoc; ex: ExportRecord[]; posting?: JobPosting; status?: AppStatus }
const MIME: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', zip: 'application/zip' };
const mimeOf = (n: string) => MIME[n.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
const local = (iso?: string) => (iso ? new Date(iso).toLocaleString('sv-SE').slice(0, 16) : '');
const day = (iso?: string) => local(iso).slice(0, 10);

/**
 * 岗位分析历史 / 制作历史（v1.11 改名：这些是做过的岗位分析和简历制作，不等于已投递）。
 * 列表「公司 · 岗位（日期）」；详情 = 岗位信息 → 原始截图 → 生成的文件；可「加入求职管理」（默认待投递，不计入投递统计）。
 */
export function JobHistory({ onOpen, go }: { onOpen: () => void; go?: (p: string) => void }) {
  const { job, setJob, setResume, settings } = useApp();
  const SL = settings.uiLang === 'en' ? STATUS_LABEL_EN : STATUS_LABEL;
  const [msg, setMsg] = useState('');
  const L = useL();
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const load = async () => {
    const [jobs, rs, ex, ps, as] = await Promise.all([db.jobs.toArray(), db.resumes.toArray(), db.exports.toArray(), db.postings.toArray(), db.applications.toArray()]);
    const latest = latestByPosting(as);
    return jobs.map((j) => {
      const posting = ps.find((p) => p.jobParseId === j.id);
      const mine = rs.filter((x) => x.jobId === j.id);
      const r = mine.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
      const ids = new Set(mine.map((x) => x.id));
      return { j, r, posting, status: posting ? latest.get(posting.id)?.status : undefined, ex: ex.filter((e) => e.jobId === j.id || ids.has(e.resumeId)).sort((a, b) => b.exportedAt.localeCompare(a.exportedAt)) };
    }).sort((a, b) => (b.j.createdAt ?? '').localeCompare(a.j.createdAt ?? ''));
  };
  useEffect(() => { let alive = true; load().then((x) => alive && setRows(x)); return () => { alive = false; }; }, [job?.id]);
  if (!FEATURES.jobHistory || rows.length === 0) return null;
  /** 加入求职管理：已关联 → 直接打开；同公司同岗位已存在 → 让用户选「关联到已有」或「仍然新建」，不自动合并 */
  const track = async (row: Row) => {
    if (row.posting) { go?.(`applications/${row.posting.id}`); return; }
    const dups = await analysisDuplicates(db, row.j);
    if (dups.length) {
      const d = dups[0].posting;
      const ok = confirm(L(`求职管理里已有「${d.company} · ${d.title}」${d.city ? `（${d.city}）` : ''}。\n\n确定：关联到这条已有记录（不改它已有的内容）\n取消：不关联，再选择是否新建`, `"${d.company} · ${d.title}" already exists in Applications.\n\nOK: link to the existing record (its fields stay unchanged)\nCancel: decide whether to create a new one`));
      if (ok) { await linkAnalysis(db, d.id, row.j.id); setMsg(L('已关联到已有的求职记录', 'Linked to the existing record')); setRows(await load()); return; }
      if (!confirm(L('仍然新建一条「待投递」记录吗？', 'Create a new "To apply" record anyway?'))) return;
    }
    const r = await addFromAnalysis(db, row.j);
    setMsg(r.existed ? L('这条岗位分析已在求职管理中', 'Already in Applications') : L('已加入求职管理，状态「待投递」（不计入已投递统计）。城市、截止日期等请在求职管理里补充', 'Added to Applications as "To apply" (not counted as applied). Add city / deadline there.'));
    setRows(await load());
  };
  const del = async (id: string) => {
    if (!confirm(L('删除这条岗位分析记录（岗位分析、截图与生成的文件）？求职管理里的记录不受影响。', 'Delete this analysis (job, screenshots and files)? Applications records are not affected.'))) return;
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
        <b>{L(`🗂 岗位分析历史 / 制作历史（${rows.length}）`, `🗂 Analysis & résumé history (${rows.length})`)}</b>
        <div className="muted small">{L('这里是做过的岗位分析和简历制作，不等于已投递；「加入求职管理」后才会出现在求职投递里。', 'These are analyses and résumés you made, not applications. Use "Add to Applications" to track them.')}</div>
        {msg && <div className="notice ok small" data-testid="history-msg">{msg}</div>}
        <ul>{rows.map((row) => (
          <li key={row.j.id} className={job?.id === row.j.id ? 'cur' : ''}>
            <button className="link" onClick={() => setOpen(row)}>{title(row.j)}</button>
            <span className="muted small">（{day(row.j.createdAt)}）{row.ex.length ? L(` · 已下载 ${row.ex.length} 次`, ` · ${row.ex.length} downloads`) : ''}</span>
            {row.posting
              ? <button className="link small" data-testid="history-tracked" onClick={() => go?.(`applications/${row.posting!.id}`)}>{L(`已在求职管理${row.status ? `（${SL[row.status]}）` : ''} →`, `In Applications${row.status ? ` (${SL[row.status]})` : ''} →`)}</button>
              : <button className="link small" data-testid="history-track" onClick={() => track(row)}>{L('＋ 加入求职管理', '+ Add to Applications')}</button>}
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
              <button onClick={() => { const r = open; setOpen(null); track(r); }}>{open.posting ? L('在求职管理中查看', 'View in Applications') : L('加入求职管理', 'Add to Applications')}</button>
              <button className="primary" onClick={() => { setJob(open.j); setResume(open.r ?? null); setOpen(null); onOpen(); }}>{L('打开继续编辑 / 重新导出', 'Open to edit / re-export')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
