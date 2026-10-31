import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { db, snapshotProfile } from '../storage/db';
import { normalizeProfile } from '../storage/profileIO';
import { applyOrganize, planOrganize, type OrganizePlan, type Proposal } from '../quality/organize';
import { qualityReport, type QualityReport } from '../quality/contentQuality';
import { isUnconfirmedImport } from '../audit/techTerms';
import { forEachText } from '../locale/text';
import type { ProfileDoc } from '../types';

const SEC: Record<string, string> = { profile: '基本信息', education: '教育', work: '工作及社会经历', projects: '项目', skills: '技能', certificates: '证书', awards: '获奖' };
const FIELD: Record<string, string> = { actualConferralDate: '实际授予学位日期', expectedConferralDate: '预计授予学位日期', end: '结束日期', start: '开始日期', kind: '经历类型', issuer: '颁发机构', date: '日期', summary: '个人简介', headline: '求职意向', name: '名称' };
const rep = (p: ProfileDoc) => qualityReport(p, (e) => isUnconfirmedImport(e as Parameters<typeof isUnconfirmedImport>[0]));
const txt = (v: Proposal['before']) => (typeof v === 'string' ? v || '（空）' : [v.zh, v.en].filter(Boolean).join('\n') || '（移出简历要点）');

/** 「我的资料」：AI 整理现有资料（v1.9）——快照 → 本地规则 → 明确提示后才调用 AI（分批）→ 报告 + 前后对比 → 安全修正可批量接受，高风险事实逐条确认 → 写入 → 可恢复 */
export function OrganizePanel() {
  const { profile, settings, replaceProfile, restoreBackup } = useApp();
  const [stage, setStage] = useState<'idle' | 'ask' | 'running' | 'review' | 'done'>('idle');
  const [snap, setSnap] = useState<string | null>(null);
  const [prog, setProg] = useState('');
  const [err, setErr] = useState('');
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [acc, setAcc] = useState<Set<string>>(new Set());
  const [before, setBefore] = useState<QualityReport | null>(null);
  const [after, setAfter] = useState<QualityReport | null>(null);
  const [base, setBase] = useState<ProfileDoc | null>(null);
  const aiReady = !settings.demoMode && !!settings.apiKey;
  const host = (() => { try { return new URL(settings.baseUrl).host; } catch { return settings.baseUrl; } })();

  const start = async () => {
    setErr(''); setPlan(null);
    const cur = structuredClone(profile); setBase(cur); setBefore(rep(cur));
    const id = await snapshotProfile(db, cur, 'AI 整理现有资料前（自动快照）'); setSnap(id);
    setStage('ask');
  };
  const run = async (useAi: boolean, force = false) => {
    if (!base) return;
    setStage('running'); setErr(''); setProg(useAi ? '本地规则检查…' : '本地规则检查中…');
    try {
      const pl = await planOrganize(settings, base, { useAi, force, onProgress: (d, n, m) => setProg(`${m}（${d}/${n}）`) });
      setPlan(pl); setAcc(new Set(pl.proposals.filter((x) => x.risk === 'safe').map((x) => x.id)));
      setAfter(rep(applyOrganize(base, pl, new Set(pl.proposals.filter((x) => x.risk === 'safe').map((x) => x.id)))));
      setStage('review');
    } catch (e) {
      setErr(`整理失败，资料没有任何改动：${(e as Error).message}${snap ? '。整理前的快照已保存，可随时恢复。' : ''}`); setStage('ask');
    } finally { setProg(''); }
  };
  const write = async () => {
    if (!plan || !base) return;
    const high = plan.proposals.filter((x) => x.risk === 'high' && acc.has(x.id)).length;
    if (high && !confirm(`你勾选了 ${high} 条高风险事实修改（日期 / 学位 / 机构 / 数字等），确认这些修改都与真实情况一致吗？`)) return;
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
      {x.risk === 'high' && x.source === 'ai' && <div className="small org-loss" data-testid="org-loss">⚠ {x.reasons.filter((r) => /译文待核对|找不到原文|删除了|新增了|参与程度|团队|并列|独立|数字|时间状态|商业|全职|学位/.test(r)).join('；') || 'AI 改写了措辞，无法证明与原文事实完全等价'}{plan?.proposals.some((y) => y.target === x.target && y.entryId === x.entryId && y.risk === 'safe') ? '。已在 A 类中提供只做机械清洗、保留全部事实的版本。' : ''}</div>}
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
      {stage === 'ask' && before && (
        <div className="notice" data-testid="organize-ask">
          已自动保存整理前快照{snap ? '' : '（资料为空，未保存）'}。本地检查：{stat(before)}。
          {before.pollutedSamples.length > 0 && <div className="small muted">示例：{before.pollutedSamples.slice(0, 2).join(' ／ ')}</div>}
          <div className="row">
            <button data-testid="organize-local" onClick={() => run(false)}>只用本地规则整理（不联网）</button>
            {aiReady
              ? <button className="primary" data-testid="organize-ai" onClick={() => run(true)}>调用 AI 规范化措辞</button>
              : <span className="muted small">{settings.demoMode ? '演示模式不调用 AI。' : '尚未启用 API，只能使用本地规则。'}</span>}
            {aiReady && <button data-testid="organize-recheck" title="规则或模型更新后，重新检查以前整理过 / 拒绝过的文字，不需要重新导入" onClick={() => run(true, true)}>重新检查已拒绝建议</button>}
            {snap && <button onClick={restore}>恢复快照</button>}
            <button onClick={() => setStage('idle')}>取消</button>
          </div>
          {aiReady && <div className="small muted" data-testid="organize-ai-notice">⚠ 调用 AI 会把经历要点文字（不含照片、手机号、邮箱、出生年月）分批发送到当前启用的服务：{host}（{settings.model}）。不会发送 API Key 以外的账户信息，结果只作为建议，确认前不写入资料库。</div>}
        </div>)}
      {stage === 'running' && <div className="notice" data-testid="organize-progress">⏳ {prog || '整理中…'}</div>}
      {stage === 'review' && plan && (
        <div data-testid="organize-review">
          <div className="notice ok" data-testid="organize-report">整理报告：共 {plan.stats?.total ?? plan.proposals.length} 条文字，生成 {plan.proposals.length} 条建议（A 类 {safe.length} 条默认勾选；需要你审核 {high.length} 条，默认不写入）。{plan.aiCalls ? `调用 AI ${plan.aiCalls} 次，只发送了 ${plan.aiItems} 条有问题的内容${plan.stats ? `（${plan.stats.aiSkipped} 条干净内容未发送）` : ''}。` : '未调用 AI。'}
            {plan.aiErrors?.length ? <div className="small" data-testid="organize-ai-errors">⚠ {plan.aiErrors.length} 批 AI 请求失败，这些条目只做了本地清洗：{plan.aiErrors.join('；')}</div> : null}
            <div className="small">整理前：{stat(before)}<br />接受安全修正后：{stat(after)}</div></div>
          {plan.stats && <ul className="small org-stats" data-testid="organize-stats">
            <li data-testid="stat-meta">清理的不适合求职说明：{plan.stats.metaCleaned} 条</li>
            <li data-testid="stat-improved">实际改善表达（去第一人称 / 格式 / 补译）：{plan.stats.improved} 条</li>
            <li data-testid="stat-unchanged">无需修改：{plan.stats.unchanged} 条</li>
            <li data-testid="stat-rejected">AI 建议因事实不完整被拒绝（已保持原文，只做本地清洗）：{plan.stats.rejected} 条</li>
            <li data-testid="stat-review">需要你审核：{plan.stats.review} 条{plan.stats.review ? '（不是成功修改，默认不写入）' : ''}</li>
          </ul>}
          {!!plan.rejectedItems?.length && <details className="org-group" data-testid="organize-rejected"><summary>AI 建议因事实不完整被拒绝，已保持原文（{plan.rejectedItems.length}）</summary>{plan.rejectedItems.map((r, k) => <div key={k} className="small org-rejected"><b>{r.entryTitle}</b>：{r.text}<div className="muted">{r.reasons.slice(0, 3).join('；')}</div></div>)}</details>}
          {high.length > 0 && <details open className="org-group high"><summary>⚠ B 类 · 需要你审核（{high.length}）—— AI 语义改写、可能丢失 / 改变事实（地点、对象、参与程度、条件、状态、日期、学位等），默认不写入</summary>{high.map(row)}</details>}
          <details open={high.length === 0} className="org-group"><summary>✓ A 类 · 机械清洗（{safe.length}）—— 去掉「我」主语、说明句移入备注、失败方案归档、中英交叉核对通过的译文，事实原样保留 <button className="link" data-testid="organize-accept-all" onClick={(e) => { e.preventDefault(); setAcc((s) => new Set([...s, ...safe.map((x) => x.id)])); }}>全部接受</button> <button className="link" onClick={(e) => { e.preventDefault(); setAcc((s) => new Set([...s].filter((id) => !safe.some((x) => x.id === id)))); }}>全部取消</button></summary>{safe.map(row)}</details>
          <div className="row end"><button onClick={() => { setStage('idle'); setPlan(null); }}>放弃（不写入）</button><button className="primary" data-testid="organize-apply" disabled={!acc.size} onClick={write}>写入资料库（{acc.size} 条）</button></div>
        </div>)}
      {stage === 'done' && <div className="notice ok" data-testid="organize-done">已写入。现在：{stat(after)}。英文机翻不阻塞生成，可在下方「资料状态」里批量查看。{snap && <button className="link" data-testid="organize-restore" onClick={restore}>恢复到整理前</button>}</div>}
    </div>
  );
}

