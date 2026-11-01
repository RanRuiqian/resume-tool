import { AiDisclosure } from '../components/AiDisclosure';
import { uiStorage } from '../storage/mode';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import type { Lang, PhotoPosition } from '../types';
import { SetupCard } from '../components/SetupCard';
import { ItemsEditor } from '../components/ItemsEditor';
import { AuditBadge, FactAudit } from '../components/FactAudit';
import { MaterialPool } from '../components/MaterialPool';
import { ExportPanel } from '../components/ExportDialog';
import { importProfileFromText, mergeProfiles } from '../ai/importProfile';
import { translateProfile } from '../ai/translate';
import { recognizeScreenshot } from '../ai/ocr';
import { analyzeJob, isAnalysisStale } from '../ai/jd';
import { extractJdBody } from '../ai/jdText';
import { JD_PREFILL_KEY, TRACKER_RETURN_KEY, type TrackerReturn } from '../tracker/useTracker';
import { linkResumeSnapshot } from '../tracker/repo';
import { db } from '../storage/db';
import { generateResume, localizeAi, runConsistency } from '../ai/generate';
import { forEachText, needsTranslation, lt } from '../locale/text';
import { normalizeProfile } from '../storage/profileIO';
import { buildLayout } from '../render/layout';
import { Preview } from '../render/Preview';
import { useEditTemplate } from '../render/useEditTemplate';
import { measurePages, type PageInfo } from '../export/client';
import { fileToDataUrl } from '../utils/download';
import sample from '../sample/sample-profile.json';
import { SAMPLE_JD } from '../sample/sampleJd';
import { ALL_TEMPLATES } from '../templates';
import { fileToText } from '../ai/fileText';
import { ProgressNote } from '../components/ProgressNote';
import { PhotoCropper } from '../components/PhotoCropper';
import { JobHistory } from '../components/JobHistory';
import { MatchInsights } from '../components/MatchInsights';
import { CareerKit } from '../components/CareerKit';
import { FEATURES } from '../features';
import { useL } from '../i18n';

const STEPS: [string, string][] = [['填写我的资料', 'My profile'], ['上传岗位要求', 'Target job'], ['生成并预览', 'Generate & preview'], ['下载简历', 'Download']];
const COLORS = [['#1a365d', '#2b6cb0'], ['#0f4c5c', '#e36414'], ['#3c096c', '#7b2cbf'], ['#22543d', '#38a169'], ['#1a1a1a', '#555555']];

export function WizardPage({ go }: { go: (p: string) => void }) {
  const app = useApp();
  const L = useL();
  const { settings, profile, job, resume } = app;
  const hasProfile = !!(profile.profile.name.zh || profile.profile.name.en || profile.work.length || profile.education.length);
  const [step, setStepS] = useState(() => Number(uiStorage.getItem('wizardStep')) || (resume ? 3 : job ? 2 : hasProfile ? 2 : 1));
  const setStep = (n: number) => { setStepS(n); uiStorage.setItem('wizardStep', String(n)); window.scrollTo(0, 0); };
  const can = [true, hasProfile, hasProfile && !!job, !!resume];
  const cur = can[step - 1] ? step : Math.max(1, can.lastIndexOf(true) + 1 > 3 ? 3 : can.lastIndexOf(true) + 1);

  if (!settings.setupDone) return <div className="page wizard"><Hero /><SetupCard /></div>;
  return (
    <div className="page wizard">
      <ol className="stepper">
        {STEPS.map(([zs, es], i) => { const s = L(zs, es); return (
          <li key={zs} className={`${cur === i + 1 ? 'active' : ''} ${cur > i + 1 ? 'done' : ''}`}>
            <button disabled={!can[i]} onClick={() => setStep(i + 1)}><span className="num">{cur > i + 1 ? '✓' : i + 1}</span>{s}</button>
          </li>
        ); })}
      </ol>
      <TrackerReturnBanner go={go} />
      {settings.demoMode && <div className="notice warn">{L('当前为演示模式：不调用 AI，只做关键词匹配，英文缺失处用占位文字。', 'Demo mode: no AI calls — keyword matching only, missing translations use placeholders.')}<button className="link" onClick={() => go('settings')}>{L('连接 AI 服务 →', 'Connect AI →')}</button></div>}
      {cur === 1 && <Step1 next={() => setStep(2)} go={go} hasProfile={hasProfile} />}
      {cur === 2 && <Step2 next={() => setStep(3)} back={() => setStep(1)} />}
      {cur === 2 && <JobHistory onOpen={() => setStep(3)} go={go} />}
      {cur === 3 && <Step3 next={() => setStep(4)} back={() => setStep(2)} go={go} />}
      {cur === 4 && <Step4 back={() => setStep(3)} restart={() => setStep(2)} />}
    </div>
  );
}

