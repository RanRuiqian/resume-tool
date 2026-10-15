import { useState } from 'react';
import { useApp } from '../store';
import { useL } from '../i18n';
import { FEATURES } from '../features';
import { generateCoverKit, generatePrep } from '../ai/extras';
import type { Bi, Lang, ResumeDoc } from '../types';

/** 求职信 / 自我介绍 / 面试准备（均基于当前简历事实，可编辑，可附带进 zip） */
export function CareerKit() {
  const { settings, profile, job, resume, setResume } = useApp();
  const L = useL();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [lang, setLang] = useState<Lang>('zh');
  if (!resume || !job || (!FEATURES.coverLetter && !FEATURES.prepDirections)) return null;
  const ex = resume.extras ?? {};
  const save = (fn: (e: NonNullable<ResumeDoc['extras']>) => void) => { const n = structuredClone(resume); n.extras = n.extras ?? {}; fn(n.extras); setResume(n); };
  const go = async (kind: 'cover' | 'interview') => {
    if (settings.demoMode) { setErr(L('演示模式不调用 AI，请先在「设置」连接 AI 服务。', 'Demo mode does not call AI. Connect an AI provider in Settings first.')); return; }
    setErr(''); setBusy(kind === 'cover' ? L('AI 正在写求职信和自我介绍…', 'Writing cover letter & self-intro…') : L('AI 正在根据岗位要求整理备考方向…', 'Deriving preparation areas from the job post…'));
    try {
      if (kind === 'cover') { const k = await generateCoverKit(settings, profile, job, resume); save((e) => { e.coverLetter = k.coverLetter; e.selfIntro = k.selfIntro; }); }
      else { const q = await generatePrep(settings, job); if (!q.length) throw new Error(L('没有得到能对应到岗位原文的方向，请检查岗位文字是否完整', 'No directions could be tied to the job text; check the job description')); save((e) => { e.prep = q; }); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const area = (title: string, v: Bi | undefined, set: (t: string) => void, rows = 8) => v && (
    <label className="kit-field">{title}<textarea rows={rows} value={v[lang]} onChange={(e) => set(e.target.value)} /></label>
  );
  return (
    <div className="card career-kit">
      <div className="row">
        <h3 className="grow">{L('📨 求职信 · 自我介绍 · 备考方向', '📨 Cover letter · Self-intro · What to prepare')}</h3>
        {(['zh', 'en'] as Lang[]).map((l) => <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{l === 'zh' ? '中文' : 'English'}</button>)}
      </div>
      <p className="muted small">{L('只使用这份简历里的事实撰写；生成后可直接修改。下载时可勾选一起打包进 zip（Word 格式）。', 'Written only from facts in this resume; edit freely. You can include them in the zip (Word) when downloading.')}</p>
      <div className="row">
        {FEATURES.coverLetter && <button disabled={!!busy} onClick={() => go('cover')}>{ex.coverLetter ? '🔄 ' : '✨ '}{L('求职信 + 1 分钟自我介绍', 'Cover letter + 1-min intro')}</button>}
        {FEATURES.prepDirections && <button disabled={!!busy} onClick={() => go('interview')}>{ex.prep ? '🔄 ' : '✨ '}{L('备考大方向', 'What to prepare')}</button>}
      </div>
      {busy && <div className="notice"><span className="spinner" /> {busy}</div>}
      {err && <div className="notice error">{err}</div>}
      {area(L('求职信', 'Cover letter'), ex.coverLetter, (t) => save((e) => { e.coverLetter![lang] = t; }), 10)}
      {area(L('1 分钟自我介绍', '1-minute self-introduction'), ex.selfIntro, (t) => save((e) => { e.selfIntro![lang] = t; }), 6)}
      {ex.prep && ex.prep.length > 0 && (
        <div className="interview prep">
          <b>{L('备考大方向（每条均来自岗位原文）', 'What to prepare (each tied to the job post)')}</b>
          {ex.prep.map((it, i) => <div key={i} className="prep-item"><div><b>{i + 1}. {it.area[lang] || it.area.zh || it.area.en}</b></div><div className="small">{it.why[lang] || it.why.zh || it.why.en}</div><blockquote className="small muted">{L('岗位原文：', 'From the JD: ')}“{it.source}”</blockquote></div>)}
        </div>
      )}
    </div>
  );
}
