import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { useL } from '../i18n';
import { importProfileDetailed, type Uncertain } from '../ai/importProfile';
import { translateProfile } from '../ai/translate';
import { fileToText } from '../ai/fileText';
import { ProgressNote } from './ProgressNote';
import { WORK_KIND_LABEL, type LocalizedText, type ProfileDoc, type SourceText, type WorkKind } from '../types';
import { applyImportPlan, applyReplace, buildImportPlan, mergePreview, planSummary, sampleResidue, type ImportMode, type ImportPlan, type PlanAction, type PlanItem, type PlanSection } from '../ai/importPlan';
import { normalizeProfile } from '../storage/profileIO';
import { CRITICAL } from '../ai/sourceCheck';
import sample from '../sample/sample-profile.json';

const PLACEHOLDER = `随便写，不用管顺序和格式，例如：
我叫李明，1998年5月出生，男，籍贯湖南长沙，党员。电话 138-0000-0000，邮箱 liming@example.com
2016-2020 中山大学 软件工程 本科，GPA 3.7，拿过两次一等奖学金
现在在腾讯做后端开发（2021.7 至今），负责支付对账服务，把对账耗时从 2 小时降到 15 分钟
之前在字节实习过半年，做推荐系统特征工程
会 Go、Java、MySQL、Redis、Kafka；英语六级 580；有 AWS 认证
大学参加 ACM 区域赛拿过银牌……`;

type FileStatus = 'parsing' | 'ok' | 'warn' | 'error';
interface FileCard { id: string; name: string; type: string; size: number; status: FileStatus; msg: string; text: string; open: boolean }
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const kindOf = (f: File) => { const n = f.name.toLowerCase(); return n.endsWith('.pdf') ? 'PDF' : n.endsWith('.docx') ? 'Word' : n.endsWith('.doc') ? 'Word (.doc)' : f.type.startsWith('image/') ? '图片' : n.endsWith('.md') ? 'Markdown' : 'TXT'; };
const ltk = (t?: LocalizedText) => (t ? t.zh || t.en || '' : '');
type AnyEntry = Record<string, unknown> & { id: string };
const SAMPLE = normalizeProfile(structuredClone(sample));

const GROUPS: { key: string; label: string; secs: PlanSection[] }[] = [
  { key: 'education', label: '教育', secs: ['education'] },
  { key: 'work', label: '工作及社会经历', secs: ['work'] },
  { key: 'projects', label: '项目', secs: ['projects'] },
  { key: 'skills', label: '技能', secs: ['skills'] },
  { key: 'certificates', label: '证书', secs: ['certificates'] },
  { key: 'awards', label: '获奖', secs: ['awards'] },
  { key: 'evidence', label: '证据材料', secs: ['evidence'] },
];
const ACTION_LABEL: Record<PlanAction, string> = { add: '新增条目', merge: '合并已有条目', replace: '替换已有条目', skip: '跳过', undecided: '请选择处理方式…' };
const STATUS: Record<string, [string, string]> = { new: ['新增', 'st-confirmed'], duplicate: ['与已有重复', 'st-manual'], maybe: ['可能重复', 'st-machine'], conflict: ['有冲突', 'st-stale'], internal: ['本次识别内重复', 'st-machine'] };
const FIELD_LABEL: Record<string, string> = { school: '学校', degree: '学位', major: '专业', company: '单位', title: '职位', name: '名称', role: '角色', start: '开始', end: '结束', date: '日期', issuer: '颁发机构', category: '分类', link: '链接', kind: '类型', nature: '性质', aliases: '其它称呼', notes: '备注（不进简历）', courses: '课程', coursesInText: '原文课程数', courseCompletionDate: '课程完成', expectedConferralDate: '预计授予学位', actualConferralDate: '实际授予学位', availableFullTimeDate: '可全职入职', bullets: '要点', highlights: '亮点', tags: '标签', location: '位置', proves: '证明事实', fileName: '文件名', type: '类型', uncertain: '待核对' };

