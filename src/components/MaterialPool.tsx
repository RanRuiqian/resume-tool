import { useState } from 'react';
import { useApp } from '../store';
import { sourceIdsOf } from '../ai/provenance';
import type { GenItem, LocalizedText } from '../types';
import { lt, formatRange } from '../locale/text';
import { reorderEntry, entryBullets, SEL_KEYS, toggleBullet, toggleEntry, toggleSummary, type SelKey } from '../ai/selection';
import { editResumeItem } from '../ai/editResume';
import { ENTRY_TEXT_FIELDS } from '../render/resumeEdits';
import type { Bi, ResumeEntryEdit } from '../types';

const TITLES: Record<SelKey, string> = { work: '工作经历', projects: '项目经历', education: '教育背景', skills: '技能', certificates: '证书', awards: '获奖' };

/** 素材池：资料库全部条目的勾选清单；勾选即时更新简历与预览 */
export function MaterialPool() {
  const { profile, resume, setResume } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!resume) return null;
  const itemIds = new Set(resume.items.flatMap(sourceIdsOf));

  const apply = setResume;
  const edit = (item: GenItem) => <details className="pool-edit" key={item.sourceId}>
    <summary>编辑本简历文字</summary>
    {(['zh', 'en'] as const).map((lang) => <label key={lang}>{lang === 'zh' ? '中文' : 'English'}<textarea rows={3} aria-label={`${item.sourceId} ${lang}`} value={item[lang]} onChange={(e) => setResume(editResumeItem(resume, item.sourceId, lang, e.target.value))} /></label>)}
    {item.syncStatus !== 'in-sync' && <span className="muted small">另一语言可手动编辑，也可点击「同步翻译」。不影响下载。</span>}
  </details>;

  const entries = (k: SelKey) => (profile[k] as unknown as ({ id: string; enabled: boolean } & Record<string, unknown>)[]).filter((e) => e.enabled !== false);
  const titleOf = (k: SelKey, e: Record<string, unknown>) => {
    const L = (f: string) => lt(e[f] as LocalizedText, 'zh');
    if (k === 'work') return [L('company'), L('title')];
    if (k === 'projects') return [L('name'), L('role')];
    if (k === 'education') return [L('school'), [L('major'), L('degree')].filter(Boolean).join(' · ')];
    if (k === 'skills') return [L('name'), L('category')];
    return [L('name'), L('issuer')];
  };
  const dateOf = (e: Record<string, unknown>) => (e.start || e.end ? formatRange(e.start as string, e.end as string, 'YYYY.MM', '至今') : (e.date as string) || '');
  const entryEdit = (e: Record<string, unknown> & { id: string }) => {
    const current = resume.entryEdits?.[e.id] ?? {};
    const save = (next: ResumeEntryEdit) => setResume({ ...resume, entryEdits: { ...resume.entryEdits, [e.id]: next } });
    return <details className="pool-edit" data-testid="resume-entry-edit"><summary>编辑本简历标题与日期</summary>
      {(Object.keys(ENTRY_TEXT_FIELDS) as (keyof typeof ENTRY_TEXT_FIELDS)[]).filter((key) => key in e).map((key) => <div key={key}>{(['zh', 'en'] as const).map((lang) => <label key={lang}>{ENTRY_TEXT_FIELDS[key]} · {lang === 'zh' ? '中文' : 'English'}<input value={current.texts?.[key]?.[lang] ?? (e[key] as Bi)?.[lang] ?? ''} onChange={(ev) => save({ ...current, texts: { ...current.texts, [key]: { ...(e[key] as Bi), ...current.texts?.[key], [lang]: ev.target.value } } })} /></label>)}</div>)}
      {(['start', 'end', 'date'] as const).filter((key) => key in e).map((key) => <label key={key}>{key === 'start' ? '开始' : key === 'end' ? '结束' : '日期'}<input value={current[key] ?? e[key] as string ?? ''} onChange={(ev) => save({ ...current, [key]: ev.target.value })} /></label>)}
      <p className="small muted">只修改本份简历。学历、日期等请按真实情况填写。</p>
    </details>;
  };

  const row = (k: SelKey, e: Record<string, unknown> & { id: string }) => {
    const on = resume.selection[k].includes(e.id);
    const bullets = entryBullets(profile, k, e.id);
    const [t1, t2] = titleOf(k, e);
    const nb = bullets.filter((b) => b.id && itemIds.has(b.id)).length;
    const expanded = open[e.id] ?? on;
    return (
      <div key={e.id} className={`pool-entry ${on ? 'on' : 'off'}`}>
        <label className="pool-head">
          <input type="checkbox" checked={on} onChange={(ev) => apply(toggleEntry(profile, resume, k, e.id, ev.target.checked))} />
          <span className="grow"><b>{t1 || '（未命名）'}</b>{t2 && <span className="muted"> · {t2}</span>}
            <span className="pool-meta">{dateOf(e)}{bullets.length > 0 && ` · 要点 ${nb}/${bullets.length}`}</span>
          </span>
        </label>
        {on && <div className="row small"><button aria-label={`上移 ${t1}`} disabled={resume.selection[k].indexOf(e.id) === 0} onClick={() => setResume(reorderEntry(resume, k, e.id, -1))}>↑</button><button aria-label={`下移 ${t1}`} disabled={resume.selection[k].indexOf(e.id) === resume.selection[k].length - 1} onClick={() => setResume(reorderEntry(resume, k, e.id, 1))}>↓</button></div>}
        {on && entryEdit(e)}
        {bullets.length > 0 && <button className="link pool-toggle" onClick={() => setOpen({ ...open, [e.id]: !expanded })}>{expanded ? '收起要点' : '展开要点'}</button>}
        {expanded && bullets.length > 0 && (
          <div className="pool-bullets">
            {bullets.filter((b) => b.id).map((b) => {
              const bon = itemIds.has(b.id!);
              const item = resume.items.find((i) => sourceIdsOf(i).includes(b.id!));
              if (item && item.sourceId !== b.id) return null;
              return (
                <div key={b.id}><label className={`pool-bullet ${bon ? 'on' : 'off'}`}>
                  <input type="checkbox" checked={bon} onChange={(ev) => apply(toggleBullet(profile, resume, k, e.id, b, ev.target.checked))} />
                  <span>{item ? item.zh || item.en : lt(b, 'zh')}{item?.sourceIds && item.sourceIds.length > 1 && <small>（合并要点，整体选择）</small>}</span>
                </label>{item && edit(item)}</div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const hasSummary = !!(profile.profile.summary.zh || profile.profile.summary.en);
  return (
    <div className="pool">
      <div className="pool-title">
        <b>📚 我的素材库</b>
        <span className="muted small">勾选 = 放进简历，右侧实时更新。AI 已综合岗位与个人背景选材，你可继续调整。勾选不调用 AI，不改母库，重新勾选保留编辑。</span>
      </div>
      {/* 2026-11：个人简介固定放在素材库最上面；资料库没有简介时直接在这里写，保存后以后每份简历都用 */}
      {!hasSummary && !itemIds.has('summary') && <SummarySetup />}
      {(hasSummary || itemIds.has('summary')) && (
        <div className="pool-sec">
          <div className="pool-sec-title">个人简介</div>
          <label className={`pool-entry pool-head ${itemIds.has('summary') ? 'on' : 'off'}`}>
            <input type="checkbox" checked={itemIds.has('summary')} onChange={(ev) => apply(toggleSummary(profile, resume, ev.target.checked))} />
            <span className="grow small" data-testid="pool-summary">{((resume.items.find((i) => i.sourceId === 'summary') ?? resume.deselectedItems?.find((i) => i.sourceId === 'summary') ?? resume.summaryBaseline)?.zh || lt(profile.profile.summary, 'zh')).slice(0, 60)}…</span>
          </label>
          {resume.items.find((i) => i.sourceId === 'summary') && edit(resume.items.find((i) => i.sourceId === 'summary')!)}
        </div>
      )}
      {SEL_KEYS.map((k) => {
        const all = entries(k);
        if (!all.length) return null;
        const chosen = resume.selection[k].flatMap((id) => all.filter((e) => e.id === id));
        const rest = all.filter((e) => !resume.selection[k].includes(e.id));
        return (
          <div key={k} className="pool-sec">
            <div className="pool-sec-title">{TITLES[k]} <span className="muted small">已选 {chosen.length}/{all.length}</span></div>
            {chosen.map((e) => row(k, e))}
            {rest.length > 0 && <div className="pool-unused">未选用（勾选即可加入）</div>}
            {rest.map((e) => row(k, e))}
          </div>
        );
      })}
    </div>
  );
}

/** 资料库还没有个人简介：在素材库顶部直接填写，保存到资料库并放进本份简历。 */
function SummarySetup() {
  const { profile, setProfile, resume, setResume } = useApp();
  const [zh, setZh] = useState(''), [en, setEn] = useState('');
  if (!resume) return null;
  const save = () => {
    const summary = { ...profile.profile.summary, zh: zh.trim(), en: en.trim(), status: { ...(profile.profile.summary.status ?? {}), ...(zh.trim() ? { zh: 'confirmed' as const } : {}), ...(en.trim() ? { en: 'confirmed' as const } : {}) } };
    const p = { ...profile, profile: { ...profile.profile, summary } };
    setProfile(p);
    setResume(toggleSummary(p, { ...resume, summaryBaseline: undefined }, true));
  };
  return <div className="pool-sec" data-testid="summary-setup">
    <div className="pool-sec-title">个人简介</div>
    <p className="muted small">资料库里还没有个人简介。在这里写一次（中英文可只写一种），会保存到「我的资料」，以后每份简历都固定使用，可随时在这里修改。</p>
    <label>中文<textarea rows={3} aria-label="个人简介中文" value={zh} onChange={(e) => setZh(e.target.value)} /></label>
    <label>English<textarea rows={3} aria-label="summary en" value={en} onChange={(e) => setEn(e.target.value)} /></label>
    <button className="primary" disabled={!zh.trim() && !en.trim()} onClick={save}>保存并放进简历</button>
  </div>;
}