/** 从「求职投递」岗位详情进入时显示：生成后一键把简历快照关联回该岗位 */
function TrackerReturnBanner({ go }: { go: (p: string) => void }) {
  const { resume, profile, job } = useApp();
  const [ret, setRet] = useState<TrackerReturn | null>(() => { try { const v = uiStorage.getItem(TRACKER_RETURN_KEY); return v ? JSON.parse(v) : null; } catch { return null; } });
  const [err, setErr] = useState('');
  if (!ret) return null;
  const clear = () => { uiStorage.setItem(TRACKER_RETURN_KEY, ''); setRet(null); };
  const linkBack = async () => {
    if (!resume) return;
    try { await linkResumeSnapshot(db, ret.applicationId, { resume, profile, job, label: `${ret.label} · 生成于 ${resume.createdAt.slice(0, 16).replace('T', ' ')}` }); clear(); go(`applications/${ret.postingId}`); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="notice tracker-return" data-testid="tracker-return">
      正在为岗位「<b>{ret.label}</b>」准备简历。生成并检查满意后：
      <button className="primary" data-testid="link-back" disabled={!resume} onClick={linkBack}>关联当前简历并返回该岗位</button>
      <button className="link" onClick={() => go(`applications/${ret.postingId}`)}>先返回岗位</button><button className="link" onClick={clear}>不关联</button>
      {err && <div className="bad">{err}</div>}
    </div>
  );
}

function Hero() {
  const L = useL();
  return (
    <div className="hero-text">
      <h1>{L('上传岗位截图，一键生成中英文简历', 'Screenshot a job post, get a tailored resume in Chinese & English')}</h1>
      <p>{L('填一次个人资料 → 每投一个岗位，上传它的招聘截图 → 自动挑选最相关的经历、改写贴合岗位 → 下载中文 / 英文的 PDF 和 Word。', 'Fill in your profile once → for each job, upload the posting screenshot → the most relevant experience is picked and rephrased → download CN/EN PDF and Word.')}</p>
    </div>
  );
}

function Step1({ next, go, hasProfile }: { next: () => void; go: (p: string) => void; hasProfile: boolean }) {
  const { profile, setProfile, settings, replaceProfile } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const [adding, setAdding] = useState(!hasProfile);
  const [prog, setProg] = useState<{ m: string; p?: number } | null>(null);
  const loadFile = async (f: File) => {
    setMsg(null); setProg({ m: `读取 ${f.name}` });
    try { const t = await fileToText(f, (m, p) => setProg({ m, p })); if (!t.trim()) throw new Error('没有读到文字'); setText(t); setMsg({ t: 'ok', m: `已读取 ${f.name}（${t.length} 字），请检查后点「AI 帮我整理」。` }); }
    catch (e) { setMsg({ t: 'error', m: '读取失败：' + (e as Error).message }); } finally { setProg(null); }
  };

  const importText = async () => {
    if (settings.demoMode) { setMsg({ t: 'error', m: '演示模式无法 AI 整理文字。请先连接 AI 服务，或点「先看看示例」。' }); return; }
    setBusy('AI 正在整理你的经历（约 10–30 秒）…'); setMsg(null);
    try {
      let p = mergeProfiles(profile, await importProfileFromText(settings, text));
      setBusy('正在自动翻译成英文…');
      try { p = (await translateProfile(settings, p, p.primaryLanguage === 'zh' ? 'en' : 'zh')).profile; } catch { /* 翻译失败不影响导入 */ }
      await replaceProfile(p, 'AI 整理经历前'); setText(''); setAdding(false);
      setMsg({ t: 'ok', m: `已整理：${p.work.length} 段工作、${p.projects.length} 个项目、${p.education.length} 段教育、${p.skills.length} 项技能。请核对下面的信息。` });
    } catch (e) { setMsg({ t: 'error', m: '整理失败：' + (e as Error).message }); }
    finally { setBusy(''); }
  };
  let missing = 0, machine = 0;
  forEachText(profile, (t, path) => { if (path === 'profile.summary') return; if (needsTranslation(t, 'en') || needsTranslation(t, 'zh')) missing++; if (t.status?.en === 'machine' || t.status?.zh === 'machine') machine++; });
  const fixTranslate = async () => {
    setBusy('翻译中…');
    try { let p = (await translateProfile(settings, profile, 'en')).profile; p = (await translateProfile(settings, p, 'zh')).profile; setProfile(p); }
    catch (e) { setMsg({ t: 'error', m: (e as Error).message }); } finally { setBusy(''); }
  };
  const pr = profile.profile;

  return (
    <div className="step">
      <h2>① 你的个人资料</h2>
      <p className="muted">资料只需填一次，以后结合岗位挑选有价值的经历，并兼顾职业与组织背景。请写清实际做过什么、用了什么方法；有真实成果再填写数字。</p>
      {hasProfile && (
        <div className="card profile-summary">
          <div className="row">
            <PhotoPicker />
            <div className="grow">
              <div className="big-name">{lt(pr.name, 'zh') || '（未填写姓名）'} <span className="muted">{pr.name.en && pr.name.en !== pr.name.zh ? pr.name.en : ''}</span></div>
              <div className="muted">{lt(pr.headline, 'zh')} · {[pr.contacts.phone, pr.contacts.email].filter(Boolean).join(' · ')}</div>
              <div className="chips">
                <span className="chip">工作 {profile.work.length}</span><span className="chip">项目 {profile.projects.length}</span><span className="chip">教育 {profile.education.length}</span>
                <span className="chip">技能 {profile.skills.length}</span><span className="chip">证书/获奖 {profile.certificates.length + profile.awards.length}</span>
              </div>
            </div>
          </div>
          {profile.work.slice(0, 4).map((w) => <div key={w.id} className="small">💼 {lt(w.company, 'zh')} · {lt(w.title, 'zh')}（{w.bullets.length} 条经历）</div>)}
          {missing > 0 && <div className="notice warn">有 {missing} 处缺少英文/中文版本。<button disabled={!!busy || settings.demoMode} onClick={fixTranslate}>一键自动翻译</button></div>}
          {machine > 0 && <div className="muted small">ℹ {machine} 处是机器翻译，建议在「详细编辑」里扫一眼。</div>}
          <div className="row">
            <button onClick={() => go('profile')}>✏️ 详细编辑资料</button>
            {!adding && <button onClick={() => setAdding(true)}>➕ 粘贴更多经历</button>}
            <span className="spacer" />
            <button className="primary big" onClick={next}>资料没问题，下一步 →</button>
          </div>
        </div>
      )}
      {adding && (
        <div className="card">
          <h3>{hasProfile ? '粘贴补充的经历' : '最快的方式：把你现有的简历文字粘贴进来'}</h3>
          <p className="muted small">可以是旧简历、LinkedIn 简介、随手写的经历——中文或英文都行。AI 只整理你写的内容，不会编造；整理后会自动生成另一种语言。</p>
          <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'例如：\n张三，138xxxx，zhangsan@xx.com\n2021.07-至今 某某科技 高级前端工程师\n- 主导编辑器重构，首屏加载降低 40%\n...\n2014-2018 某某大学 计算机 本科'} />
          <div className="row">
            <label className="filebtn">📄 上传旧简历（PDF / Word / 图片 / txt）<input data-testid="resume-file" type="file" accept=".pdf,.docx,.doc,.txt,.md,text/plain,application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} /></label>
            <span className="spacer" />
            {!hasProfile && <button onClick={() => setProfile(normalizeProfile(sample))}>先看看示例</button>}
            {!hasProfile && <button onClick={() => go('profile')}>我想手动逐项填写</button>}
            <button className="primary big" disabled={!text.trim() || !!busy} onClick={importText}>✨ AI 帮我整理</button>
          </div>
        </div>
      )}
      {prog && <ProgressNote msg={prog.m} pct={prog.p} />}
      {busy && <div className="notice"><span className="spinner" /> {busy}</div>}
      {msg && <div className={`notice ${msg.t}`}>{msg.m}</div>}
    </div>
  );
}

