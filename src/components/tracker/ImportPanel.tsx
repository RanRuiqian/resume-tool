import { useMemo, useState } from 'react';
import { db } from '../../storage/db';
import { applyImport, buildCandidates, guessMapping, parseImportFile, planImport, TARGET_FIELDS, TARGET_LABEL, type FieldMapping, type ImportResult, type ParsedSource, type PlanRow, type RowAction } from '../../tracker/importers';
import { STATUS_LABEL, type Application, type JobPosting } from '../../tracker/types';

const KIND_LABEL = { new: '新增', duplicate: '重复', conflict: '冲突', invalid: '无效' } as const;
const SRC_LABEL = { csv: 'CSV 表格', json: '通用 JSON', 'ran-application-handoff': '2027 求职投递导航（ran-application-handoff）' } as const;

/** 导入：选择文件 → 解析 → 字段映射 → 预览（新增 / 重复 / 冲突）→ 逐行选择 → 确认 → 结果；失败整体回滚 */
export function ImportPanel({ postings, apps, onDone }: { postings: JobPosting[]; apps: Application[]; onDone: () => void }) {
  const [src, setSrc] = useState<ParsedSource | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [actions, setActions] = useState<Record<number, RowAction>>({});
  const [err, setErr] = useState(''); const [res, setRes] = useState<ImportResult | null>(null); const [busy, setBusy] = useState(false);
  const plan: PlanRow[] = useMemo(() => (src ? planImport(buildCandidates(src, mapping), postings, apps) : []), [src, mapping, postings, apps]);
  const counts = plan.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {} as Record<string, number>);
  const act = (r: PlanRow) => (r.kind === 'invalid' ? 'skip' : actions[r.cand.index] ?? r.defaultAction);
  const pick = async (f?: File) => {
    setErr(''); setRes(null); setActions({}); if (!f) return;
    try { const s = parseImportFile(await f.text(), f.name); setSrc(s); setMapping(s.presetMapping ?? guessMapping(s.keys)); }
    catch (e) { setSrc(null); setErr((e as Error).message); }
  };
  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await applyImport(db, plan, Object.fromEntries(plan.map((p) => [p.cand.index, act(p)]))); setRes(r); setSrc(null); onDone(); }
    catch (e) { setErr(`导入失败，已全部回滚，数据库保持导入前的状态：${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="card" data-testid="import-panel">
      <h3>导入以前的求职记录</h3>
      <p className="muted small">支持 Excel 另存的 CSV（列名如：类别、企业、城市、岗位、状态、投递链接，或 company / title / city / status / url）、通用 JSON，以及「2027 求职投递导航」导出的 JSON（format: ran-application-handoff, schemaVersion 1.0）。导入前会先预览，不会直接覆盖现有记录；同一文件重复导入会被识别为「重复」。</p>
      <input type="file" data-testid="import-file" accept=".csv,.json,.txt,text/csv,application/json" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {err && <div className="notice error" data-testid="import-error">{err}</div>}
      {res && <div className="notice ok" data-testid="import-result">导入完成：新增岗位 {res.created}，合并 {res.merged}，跳过 {res.skipped}；新建申请 {res.applications}，写入状态历史 {res.events} 条。</div>}
      {src && (<>
        <div className="notice">来源：<b>{SRC_LABEL[src.kind]}</b> · {src.fileName} · {src.records.length} 条记录{src.meta ? ` · schemaVersion ${String(src.meta.schemaVersion)}` : ''}</div>
        {src.warnings.map((w) => <div key={w} className="notice warn" data-testid="import-warning">{w}</div>)}
        {src.portals && src.portals.length > 0 && <details data-testid="import-portals"><summary>招聘网站 {src.portals.length} 个（portals，仅供参考，不导入为岗位）</summary><ul className="small">{src.portals.map((p, i) => <li key={i}>{String(p.name ?? p.title ?? p.company ?? p.id ?? `#${i + 1}`)}{typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? <> · <a href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a></> : null}</li>)}</ul></details>}
        <details open={src.kind !== 'csv' || !mapping.company || !mapping.title} data-testid="mapping">
          <summary>字段映射（自动识别，可手动修改）</summary>
          <div className="grid2 small">{TARGET_FIELDS.map((f) => <label key={f}>{TARGET_LABEL[f]}<select data-testid={`map-${f}`} value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })}><option value="">（不导入）</option>{src.keys.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>)}</div>
        </details>
        <div className="chips" data-testid="import-counts">{(['new', 'duplicate', 'conflict', 'invalid'] as const).map((k) => <span key={k} className={`chip kind-${k}`}>{KIND_LABEL[k]} {counts[k] ?? 0}</span>)}</div>
        <div className="row small"><span>批量：</span><button className="link" onClick={() => setActions(Object.fromEntries(plan.filter((r) => r.kind === 'conflict').map((r) => [r.cand.index, 'merge'])))}>冲突全部合并</button><button className="link" onClick={() => setActions(Object.fromEntries(plan.filter((r) => r.kind !== 'new').map((r) => [r.cand.index, 'skip'])))}>重复与冲突全部跳过</button></div>
        <div className="scroll-x"><table className="items" data-testid="import-preview"><thead><tr><th>#</th><th>判定</th><th>企业 / 岗位 / 城市</th><th>状态</th><th>说明</th><th>处理方式</th></tr></thead><tbody>
          {plan.map((r) => (
            <tr key={r.cand.index} className={r.kind === 'conflict' ? 'pending' : r.kind === 'invalid' ? 'bad' : ''} data-testid="import-row" data-kind={r.kind}>
              <td>{r.cand.index + 1}</td><td>{KIND_LABEL[r.kind]}{src.adapter && <div className="muted small">{r.cand.posting.recruitType === 'intern' ? '实习' : '校招'}</div>}</td>
              <td>{r.cand.posting.company} · {r.cand.posting.title} · {r.cand.posting.city || '—'}{r.match && <div className="muted small">对应已有：{r.match.company} · {r.match.title}</div>}</td>
              <td data-testid="import-status">{r.cand.status ? STATUS_LABEL[r.cand.status] : src.adapter && r.cand.statusRaw === '未投' ? '仅岗位（未投）' : r.cand.statusRaw ? <span className="bad">无法识别「{r.cand.statusRaw}」</span> : '—'}{src.adapter && r.cand.statusRaw && <div className="muted small">原：{r.cand.statusRaw}</div>}</td>
              <td className="small">{[...r.diffs, ...r.cand.problems.filter((p) => !r.diffs.includes(p))].map((d) => <div key={d}>{d}</div>)}</td>
              <td>{r.kind === 'invalid' ? '跳过' : <select data-testid="row-action" value={act(r)} onChange={(e) => setActions({ ...actions, [r.cand.index]: e.target.value as RowAction })}>
                <option value="skip">跳过</option>{r.match && <option value="merge">合并到已有岗位</option>}<option value="new">作为新记录</option></select>}</td>
            </tr>))}
        </tbody></table></div>
        <div className="row end"><button onClick={() => setSrc(null)}>取消</button><button className="primary" data-testid="import-confirm" disabled={busy || !plan.some((r) => act(r) !== 'skip')} onClick={run}>确认导入（{plan.filter((r) => act(r) !== 'skip').length} 条）</button></div>
      </>)}
    </div>
  );
}
