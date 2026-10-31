import { useMemo, useState } from 'react';
import { useApp } from '../store';
import type { Lang } from '../types';
import { applyDecision, auditResume, diffTokens, isDecided, LEVEL_LABEL, LEVEL_ORDER, summarize, type ItemAudit, type RiskLevel } from '../audit/factAudit';

type Filter = 'focus' | 'all' | RiskLevel | 'unconfirmed';
const DEC_LABEL = { accepted: '已接受改写', restored: '已恢复原文', edited: '已手动编辑', pending: '待审查' } as const;

function Diff({ a, b }: { a: string; b: string }) {
  const d = diffTokens(a, b);
  return <>{d.filter(([t]) => t !== 'del').map(([t, s], i) => (t === 'add' ? <mark key={i} className="diff-add">{s}</mark> : <span key={i}>{s}</span>))}</>;
}
function DiffOld({ a, b }: { a: string; b: string }) {
  const d = diffTokens(a, b);
  return <>{d.filter(([t]) => t !== 'add').map(([t, s], i) => (t === 'del' ? <del key={i} className="diff-del">{s}</del> : <span key={i}>{s}</span>))}</>;
}

/** 事实审查（B3/B7）：左侧原始资料，右侧 AI 改写；逐条接受 / 恢复 / 编辑。全部本地规则，不调用 AI */
export function FactAudit({ onClose }: { onClose?: () => void }) {
  const { profile, resume, setResume } = useApp();
  const [lang, setLang] = useState<Lang>(resume?.primaryLanguage ?? 'zh');
  const [filter, setFilter] = useState<Filter>('focus');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const audit = useMemo(() => (resume ? auditResume(profile, resume) : null), [profile, resume]);
  if (!resume || !audit) return null;
  const sum = summarize(audit.items, resume, [lang]);
  const all = summarize(audit.items, resume);
  const decided = (id: string) => isDecided(resume, id, lang);
  const show = (it: ItemAudit) => {
    const a = it[lang];
    if (filter === 'all') return true;
    if (filter === 'focus') return a.level === 'red' || a.level === 'yellow' || (a.level === 'gray' && !decided(it.sourceId));
    if (filter === 'unconfirmed') return a.level !== 'green' && !decided(it.sourceId);
    return a.level === filter;
  };
  const rows = audit.items.filter(show).sort((x, y) => LEVEL_ORDER[x[lang].level] - LEVEL_ORDER[y[lang].level]);
  const act = (id: string, d: 'accepted' | 'restored' | 'edited', text?: string) => { setResume(applyDecision(profile, resume, id, lang, d, text)); setEditing(null); };
  const F = (k: Filter, label: string, n?: number) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}{n !== undefined ? ` ${n}` : ''}</button>;

  return (
    <div className="card fact-audit" data-testid="fact-audit">
      <div className="row">
        <h3 style={{ margin: 0 }}>🔍 事实审查</h3>
        <div className="seg">
          {(['zh', 'en'] as Lang[]).map((l) => <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{l === 'zh' ? '中文版' : 'English'}</button>)}
        </div>
        <span className="spacer" />
        {onClose && <button onClick={onClose}>收起</button>}
      </div>
      <div className="audit-summary" data-testid="audit-summary">
        <span>共 <b>{sum.total}</b> 条</span><span>已审查 <b>{sum.reviewed}</b></span>
        <span className="lv red">红 {sum.red}</span><span className="lv yellow">黄 {sum.yellow}</span><span className="lv green">绿 {sum.green}</span><span className="lv gray">灰 {sum.gray}</span>
        <span>未确认 <b>{sum.unconfirmed}</b></span>
      </div>
      {all.unconfirmedRed > 0
        ? <div className="notice error" data-testid="audit-red-warn">⚠ 还有 {all.unconfirmedRed} 处高风险改写未确认（中英文合计）。请逐条接受、恢复原文或手动修改后再导出。</div>
        : all.unconfirmed > 0 ? <div className="notice warn">还有 {all.unconfirmed} 处需要关注的改写未处理。</div>
        : <div className="notice ok">✓ 所有需要关注的改写都已由你处理。注意：这只说明改写能追溯到你的资料，经历本身的真实性仍以你的确认为准。</div>}
      <div className="chips">{F('focus', '红 + 黄（默认）')}{F('red', '红', sum.red)}{F('yellow', '黄', sum.yellow)}{F('gray', '灰', sum.gray)}{F('green', '绿', sum.green)}{F('unconfirmed', '未确认', sum.unconfirmed)}{F('all', '全部', sum.total)}</div>
      {!rows.length && <div className="muted">这个筛选下没有条目。</div>}
      {rows.map((it) => {
        const a = it[lang]; const dec = resume.audit?.decisions[it.sourceId]?.[lang];
        const ed = editing?.id === it.sourceId;
        return (
          <div key={it.sourceId} className={`audit-item lv-${a.level}`} data-testid="audit-item" data-level={a.level}>
            <div className="audit-head">
              <span className={`lv ${a.level}`}>{LEVEL_LABEL[a.level]}</span>
              <span className="muted small" title={it.sourceId}>来源：{it.sourcePath}{it.source ? '' : '（无效）'}</span>
              {dec && <span className={`badge ${decided(it.sourceId) ? 'st-confirmed' : 'st-stale'}`}>{dec.recheck ? '需重新检查' : DEC_LABEL[dec.decision]}</span>}
            </div>
            <div className="audit-cols">
              <div><div className="muted small">原始资料{a.originalLang !== lang ? `（${a.originalLang === 'zh' ? '中文' : '英文'}）` : ''}</div><div className="audit-text">{a.original ? <DiffOld a={a.original} b={a.rewrite} /> : <span className="muted">（资料库中没有原文）</span>}</div></div>
              <div><div className="muted small">AI 改写结果</div>
                {ed ? <textarea rows={3} value={editing!.text} onChange={(e) => setEditing({ id: it.sourceId, text: e.target.value })} data-testid="audit-edit" />
                  : <div className="audit-text">{a.original && a.originalLang === lang ? <Diff a={a.original} b={a.rewrite} /> : a.rewrite}</div>}
              </div>
            </div>
            <ul className="audit-checks small">
              <li className={a.checks.sourceValid ? 'ok' : 'bad'}>{a.checks.sourceValid ? '✓ 来源有效' : '✗ 来源无效'}</li>
              <li className={a.checks.coreKept ? 'ok' : 'bad'}>{a.checks.coreKept ? '✓ 保留核心事实' : '⚠ 核心事实可能变化'}</li>
              <li className={a.checks.noNewTech ? 'ok' : 'bad'}>{a.checks.noNewTech ? '✓ 无新增技术名词' : `✗ 新增技术：${a.newTerms.join('、')}`}</li>
              <li className={a.checks.numbersKept ? 'ok' : 'bad'}>{a.checks.numbersKept ? '✓ 数字未改动' : `✗ 数字差异：${a.numberDiff.join(' ') || '见下'}`}</li>
              <li className={a.checks.roleKept ? 'ok' : 'bad'}>{a.checks.roleKept ? '✓ 本人职责未改变' : '✗ 职责 / 性质有变化'}</li>
              <li className={a.checks.needsUser ? 'bad' : 'ok'}>{a.checks.needsUser ? '需要你确认' : '无需确认'}</li>
            </ul>
            {a.findings.map((f, i) => (
              <div key={i} className={`finding ${f.level}`} data-testid={`finding-${f.code}`}>
                <b>{LEVEL_LABEL[f.level]}</b>：{f.reason}{f.quote && f.code !== 'cross-lang' ? <div className="muted small">对应原文：「{f.quote}」</div> : null}
              </div>))}
            <div className="row end">
              {ed ? <>
                <button onClick={() => setEditing(null)}>取消</button>
                <button className="primary" onClick={() => act(it.sourceId, 'edited', editing!.text)}>保存修改</button>
              </> : <>
                <button onClick={() => act(it.sourceId, 'accepted')} disabled={!a.rewrite.trim()}>✓ 接受改写</button>
                <button onClick={() => act(it.sourceId, 'restored')} disabled={!a.original || a.originalLang !== lang}>↺ 恢复原文</button>
                <button onClick={() => setEditing({ id: it.sourceId, text: a.rewrite })}>✎ 手动编辑</button>
              </>}
            </div>
          </div>);
      })}
      <div className="muted small">审查只修改这份简历的文字，不会改动个人资料库中的原始事实。技术词许可清单只说明资料里有使用记录，不代表熟练程度。</div>
    </div>
  );
}

/** 简历结果栏里的审查状态提示（B8）：存在未确认高风险时绝不显示「已验证」 */
export function AuditBadge({ onOpen }: { onOpen: () => void }) {
  const { profile, resume } = useApp();
  const s = useMemo(() => (resume ? auditResume(profile, resume).summary : null), [profile, resume]);
  if (!s) return null;
  return (
    <div className={`small ${s.unconfirmedRed ? 'err-text' : s.unconfirmed ? '' : 'ok-text'}`} data-testid="audit-badge">
      {s.unconfirmedRed ? `⚠ 事实审查：${s.unconfirmedRed} 处高风险改写未确认` : s.unconfirmed ? `事实审查：${s.unconfirmed} 处待确认` : '✓ 事实审查：需要关注的改写都已处理'}
      {' '}<button className="link" onClick={onOpen} data-testid="open-audit">🔍 事实审查</button>
    </div>
  );
}
