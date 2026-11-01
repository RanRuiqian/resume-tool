import { useState } from 'react';
import { useApp } from '../store';
import { sourceIdsOf } from '../ai/provenance';
import type { LocalizedText, ResumeDoc } from '../types';
import { lt, formatRange } from '../locale/text';
import { entryBullets, fillWithOriginal, matchHints, missingLang, SEL_KEYS, toggleBullet, toggleEntry, toggleSummary, type SelKey } from '../ai/selection';
import { translateTexts } from '../ai/translate';
import { runConsistency } from '../ai/generate';

const TITLES: Record<SelKey, string> = { work: '工作经历', projects: '项目经历', education: '教育背景', skills: '技能', certificates: '证书', awards: '获奖' };

/** 素材池：资料库全部条目的勾选清单；勾选即时更新简历与预览 */
export function MaterialPool() {
  const { profile, resume, setResume, job, settings } = useApp();
  const [translating, setTranslating] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!resume) return null;
  const itemIds = new Set(resume.items.flatMap(sourceIdsOf));

  /** 更新后：缺少的语言用 AI 翻译（失败或演示模式则直接用原文） */
  const apply = async (next: ResumeDoc) => {
    const miss = missingLang(next);
    if (!miss.length) { setResume(next); return; }
    const shown = fillWithOriginal(next);
    setResume(shown);
    if (settings.demoMode) return;
    setTranslating(true);
    try {
      const patch = new Map<string, string>();
      for (const to of ['zh', 'en'] as const) {
        const list = miss.filter((m) => m.to === to);
        const out = await translateTexts(settings, list.map((m) => ({ key: m.id, text: m.text })), to, profile.glossary);
        out.forEach((v, k) => patch.set(`${to}:${k}`, v));
      }
      setResume(runConsistency({ ...shown, items: shown.items.map((i) => ({ ...i, zh: patch.get(`zh:${i.sourceId}`) ?? i.zh, en: patch.get(`en:${i.sourceId}`) ?? i.en })) }));
    } catch { /* 保持原文 */ } finally { setTranslating(false); }
  };

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

  const row = (k: SelKey, e: Record<string, unknown> & { id: string }) => {
    const on = resume.selection[k].includes(e.id);
    const bullets = entryBullets(profile, k, e.id);
    const [t1, t2] = titleOf(k, e);
    const hints = matchHints(JSON.stringify(e), job);
    const nb = bullets.filter((b) => b.id && itemIds.has(b.id)).length;
    const expanded = open[e.id] ?? on;
    return (
      <div key={e.id} className={`pool-entry ${on ? 'on' : 'off'}`}>
        <label className="pool-head">
          <input type="checkbox" checked={on} onChange={(ev) => apply(toggleEntry(profile, resume, k, e.id, ev.target.checked))} />
          <span className="grow"><b>{t1 || '（未命名）'}</b>{t2 && <span className="muted"> · {t2}</span>}
            <span className="pool-meta">{dateOf(e)}{bullets.length > 0 && ` · 要点 ${nb}/${bullets.length}`}</span>
            {hints.length > 0 && <span className="pool-hints">{hints.map((h) => <span key={h} className="hint">✓ {h}</span>)}</span>}
          </span>
        </label>
        {bullets.length > 0 && <button className="link pool-toggle" onClick={() => setOpen({ ...open, [e.id]: !expanded })}>{expanded ? '收起要点' : '展开要点'}</button>}
        {expanded && bullets.length > 0 && (
          <div className="pool-bullets">
            {bullets.filter((b) => b.id).map((b) => {
              const bon = itemIds.has(b.id!);
              const bh = matchHints(lt(b, 'zh') + ' ' + lt(b, 'en'), job);
              return (
                <label key={b.id} className={`pool-bullet ${bon ? 'on' : 'off'}`}>
                  <input type="checkbox" checked={bon} onChange={(ev) => apply(toggleBullet(profile, resume, k, e.id, b, ev.target.checked))} />
                  <span>{lt(b, 'zh')}{bh.length > 0 && <span className="hint small-hint">匹配</span>}</span>
                </label>
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
        <span className="muted small">勾选 = 放进简历，右侧实时更新。AI 已综合岗位与个人背景选材，你可继续调整。</span>
        {translating && <span className="small"><span className="spinner" />正在翻译新加入的内容…</span>}
      </div>
      {hasSummary && (
        <div className="pool-sec">
          <div className="pool-sec-title">个人简介</div>
          <label className={`pool-entry pool-head ${itemIds.has('summary') ? 'on' : 'off'}`}>
            <input type="checkbox" checked={itemIds.has('summary')} onChange={(ev) => apply(toggleSummary(profile, resume, ev.target.checked))} />
            <span className="grow small">{lt(profile.profile.summary, 'zh').slice(0, 60)}…</span>
          </label>
        </div>
      )}
      {SEL_KEYS.map((k) => {
        const all = entries(k);
        if (!all.length) return null;
        const chosen = all.filter((e) => resume.selection[k].includes(e.id));
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
