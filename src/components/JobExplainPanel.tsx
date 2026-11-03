import { useState } from 'react';
import { useApp } from '../store';
import { jobRequirements } from '../joint/jobs';
import { explainJob, unexplained } from '../ai/jobExplain';

const TIER = { responsibility: '岗位职责', must: '必备要求', preferred: '加分项' } as const;

/** 岗位要求解读：只读说明，AI 按行业常识解释每条职责 / 要求；不读个人资料库，不影响选材和简历。 */
export function JobExplainPanel({ open }: { open?: boolean }) {
  const { settings, job, setJob } = useApp();
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  if (!job || job.generic) return null;
  const refs = jobRequirements(job);
  if (!refs.length) return null;
  const have = new Map((job.explain?.items ?? []).map((x) => [x.id, x]));
  const missing = unexplained(job).length;
  const titles = new Map((job.joint?.targets ?? []).map((t) => [t.job.id, t.name]));
  const run = async () => {
    setBusy(true); setErr('');
    try { setJob({ ...job, explain: await explainJob(settings, job) }); }
    catch (e) { setErr((e as Error).message || '解读失败'); }
    finally { setBusy(false); }
  };
  const groups = [...new Set(refs.map((r) => r.jobId))];
  return (
    <details className="card" data-testid="job-explain" open={open}>
      <summary>读不懂某条要求？查看岗位要求解读{missing === 0 ? '' : have.size ? `（还有 ${missing} 条未解读）` : ''}</summary>
      <p className="muted small">AI 按行业常识解释每条职责 / 要求的含义和通常需要的能力，仅供参考；不是这家公司的内部信息，不读取你的资料库，也不会写进简历。点按钮时才调用 AI（约几分钱）。</p>
      <div className="row"><button data-testid="explain-run" disabled={busy || (missing === 0)} onClick={run}>{busy ? '解读中…' : have.size ? (missing ? '补充解读' : '已全部解读') : '解读这个岗位的要求'}</button></div>
      {err && <div className="notice error small" data-testid="explain-error">{err}</div>}
      {groups.map((jid) => {
        const rows = refs.filter((r) => r.jobId === jid && have.get(r.id)?.text === (r.text.zh.trim() || r.text.en.trim()));
        if (!rows.length) return null;
        return (
          <section key={jid}>
            {groups.length > 1 && <h4>{titles.get(jid) || jid}</h4>}
            {(['responsibility', 'must', 'preferred'] as const).map((tier) => {
              const part = rows.filter((r) => r.tier === tier);
              if (!part.length) return null;
              return (
                <div key={tier}>
                  <div className="small"><b>{TIER[tier]}</b></div>
                  {part.map((r) => { const x = have.get(r.id)!; return (
                    <div className="notice small" key={r.id} data-testid="explain-item">
                      <b>{x.text}</b>
                      {x.meaning && <div>意思：{x.meaning}</div>}
                      {x.abilities && <div>通常需要：{x.abilities}</div>}
                      {x.experience && <div>对口经历：{x.experience}</div>}
                    </div>
                  ); })}
                </div>
              );
            })}
          </section>
        );
      })}
    </details>
  );
}
