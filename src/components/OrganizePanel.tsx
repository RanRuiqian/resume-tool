import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { db, snapshotProfile } from '../storage/db';
import { normalizeProfile } from '../storage/profileIO';
import { applyOrganize, planOrganize, OrganizeAiError, type OrganizeAiReport, type OrganizePlan, type Proposal } from '../quality/organize';
import { qualityReport, type QualityReport } from '../quality/contentQuality';
import { isUnconfirmedImport } from '../audit/techTerms';
import type { ProfileDoc } from '../types';

const SEC: Record<string, string> = { profile: '基本信息', education: '教育', work: '工作及社会经历', projects: '项目', skills: '技能', certificates: '证书', awards: '获奖' };
const FIELD: Record<string, string> = { actualConferralDate: '实际授予学位日期', expectedConferralDate: '预计授予学位日期', end: '结束日期', start: '开始日期', kind: '经历类型', issuer: '颁发机构', date: '日期', summary: '个人简介', headline: '求职意向', name: '名称' };
const rep = (p: ProfileDoc) => qualityReport(p, (e) => isUnconfirmedImport(e as Parameters<typeof isUnconfirmedImport>[0]));
const txt = (v: Proposal['before']) => (typeof v === 'string' ? v || '（空）' : [v.zh, v.en].filter(Boolean).join('\n') || '（移出简历要点）');

