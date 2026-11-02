import { EvidenceReport } from '../components/EvidenceReport';
import { measurePages } from '../export/client';
import { ResumeFactsOptions } from '../components/ResumeFactsOptions';
import { AiDisclosure } from '../components/AiDisclosure';
import { ResumeNotice } from '../components/ResumeNotice';
import { MaterialPool } from '../components/MaterialPool';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { useT } from '../i18n';
import type { Lang } from '../types';
import { generateResume, localizeAi, runConsistency } from '../ai/generate';
import { buildLayout } from '../render/layout';
import { Preview } from '../render/Preview';
import { ExportDialog } from '../components/ExportDialog';
import { ItemsEditor } from '../components/ItemsEditor';

export function GeneratePage({ go }: { go: (p: string) => void }) {
  const { profile, settings, job, resume, setResume, template, templates, templateId, setTemplateId } = useApp();
  const t = useT();
  const [primary, setPrimary] = useState<Lang>(job?.jdLanguage ?? 'zh');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [view, setView] = useState<'zh' | 'en' | 'both'>('both');
  const [showExport, setShowExport] = useState(false);

  const run = async () => {
    if (!job) return;
    setErr('');
    try { const r = await generateResume(settings, profile, job, primary, template.page.targetPages, setBusy, { template, measure: (r) => measurePages(profile, { ...template, page: { ...template.page, autoFit: false } }, r) }); setResume({ ...r, templateId }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const latestResume = useRef(resume);
  useEffect(() => { latestResume.current = resume; }, [resume]);
  const resync = async () => {
    if (!resume) return;
    const ids = resume.items.filter((i) => i.syncStatus !== 'in-sync').map((i) => i.sourceId);
    if (settings.demoMode) { setResume(runConsistency({ ...resume, items: resume.items.map((i) => ({ ...i, syncStatus: 'in-sync' })) })); return; }
    setBusy('重新本地化待同步条目…');
    try { const translated = await localizeAi(settings, profile, job, resume, ids); if (latestResume.current === resume) setResume(translated); else setErr('同步期间简历已修改，保留当前编辑；可按需再次同步。'); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const pending = resume?.items.filter((i) => i.syncStatus !== 'in-sync').length ?? 0;

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
          <AiDisclosure />
          {busy && <div className="notice">{busy}</div>}
          {err && <div className="notice error">{err}</div>}
        </div>
      )}
      {resume && (
        <>
          <div className="card">
            <b>{resume.generatedBy === 'ai' ? 'AI 已完成岗位选材与撰写' : '演示简历（未调用 AI）'}</b>
            <p className="muted small">左侧勾选、编辑、排序，右侧实时更新。调整素材不调用 AI，也不修改个人资料库。</p>
            <ResumeNotice />
            {pending > 0 && <div className="notice warn">{pending} 条文字的另一语言可按需同步，不影响下载。<button onClick={resync}>重新本地化</button></div>}
          </div>
          <details className="card"><summary>中英文逐条编辑</summary><ItemsEditor /></details>
        </>
      )}
      <div className="card">
        <div className="row"><h4>{t('preview')}</h4>
          {(['zh', 'en', 'both'] as const).map((v) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v === 'zh' ? 'CN' : v === 'en' ? 'EN' : 'CN | EN 并排'}</button>)}
        </div>
        <div className="pool-layout">
          {resume && <MaterialPool />}
          <div className="previews">
          {(view === 'both' ? (['zh', 'en'] as Lang[]) : [view]).map((l) => <Preview key={l} m={buildLayout(profile, template, l, resume)} scale={view === 'both' ? 0.55 : 0.8} />)}
          </div>
        </div>
      </div>
      <ResumeFactsOptions />
      <EvidenceReport go={go} />
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  );
}
