import { useApp } from '../store';
import { useL } from '../i18n';
import { FEATURES } from '../features';
import { atsCoverage } from '../ai/insights';
import { buildLayout } from '../render/layout';
import type { Lang } from '../types';

/** ATS 关键词覆盖率 + 缺口建议（只建议补充真实经历，绝不代写） */
export function MatchInsights({ go }: { go: (p: string) => void }) {
  const { profile, template, job, resume } = useApp();
  const L = useL();
  if (!FEATURES.matchInsights || !job || !resume) return null;
  const cov = (l: Lang) => atsCoverage(buildLayout(profile, template, l, resume), job, l);
  const zh = cov('zh'), en = cov('en');
  const meter = (label: string, c: typeof zh, l: Lang) => (
    <div className="ats">
      <div className="row"><b>{label}</b><span className="spacer" /><span className={c.pct >= 70 ? 'ok-text' : c.pct >= 40 ? '' : 'err-text'}>{c.pct}%</span></div>
      <div className="bar"><div style={{ width: `${c.pct}%`, background: c.pct >= 70 ? '#38a169' : c.pct >= 40 ? '#d69e2e' : '#e53e3e' }} /></div>
      {c.missing.length > 0 && <div className="small muted">{L('未出现：', 'Missing: ')}{c.missing.map((k, i) => <span key={i} className="chip gap">{k[l] || k.zh || k.en}</span>)}</div>}
    </div>
  );
  return (
    <div className="card insights">
      <h3>{L('📊 关键词匹配（ATS）', '📊 Keyword match (ATS)')}</h3>
      <p className="muted small">{L('只统计岗位关键词在简历中出现的比例，用来提醒可补充的真实经历；不是招聘方或 ATS 系统的官方评分。', 'Share of job keywords found in the resume — a reminder, not an official employer or ATS score.')}</p>
      <div className="grid2">{meter(L('中文版', 'Chinese'), zh, 'zh')}{meter('English', en, 'en')}</div>
      {(resume.gaps.length > 0 || zh.missing.length > 0) && (
        <div className="notice">
          💡 {L('如果你确实有相关经历，只是资料库里没写，去「我的资料」补充后重新生成，覆盖率会提高。没有的经历不要硬写——面试时可以诚实说明正在学习。',
            'If you really have experience with these but it isn’t in your profile, add it and regenerate. Don’t claim experience you lack — be honest in interviews.')}
          <button className="link" onClick={() => go('profile')}>{L('去补充资料 →', 'Add to profile →')}</button>
        </div>
      )}
    </div>
  );
}
