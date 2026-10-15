import { useState } from 'react';
import { useApp } from '../store';
import { useT } from '../i18n';
import type { Bi, JobParse } from '../types';
import { ocrImage, parseJdAi, parseJdRules } from '../ai/jd';
import { SAMPLE_JD } from '../sample/sampleJd';
import { fileToDataUrl } from '../utils/download';

const biToText = (a: Bi[]) => a.map((k) => `${k.zh} = ${k.en}`).join('\n');
const textToBi = (s: string): Bi[] => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [zh, en] = l.split(/\s*=\s*/); return { zh: zh ?? '', en: en ?? zh ?? '' }; });

export function JobPage({ go }: { go: (p: string) => void }) {
  const { settings, job, setJob } = useApp();
  const t = useT();
  const [text, setText] = useState(job?.rawText ?? '');
  const [img, setImg] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const doOcr = async () => {
    setErr('');
    if (settings.demoMode) { setErr('演示模式无法识别截图（需要多模态模型）。请到「设置」填写 API Key，或直接粘贴 JD 文本 / 使用示例 JD。'); return; }
    setBusy('正在识别截图文字…');
    try { setText(await ocrImage(settings, img)); } catch (e) { setErr(`识别失败：${(e as Error).message}。可改用粘贴文本。`); } finally { setBusy(''); }
  };
  const doParse = async () => {
    setErr(''); setBusy('正在解析岗位…');
    try {
      setJob(settings.demoMode ? parseJdRules(text) : await parseJdAi(settings, text));
    } catch (e) {
      setErr(`AI 解析失败（${(e as Error).message}），已使用规则解析结果，请人工校对。`);
      setJob(parseJdRules(text));
    } finally { setBusy(''); }
  };
  const edit = (fn: (j: JobParse) => void) => { if (!job) return; const n = structuredClone(job); fn(n); setJob(n); };

  return (
    <div className="page">
      <div className="toolbar"><h2>{t('navJob')}</h2><span className="spacer" /><button onClick={() => setText(SAMPLE_JD)}>使用示例 JD</button></div>
      <div className="grid2 top">
        <div className="card">
          <h4>1. 上传招聘截图（png / jpg / webp）</h4>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImg(await fileToDataUrl(f)); }} />
          {img && <><img src={img} className="jd-img" /><button className="primary" disabled={!!busy} onClick={doOcr}>{t('ocr')}</button></>}
          <h4>2. 或粘贴 JD 文本（中 / 英均可）</h4>
          <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴岗位描述…" />
          <button className="primary" disabled={!text.trim() || !!busy} onClick={doParse}>{t('parse')}</button>
          {busy && <div className="notice">{busy}</div>}
          {err && <div className="notice error">{err}</div>}
        </div>
        <div className="card">
          <h4>3. 解析结果（可编辑）</h4>
          {!job ? <p className="muted">尚未解析。</p> : (
            <div className="form">
              <div className="grid2">
                <label>公司简称（用于文件名，不确定可留空）<input value={job.company.short} onChange={(e) => edit((j) => { j.company.short = e.target.value; })} /></label>
                <label>公司全称<input value={job.company.full} onChange={(e) => edit((j) => { j.company.full = e.target.value; })} /></label>
                <label>岗位缩写（如 FE / PM）<input value={job.roleAbbr} onChange={(e) => edit((j) => { j.roleAbbr = e.target.value; })} /></label>
                <label>JD 语言<select value={job.jdLanguage} onChange={(e) => edit((j) => { j.jdLanguage = e.target.value as 'zh' | 'en'; })}><option value="zh">中文</option><option value="en">English</option></select></label>
                <label>职位（中）<input value={job.title.zh} onChange={(e) => edit((j) => { j.title.zh = e.target.value; })} /></label>
                <label>Title (EN)<input value={job.title.en} onChange={(e) => edit((j) => { j.title.en = e.target.value; })} /></label>
                <label>年限要求<input type="number" value={job.yearsRequired ?? ''} onChange={(e) => edit((j) => { j.yearsRequired = e.target.value ? Number(e.target.value) : null; })} /></label>
              </div>
              <BiArea label="必备要求（每行：中文 = English）" value={job.mustHave} onChange={(v) => edit((j) => { j.mustHave = v; })} />
              <BiArea label="加分项" value={job.niceToHave} onChange={(v) => edit((j) => { j.niceToHave = v; })} />
              <BiArea label="关键词中英对照" value={job.keywords} onChange={(v) => edit((j) => { j.keywords = v; })} />
              <label>岗位摘要<textarea rows={2} value={job.summary} onChange={(e) => edit((j) => { j.summary = e.target.value; })} /></label>
              <button className="primary" onClick={() => go('generate')}>下一步：生成简历 →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BiArea({ label, value, onChange }: { label: string; value: Bi[]; onChange: (v: Bi[]) => void }) {
  const [draft, setDraft] = useState(biToText(value));
  return <label>{label}<textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => onChange(textToBi(draft))} /></label>;
}