/** 「我的资料」：AI 整理现有资料（v1.9）——快照 → 本地规则 → 明确提示后才调用 AI（分批）→ 报告 + 前后对比 → 用户选择建议后一次应用 → 写入 → 可恢复 */
export function OrganizePanel() {
  const { profile, profileEpoch, settings, replaceProfile, restoreBackup } = useApp();
  const [stage, setStage] = useState<'idle' | 'ask' | 'running' | 'review' | 'done'>('idle');
  const [snap, setSnap] = useState<string | null>(null);
  const [prog, setProg] = useState('');
  const [err, setErr] = useState('');
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [acc, setAcc] = useState<Set<string>>(new Set());
  const [before, setBefore] = useState<QualityReport | null>(null);
  const [after, setAfter] = useState<QualityReport | null>(null);
  const [base, setBase] = useState<ProfileDoc | null>(null);
  const [execution, setExecution] = useState<OrganizeAiReport | null>(null);
  const aiReady = !settings.demoMode && !!settings.apiKey;
  const host = (() => { try { return new URL(settings.baseUrl).host; } catch { return settings.baseUrl; } })();

  const start = async () => {
    setErr(''); setPlan(null); setExecution(null);
    const cur = structuredClone(profile); setBase(cur); setBefore(rep(cur));
    try {
      const id = await snapshotProfile(db, cur, 'AI 整理现有资料前（自动快照）', profileEpoch); setSnap(id); setStage('ask');
    } catch (e) { setErr((e as Error).message); }
  };
  const run = async (useAi: boolean, force = false) => {
    if (!base) return;
    setStage('running'); setErr(''); setPlan(null); setExecution(null); setProg(useAi ? `准备审阅措辞（请求模型：${settings.model}）…` : '本地规则检查中…');
    try {
      const pl = await planOrganize(settings, base, { useAi, force, onProgress: (d, n, m) => setProg(`${settings.model} · ${m}（${d}/${n}）`) });
      setExecution(pl.ai ?? null);
      setPlan(pl); setAcc(new Set(pl.proposals.filter((x) => x.risk === 'safe').map((x) => x.id)));
      setAfter(rep(applyOrganize(base, pl, new Set(pl.proposals.filter((x) => x.risk === 'safe').map((x) => x.id)))));
      setStage('review');
    } catch (e) {
      if (e instanceof OrganizeAiError) setExecution(e.report);
      setErr(`整理失败，资料没有任何改动：${(e as Error).message}${snap ? '。整理前的快照已保存，可随时恢复。' : ''}`); setStage('ask');
    } finally { setProg(''); }
  };
  const write = async () => {
    if (!plan || !base) return;
    if (JSON.stringify(profile) !== JSON.stringify(base)) { setErr('资料在整理期间已发生变化，请重新整理；没有写入旧建议或覆盖当前事实。'); return; }
    try {
      const next = normalizeProfile(JSON.parse(JSON.stringify(applyOrganize(base, plan, acc))));
      await replaceProfile(next, 'AI 整理写入前');
      setAfter(rep(next)); setStage('done');
    } catch (e) { setErr('写入失败，资料保持整理前状态：' + (e as Error).message); }
  };
  const restore = async () => { if (snap && confirm('恢复到整理前的快照？当前资料会先另存一份快照。')) { await restoreBackup(snap); setStage('idle'); setPlan(null); } };

  const safe = useMemo(() => plan?.proposals.filter((x) => x.risk === 'safe') ?? [], [plan]);
  const high = useMemo(() => plan?.proposals.filter((x) => x.risk === 'high') ?? [], [plan]);
  const toggle = (id: string, on: boolean) => setAcc((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const row = (x: Proposal) => (
    <div key={x.id} className={`org-row ${x.risk}`} data-testid={`org-${x.risk}`}>
      <label className="check"><input type="checkbox" checked={acc.has(x.id)} onChange={(e) => toggle(x.id, e.target.checked)} /> <b>{SEC[x.section]} · {x.entryTitle || x.entryId}</b>{x.kind === 'field' && <> · {FIELD[x.target] ?? x.target}</>}<span className="muted small"> （来源：{x.source === 'ai' ? 'AI 规范化' : x.source === 'local' ? '本地规则' : '原始资料复核'}）</span></label>
      <div className="org-diff"><div className="org-before"><span className="muted small">修改前</span><pre>{txt(x.before)}</pre></div><div className="org-after"><span className="muted small">修改后</span><pre>{txt(x.after)}</pre></div></div>
      <div className="small muted">原因：{x.reasons.join('；')}</div>
      {x.risk === 'high' && x.source === 'ai' && <div className="small org-loss" data-testid="org-loss">⚠ {x.reasons.filter((r) => /译文待核对|找不到原文|删除了|新增了|参与程度|团队|并列|独立|数字|时间状态|商业|全职|学位/.test(r)).join('；') || 'AI 提出了措辞调整，可对照原文选择是否采用'}{plan?.proposals.some((y) => y.target === x.target && y.entryId === x.entryId && y.risk === 'safe') ? '。已在 A 类中提供只做机械清洗、保留全部事实的版本。' : ''}</div>}
      {x.notes.length > 0 && <div className="small">移入内部备注：{x.notes.join('；')}</div>}
      {x.archive.length > 0 && <div className="small">存入项目档案：{x.archive.join('；')}</div>}
    </div>
  );
  const stat = (r: QualityReport | null) => r ? `说明性语句 ${r.polluted} 处 · 第一人称 ${r.firstPerson} 处 · 机翻待校对 ${r.machine} · 过期译文 ${r.stale} · 待核实 ${r.uncertain}（重要 ${r.critical}）` : '';

  return (
    <div className="card organize" data-testid="organize-panel">
      <div className="row"><b>🧹 AI 整理现有资料</b><span className="muted small">清理已导入资料里的核验说明、写作建议等非经历句子，统一成可直接用于简历的表述。不需要重新上传原文。</span><span className="spacer" />
        {stage === 'idle' || stage === 'done' ? <button className="primary" data-testid="organize-start" onClick={start}>AI 整理现有资料</button> : null}</div>
      {err && <div className="notice error" data-testid="organize-error">{err}</div>}
      {execution && <OrganizeExecution report={execution} reviewed={plan?.aiItems} />}
      {stage === 'ask' && before && (
        <div className="notice" data-testid="organize-ask">
          已自动保存整理前快照{snap ? '' : '（资料为空，未保存）'}。本地检查：{stat(before)}。
          {before.pollutedSamples.length > 0 && <div className="small muted">示例：{before.pollutedSamples.slice(0, 2).join(' ／ ')}</div>}
          <div className="row">
            <button data-testid="organize-local" onClick={() => run(false)}>只用本地规则整理（不联网）</button>
            {aiReady
              ? <button className="primary" data-testid="organize-ai" onClick={() => run(true)}>调用 AI 规范化措辞</button>
              : <span className="muted small">{settings.demoMode ? '演示模式不调用 AI。' : '尚未启用 API，只能使用本地规则。'}</span>}
            {aiReady && <button data-testid="organize-recheck" title="忽略同模型已审阅标记，重新调用 AI 审阅文字；仍须人工确认，不需要重新导入" onClick={() => run(true, true)}>重新检查已拒绝建议</button>}
            {snap && <button onClick={restore}>恢复快照</button>}
            <button onClick={() => setStage('idle')}>取消</button>
          </div>
          {aiReady && <div className="small muted" data-testid="organize-ai-notice">⚠ 调用 AI 会把简介和经历要点（包括已确认事实对应的文字）分批发送到当前启用的服务：{host}（请求模型：{settings.model}）。不发送联系方式字段、照片、课程成绩、学历字段或原件来源账本；文字中已写入的信息会随正文发送。只提出措辞建议，事实检查保留，确认前不写入资料库。</div>}
        </div>)}
      {stage === 'running' && <div className="notice" data-testid="organize-progress">⏳ {prog || '整理中…'}</div>}
      {stage === 'review' && plan && (
        <div data-testid="organize-review">
          <div className="notice" data-testid="organize-report">整理报告：共 {plan.stats?.total ?? plan.proposals.length} 条文字，生成 {plan.proposals.length} 条建议（本地规则 {plan.proposals.filter((x) => x.source === 'local').length} 条；AI 建议 {plan.proposals.filter((x) => x.source === 'ai').length} 条；A 类 {safe.length} 条默认勾选，需要你审核 {high.length} 条，默认不写入）。
            {plan.aiErrors?.length ? <div className="small" data-testid="organize-ai-errors">⚠ 未完成的 AI 批次 / 条目保持原文，其本地建议单独标为“本地规则”：{plan.aiErrors.join('；')}</div> : null}
            <div className="small">整理前：{stat(before)}<br />接受安全修正后：{stat(after)}</div></div>
          {plan.stats && <ul className="small org-stats" data-testid="organize-stats">
            <li className="muted">以下为不同统计维度：AI 建议被拒绝后，仍可能保留原文或提供本地规则建议，数量不能相加。</li>
            <li data-testid="stat-meta">清理的不适合求职说明：{plan.stats.metaCleaned} 条</li>
            <li data-testid="stat-improved">实际改善表达（去第一人称 / 格式 / 补译）：{plan.stats.improved} 条</li>
            <li data-testid="stat-unchanged">无需修改：{plan.stats.unchanged} 条</li>
            <li data-testid="stat-rejected">AI 建议因事实不完整被拒绝（已保持原文，只做本地清洗）：{plan.stats.rejected} 条</li>
            <li data-testid="stat-review">需要你审核：{plan.stats.review} 条{plan.stats.review ? '（不是成功修改，默认不写入）' : ''}</li>
          </ul>}
          {!!plan.rejectedItems?.length && <details className="org-group" data-testid="organize-rejected"><summary>AI 建议因事实不完整被拒绝，已保持原文（{plan.rejectedItems.length}）</summary>{plan.rejectedItems.map((r, k) => <div key={k} className="small org-rejected"><b>{r.entryTitle}</b>：{r.text}<div className="muted">{r.reasons.slice(0, 3).join('；')}</div></div>)}</details>}
          {high.length > 0 && <details open className="org-group high"><summary>⚠ B 类 · 需要你审核（{high.length}）—— AI 语义改写、可能丢失 / 改变事实（地点、对象、参与程度、条件、状态、日期、学位等），默认不写入</summary>{high.map(row)}</details>}
          <details open={high.length === 0} className="org-group"><summary>✓ A 类 · 机械清洗（{safe.length}）—— 去掉「我」主语、说明句移入备注、失败方案归档、中英交叉核对通过的译文，事实原样保留 <button className="link" data-testid="organize-accept-all" onClick={(e) => { e.preventDefault(); setAcc((s) => new Set([...s, ...safe.map((x) => x.id)])); }}>全部接受</button> <button className="link" onClick={(e) => { e.preventDefault(); setAcc((s) => new Set([...s].filter((id) => !safe.some((x) => x.id === id)))); }}>全部取消</button></summary>{safe.map(row)}</details>
          <div className="row end">{plan.ai?.requested && plan.ai.requests === 0 && plan.ai.skipped.some((s) => s.reason.startsWith('同模型')) && <button data-testid="organize-retry-ai" onClick={() => run(true, true)}>重新调用 AI 审阅</button>}<button onClick={() => { setStage('idle'); setPlan(null); }}>放弃（不写入）</button><button className="primary" data-testid="organize-apply" disabled={!acc.size} onClick={write}>写入资料库（{acc.size} 条）</button></div>
        </div>)}
      {stage === 'done' && <div className="notice ok" data-testid="organize-done">已保存所选建议，可直接用于后续简历生成；需要时可继续编辑中英文文字。{snap && <button className="link" data-testid="organize-restore" onClick={restore}>恢复到整理前</button>}</div>}
    </div>
  );
}

function OrganizeExecution({ report: r, reviewed }: { report: OrganizeAiReport; reviewed?: number }) {
  const ok = r.batches.filter((b) => b.status === 'success').length, partial = r.batches.filter((b) => b.status === 'partial').length, failed = r.batches.filter((b) => b.status === 'failed').length;
  return <div className={`notice ${failed || partial ? 'warn' : r.requests ? 'ok' : ''}`} data-testid="organize-execution">
    <div>{r.requested ? `请求模型：${r.requestedModel || '未设置'}` : '本次仅使用本地规则'} · 实际请求尝试：{r.requests} 次</div>
    <div>{r.requests ? `响应模型：${r.responseModels.join('、') || '服务未返回模型标识，无法核实响应模型'}；成功批次 ${ok}，部分完成 ${partial}，失败 ${failed}。${reviewed !== undefined ? `AI 已返回 ${reviewed} 条审阅结果（不等于建议修改数）。` : ''}` : `未调用 AI：${r.noCallReason || r.batches.find((b) => b.error)?.error || '未发出请求'}`}</div>
    {r.skipped.length > 0 && <details><summary>未发送原因</summary><ul>{r.skipped.map((s) => <li key={s.reason}>{s.reason}：{s.count} 条</li>)}</ul></details>}
    {r.batches.some((b) => b.error) && <ul data-testid="organize-execution-errors">{r.batches.filter((b) => b.error).map((b, i) => <li key={i}>{b.error}</li>)}</ul>}
  </div>;
}
