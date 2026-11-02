import { useState } from 'react';
import { useApp } from '../store';
import { refreshReportSelection } from '../joint/report';
import { linkJointApplications } from '../joint/versions';
import { db } from '../storage/db';
import { downloadBytes } from '../utils/download';

const STATUS = { direct: '已证实的对应事实（AI 判断待审）', transferable: '可迁移背景', learning: '仅课程知识支持，实践仍有缺口', gap: '尚无可靠证据' };
const CATEGORY = { work: '实际工作', project: '项目证明', course: '课程学习', education: '教育背景', skill: '技能自述', certificate: '证书', award: '奖项', campus: '学生组织' };
export function EvidenceReport({ go }: { go?: (p: string) => void }) {
  const { resume, profile, template, job } = useApp();
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  if (!resume?.evidenceReport) return null;
  const report = refreshReportSelection(resume)!;
  const canLink = !!job?.joint && job.id === resume.jobId;
  const refs = new Map(report.targets.flatMap((t) => t.requirements.map((r) => [r.requirementId, `${t.title.zh || t.title.en}：${r.text}`])));
  const warning = report.synthesis?.conflicts.length || (report.targets.length > 1 && (!report.synthesis?.common.length || report.targets.some((t) => t.requirements.filter((q) => q.assessment === 'learning' || q.assessment === 'gap').length >= t.requirements.length / 2)));
  return <div className="card evidence-report" data-testid="evidence-report">
    <h3>{report.targets.length > 1 ? '逐岗位匹配证据与能力缺口' : '匹配证据与课程关联依据'}</h3>
    <p className="muted small">这是 AI 对真实来源的关联判断，不是官方 ATS 分数或录用概率。课程概述/推断不能证明实操。来源仍存在于母库但已取消选入本简历的，会明确标出；手工改写仍需在事实审查逐句核对。</p>
    {warning ? <div className="notice warn" data-testid="joint-conflict">单份简历难以同时强匹配：岗位之间存在冲突或缺少共同要求。可继续使用共同版本，也可返回单岗位模式分别制作。</div> : null}
    {report.synthesis && (['common', 'complementary', 'conflicts'] as const).map((kind) => <details key={kind} open><summary>{kind === 'common' ? '共同要求' : kind === 'complementary' ? '互补 / 各岗特有要求' : '冲突 / 无法同时覆盖'}</summary>
      {report.synthesis![kind].length ? report.synthesis![kind].map((row, i) => <div className="notice small" key={i}><b>AI 关联依据：</b>{row.reason}<ul>{row.requirementIds.map((id) => <li key={id}>{refs.get(id) || id}</li>)}</ul></div>) : <p className="muted small">本次未识别到该类归纳；请人工核对。</p>}
    </details>)}
    {report.targets.map((target) => <section key={target.jobId} data-testid="role-evidence-report"><h4>{target.title.zh || target.title.en}</h4><div className="muted small">独立 JD：{target.jobId} · 已证实 {target.requirements.filter((r) => r.assessment === 'direct').length} · 可迁移 {target.requirements.filter((r) => r.assessment === 'transferable').length} · 课程支持 {target.requirements.filter((r) => r.assessment === 'learning').length} · 无证据 {target.requirements.filter((r) => r.assessment === 'gap').length}</div>
      {target.requirements.map((r, i) => <details className="card" key={r.requirementId || i} open={r.assessment === 'gap' || r.assessment === 'learning'}><summary><b>{r.text}</b> · {STATUS[r.assessment]}</summary>
        <p className="small">AI 候选原因 / 关联依据：{r.reason || '由所引事实提供对应背景，仍需人工核对。'}</p>
        {r.evidence.map((e) => <div className="notice small" key={e.id}><b>{CATEGORY[e.category]}</b> · {e.label} · {e.id}{e.level ? ` · 概述等级 ${e.level}` : ''}<br />{e.zh || e.en}<br /><span className={e.selected ? 'ok-text' : 'err-text'}>{e.selected ? '本简历已采用该来源；正文措辞仍须事实审查' : '本简历未采用该来源（母库保留，不计作当前正文亮点）'}</span></div>)}
        <div className="uncertain small">过度宣传风险 / 待确认：{r.risks.join('；')}</div>
      </details>)}
    </section>)}
    <details><summary>AI 选材原因（可在素材池或本份简历选项中调整、排序）</summary>{report.selectionReasons.map((s, i) => <p className="small" key={i}>{s}</p>)}</details>
    <div className="row"><button onClick={() => downloadBytes(new TextEncoder().encode(JSON.stringify(report, null, 2)), 'evidence-and-gaps.json', 'application/json')}>下载逐岗证据报告</button>
      {canLink && <button className="primary" data-testid="link-shared-resume" disabled={busy} onClick={async () => {
        setBusy(true); setMessage('正在冻结一份共同内容版本并关联待投递记录…');
        try { const result = await linkJointApplications(db, { profile, template, resume, job: job! }); setMessage(`已关联 ${result.applicationIds.length} 条记录，共同版本 ID：${result.versionId}。未修改为已投递；后续改简历请显式关联新版本。`); }
        catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
      }}>将同一版本关联到 {report.targets.length} 条投递记录</button>}
      {go && <button onClick={() => go('applications')}>查看求职记录 →</button>}
    </div>{message && <div role="status" className="notice" data-testid="shared-link-result">{message}</div>}
  </div>;
}
