import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { useL } from '../i18n';
import { FEATURES } from '../features';
import { enWords, generateCoverKit, generatePrep, zhLen, type KitQuality } from '../ai/extras';
import { kitExportState, makeKitReview, type SentenceTrace } from '../quality/kitVerify';
import type { Bi, Lang, ResumeDoc } from '../types';

const KIND: Record<SentenceTrace['kind'], string> = { closing: '称呼 / 结尾', self: '自述', reflection: '概括前文', motivation: '动机', jd: '岗位 / 公司描述（对照 JD）', learning: '学习意愿', future: '未来计划 / 兴趣', other: '其他陈述' };
function TraceTable({ trace, lang }: { trace: SentenceTrace[]; lang: Lang }) {
  const rows = trace.filter((t) => t.lang === lang);
  return (
    <table className="kit-trace small" data-testid="kit-trace">
      <tbody>
        {rows.map((t, i) => <tr key={i} className={t.ok ? '' : 'bad'}><td>{t.ok ? '✓' : '✗'}</td><td>{t.field === 'coverLetter' ? '求职信' : '自我介绍'} · {KIND[t.kind]}</td><td>{t.text}</td><td>{t.ok ? (t.factIds.length ? `依据：${t.factIds.join('、')}` : '') : t.reasons.join('；')}</td></tr>)}
      </tbody>
    </table>
  );
}