function PhotoPicker() {
  const { profile, setProfile } = useApp();
  const [src, setSrc] = useState('');
  return (
    <>
      <label className="photo-pick" title="点击上传证件照（仅用于中文版，保存在本机）">
        {profile.profile.photo ? <img src={profile.profile.photo} style={{ aspectRatio: String(profile.profile.photoAspect ?? 0.75) }} /> : <span>＋<br />照片</span>}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setSrc(await fileToDataUrl(f)); e.target.value = ''; }} />
      </label>
      {src && <PhotoCropper src={src} onCancel={() => setSrc('')} onDone={(url, aspect) => { const p = structuredClone(profile); p.profile.photo = url; p.profile.photoAspect = aspect; setProfile(p); setSrc(''); }} />}
    </>
  );
}

function Step2({ next, back }: { next: () => void; back: () => void }) {
  const { settings, job, setJob, resume, setResume } = useApp();
  // v1.10：每张截图单独保存识别原文，删除某张时可以重建文字；岗位正文 = 去掉网页噪声后的识别文字（可修改）
  const [shots, setShots] = useState<{ url: string; raw: string }[]>(() => (job?.screenshots ?? []).map((url) => ({ url, raw: '' })));
  const [text, setText] = useState(() => { const pre = uiStorage.getItem(JD_PREFILL_KEY); if (pre) { uiStorage.setItem(JD_PREFILL_KEY, ''); return pre; } return job?.rawText ?? ''; });
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState('');
  const [pct, setPct] = useState<number | undefined>();
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const imgs = shots.map((x) => x.url);
  const rawAll = shots.map((x) => x.raw).filter(Boolean).join('\n');
  const removedNoise = rawAll ? extractJdBody(rawAll).removed : [];
  const stale = !!job && !!text.trim() && isAnalysisStale(job, text);
  const hasResult = !!resume && !!job && resume.jobId === job.id;

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const urls = await Promise.all(list.map(fileToDataUrl));
    setErr(''); setInfo('');
    let cur = [...shots];
    for (let i = 0; i < urls.length; i++) {
      const at = cur.length; // 按位置对应（两张相同图片也各自保存识别结果）
      cur = [...cur, { url: urls[i], raw: '' }]; setShots(cur);
      try {
        const r = await recognizeScreenshot(settings, urls[i], (m, p) => { setBusy(`第 ${i + 1}/${urls.length} 张：${m}`); setPct(p === undefined ? undefined : (i + p) / urls.length); });
        cur = cur.map((x, k) => (k === at ? { ...x, raw: r.text } : x)); setShots(cur);
        const body = extractJdBody(cur.map((x) => x.raw).filter(Boolean).join('\n')).text;
        setText((t) => (edited && t.trim() ? `${t}\n${extractJdBody(r.text).text}`.trim() : body));
      } catch (e) { setErr(`截图识别失败：${(e as Error).message}。你也可以直接把岗位文字粘贴到下面。`); }
    }
    setBusy(''); setPct(undefined);
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { const fs = [...(e.clipboardData?.files ?? [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  /** 清空本次岗位：只清当前文字 / 分析 / 生成结果；资料母库与历史投递记录不动 */
  const clearJob = (askFirst = true) => {
    if (askFirst && hasResult && !confirm('清空本次岗位会同时清除当前生成的简历（历史投递记录和个人资料不受影响）。继续吗？')) return false;
    setShots([]); setText(''); setEdited(false); setInfo(''); setErr('');
    if (job) setJob(null);
    if (resume) setResume(null);
    return true;
  };
  const removeShot = (i: number) => {
    if (shots.length === 1) { clearJob(); return; }
    const rest = shots.filter((_, k) => k !== i);
    setShots(rest);
    // 剩余截图重建正文（用户手动改过的文字保留，但分析会因文字变化被标为过期）
    if (!edited) setText(extractJdBody(rest.map((x) => x.raw).filter(Boolean).join('\n')).text);
    setInfo('已删除一张截图：岗位文字已按剩余截图更新，之前的分析结果需要重新分析后才会使用。');
  };

  const analyze = async (force = false) => {
    setErr(''); setInfo('');
    if (force && hasResult && !confirm('重新分析会生成新的岗位分析，当前生成的简历需要重新生成（旧简历仍保存在历史记录里）。继续吗？')) return;
    if (!force && stale && hasResult && !confirm('岗位文字已修改，重新分析后需要重新生成简历（旧简历仍保存在历史记录里）。继续吗？')) return;
    setBusy('AI 正在读懂这个岗位…');
    try {
      const history = await db.jobs.toArray().catch(() => [] as NonNullable<typeof job>[]);
      const r = await analyzeJob(settings, text, { current: job, history, force });
      if (r.reused === 'current') { setInfo('岗位文字没有变化，沿用已有分析结果（没有重新调用 AI）。需要时可点「重新分析」。'); return; }
      const j = { ...r.job, screenshots: imgs, ocrRawText: rawAll || undefined };
      setJob(j);
      if (resume && resume.jobId !== j.id) setResume(null);
      if (r.reused === 'history') setInfo('这份岗位文字之前分析过，已复用当时的分析结果（没有重新调用 AI）。');
      if (r.aiError) setErr(`AI 解析失败（${r.aiError}），已用简单规则解析，请核对。`);
    } finally { setBusy(''); }
  };
  const edit = (fn: (j: NonNullable<typeof job>) => void) => { if (!job) return; const n = structuredClone(job); fn(n); setJob(n); };

  return (
    <div className="step">
      <h2>② 你想投哪个岗位？</h2>
      <p className="muted">把招聘页面截图拖进来（或 Ctrl+V 粘贴截图），也可以直接粘贴岗位文字。可以放多张截图。</p>
      <div className="grid2 top">
        <div className="card">
          <div className={`dropzone ${busy ? 'busy' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            {shots.length ? <div className="thumbs">{shots.map((x, i) => (
              <div key={i} className="thumb" data-testid="jd-thumb">
                <img src={x.url} />
                <button type="button" className="thumb-del" title="删除这张截图" aria-label="删除这张截图" data-testid="thumb-del" onClick={(e) => { e.stopPropagation(); removeShot(i); }}>×</button>
              </div>))}</div> : <><div className="dz-icon">🖼️</div><b>点击选择 / 拖入 / 粘贴 岗位截图</b><div className="muted small">支持 png、jpg、webp</div></>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <label>岗位文字（已自动去掉「共有 N 个职位」等网页噪声，可修改，或直接粘贴）<textarea data-testid="jd-text" rows={10} value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} placeholder="岗位名称、公司、职责、任职要求……" /></label>
          {rawAll && <details className="small" data-testid="ocr-raw"><summary>查看截图识别原文{removedNoise.length ? `（已去掉 ${removedNoise.length} 行网页噪声）` : ''}</summary><pre className="src-pre">{rawAll}</pre>{removedNoise.length > 0 && <div className="muted">去掉的行：{removedNoise.join(' / ')}</div>}<button className="link" onClick={() => { setText(rawAll); setEdited(true); }}>改用完整识别原文</button></details>}
          <div className="row"><button className="link" onClick={() => { setText(SAMPLE_JD); setEdited(true); }}>用一个示例岗位试试</button>
            {(text || shots.length > 0 || job) && <button className="link" data-testid="clear-job" onClick={() => clearJob()}>清空本次岗位</button>}
            <span className="spacer" />
            {job && !stale && <button disabled={!text.trim() || !!busy} data-testid="reanalyze" onClick={() => analyze(true)}>↻ 重新分析</button>}
            <button className="primary big" data-testid="analyze" disabled={!text.trim() || !!busy} onClick={() => analyze(false)}>🔍 分析岗位</button></div>
          {stale && <div className="notice warn" data-testid="stale-warn">岗位文字已修改，右侧的分析结果可能已过期。点「分析岗位」按新文字重新分析。</div>}
          {info && <div className="notice ok" data-testid="analyze-info">{info}</div>}
          {busy && <ProgressNote msg={busy} pct={pct} />}
          {err && <div className="notice error">{err}</div>}
        </div>
        <div className="card">
          {!job ? <div className="empty">分析结果会显示在这里：公司、岗位、关键要求。</div> : (
            <>
              <h3>{job.title.zh || job.title.en || '岗位'} <span className="muted small">{job.title.en}</span>{stale && <span className="badge st-stale">可能过期</span>}</h3>
              <div className="grid2">
                <label>公司简称<input value={job.company.short} placeholder="没识别到，请填写" onChange={(e) => edit((j) => { j.company.short = e.target.value; })} /></label>
                <label>岗位缩写（用于文件名）<input value={job.roleAbbr} placeholder="如 FE / PM / DA" onChange={(e) => edit((j) => { j.roleAbbr = e.target.value; })} /></label>
              </div>
              {job.yearsRequired != null && <div className="small">经验要求：{job.yearsRequired} 年以上</div>}
              {(job.responsibilities?.length ?? 0) > 0 && <><div className="small"><b>岗位职责：</b></div><div className="chips">{job.responsibilities!.map((k, i) => <span key={i} className="chip">{k.zh || k.en}</span>)}</div></>}
              <div className="small"><b>必备：</b></div>
              <div className="chips">{job.mustHave.map((k, i) => <span key={i} className="chip must">{k.zh || k.en}</span>)}</div>
              <div className="small"><b>加分（JD 明确写出的）：</b>{job.niceToHave.length ? '' : <span className="muted">JD 没有明确列出加分项</span>}</div>
              {job.niceToHave.length > 0 && <div className="chips">{job.niceToHave.map((k, i) => <span key={i} className="chip">{k.zh || k.en}</span>)}</div>}
              <div className="small"><b>关键词（中 / 英）：</b></div>
              <div className="chips">{job.keywords.map((k, i) => <span key={i} className="chip kw">{k.zh}{k.en && k.en !== k.zh ? ` / ${k.en}` : ''}</span>)}</div>
            </>
          )}
        </div>
      </div>
      <div className="row nav-row"><button onClick={back}>← 上一步</button><span className="spacer" /><button className="primary big" disabled={!job || stale} title={stale ? '岗位文字已修改，请先重新分析' : ''} onClick={next}>生成简历 →</button></div>
    </div>
  );
}

function Step3({ next, back, go }: { next: () => void; back: () => void; go: (p: string) => void }) {
  const { settings, profile, job, resume, setResume, template, templateId, setTemplateId, templates, canUndo, undo } = useApp();
  useEffect(() => {
    if (!FEATURES.undo) return;
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !/INPUT|TEXTAREA/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); undo(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const moved = (['zh', 'en'] as Lang[]).flatMap((l) => buildLayout(profile, template, l, resume).movedFromSide.map((m) => ({ l, m })));
  const editTpl = useEditTemplate();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [view, setView] = useState<'zh' | 'en' | 'both'>('zh');
  const [showItems, setShowItems] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [pages, setPages] = useState<PageInfo | null | 'error'>(null);
  const started = useRef(false);
  const primary: Lang = job?.jdLanguage ?? 'zh';

  const run = async () => {
    if (!job) return;
    setErr('');
    try { const r = await generateResume(settings, profile, job, primary, template.page.targetPages, setBusy, { template, measure: (r) => measurePages(profile, { ...template, page: { ...template.page, autoFit: false } }, r) }); setResume({ ...r, templateId }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  useEffect(() => { if (!started.current && job && (!resume || resume.jobId !== job.id)) { started.current = true; run(); } });
  // 实时统计 PDF 页数（Worker 中渲染，防抖）
  useEffect(() => {
    if (!resume) return;
    let alive = true;
    const t = setTimeout(() => measurePages(profile, template, resume).then((p) => alive && setPages(p ?? 'error')), 700);
    return () => { alive = false; clearTimeout(t); };
  }, [profile, template, resume]);

  const resync = async () => {
    if (!resume) return;
    const ids = resume.items.filter((i) => i.syncStatus !== 'in-sync').map((i) => i.sourceId);
    if (settings.demoMode) { setResume(runConsistency({ ...resume, items: resume.items.map((i) => ({ ...i, syncStatus: 'in-sync' })) })); return; }
    setBusy('重新翻译修改过的条目…');
    try { setResume(await localizeAi(settings, profile, job, resume, ids)); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const pending = resume?.items.filter((i) => i.syncStatus !== 'in-sync').length ?? 0;
  const photoPos = template.locales.zh.photo.enabled ? template.locales.zh.photo.position : 'none';
  const baseOf = (id: string) => ALL_TEMPLATES.find((b) => id === b.id || id.startsWith(b.id + '-custom'))?.id;
  const pageText = (l: Lang) => pages === 'error' ? '—' : pages ? `${pages[l].pages} 页${pages[l].level ? '（已自动缩排）' : ''}${pages[l].overflow ? ' ⚠ 超出目标页数' : ''}` : '计算中…';

  return (
    <div className="step">
      <h2>③ 生成并预览</h2>
      <AiDisclosure />
      {busy && <div className="notice"><span className="spinner" /> {busy}</div>}
      {err && <div className="notice error">{err}</div>}
      {resume && (
        <div className="card result-bar">
          <div className="score" style={{ ['--p' as string]: resume.matchScore }}>{resume.matchScore}<small>匹配度</small></div>
          <div className="grow">
            <div>{resume.gaps.length ? <>岗位要求里这些你的资料没体现：{resume.gaps.map((g) => <span key={g} className="chip gap">{g}</span>)}</> : '岗位要求都能在你的资料中找到对应经历 👍'}</div>
            <div className={`small ${resume.consistency.issues.length ? 'err-text' : 'ok-text'}`}>
              {resume.consistency.issues.length ? `⚠ 中英文有 ${resume.consistency.issues.length} 处数字/内容对不上，请在「逐条修改」里检查（标红行）` : '✓ 中英文两版条目和数字完全一致'}
            </div>
            <div className="muted small" data-testid="score-note">「匹配度」是本工具按你的资料覆盖岗位要求估算的参考分，和下方「关键词覆盖率（ATS）」算法不同，也都不是招聘方的官方评分。</div>
            <div className="muted small">固定简介直接复用；AI 综合岗位与完整背景选材和表达。请用「事实审查」核对每条内容的真实来源。</div>
            <AuditBadge onOpen={() => setShowAudit(true)} />
          </div>
          <button disabled={!!busy} onClick={run}>🔄 重新生成</button>
        </div>
      )}
      {moved.length > 0 && <div className="notice warn" data-testid="side-warn">⚠ 侧栏放不下，已把「{[...new Set(moved.map((x) => template.locales.zh.sectionTitles?.[x.m] ?? x.m))].join('、')}」移到主栏末尾显示（{[...new Set(moved.map((x) => x.l === 'zh' ? '中文版' : '英文版'))].join('、')}），内容没有被截断。想放回侧栏可以在左侧清单减少条目，或换单栏样式。</div>}
      {resume && showAudit && <FactAudit onClose={() => setShowAudit(false)} />}
      {pending > 0 && <div className="notice warn">你改了 {pending} 条，另一种语言还没同步。<button onClick={resync}>同步翻译</button></div>}

      <div className="card quick-layout">
        <div className="row">
          <b>样式</b>
          {ALL_TEMPLATES.map((t) => <button key={t.id} className={baseOf(templateId) === t.id ? 'active' : ''} onClick={() => setTemplateId(templates.find((x) => !x.builtin && x.id.startsWith(t.id + '-custom'))?.id ?? t.id)}>{t.name.zh}</button>)}
          <span className="sep" />
          <b>照片</b>
          {(['left', 'right', 'none'] as PhotoPosition[]).map((p) => <button key={p} className={photoPos === p ? 'active' : ''} onClick={() => editTpl((x) => { x.locales.zh.photo.position = p; x.locales.zh.photo.enabled = p !== 'none'; })}>{p === 'left' ? '左上' : p === 'right' ? '右上' : '不放'}</button>)}
          <span className="sep" />
          <b>篇幅</b>
          {[1, 2].map((n) => <button key={n} className={template.page.targetPages === n ? 'active' : ''} onClick={() => editTpl((x) => { x.page.targetPages = n; })}>{n} 页内</button>)}
          <span className="sep" />
          <b>配色</b>
          {COLORS.map(([a, b]) => <button key={a} className={`swatch ${template.colors.primary === a ? 'active' : ''}`} style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }} onClick={() => editTpl((x) => { x.colors.primary = a; x.colors.accent = b; })} />)}
          <span className="spacer" />
          {FEATURES.undo && <button disabled={!canUndo} title="Ctrl+Z" onClick={undo}>↶ 撤销</button>}
          <button className="link" onClick={() => go('layout')}>更多版式设置 →</button>
        </div>
        <div className="row">
          {(['zh', 'en', 'both'] as const).map((v) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v === 'zh' ? '中文版' : v === 'en' ? 'English' : '中英对照'}</button>)}
          <span className="muted small">中文版 {pageText('zh')} · 英文版 {pageText('en')}</span>
        </div>
        {pages && pages !== 'error' && (pages.zh.overflow || pages.en.overflow) && <div className="notice warn small" data-testid="overflow-tip">超出目标页数：建议在左侧清单取消勾选和岗位关系最弱的条目（如与岗位无关的项目、奖项或证书），或改为「2 页内」。本工具不会为了塞进页面而把字号缩到难以阅读。</div>}
        <div className="pool-layout">
          {resume && <MaterialPool />}
          <div className="previews">
            {(view === 'both' ? (['zh', 'en'] as Lang[]) : [view]).map((l) => <Preview key={l} m={buildLayout(profile, template, l, resume)} scale={view === 'both' ? 0.46 : 0.72} />)}
          </div>
        </div>
      </div>
      <MatchInsights go={go} />
      {resume && (
        <div className="card">
          <button className="link big-link" onClick={() => setShowItems(!showItems)}>{showItems ? '▾' : '▸'} 想改某句话？逐条修改内容（{resume.items.length} 条）</button>
          {showItems && <ItemsEditor />}
        </div>
      )}
      <div className="row nav-row"><button onClick={back}>← 换个岗位</button><span className="spacer" /><button className="primary big" disabled={!resume || !!busy} onClick={next}>满意了，去下载 →</button></div>
    </div>
  );
}

function Step4({ back, restart }: { back: () => void; restart: () => void }) {
  return (
    <div className="step">
      <h2>④ 下载你的简历</h2>
      <p className="muted">会下载一个压缩包，里面有：中文 PDF、中文 Word、英文 PDF、英文 Word。</p>
      <div className="card narrow-card"><ExportPanel inline /></div>
      <CareerKit />
      <div className="row nav-row"><button onClick={back}>← 返回预览</button><span className="spacer" /><button onClick={restart}>投递下一个岗位 →</button></div>
    </div>
  );
}
