import { useState } from 'react';
import { useApp } from '../store';
import { useT } from '../i18n';
import type { Lang, GenItem } from '../types';
import { generateResume, localizeAi, runConsistency, textIndex } from '../ai/generate';
import { buildLayout } from '../render/layout';
import { Preview } from '../render/Preview';
import { ExportDialog } from '../components/ExportDialog';
import { lt } from '../locale/text';

export function GeneratePage({ go }: { go: (p: string) => void }) {
  const { profile, settings, job, resume, setResume, template, templates, templateId, setTemplateId } = useApp();
  const t = useT();
  const [primary, setPrimary] = useState<Lang>(job?.jdLanguage ?? 'zh');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [view, setView] = useState<'zh' | 'en' | 'both'>('both');
  const [showExport, setShowExport] = useState(false);
  const idx = textIndex(profile);
  const issueIds = new Set(resume?.consistency.issues.map((i) => i.sourceId));

  const run = async () => {
    if (!job) return;
    setErr('');
    try { const r = await generateResume(settings, profile, job, primary, template.page.targetPages, setBusy); setResume({ ...r, templateId }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const editItem = (i: number, l: Lang, v: string) => {
    if (!resume) return;
    const items = resume.items.map((x, j): GenItem => (j === i ? { ...x, [l]: v, syncStatus: l === resume.primaryLanguage ? 'pending' : x.syncStatus } : x));
    setResume(runConsistency({ ...resume, items }));
  };
  const resync = async () => {
    if (!resume) return;
    const ids = resume.items.filter((i) => i.syncStatus === 'pending').map((i) => i.sourceId);
    if (settings.demoMode) { setResume(runConsistency({ ...resume, items: resume.items.map((i) => ({ ...i, syncStatus: 'in-sync' })) })); return; }
    setBusy('重新本地化待同步条目…');
    try { setResume(await localizeAi(settings, profile, job, resume, ids)); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const pending = resume?.items.filter((i) => i.syncStatus === 'pending').length ?? 0;

  return (
    <div className="page">
      <div className="toolbar">
        <h2>{t('navGenerate')}</h2>
        <span className="spacer" />
        <button className="primary big" onClick={() => setShowExport(true)}>⬇ {t('exportZip')}</button>
      </div>
      {!job ? <div className="notice warn">请先在「岗位解析」页解析一个岗位。<button className="link" onClick={() => go('job')}>去解析 →</button></div> : (
        <div className="card">
          <div className="row">
            <b>{job.company.short || '（未识别公司）'} · {job.title.zh || job.title.en} {job.roleAbbr && `(${job.roleAbbr})`}</b>
            <label>主版本语言 <select value={primary} onChange={(e) => setPrimary(e.target.value as Lang)}><option value="zh">中文</option><option value="en">English</option></select></label>
            <label>模板 <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name.zh}</option>)}</select></label>
            <button className="primary" disabled={!!busy} onClick={run}>{t('generate')}</button>
            {settings.demoMode && <span className="badge st-machine">演示模式：规则匹配，不改写</span>}
          </div>
          {busy && <div className="notice">{busy}</div>}
          {err && <div className="notice error">{err}</div>}
        </div>
      )}
      {resume && (
        <>
          <div className="card">
            <div className="row">
              <div className="score" style={{ ['--p' as string]: resume.matchScore }}>{resume.matchScore}<small>匹配度</small></div>
              <div className="grow">
                <div><b>缺口：</b>{resume.gaps.length ? resume.gaps.map((g) => <span key={g} className="badge st-stale">{g}</span>) : '无'}</div>
                <div className="muted small">生成方式：{resume.generatedBy === 'ai' ? 'AI 改写' : '规则匹配'} · 主版本 {resume.primaryLanguage === 'zh' ? '中文' : 'English'} · 共 {resume.items.length} 条，均可追溯到资料库 sourceId</div>
                {resume.notes?.map((n, i) => <div key={i} className="muted small">· {n}</div>)}
              </div>
            </div>
            <div className={`notice ${resume.consistency.issues.length ? 'error' : 'ok'}`}>
              一致性校验：{resume.consistency.issues.length ? `${resume.consistency.issues.length} 个问题` : '两版条目、数字、日期一致 ✓'}
              {resume.consistency.issues.map((i, k) => <div key={k} className="small">· {i.message}</div>)}
            </div>
            {pending > 0 && <div className="notice warn">{pending} 条主版本已修改，副版本待同步。<button onClick={resync}>重新本地化</button></div>}
          </div>
          <div className="card">
            <h4>逐条微调（左：中文，右：English）</h4>
            <table className="items">
              <thead><tr><th>来源</th><th>中文</th><th>English</th></tr></thead>
              <tbody>
                {resume.items.map((it, i) => {
                  const src = idx.get(it.sourceId);
                  return (
                    <tr key={it.sourceId} className={issueIds.has(it.sourceId) ? 'bad' : it.syncStatus === 'pending' ? 'pending' : ''}>
                      <td className="small" title={src ? lt(src.t, resume.primaryLanguage) : ''}>{it.sourceId}<div className="muted">{src?.parent}</div></td>
                      <td><textarea rows={2} value={it.zh} onChange={(e) => editItem(i, 'zh', e.target.value)} /></td>
                      <td><textarea rows={2} value={it.en} onChange={(e) => editItem(i, 'en', e.target.value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="card">
        <div className="row"><h4>{t('preview')}</h4>
          {(['zh', 'en', 'both'] as const).map((v) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v === 'zh' ? 'CN' : v === 'en' ? 'EN' : 'CN | EN 并排'}</button>)}
        </div>
        <div className="previews">
          {(view === 'both' ? (['zh', 'en'] as Lang[]) : [view]).map((l) => <Preview key={l} m={buildLayout(profile, template, l, resume)} scale={view === 'both' ? 0.55 : 0.8} />)}
        </div>
      </div>
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  );
}