function fieldRows(e: AnyEntry): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(e)) {
    if (!FIELD_LABEL[k] || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    let s = '';
    if (Array.isArray(v)) s = v.map((x) => (typeof x === 'string' ? x : ltk(x as LocalizedText))).filter(Boolean).join(k === 'courses' || k === 'tags' || k === 'aliases' ? '、' : '\n');
    else if (typeof v === 'object') { const t = v as LocalizedText; s = [t.zh, t.en].filter(Boolean).join(' / '); }
    else s = k === 'kind' ? (WORK_KIND_LABEL[v as WorkKind] ?? (v === 'core' ? '核心项目' : v === 'auxiliary' ? '辅助项目' : String(v))) : String(v);
    if (k === 'courses') s = `${(v as string[]).length} 门：${s}`;
    if (s) out.push([FIELD_LABEL[k], s]);
  }
  return out;
}
const dates = (e?: AnyEntry) => { if (!e) return ''; const s = (e.start || e.date || '') as string; const en = e.end as string | undefined; const exp = e.expectedConferralDate as string | undefined; return [s, en === 'present' ? '至今' : en].filter(Boolean).join(' — ') + (exp && !e.actualConferralDate ? `（预计 ${exp}）` : ''); };
const typeLabel = (sec: PlanSection, e?: AnyEntry) => {
  if (!e) return '';
  if (sec === 'work') return WORK_KIND_LABEL[(e.kind as WorkKind) ?? ''] ?? '';
  if (sec === 'projects') return [e.kind === 'core' ? '核心项目' : e.kind === 'auxiliary' ? '辅助项目' : '', e.nature as string].filter(Boolean).join(' · ');
  if (sec === 'education') return ltk(e.degree as LocalizedText);
  return '';
};