/** 待处理汇总（v1.9）：高风险待核实单独列出（含原因和来源）；英文机翻集中为一个非阻塞的批量校对清单，只有用户勾选并点击确认才改为已确认 */
export function ReviewSummary() {
  const { profile, setProfile } = useApp();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const unc: { sec: string; title: string; text: string; critical: boolean }[] = [];
  for (const sec of ['education', 'work', 'projects', 'skills', 'certificates', 'awards'] as const) for (const e of profile[sec] as unknown as { id: string; uncertain?: string[]; name?: { zh?: string; en?: string }; school?: { zh?: string }; company?: { zh?: string; en?: string } }[]) {
    const title = e.name?.zh || e.name?.en || e.school?.zh || e.company?.zh || e.company?.en || e.id;
    (e.uncertain ?? []).forEach((u) => unc.push({ sec, title, text: u, critical: u.startsWith('【严重】') }));
  }
  const machine: { t: { zh?: string; en?: string; status?: Partial<Record<'zh' | 'en', string>> }; l: 'zh' | 'en'; path: string }[] = [];
  forEachText(profile, (t, path) => (['zh', 'en'] as const).forEach((l) => { if (t.status?.[l] === 'machine') machine.push({ t, l, path }); }));
  const crit = unc.filter((x) => x.critical);
  const q = rep(profile); const stale = q.stale;
  if (!unc.length && !machine.length && !q.polluted && !q.firstPerson && !stale) return null;
  const confirmSel = () => {
    if (!sel.size) return;
    const n = structuredClone(profile); let i = 0;
    forEachText(n, (t) => (['zh', 'en'] as const).forEach((l) => { if (t.status?.[l] === 'machine') { if (sel.has(i)) t.status = { ...t.status, [l]: 'confirmed' }; i++; } }));
    setProfile(n); setSel(new Set());
  };
  return (
    <div className="card review-summary" data-testid="review-summary">
      <b>📋 资料状态</b>
      <div className="status3" data-testid="status3">
        <span data-testid="st-clean">🧹 内容清洗：{q.polluted + q.firstPerson ? `${q.polluted} 处说明句、${q.firstPerson} 处「我」主语待清洗` : '已清洗'}</span>
        <span data-testid="st-fact">🔎 事实核对：{unc.length ? `${unc.length} 条待核实（重要 ${crit.length}）` : '无待核实'}</span>
        <span data-testid="st-trans">🌐 英文翻译：{machine.length} 条机翻（可直接用于求职，生成时会再核对）{stale ? ` · ${stale} 条待更新（中文已改）` : ''}</span>
      </div>
      {crit.length > 0 && <div className="notice warn" data-testid="review-critical">{crit.map((x, i) => <div key={i} className="small">⚠ {SEC[x.sec]} · {x.title}：{x.text.replace('【严重】', '')}</div>)}</div>}
      {unc.length > crit.length && <details><summary className="small">其他待核实（{unc.length - crit.length}）</summary>{unc.filter((x) => !x.critical).map((x, i) => <div key={i} className="small">· {SEC[x.sec]} · {x.title}：{x.text}<span className="muted">（来源：导入时与原文比对）</span></div>)}</details>}
      {machine.length > 0 && <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="review-machine"><summary className="small">机翻待校对（{machine.length}）—— 可批量查看，勾选确认无误的译文</summary>
        {open && <><div className="row"><button className="link" onClick={() => setSel(new Set(machine.map((_, i) => i)))}>全选</button><button className="link" onClick={() => setSel(new Set())}>全不选</button><button data-testid="review-confirm-machine" disabled={!sel.size} onClick={confirmSel}>确认所选译文（{sel.size}）</button></div>
          {machine.slice(0, 200).map((m, i) => <label key={i} className="check small" style={{ display: 'block' }}><input type="checkbox" checked={sel.has(i)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })} /> {m.t[m.l === 'en' ? 'zh' : 'en']} → <b>{m.t[m.l]}</b></label>)}</>}
      </details>}
    </div>
  );
}
