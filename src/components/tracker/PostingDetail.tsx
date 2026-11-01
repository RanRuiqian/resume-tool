import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../store';
import { db } from '../../storage/db';
import { uiStorage } from '../../storage/mode';
import { exportZip } from '../../export/client';
import { buildExportNames, guessRoleAbbr } from '../../export/naming';
import { downloadBytes } from '../../utils/download';
import { addAttachment, addSubmittedResume, changeStatus, createApplication, deleteAttachment, linkResumeSnapshot, listEvents, nowIso, saveApplication, StorageError, uid, verifyAttachment } from '../../tracker/repo';
import { APP_STATUSES, ATTACH_KIND_LABEL, PRIORITY_LABEL, RECRUIT_LABEL, STATUS_LABEL, type Application, type ApplicationEvent, type Attachment, type AttachmentKind, type JobPosting, type ResumeArtifact } from '../../tracker/types';
import { JD_PREFILL_KEY, TRACKER_RETURN_KEY, type TrackerReturn } from '../../tracker/useTracker';
import type { Lang } from '../../types';

const fmt = (s?: string) => (s ? s.slice(0, 16).replace('T', ' ') : '');
const safeHref = (u?: string) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : undefined);
export function ExtLink({ url, label }: { url?: string; label?: string }) {
  const h = safeHref(url); if (!url) return <span className="muted">—</span>;
  return h ? <a href={h} target="_blank" rel="noopener noreferrer" data-testid="ext-link">{label ?? url} ↗</a> : <span title="不是 http(s) 链接，未设为可点击">{url}</span>;
}
function guessKind(name: string, mime: string): AttachmentKind {
  if (/\.(pdf|docx?)$/i.test(name) && /简历|resume|cv/i.test(name)) return 'resume-submitted';
  if (/offer|录用/i.test(name)) return 'offer'; if (/面试|interview/i.test(name)) return 'interview'; if (/笔试|测评|assess|test/i.test(name)) return 'assessment';
  if (/jd/i.test(name) || mime.startsWith('image/')) return 'jd-screenshot'; return 'other';
}