/** 「我的资料」顶部：上传 / 粘贴 → 本地提取文字 → 点击后 AI 识别 → 预览 → 合并或替换（替换前自动快照） */
export function SmartImport() {
  const { settings, profile, replaceProfile } = useApp();
  const L = useL();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileCard[]>([]);
  const [prog, setProg] = useState<{ m: string; p?: number } | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const [res, setRes] = useState<{ p: ProfileDoc; u: Uncertain[]; src: SourceText } | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [undo, setUndo] = useState<{ doc: ProfileDoc; snap: string | null } | null>(null);
  const [done, setDone] = useState('');

  const aiText = useMemo(() => [text.trim(), ...files.filter((f) => f.status !== 'error' && f.text.trim()).map((f) => `【文件：${f.name}】\n${f.text}`)].filter(Boolean).join('\n\n'), [text, files]);
  const upd = (id: string, f: (c: FileCard) => FileCard) => setFiles((l) => l.map((c) => (c.id === id ? f(c) : c)));

  const loadFile = async (f: File) => {
    setErr('');
    const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const kind = kindOf(f);
    setFiles((l) => [...l, { id, name: f.name, type: kind, size: f.size, status: 'parsing', msg: L('正在本地提取文字…', 'Extracting locally…'), text: '', open: false }]);
    try {
      const t = (await fileToText(f, (m, p) => upd(id, (c) => ({ ...c, msg: p !== undefined ? `${m}（${Math.round(p * 100)}%）` : m })))).trim();
      const n = t.replace(/\s/g, '').length;
      if (!n) { upd(id, (c) => ({ ...c, status: 'error', msg: kind === '图片' || kind === 'PDF' ? L('没有提取到文字：OCR 失败或图片 / 扫描件不清晰。可以换更清晰的文件，或直接把文字粘贴到下方。', 'No text found (OCR failed or unclear scan).') : L('文件里没有可读取的文字。', 'No readable text.') })); return; }
      const warn = kind === '图片' ? L('文字由本地 OCR 识别，可能有错字，请展开核对。', 'Text from local OCR — please check.')
        : n < 200 && kind !== 'TXT' && kind !== 'Markdown' ? L(`只提取到 ${n} 个字，内容可能不完整（扫描版 PDF 只识别前 4 页），请展开核对。`, `Only ${n} chars extracted — may be incomplete.`) : '';
      upd(id, (c) => ({ ...c, text: t, status: warn ? 'warn' : 'ok', msg: warn || L(`已在本地提取 ${t.length} 字，尚未发送给 AI`, `${t.length} chars extracted locally, not sent to AI yet`), open: kind === 'TXT' || kind === 'Markdown' }));
    } catch (e) { upd(id, (c) => ({ ...c, status: 'error', msg: L('解析失败：', 'Parse failed: ') + (e as Error).message })); }
  };

  const run = async () => {
    if (settings.demoMode) { setErr(L('演示模式不调用 AI。请先在「设置」连接 AI 服务。', 'Demo mode does not call AI. Connect an AI provider in Settings first.')); return; }
    setErr(''); setDone(''); setRes(null); setPlan(null);
    try {
      const r = await importProfileDetailed(settings, aiText, (i, n) => setProg({ m: n > 1 ? L(`AI 识别中（第 ${i}/${n} 段）…`, `Recognizing (part ${i}/${n})…`) : L('AI 识别中（约 10–60 秒）…', 'Recognizing…'), p: n > 1 ? (i - 1) / (n + 1) : undefined }));
      setProg({ m: L('生成另一种语言（机翻待校对）…', 'Translating (marked machine-translated)…') });
      let p = r.profile;
      try { p = (await translateProfile(settings, p, p.primaryLanguage === 'zh' ? 'en' : 'zh')).profile; } catch { /* 翻译失败不影响识别结果 */ }
      const src: SourceText = { id: `src-${Date.now().toString(36)}`, at: new Date().toISOString(), files: files.filter((f) => f.status !== 'error').map((f) => f.name), text: aiText };
      setRes({ p, u: r.uncertain, src }); setPlan(buildImportPlan(profile, p, r.uncertain)); setUndo(null); setOpen({});
      setMode(hasExisting && sampleResidue(profile, SAMPLE).length ? 'replace' : 'merge');
    } catch (e) { setErr(L('识别失败：', 'Failed: ') + (e as Error).message); } finally { setProg(null); }
  };

  const hasExisting = !!(profile.profile.name.zh || profile.profile.name.en || profile.work.length || profile.education.length || profile.projects.length);
  const residue = useMemo(() => sampleResidue(profile, SAMPLE), [profile]);
  const effMode: ImportMode = hasExisting ? mode : 'merge';

  const apply = async () => {
    if (!res || !plan) return;
    if (effMode === 'replace' && !confirm(L('替换会清空现有的教育、工作、项目等全部条目，改用本次识别结果（照片和术语表保留）。替换前会自动保存快照，可随时恢复。确定吗？', 'Replace discards current entries (photo kept). A snapshot is saved first. Continue?'))) return;
    const before = structuredClone(profile);
    let snap: string | null = null;
    try {
      const n = effMode === 'merge' ? applyImportPlan(profile, res.p, plan, res.src) : applyReplace(profile, res.p, plan, res.src);
      const checked = normalizeProfile(JSON.parse(JSON.stringify(n))); // 校验结果完整可序列化，失败则不写入
      snap = await replaceProfile(checked, effMode === 'merge' ? '智能导入合并前' : '智能导入替换前');
    } catch (e) {
      try { await replaceProfile(before, '导入失败回退'); } catch { /* 写库失败时内存状态未变 */ }
      setErr(L('导入失败，资料已回退到导入前：', 'Import failed; profile rolled back: ') + (e as Error).message); return;
    }
    setUndo({ doc: before, snap }); setRes(null); setPlan(null); setText(''); setFiles([]);
    setDone(effMode === 'merge' ? L('已按你的选择合并到现有资料。标 ⚠ 的条目请在下方核对，英文为机翻待校对。', 'Merged as selected.') : L('已替换现有资料。替换前的资料已保存为快照（「资料快照」里可恢复），也可以点右侧直接回滚。', 'Replaced. A snapshot was saved.'));
  };
  const rollback = async () => { if (!undo) return; await replaceProfile(undo.doc, '回滚导入前'); setUndo(null); setDone(L('已回滚到导入前的资料。', 'Rolled back.')); };

  const setItem = (key: string, f: (x: PlanItem) => PlanItem) => setPlan((pl) => pl && { ...pl, items: pl.items.map((x) => (x.key === key ? f(x) : x)) });
  const setConflict = (key: string, fld: string, useNew: boolean) => setItem(key, (x) => ({ ...x, conflicts: x.conflicts.map((c) => (c.field === fld ? { ...c, useNew } : c)) }));
  const setBasic = (path: string, useNew: boolean) => setPlan((pl) => pl && { ...pl, basics: pl.basics.map((b) => (b.path === path ? { ...b, useNew } : b)) });

  const p = res?.p;
  const entryOf = (it: PlanItem) => (p?.[it.section] as unknown as AnyEntry[] | undefined)?.find((x) => x.id === it.incomingId);
  // 分级提示：重要冲突 / 缺失与待核对 / 普通说明
  const notices = useMemo(() => {
    const critical: string[] = [], missing: string[] = [], info: string[] = [];
    if (!p || !plan) return { critical, missing, info };
    for (const it of plan.items) {
      if (it.action === 'undecided') critical.push(`${it.title}：${it.status === 'internal' ? `可能与本次识别的「${it.intoTitle}」是同一条` : it.status === 'conflict' ? '与已有条目字段冲突' : `可能与已有「${it.matchTitle}」重复`}，请选择处理方式`);
      const e = entryOf(it);
      for (const u of [...new Set([...it.uncertain, ...(((e?.uncertain as string[] | undefined) ?? []))])]) (u.startsWith(CRITICAL) ? critical : missing).push(`${it.title}：${u.startsWith(CRITICAL) ? u.slice(CRITICAL.length) : u}`);
      if (e && ['education', 'work', 'projects'].includes(it.section) && !e.start) missing.push(`${it.title}：没有识别到开始时间`);
      if (e && it.section === 'education' && typeof e.coursesInText === 'number' && e.coursesInText > ((e.courses as string[]) ?? []).length) critical.push(`${it.title}：原文约 ${e.coursesInText} 门课程，只识别到 ${((e.courses as string[]) ?? []).length} 门，可能有遗漏。完整原文会随导入一起保存，可在「原始资料记录」中检索。`);
      if (it.relatedNote) info.push(`${it.title}：${it.relatedNote}`);
      for (const n of (e?.notes as string[] | undefined) ?? []) info.push(`${it.title}（备注，不进简历）：${n}`);
    }
    for (const x of plan.otherUncertain) missing.push(`${x.field ? x.field + '：' : ''}${x.note}`);
    info.push(L('另一种语言为机翻，已标记「机翻待校对」。', 'The other language is machine-translated.'));
    return { critical, missing, info };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, plan]);
  const sum = plan ? planSummary(plan, effMode, profile) : null;
  const pending = sum?.pending ?? 0;

  const renderItem = (it: PlanItem) => {
    const e = entryOf(it); const isOpen = !!open[it.key];
    const pv = isOpen && p && (it.status === 'internal' || it.matchId) ? mergePreview(profile, p, it) : null;
    const [stl, stc] = STATUS[it.status];
    return (
      <div key={it.key} className={`imp-item ${it.action === 'skip' ? 'skip' : ''} ${it.action === 'undecided' ? 'undecided' : ''}`} data-testid="imp-item" data-status={it.status} data-section={it.section}>
        <div className="imp-row">
          <button className="imp-head" onClick={() => setOpen((o) => ({ ...o, [it.key]: !o[it.key] }))} aria-expanded={isOpen}>
            <span className="imp-caret">{isOpen ? '▾' : '▸'}</span>
            <span className="imp-title"><b>{it.title}</b>
              <span className="imp-meta">{[dates(e), typeLabel(it.section, e)].filter(Boolean).join(' · ')}</span></span>
            <span className={`badge ${stc}`}>{stl}</span>
          </button>
          <select className="imp-action" data-testid="imp-action" value={it.action} onChange={(ev) => setItem(it.key, (x) => ({ ...x, action: ev.target.value as PlanAction }))} aria-label={L('处理方式', 'Action')}>
            {it.action === 'undecided' && <option value="undecided" disabled>{ACTION_LABEL.undecided}</option>}
            {it.status === 'internal' && <option value="merge">{L('合并到同批条目', 'Merge into sibling')}</option>}
            {it.matchId && <option value="merge">{ACTION_LABEL.merge}</option>}
            {it.matchId && <option value="replace">{ACTION_LABEL.replace}</option>}
            <option value="add">{ACTION_LABEL.add}</option>
            <option value="skip">{ACTION_LABEL.skip}</option>
          </select>
        </div>
        {isOpen && (
          <div className="imp-detail small" data-testid="imp-detail">
            {it.status === 'internal' && <div className="muted">🔁 {L(`与本次识别的「${it.intoTitle}」可能是同一条记录`, 'Possibly same as')}（{it.reasons?.join('、')}）</div>}
            {it.matchTitle && it.status !== 'internal' && <div className="muted">{L('对应已有：', 'Matches: ')}{it.matchTitle}{it.reasons?.length ? `（${it.reasons.join('、')}）` : ''}{it.samePoints ? L(`；${it.samePoints} 条要点已存在`, '') : ''}</div>}
            {pv ? (
              <div className="merge-preview" data-testid="merge-preview">
                <div><h5>{it.status === 'internal' ? L('主记录（合并前）', 'Primary (before)') : L('已有条目（合并前）', 'Existing (before)')}</h5><dl>{fieldRows(pv.before[0]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
                <div><h5>{L('本条识别结果', 'This item')}</h5><dl>{fieldRows(pv.before[1]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
                <div className="after"><h5>{L('合并后', 'After merge')}</h5><dl>{fieldRows(pv.after).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
              </div>
            ) : e && <dl className="imp-fields">{fieldRows(e).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
            {it.matchId && it.newPoints.length > 0 && <div>{it.newPoints.map((x, i) => <div key={i} className="new">＋ {x}</div>)}</div>}
            {it.conflicts.map((c) => <div key={c.field} className="conflict-line">{c.label}：<span className={c.useNew ? 'old' : ''}>{c.old}</span> → <span className={c.useNew ? 'new' : 'muted'}>{c.new}</span>
              <label className="check"><input type="checkbox" checked={c.useNew} onChange={(ev) => setConflict(it.key, c.field, ev.target.checked)} /> {L('用新值覆盖', 'use new')}</label></div>)}
            {it.conflicts.some((c) => c.oldConfirmed && c.useNew) && <label className="check uncertain"><input type="checkbox" checked={it.conflicts.every((c) => !c.oldConfirmed || !c.useNew || (c as { overrideConfirmed?: boolean }).overrideConfirmed)} onChange={(ev) => setItem(it.key, (x) => ({ ...x, conflicts: x.conflicts.map((c) => (c.oldConfirmed ? { ...c, overrideConfirmed: ev.target.checked } : c)) }))} /> {L('该字段你已确认过，仍要用新值覆盖', 'Override confirmed field')}</label>}
            {it.action === 'replace' && it.matchConfirmed && <label className="check uncertain"><input type="checkbox" checked={!!it.overrideConfirmed} onChange={(ev) => setItem(it.key, (x) => ({ ...x, overrideConfirmed: ev.target.checked }))} /> {L('这条已有记录你确认过，仍要整条替换', 'Replace a confirmed entry anyway')}</label>}
            {it.uncertain.map((x, i) => <div key={i} className="hint-missing">• {x}</div>)}
          </div>
        )}
      </div>
    );
  };

  const pr = p?.profile;
  const basicCount = pr ? [pr.name, pr.headline, pr.summary].filter((t) => ltk(t)).length + Object.values(pr.contacts).filter((v) => (typeof v === 'string' ? v : ltk(v as LocalizedText))).length + Object.values(pr.personal ?? {}).filter(Boolean).length : 0;
  const notOk = files.some((f) => f.status === 'parsing');

  return (
    <div className="card smart-import" data-testid="smart-import">
      <h3>{L('✍️ 一次写完所有经历，AI 帮你分类填好', '✍️ Write everything once — AI sorts it into the fields')}</h3>
      <p className="muted small">{L('上传旧简历 / 成绩单 / 个人资料（PDF、Word、图片、TXT），或直接粘贴文字。文件先在本机提取文字，确认无误后再点「智能识别并填入」。识别结果只是预览，确认后才写入资料。', 'Upload files or paste text. Text is extracted locally first; AI runs only when you click. Results are a preview until you confirm.')}</p>
      <div className={`dropzone ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); for (const f of Array.from(e.dataTransfer.files ?? [])) loadFile(f); }}>
        <label className="filebtn">📎 {L('选择文件（PDF / Word / 图片 / TXT，可多选）', 'Choose files (PDF / Word / image / txt)')}<input type="file" hidden multiple data-testid="smart-file" accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" onChange={(e) => { for (const f of Array.from(e.target.files ?? [])) loadFile(f); e.target.value = ''; }} /></label>
        <span className="muted small">{L('或把文件拖到这里', 'or drop files here')}</span>
      </div>
      {files.length > 0 && <div className="file-cards">{files.map((f) => (
        <div key={f.id} className={`file-card fc-${f.status}`} data-testid="file-card">
          <div className="fc-head">
            <span className="fc-name" title={f.name}>📄 {f.name}</span>
            <span className="muted small">{f.type} · {fmtSize(f.size)}</span>
            <span className={`fc-status small`} data-testid="file-status">{f.status === 'parsing' ? '⏳ ' : f.status === 'ok' ? '✓ ' : f.status === 'warn' ? '⚠ ' : '✗ '}{f.msg}</span>
            <button className="link" onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))}>{L('移除', 'Remove')}</button>
          </div>
          {f.status !== 'parsing' && f.status !== 'error' && (
            <details open={f.open} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; if (o !== f.open) upd(f.id, (c) => ({ ...c, open: o })); }}>
              <summary>{L(`查看提取文本（${f.text.length} 字，可修改）`, `View extracted text (${f.text.length} chars, editable)`)}</summary>
              <textarea className="fc-text" data-testid="file-text" rows={10} value={f.text} onChange={(e) => upd(f.id, (c) => ({ ...c, text: e.target.value }))} />
            </details>)}
        </div>))}</div>}
      <textarea className="big-input" rows={files.length ? 4 : 10} value={text} placeholder={files.length ? L('（可选）补充文字', '(optional) extra notes') : PLACEHOLDER} onChange={(e) => setText(e.target.value)} data-testid="smart-text" />
      <div className="row">
        <span className="muted small" data-testid="ai-chars">{aiText.length ? L(`共 ${aiText.length} 字将用于识别`, `${aiText.length} chars`) : ''}</span>
        <span className="spacer" />
        <button className="primary big" data-testid="smart-run" disabled={!aiText.trim() || !!prog || notOk} onClick={run} title={L('会把上面的文字发送给外部 AI 模型', 'Sends the text to the external AI model')}>✨ {L('智能识别并填入', 'Recognize & fill')}</button>
      </div>
      {!settings.demoMode && <div className="muted small" data-testid="ai-disclosure">🔒 {L(`点击后，上面的文字（含文件提取出的文字，以及其中的姓名、联系方式、本地路径等）会发送给外部 AI 模型（${settings.baseUrl || 'DeepSeek'}）用于识别；照片、证据文件本身不会发送。`, `Clicking sends the text above to the external AI model; photos and evidence files are never sent.`)}</div>}
      {prog && <ProgressNote msg={prog.m} pct={prog.p} />}
      {err && <div className="notice error">{err}</div>}
      {done && <div className="notice ok" data-testid="import-done">✓ {done}{undo && <button className="link" data-testid="import-rollback" onClick={rollback}>{L('回滚本次导入', 'Roll back')}</button>}</div>}
      {(profile.sourceTexts?.length ?? 0) > 0 && !res && (
        <details className="small source-texts" data-testid="source-texts"><summary>{L(`原始资料记录（${profile.sourceTexts!.length} 份，完整保存，不进简历）`, `Saved source texts (${profile.sourceTexts!.length})`)}</summary>
          {profile.sourceTexts!.map((s) => <details key={s.id}><summary>{s.at.slice(0, 16).replace('T', ' ')} · {s.files.join('、') || L('粘贴文字', 'pasted')} · {s.text.length} 字</summary><pre className="src-pre">{s.text}</pre></details>)}
        </details>)}
      {res && plan && p && sum && (
        <div className="review" data-testid="import-review">
          <h4>{L('识别结果预览（尚未写入资料）', 'Preview — nothing saved yet')}</h4>
          <div className="notice-levels">
            {notices.critical.length > 0 && <details open className="lv lv-critical" data-testid="lv-critical"><summary>❗ {L(`需要你决定 / 重要问题（${notices.critical.length}）`, `Needs decision (${notices.critical.length})`)}</summary><ul>{notices.critical.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
            {notices.missing.length > 0 && <details className="lv lv-missing" data-testid="lv-missing"><summary>⚠ {L(`缺失信息 / 待核对（${notices.missing.length}）`, `Missing / to check (${notices.missing.length})`)}</summary><ul>{notices.missing.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
            <details className="lv lv-info" data-testid="lv-info"><summary>ℹ {L(`说明（${notices.info.length}）`, `Notes (${notices.info.length})`)}</summary><ul>{notices.info.map((x, i) => <li key={i}>{x}</li>)}</ul></details>
          </div>
          <details className="imp-group" data-testid="imp-group-basic">
            <summary><b>{L('个人信息', 'Personal info')}</b> <span className="muted small">{basicCount} {L('项', 'fields')}{plan.basics.filter((b) => b.old).length ? ` · ${L('与现有不同', 'differs')} ${plan.basics.filter((b) => b.old).length}` : ''}</span></summary>
            <div className="small">{[ltk(pr!.name), ltk(pr!.headline), pr!.contacts.phone, pr!.contacts.email, ltk(pr!.contacts.location), pr!.personal?.birth, pr!.personal?.gender, pr!.personal?.hometown, pr!.personal?.politics].filter(Boolean).join(' · ') || L('未识别到', 'none')}</div>
            {effMode === 'merge' && plan.basics.map((b) => (
              <div key={b.path} className="imp-basic small"><b>{b.label}</b>：{b.old ? <><span className="old">{b.old}</span> → </> : null}<span className="new">{b.new}</span>
                <label className="check"><input type="checkbox" checked={b.useNew} onChange={(e) => setBasic(b.path, e.target.checked)} /> {b.old ? L('用新值覆盖', 'use new') : L('填入', 'fill')}</label></div>))}
          </details>
          {GROUPS.map((g) => {
            const its = plan.items.filter((x) => g.secs.includes(x.section));
            const dup = its.filter((x) => x.status !== 'new').length, und = its.filter((x) => x.action === 'undecided').length;
            return (
              <details key={g.key} className="imp-group" data-testid={`imp-group-${g.key}`} open={und > 0 || (its.length > 0 && its.length <= 6)}>
                <summary><b>{g.label}</b> <span className="muted small" data-testid="group-counts">{its.length} {L('条', 'items')} · {L('重复', 'dup')} {dup} · {L('待确认', 'pending')} {und}</span></summary>
                {its.length ? its.map(renderItem) : <div className="muted small">{L('未识别到（保持空白）', 'none found')}</div>}
              </details>);
          })}
          <div className="import-bar" data-testid="import-bar">
            {hasExisting && (
              <div className="mode-pick" role="radiogroup">
                <label className={`mode ${effMode === 'merge' ? 'on' : ''}`}><input type="radio" name="imode" data-testid="mode-merge" checked={effMode === 'merge'} onChange={() => setMode('merge')} /> <b>{L('合并现有资料', 'Merge')}</b><span className="muted small">{L('保留现有条目，按上面的选择新增 / 合并；冲突字段默认保留原值', 'Keep current entries; add / merge as chosen')}</span></label>
                <label className={`mode ${effMode === 'replace' ? 'on' : ''}`}><input type="radio" name="imode" data-testid="mode-replace" checked={effMode === 'replace'} onChange={() => setMode('replace')} /> <b>{L('替换现有资料', 'Replace')}</b><span className="muted small">{L('清空现有全部条目（含示例数据），只保留本次识别结果；照片保留，替换前自动存快照，可回滚', 'Discard current entries; snapshot first')}</span></label>
              </div>)}
            {hasExisting && residue.length > 0 && effMode === 'merge' && <div className="uncertain small" data-testid="sample-warning">⚠ {L(`现有资料里还有 ${residue.length} 条内置示例数据（如「${residue.slice(0, 2).join('」「')}」），合并会保留它们；建议选择「替换现有资料」。`, `${residue.length} sample entries remain; consider Replace.`)}</div>}
            <div className="bar-row">
              <span className="small" data-testid="import-summary">{L('将', 'Will')} {L('新增', 'add')} <b>{sum.add}</b> · {L('合并', 'merge')} <b>{sum.merge}</b> · {L('跳过', 'skip')} <b>{sum.skip}</b> · {effMode === 'replace' ? <>{L('移除现有', 'remove')} <b>{sum.removed}</b></> : <>{L('覆盖', 'overwrite')} <b>{sum.overwrite}</b></>}{pending > 0 && <span className="pending"> · {L('待决定', 'pending')} <b>{pending}</b></span>}</span>
              <span className="spacer" />
              <button onClick={() => { setRes(null); setPlan(null); }}>{L('取消', 'Cancel')}</button>
              <button className={effMode === 'replace' ? 'danger' : 'primary'} data-testid="import-confirm" disabled={pending > 0} title={pending > 0 ? L('还有条目未选择处理方式', 'Some items need a decision') : ''} onClick={apply}>
                {effMode === 'replace' ? L('确认替换现有资料', 'Confirm replace') : hasExisting ? L('确认合并导入', 'Confirm merge') : L('确认填入资料', 'Fill profile')}</button>
            </div>
            {pending > 0 && <div className="pending small">{L(`还有 ${pending} 条可能重复 / 有冲突，请先在上方为每条选择处理方式`, `${pending} items need a decision`)}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