/** 求职信 / 自我介绍 / 备考方向。求职信和自我介绍逐句核对：每句自述都要能对应到资料条目，未通过不保存、不默认导出 */
export function CareerKit() {
  const { settings, profile, job, resume, setResume } = useApp();
  const L = useL();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [lang, setLang] = useState<Lang>('zh');
  const [quality, setQuality] = useState<KitQuality | null>(null);
  const [pending, setPending] = useState<{ coverLetter: Bi; selfIntro: Bi; quality: KitQuality } | null>(null);
  const ex = resume?.extras ?? {};
  const state = useMemo(() => kitExportState(profile, job, resume?.extras, resume), [profile, job, resume]);
  if (!resume || !job || (!FEATURES.coverLetter && !FEATURES.prepDirections)) return null;
  const save = (fn: (e: NonNullable<ResumeDoc['extras']>) => void) => { const n = structuredClone(resume); n.extras = n.extras ?? {}; fn(n.extras); setResume(n); };
  const adopt = (k: { coverLetter: Bi; selfIntro: Bi }) => save((e) => { e.coverLetter = k.coverLetter; e.selfIntro = k.selfIntro; delete e.kitReview; });
  const go = async (kind: 'cover' | 'interview') => {
    if (settings.demoMode) { setErr(L('演示模式不调用 AI，请先在「设置」连接 AI 服务。', 'Demo mode does not call AI. Connect an AI provider in Settings first.')); return; }
    setErr(''); setPending(null); setBusy(kind === 'cover' ? L('AI 正在写求职信和自我介绍，并逐句核对…', 'Writing cover letter & self-intro, checking each sentence…') : L('AI 正在根据岗位要求整理备考方向…', 'Deriving preparation areas from the job post…'));
    try {
      if (kind === 'cover' && (ex.coverLetter || ex.selfIntro) && !confirm(L('新版本逐句核对通过后，会替换当前的求职信和自我介绍（包括你手动修改的内容）；未通过则不替换。继续吗？', 'If the new draft passes the sentence check it replaces the current text, including your edits; otherwise nothing is replaced. Continue?'))) { setBusy(''); return; }
      if (kind === 'cover') {
        const k = await generateCoverKit(settings, profile, job, resume); setQuality(k.quality);
        if (k.quality.status === 'verified') adopt(k); else setPending(k);
      } else { const q = await generatePrep(settings, job); if (!q.length) throw new Error(L('没有得到能对应到岗位原文的方向，请检查岗位文字是否完整', 'No directions could be tied to the job text; check the job description')); save((e) => { e.prep = q; }); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const area = (title: string, v: Bi | undefined, set: (t: string) => void, rows = 8) => v && (
    <label className="kit-field">{title}<textarea rows={rows} value={v[lang]} onChange={(e) => set(e.target.value)} /></label>
  );
  const bad = state.verdict.trace.filter((t) => !t.ok);
  return (
    <div className="card career-kit">
      <div className="row">
        <h3 className="grow">{L('📨 求职信 · 自我介绍 · 备考方向', '📨 Cover letter · Self-intro · What to prepare')}</h3>
        {(['zh', 'en'] as Lang[]).map((l) => <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{l === 'zh' ? '中文' : 'English'}</button>)}
      </div>
      <p className="muted small">{L('「我做过 / 会 / 有」只取自你的资料；岗位要求只用于动机和学习方向。生成后逐句核对，每句自述都要能对应到资料条目才会保存。这是规则核对，不能保证 100% 真实，投递前请自己通读。', 'Self-claims come only from your profile; the job post is used only for motivation and learning goals. Each sentence is checked against your profile before saving. This is a rule-based check, not a guarantee — read it yourself before sending.')}</p>
      <div className="row">
        {FEATURES.coverLetter && <button disabled={!!busy} onClick={() => go('cover')}>{ex.coverLetter ? '🔄 ' : '✨ '}{L('求职信 + 1 分钟自我介绍', 'Cover letter + 1-min intro')}</button>}
        {FEATURES.prepDirections && <button disabled={!!busy} onClick={() => go('interview')}>{ex.prep ? '🔄 ' : '✨ '}{L('备考大方向', 'What to prepare')}</button>}
      </div>
      {busy && <div className="notice"><span className="spinner" /> {busy}</div>}
      {err && <div className="notice error">{err}</div>}
      {pending && (
        <div className="notice error" data-testid="kit-blocked">
          <b>{L('事实检查未通过，需人工核对', 'Fact check failed — needs manual review')}</b>
          <div className="small">{L(`AI 生成了 ${pending.quality.attempts} 次，仍有以下句子无法对应到你的资料。新内容没有保存${ex.coverLetter || ex.selfIntro ? '，原来的求职信 / 自我介绍保持不变' : ''}。`, `Generated ${pending.quality.attempts} time(s); these sentences still cannot be traced to your profile. Nothing was saved.`)}</div>
          <ul className="small" data-testid="kit-blocked-reasons">{pending.quality.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <details><summary className="small">{L('查看这次的草稿与逐句核对', 'View this draft and the per-sentence check')}</summary><TraceTable trace={pending.quality.trace} lang={lang} /></details>
          <div className="row">
            {pending.quality.safe && <button data-testid="kit-use-safe" onClick={() => { adopt(pending.quality.safe!); setPending(null); }}>{L('采用精简版（只保留已核实的句子）', 'Use the trimmed version (verified sentences only)')}</button>}
            <button data-testid="kit-discard" onClick={() => setPending(null)}>{L('放弃这次生成', 'Discard this draft')}</button>
          </div>
        </div>
      )}
      {area(L('求职信', 'Cover letter'), ex.coverLetter, (t) => save((e) => { e.coverLetter![lang] = t; }), 10)}
      {area(L('1 分钟自我介绍', '1-minute self-introduction'), ex.selfIntro, (t) => save((e) => { e.selfIntro![lang] = t; }), 6)}
      {ex.selfIntro?.[lang] && <div className="muted small" data-testid="intro-len">{lang === 'zh' ? `自我介绍 ${zhLen(ex.selfIntro.zh)} 字（建议 180–220 字，约 1 分钟）` : `Intro: ${enWords(ex.selfIntro.en)} words (aim for 100–130, about 1 minute)`}</div>}
      {state.hasText && (state.verdict.passed
        ? <div className="notice ok small" data-testid="kit-status">✓ {L(`逐句核对通过：${state.verdict.trace.filter((t) => t.kind === 'self').length} 句自述都能对应到资料条目`, 'Every self-claim maps to a profile entry')}</div>
        : <div className="notice warn small" data-testid="kit-status">
            ⚠ {L(`当前文本有 ${bad.length} 句无法对应到资料（可能是手动修改或旧版本生成）。`, `${bad.length} sentence(s) cannot be traced to your profile.`)}
            {state.overridden ? L('你已人工核对并允许导出。', ' You reviewed it and allowed export.') : L('导出 Word 时默认不包含求职信 / 自我介绍。', ' The cover letter / intro are left out of the Word export by default.')}
            <ul>{bad.map((t, i) => <li key={i}>{t.field === 'coverLetter' ? '求职信' : '自我介绍'}（{t.lang === 'zh' ? '中文' : '英文'}）「{t.text}」：{t.reasons.join('；')}</li>)}</ul>
            {!state.overridden && <button data-testid="kit-override" onClick={() => save((e) => { e.kitReview = makeKitReview(profile, job, resume, e, bad.length); })}>{L('我已逐句人工核对，允许导出', 'I reviewed each sentence; allow export')}</button>}
          </div>)}
      {state.hasText && <details className="small"><summary>{L('查看逐句核对', 'Per-sentence check')}</summary><TraceTable trace={state.verdict.trace} lang={lang} /></details>}
      {quality && quality.warnings.length > 0 && <div className="notice warn small" data-testid="kit-quality">{L('格式提示：', 'Style: ')}{quality.warnings.map((x, i) => <div key={i}>· {x}</div>)}</div>}
      {ex.prep && ex.prep.length > 0 && (
        <div className="interview prep">
          <b>{L('备考大方向（每条均来自岗位原文；是要准备的方向，不代表你已具备）', 'What to prepare (each tied to the job post; not a claim that you have it)')}</b>
          {ex.prep.map((it, i) => <div key={i} className="prep-item"><div><b>{i + 1}. {it.area[lang] || it.area.zh || it.area.en}</b></div><div className="small">{it.why[lang] || it.why.zh || it.why.en}</div><blockquote className="small muted">{L('岗位原文：', 'From the JD: ')}“{it.source}”</blockquote></div>)}
        </div>
      )}
    </div>
  );
}