export function PostingDetail({ posting, go, onEdit, onDelete, onChanged }: { posting: JobPosting; go: (p: string) => void; onEdit: () => void; onDelete: () => void; onChanged: () => void }) {
  const { profile, resume, job, templates, template, setJob, setResume } = useApp();
  /** v1.11：回到对应的岗位分析 / 简历制作记录（只读取，不修改） */
  const openAnalysis = async () => {
    const j = posting.jobParseId ? await db.jobs.get(posting.jobParseId) : undefined;
    if (!j) { setMsg({ t: 'warn', m: '对应的岗位分析记录不存在（可能已删除），求职记录本身不受影响' }); return; }
    const r = (await db.resumes.where('jobId').equals(j.id).toArray()).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
    setJob(j); setResume(r ?? null); go('wizard');
  };
  const [apps, setApps] = useState<Application[]>([]);
  const [appId, setAppId] = useState('');
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [arts, setArts] = useState<ResumeArtifact[]>([]);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [msg, setMsg] = useState<{ t: 'ok' | 'error' | 'warn'; m: string } | null>(null);
  const [st, setSt] = useState<{ to: string; note: string; at: string }>({ to: '', note: '', at: '' });
  const [kind, setKind] = useState<AttachmentKind | 'auto'>('auto');
  const [upLangs, setUpLangs] = useState<Lang[]>(['zh']);
  const fileRef = useRef<HTMLInputElement>(null), subRef = useRef<HTMLInputElement>(null);
  const app = apps.find((a) => a.id === appId) ?? null;

  const load = useCallback(async () => {
    const as = (await db.applications.where('postingId').equals(posting.id).toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setApps(as); const cur = as.find((a) => a.id === appId) ?? as[0]; setAppId(cur?.id ?? '');
    setEvents(cur ? await listEvents(db, cur.id) : []);
    setArts(cur ? (await db.artifacts.where('applicationId').equals(cur.id).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []);
    const ids = as.map((a) => a.id);
    const list = [...(await db.attachments.where('postingId').equals(posting.id).toArray()), ...(ids.length ? await db.attachments.where('applicationId').anyOf(ids).toArray() : [])];
    setAtts([...new Map(list.map((a) => [a.id, a])).values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
  }, [posting.id, appId]);
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  const done = async (m: string, t: 'ok' | 'error' | 'warn' = 'ok') => { setMsg({ t, m }); await load(); onChanged(); };
  const ensureApp = async (status: Application['status'] = 'saved') => app ?? (await createApplication(db, posting.id, status));

  const doStatus = async () => {
    if (!st.to) return;
    const to = st.to as Application['status']; const at = st.at ? new Date(st.at).toISOString() : nowIso();
    if (!app) { const a = await createApplication(db, posting.id, to, st.note || undefined, at); setAppId(a.id); }
    else await changeStatus(db, app.id, to, st.note || undefined, at);
    setSt({ to: '', note: '', at: '' }); await done(`状态已更新为「${STATUS_LABEL[to]}」，历史已保留`);
  };
  const linkCurrent = async () => {
    if (!resume) return setMsg({ t: 'error', m: '当前没有生成好的简历。可以点「用这个 JD 生成简历」先生成。' });
    const a = await ensureApp('preparing'); setAppId(a.id);
    const art = await linkResumeSnapshot(db, a.id, { resume, profile, job, label: `${posting.company} · ${posting.title} · 生成于 ${fmt(resume.createdAt)}` });
    await done(`已关联简历快照（${art.audit?.unconfirmedRed ? `⚠ 事实审查还有 ${art.audit.unconfirmedRed} 处高风险未确认` : '事实审查无高风险未确认'}）。之后修改资料或重新生成都不会改变这个快照。`, art.audit?.unconfirmedRed ? 'warn' : 'ok');
  };
  const toGenerate = async () => {
    const a = await ensureApp('preparing');
    const r: TrackerReturn = { postingId: posting.id, applicationId: a.id, label: `${posting.company} · ${posting.title}` };
    uiStorage.setItem(TRACKER_RETURN_KEY, JSON.stringify(r));
    if (posting.jdText || posting.description) uiStorage.setItem(JD_PREFILL_KEY, [posting.title, posting.company, posting.city, posting.jdText || posting.description, posting.requirements].filter(Boolean).join('\n'));
    uiStorage.setItem('wizardStep', '2'); go('wizard');
  };
  const readFile = async (f: File) => ({ name: f.name, type: f.type, data: new Uint8Array(await f.arrayBuffer()) });
  const addFiles = async (files: FileList | File[]) => {
    const errs: string[] = []; let n = 0;
    for (const f of [...files]) {
      try { await addAttachment(db, await readFile(f), { postingId: posting.id, applicationId: app?.id, kind: kind === 'auto' ? guessKind(f.name, f.type) : kind }); n++; }
      catch (e) { errs.push(e instanceof StorageError ? e.message : `「${f.name}」保存失败：${(e as Error).message}`); }
    }
    await done(errs.length ? `已保存 ${n} 个附件；${errs.join('；')}` : `已保存 ${n} 个附件（仅存本机浏览器，不会上传）`, errs.length ? 'error' : 'ok');
  };
  const uploadSubmitted = async (files: FileList) => {
    const f = files[0]; if (!f) return;
    try { const a = await ensureApp('applied'); setAppId(a.id); await addSubmittedResume(db, a.id, posting.id, await readFile(f), upLangs); await done(`「${f.name}」已标记为实际提交版本`); }
    catch (e) { await done(e instanceof StorageError ? e.message : `保存失败：${(e as Error).message}`, 'error'); }
  };
  const openAtt = async (a: Attachment, download: boolean) => {
    const b = await db.attachmentBlobs.get(a.id); if (!b) return setMsg({ t: 'error', m: `附件「${a.name}」的文件本体缺失（可能来自不含附件的轻量备份）` });
    if (download) return downloadBytes(b.data, a.name, a.mime);
    const url = URL.createObjectURL(new Blob([b.data as BlobPart], { type: a.mime })); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const exportSnapshot = async (art: ResumeArtifact) => {
    if (!art.resume || !art.profile) return;
    const tpl = templates.find((t) => t.id === art.templateId) ?? template;
    setMsg({ t: 'ok', m: '正在按快照重新生成文件…' });
    try {
      const names = buildExportNames(posting.company, guessRoleAbbr(posting.title), new Date(art.createdAt), 0);
      const r = await exportZip(art.profile, tpl, art.resume, names);
      downloadBytes(r.zip, names.zipName.replace(/\.zip$/, '_快照.zip'), 'application/zip'); setMsg({ t: 'ok', m: '已按快照内容导出（与当时投递的内容一致）' });
    } catch (e) { setMsg({ t: 'error', m: `导出失败：${(e as Error).message}` }); }
  };
  const upd = async (fn: (a: Application) => void) => { if (!app) return; const n = structuredClone(app); fn(n); await saveApplication(db, n); await load(); onChanged(); };

  return (
    <div className="tracker-detail" data-testid="posting-detail">
      <div className="row"><button onClick={() => go('applications')}>← 返回列表</button><span className="spacer" /><button onClick={onEdit} data-testid="edit-posting">编辑</button><button className="danger" onClick={onDelete} data-testid="delete-posting">删除</button></div>
      <div className="card">
        <h2 data-testid="detail-title">{posting.company} · {posting.title}</h2>
        <div className="chips">{posting.city && <span className="chip">📍 {posting.city}</span>}{posting.recruitType && <span className="chip">{RECRUIT_LABEL[posting.recruitType]}</span>}{posting.category && <span className="chip">{posting.category}</span>}{posting.companyType && <span className="chip">{posting.companyType}</span>}<span className="chip">优先级：{PRIORITY_LABEL[posting.priority]}</span>{posting.programYear && <span className="chip">{posting.programYear}</span>}</div>
        <div className="grid2 small">
          <div>投递网址：<ExtLink url={posting.applyUrl} /></div><div>官方招聘：<ExtLink url={posting.officialUrl} /></div>
          <div>来源平台：{posting.sourcePlatform || '—'}</div><div>截止日期：{posting.deadline || '—'}　发布：{posting.publishedAt || '—'}</div>
          <div>薪资：{posting.salary || '—'}</div><div className="muted">创建 {fmt(posting.createdAt)} · 更新 {fmt(posting.updatedAt)} · 来源 {posting.source.kind === 'manual' ? '手动' : posting.source.kind === 'analysis' ? '岗位分析历史' : `${posting.source.kind}${posting.source.fileName ? `（${posting.source.fileName}）` : ''}`}</div>
        </div>
        {posting.jobParseId && <div className="small"><button className="link" data-testid="open-analysis" onClick={openAnalysis}>↩ 打开对应的岗位分析 / 简历制作记录</button></div>}
        {posting.notes && <div className="notice">{posting.notes}</div>}
      </div>
      {msg && <div className={`notice ${msg.t}`} data-testid="detail-msg">{msg.m}</div>}

      <div className="grid2 top">
        <div className="card" data-testid="status-card">
          <h4>申请状态 {apps.length > 1 && <select value={appId} onChange={(e) => setAppId(e.target.value)}>{apps.map((a, i) => <option key={a.id} value={a.id}>申请 {apps.length - i}（{STATUS_LABEL[a.status]}）</option>)}</select>}</h4>
          <div className="big-status" data-testid="current-status">{app ? STATUS_LABEL[app.status] : '尚未建立申请（仅在岗位库中）'}</div>
          {app?.appliedAt && <div className="muted small">投递时间：{fmt(app.appliedAt)}</div>}
          <div className="row">
            {!app && <button data-testid="btn-save" onClick={async () => { const a = await createApplication(db, posting.id, 'saved'); setAppId(a.id); await done('已收藏'); }}>⭐ 收藏</button>}
            <select data-testid="status-select" value={st.to} onChange={(e) => setSt({ ...st, to: e.target.value })}><option value="">更新状态为…</option>{APP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            <input type="datetime-local" title="发生时间（不填为现在）" value={st.at} onChange={(e) => setSt({ ...st, at: e.target.value })} />
          </div>
          <input data-testid="status-note" placeholder="备注（可选），如：收到测评邮件" value={st.note} onChange={(e) => setSt({ ...st, note: e.target.value })} />
          <div className="row end"><button className="primary" data-testid="status-apply" disabled={!st.to} onClick={doStatus}>记录状态变化</button></div>
          <h4>状态历史</h4>
          <ol className="timeline" data-testid="history">{events.map((e) => <li key={e.id}><b>{e.at.slice(0, 10)}</b> {e.from ? `${STATUS_LABEL[e.from]} → ` : ''}<b>{STATUS_LABEL[e.to]}</b>{e.by === 'import' && <span className="chip">导入</span>}{e.note && <div className="muted small">{e.note}</div>}</li>)}{!events.length && <li className="muted">暂无记录</li>}</ol>
          {app && <label>申请结果 / 结论<textarea rows={2} data-testid="result" defaultValue={app.result ?? ''} onBlur={(e) => upd((a) => { a.result = e.target.value; })} /></label>}
        </div>

        <div className="card" data-testid="resume-card">
          <h4>关联的简历版本</h4>
          <p className="muted small">关联时会保存当时简历和资料的完整快照；之后修改资料或重新生成，已投递的版本都不会改变。</p>
          <div className="row">
            <button data-testid="link-current" disabled={!resume} onClick={linkCurrent}>🔗 关联当前生成的简历{resume ? `（${fmt(resume.createdAt)}）` : ''}</button>
            <button data-testid="to-generate" onClick={toGenerate}>✨ 用这个 JD 生成简历</button>
          </div>
          <div className="row small"><span>上传实际提交的文件：</span>{(['zh', 'en'] as Lang[]).map((l) => <label key={l} className="check"><input type="checkbox" checked={upLangs.includes(l)} onChange={(e) => setUpLangs(e.target.checked ? [...upLangs, l] : upLangs.filter((x) => x !== l))} />{l === 'zh' ? '中文' : '英文'}</label>)}
            <button data-testid="upload-submitted" onClick={() => subRef.current?.click()}>📤 上传 PDF / DOCX</button>
            <input ref={subRef} data-testid="submitted-input" type="file" accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => e.target.files && uploadSubmitted(e.target.files)} /></div>
          <ul className="artifacts" data-testid="artifacts">{arts.map((a) => (
            <li key={a.id} data-testid="artifact">
              {a.submitted && <span className="chip st-ok">实际提交版本</span>} <b>{a.label}</b> <span className="muted small">{a.languages.map((l) => (l === 'zh' ? '中' : '英')).join('/')} · {a.kind === 'snapshot' ? `快照 · 简历生成于 ${fmt(a.resumeCreatedAt)}` : '上传文件'} · 关联于 {fmt(a.createdAt)}</span>
              {a.audit && <div className="small">{a.audit.unconfirmedRed ? <span className="bad">⚠ 事实审查：{a.audit.unconfirmedRed} 处高风险未确认</span> : a.audit.unconfirmed ? `事实审查：${a.audit.unconfirmed} 处待确认` : '✓ 事实审查已处理'}{a.job && <span className="muted">　对应 JD：{a.job.company.short || a.job.company.full} {a.job.title.zh || a.job.title.en}</span>}</div>}
              <div className="row">{a.kind === 'snapshot' && <button className="link" onClick={() => exportSnapshot(a)}>按快照导出 PDF/Word</button>}
                {a.kind === 'snapshot' && <button className="link" onClick={() => db.artifacts.update(a.id, { submitted: !a.submitted }).then(load)}>{a.submitted ? '取消「实际提交」标记' : '标记为实际提交版本'}</button>}
                {a.attachmentId && <button className="link" onClick={() => { const x = atts.find((t) => t.id === a.attachmentId); if (x) openAtt(x, true); }}>下载文件</button>}</div>
            </li>))}{!arts.length && <li className="muted">还没有关联简历</li>}</ul>
        </div>
      </div>

      <div className="card" data-testid="attachments-card">
        <h4>附件（JD 截图、投递成功截图、笔试 / 面试通知、录用通知…）</h4>
        <div className="dropzone small" data-testid="att-drop" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
          <b>点击选择或拖入 PDF / DOCX / 图片</b><div className="muted small">文件只保存在本机浏览器（IndexedDB），单个上限 25 MB，不会发送给 AI 或上传</div>
          <input ref={fileRef} data-testid="att-input" type="file" multiple hidden accept=".pdf,.doc,.docx,image/*,.txt,.eml,.msg" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>
        <div className="row small">附件类型：<select value={kind} onChange={(e) => setKind(e.target.value as AttachmentKind | 'auto')}><option value="auto">按文件名自动判断</option>{Object.entries(ATTACH_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <table className="items"><tbody>{atts.map((a) => (
          <tr key={a.id} data-testid="attachment-row"><td>{ATTACH_KIND_LABEL[a.kind]}</td><td><b>{a.name}</b><div className="muted small">{(a.size / 1024).toFixed(1)} KB · {fmt(a.uploadedAt)} · SHA-256 {a.sha256.slice(0, 12)}…</div>
            <input className="small" placeholder="备注" defaultValue={a.note ?? ''} onBlur={(e) => db.attachments.update(a.id, { note: e.target.value })} /></td>
            <td><button className="link" onClick={() => openAtt(a, false)}>预览</button><button className="link" onClick={() => openAtt(a, true)}>下载</button>
              <button className="link" onClick={async () => setMsg((await verifyAttachment(db, a.id)) ? { t: 'ok', m: `「${a.name}」校验通过` } : { t: 'error', m: `「${a.name}」校验失败或文件缺失` })}>校验</button>
              <button className="link danger" onClick={async () => { if (confirm(`删除附件「${a.name}」？`)) { await deleteAttachment(db, a.id); await done('附件已删除'); } }}>删除</button></td></tr>))}</tbody></table>
        {!atts.length && <div className="muted small">暂无附件</div>}
      </div>

      <div className="grid2 top">
        <div className="card" data-testid="todos-card"><h4>待办事项</h4>
          {app ? <TodoList app={app} upd={upd} /> : <div className="muted small">建立申请后可添加待办（先收藏或更新状态）</div>}</div>
        <div className="card" data-testid="interviews-card"><h4>面试 / 笔试安排</h4>
          {app ? <InterviewList app={app} upd={upd} /> : <div className="muted small">建立申请后可记录面试</div>}</div>
      </div>

      <div className="card"><h4>完整 JD 原文</h4>{posting.description && <p>{posting.description}</p>}<pre className="jd" data-testid="jd-text">{posting.jdText || '（未填写）'}</pre>{posting.requirements && <><h4>岗位要求</h4><pre className="jd">{posting.requirements}</pre></>}</div>
    </div>
  );
}

function TodoList({ app, upd }: { app: Application; upd: (fn: (a: Application) => void) => Promise<void> }) {
  const [t, setT] = useState(''), [due, setDue] = useState('');
  return (<>
    <ul className="todos">{app.todos.map((x) => <li key={x.id}><label className="check"><input type="checkbox" checked={x.done} onChange={() => upd((a) => { const y = a.todos.find((z) => z.id === x.id)!; y.done = !y.done; })} /> <span className={x.done ? 'muted strike' : ''}>{x.text}</span></label> {x.due && <span className="chip">{x.due}</span>} <button className="link" onClick={() => upd((a) => { a.todos = a.todos.filter((z) => z.id !== x.id); })}>×</button></li>)}</ul>
    <div className="row"><input data-testid="todo-text" placeholder="如：完成在线测评" value={t} onChange={(e) => setT(e.target.value)} /><input type="date" data-testid="todo-due" value={due} onChange={(e) => setDue(e.target.value)} /><button data-testid="todo-add" disabled={!t.trim()} onClick={() => upd((a) => { a.todos.push({ id: uid('todo'), text: t.trim(), due: due || undefined, done: false, createdAt: nowIso() }); }).then(() => { setT(''); setDue(''); })}>添加</button></div>
  </>);
}
function InterviewList({ app, upd }: { app: Application; upd: (fn: (a: Application) => void) => Promise<void> }) {
  const [v, setV] = useState({ at: '', round: '', mode: '', notes: '' });
  return (<>
    <ul className="todos">{[...app.interviews].sort((a, b) => a.at.localeCompare(b.at)).map((x) => <li key={x.id}><b>{x.at.replace('T', ' ')}</b> {x.round} {x.mode && <span className="chip">{x.mode}</span>}{x.notes && <div className="muted small">{x.notes}</div>} <button className="link" onClick={() => upd((a) => { a.interviews = a.interviews.filter((z) => z.id !== x.id); })}>×</button></li>)}</ul>
    <div className="row"><input type="datetime-local" data-testid="iv-at" value={v.at} onChange={(e) => setV({ ...v, at: e.target.value })} /><input data-testid="iv-round" placeholder="轮次，如：一面 / 笔试" value={v.round} onChange={(e) => setV({ ...v, round: e.target.value })} /><input placeholder="形式：线上 / 现场" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })} /></div>
    <textarea rows={2} placeholder="面试备注 / 复盘" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
    <div className="row end"><button data-testid="iv-add" disabled={!v.at || !v.round.trim()} onClick={() => upd((a) => { a.interviews.push({ id: uid('iv'), at: v.at, round: v.round.trim(), mode: v.mode || undefined, notes: v.notes || undefined, createdAt: nowIso() }); }).then(() => setV({ at: '', round: '', mode: '', notes: '' }))}>添加安排</button></div>
  </>);
}
