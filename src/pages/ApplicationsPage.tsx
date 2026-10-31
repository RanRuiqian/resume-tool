import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { useL } from '../i18n';
import { db } from '../storage/db';
import { addPosting, copyPosting, createApplication, deleteImpact, deletePosting, updatePosting } from '../tracker/repo';
import { computeStats, latestByPosting } from '../tracker/stats';
import { APP_STATUSES, PRIORITY_LABEL, RECRUIT_LABEL, STATUS_LABEL, STATUS_LABEL_EN, type AppStatus, type Priority, type RecruitType } from '../tracker/types';
import { useTracker } from '../tracker/useTracker';
import { PostingForm } from '../components/tracker/PostingForm';
import { ExtLink, PostingDetail } from '../components/tracker/PostingDetail';
import { ImportPanel } from '../components/tracker/ImportPanel';
import { BackupPanel } from '../components/tracker/BackupPanel';

/** 求职投递：岗位库 + 申请进度 + 详情 + 统计 + 导入 + 备份。路由：#applications[/new|/import|/backup|/<岗位id>[/edit]] */
export function ApplicationsPage({ sub, go }: { sub: string; go: (p: string) => void }) {
  const { isDemo, settings } = useApp();
  const L = useL(); const en = settings.uiLang === 'en';
  const SL = en ? STATUS_LABEL_EN : STATUS_LABEL;
  const { postings, apps, loaded, reload } = useTracker();
  const [q, setQ] = useState(''); const [fType, setFType] = useState(''); const [fStatus, setFStatus] = useState(''); const [fPri, setFPri] = useState('');
  const latest = useMemo(() => latestByPosting(apps), [apps]);
  const stats = useMemo(() => computeStats(postings, apps), [postings, apps]);
  const [seg, action] = sub.split('/');
  const sel = postings.find((p) => p.id === seg);
  const list = postings.filter((p) => {
    const s = q.trim().toLowerCase();
    if (s && ![p.company, p.title, p.city, p.category ?? ''].some((x) => x.toLowerCase().includes(s))) return false;
    if (fType && p.recruitType !== fType) return false;
    if (fPri && String(p.priority) !== fPri) return false;
    const st = latest.get(p.id)?.status;
    if (fStatus === 'none' ? !!st : fStatus && st !== fStatus) return false;
    return true;
  });
  const del = async (id: string) => {
    const p = postings.find((x) => x.id === id); const imp = await deleteImpact(db, id);
    const warn = imp.applications || imp.attachments ? `\n\n⚠ 将同时删除：${imp.applications} 条申请记录、${imp.events} 条状态历史、${imp.artifacts} 个简历版本、${imp.attachments} 个附件。建议先在「备份与恢复」导出完整档案。` : '';
    if (!confirm(`删除岗位「${p?.company} · ${p?.title}」？${warn}`)) return;
    await deletePosting(db, id); await reload(); go('applications');
  };
  if (!loaded) return <div className="page">加载中…</div>;

  const tabs = (
    <div className="row tracker-tabs">
      <button className={!seg ? 'active' : ''} onClick={() => go('applications')}>{L('岗位与进度', 'Jobs & progress')}</button>
      <button data-testid="nav-new" className={seg === 'new' ? 'active' : ''} onClick={() => go('applications/new')}>➕ {L('新增岗位', 'Add job')}</button>
      <button data-testid="nav-import" className={seg === 'import' ? 'active' : ''} onClick={() => go('applications/import')}>{L('导入记录', 'Import')}</button>
      <button data-testid="nav-backup" className={seg === 'backup' ? 'active' : ''} onClick={() => go('applications/backup')}>{L('备份与恢复', 'Backup & restore')}</button>
    </div>
  );
  return (
    <div className="page tracker" data-testid="applications-page">
      <h2>{L('求职投递', 'Applications')}</h2>
      <p className="muted small">{L('岗位库只记录岗位本身；收藏或投递后才会建立申请记录。所有数据只保存在本机浏览器，不会自动投递或发送邮件。', 'Jobs are stored separately from applications. Everything stays in this browser; nothing is auto-applied or emailed.')}</p>
      {tabs}
      {seg === 'new' && <PostingForm all={postings} onCancel={() => go('applications')} onSave={async (v, status) => { const r = await addPosting(db, v, status); await reload(); go(`applications/${r.posting.id}`); }} />}
      {seg === 'import' && <ImportPanel postings={postings} apps={apps} onDone={reload} />}
      {seg === 'backup' && <BackupPanel isDemo={isDemo} onDone={reload} />}
      {sel && action === 'edit' && <PostingForm initial={sel} all={postings} onCancel={() => go(`applications/${sel.id}`)} onSave={async (v) => { await updatePosting(db, { ...sel, ...v, priority: v.priority ?? sel.priority }); await reload(); go(`applications/${sel.id}`); }} />}
      {sel && !action && <PostingDetail key={sel.id} posting={sel} go={go} onChanged={reload} onEdit={() => go(`applications/${sel.id}/edit`)} onDelete={() => del(sel.id)} />}
      {seg && !sel && !['new', 'import', 'backup'].includes(seg) && <div className="notice warn">岗位不存在（可能已删除）。<button className="link" onClick={() => go('applications')}>返回列表</button></div>}
      {!seg && (<>
        <div className="stats" data-testid="stats">
          {([['岗位总数', 'Jobs', stats.postings, 'st-postings'], ['已收藏', 'Saved', stats.saved, 'st-saved'], ['已投递（累计）', 'Applied', stats.applied, 'st-applied'], ['等待回复', 'Waiting', stats.waiting, 'st-waiting'], ['笔试 / 面试', 'Test / interview', stats.testOrInterview, 'st-ti'], ['Offer', 'Offers', stats.offer, 'st-offer'], ['被拒', 'Rejected', stats.rejected, 'st-rejected']] as const).map(([z, e, n, id]) => <div key={id} className="stat" data-testid={id}><div className="n">{n}</div><div className="muted small">{L(z, e)}</div></div>)}
        </div>
        {stats.postings > 0 && <div className="grid2 top small">
          <div className="card"><b>{L('地区分布', 'By city')}</b> {Object.entries(stats.byCity).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k} className="chip">{k} {n}</span>)}{!Object.keys(stats.byCity).length && <span className="muted"> {L('（建立申请后统计）', '(none yet)')}</span>}
            <div><b>{L('企业分布', 'By company')}</b> {Object.entries(stats.byCompany).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => <span key={k} className="chip">{k} {n}</span>)}</div></div>
          <div className="card" data-testid="upcoming"><b>{L('即将到期（14 天内）', 'Due in 14 days')}</b>{stats.upcoming.length ? <ul>{stats.upcoming.slice(0, 8).map((u, i) => <li key={i}><button className="link" onClick={() => go(`applications/${u.postingId}`)}>{u.date} · {u.label}</button></li>)}</ul> : <div className="muted">{L('暂无', 'Nothing due')}</div>}
            <b>{L('最近更新', 'Recently updated')}</b><ul>{stats.recent.map((p) => <li key={p.id}><button className="link" onClick={() => go(`applications/${p.id}`)}>{p.company} · {p.title}</button></li>)}</ul></div>
        </div>}
        <div className="row filters">
          <input data-testid="search" placeholder={L('搜索企业 / 岗位 / 城市', 'Search company / title / city')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select data-testid="f-type" value={fType} onChange={(e) => setFType(e.target.value)}><option value="">{L('全部类型', 'All types')}</option>{(Object.keys(RECRUIT_LABEL) as RecruitType[]).map((k) => <option key={k} value={k}>{RECRUIT_LABEL[k]}</option>)}</select>
          <select data-testid="f-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">{L('全部状态', 'All statuses')}</option><option value="none">{L('仅岗位（未建立申请）', 'Not tracked')}</option>{APP_STATUSES.map((s) => <option key={s} value={s}>{SL[s]}</option>)}</select>
          <select data-testid="f-priority" value={fPri} onChange={(e) => setFPri(e.target.value)}><option value="">{L('全部优先级', 'All priorities')}</option>{([1, 2, 3] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
          <span className="muted small">{list.length} / {postings.length}</span>
        </div>
        {postings.length === 0 ? <div className="card empty" data-testid="empty">{L('还没有岗位。点「新增岗位」手动添加，或在「导入记录」导入以前的投递表格。', 'No jobs yet. Add one or import a spreadsheet.')}</div> : (
          <div className="scroll-x"><table className="items tracker-list" data-testid="posting-list"><thead><tr><th>{L('企业 / 岗位', 'Company / title')}</th><th>{L('城市', 'City')}</th><th>{L('类型', 'Type')}</th><th>{L('状态', 'Status')}</th><th>{L('截止', 'Deadline')}</th><th>{L('优先级', 'Priority')}</th><th>{L('链接', 'Link')}</th><th /></tr></thead><tbody>
            {list.map((p) => { const a = latest.get(p.id); return (
              <tr key={p.id} data-testid="posting-row">
                <td><button className="link strong" data-testid="open-posting" onClick={() => go(`applications/${p.id}`)}>{p.company} · {p.title}</button>{p.category && <div className="muted small">{p.category}</div>}</td>
                <td>{p.city || '—'}</td><td>{p.recruitType ? RECRUIT_LABEL[p.recruitType] : '—'}</td>
                <td><span className={`status s-${a?.status ?? 'none'}`} data-testid="row-status">{a ? SL[a.status] : L('仅岗位', 'Not tracked')}</span></td>
                <td>{p.deadline || '—'}</td><td>{PRIORITY_LABEL[p.priority]}</td><td><ExtLink url={p.applyUrl || p.officialUrl} label={L('打开', 'Open')} /></td>
                <td className="nowrap">{!a && <button className="link" data-testid="quick-save" onClick={async () => { await createApplication(db, p.id, 'saved' as AppStatus); await reload(); }}>⭐ {L('收藏', 'Save')}</button>}<button className="link" onClick={async () => { const n = await copyPosting(db, p.id); await reload(); go(`applications/${n.id}/edit`); }}>{L('复制', 'Copy')}</button><button className="link danger" onClick={() => del(p.id)}>{L('删除', 'Delete')}</button></td>
              </tr>); })}
          </tbody></table></div>)}
      </>)}
    </div>
  );
}
