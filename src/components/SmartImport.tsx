import { useState } from 'react';
import { useApp } from '../store';
import { useL } from '../i18n';
import { importProfileDetailed, type Uncertain } from '../ai/importProfile';
import { translateProfile } from '../ai/translate';
import { fileToText } from '../ai/fileText';
import { ProgressNote } from './ProgressNote';
import type { ProfileDoc } from '../types';
import { applyImportPlan, buildImportPlan, sectionLabel, type ImportPlan, type PlanAction } from '../ai/importPlan';
import { normalizeProfile } from '../storage/profileIO';

const PLACEHOLDER = `随便写，不用管顺序和格式，例如：
我叫李明，1998年5月出生，男，籍贯湖南长沙，党员。电话 138-0000-0000，邮箱 liming@example.com
2016-2020 中山大学 软件工程 本科，GPA 3.7，拿过两次一等奖学金
现在在腾讯做后端开发（2021.7 至今），负责支付对账服务，把对账耗时从 2 小时降到 15 分钟
之前在字节实习过半年，做推荐系统特征工程
会 Go、Java、MySQL、Redis、Kafka；英语六级 580；有 AWS 认证
大学参加 ACM 区域赛拿过银牌……`;

/** 「我的资料」顶部：自由文本一键识别并填入 → 复核 → 合并/替换 */
export function SmartImport() {
  const { settings, profile, replaceProfile } = useApp();
  const L = useL();
  const [text, setText] = useState('');
  const [prog, setProg] = useState<{ m: string; p?: number } | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const [res, setRes] = useState<{ p: ProfileDoc; u: Uncertain[] } | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [undoDoc, setUndoDoc] = useState<ProfileDoc | null>(null);
  const [done, setDone] = useState('');

  const loadFile = async (f: File) => {
    setErr(''); setProg({ m: L(`读取 ${f.name}`, `Reading ${f.name}`) });
    try { const t = await fileToText(f, (m, p) => setProg({ m, p })); setText((x) => (x ? x + '\n\n' : '') + t); }
    catch (e) { setErr((e as Error).message); } finally { setProg(null); }
  };
  const run = async () => {
    if (settings.demoMode) { setErr(L('演示模式不调用 AI。请先在「设置」连接 AI 服务。', 'Demo mode does not call AI. Connect an AI provider in Settings first.')); return; }
    setErr(''); setDone(''); setRes(null);
    try {
      const r = await importProfileDetailed(settings, text, (i, n) => setProg({ m: n > 1 ? L(`AI 识别中（第 ${i}/${n} 段）…`, `Recognizing (part ${i}/${n})…`) : L('AI 识别中（约 10–40 秒）…', 'Recognizing (10–40 s)…'), p: n > 1 ? (i - 1) / (n + 1) : undefined }));
      setProg({ m: L('生成另一种语言（机翻待校对）…', 'Translating (marked machine-translated)…') });
      let p = r.profile;
      try { p = (await translateProfile(settings, p, p.primaryLanguage === 'zh' ? 'en' : 'zh')).profile; } catch { /* 翻译失败不影响识别结果 */ }
      setRes({ p, u: r.uncertain }); setPlan(buildImportPlan(profile, p, r.uncertain)); setUndoDoc(null);
    } catch (e) { setErr(L('识别失败：', 'Failed: ') + (e as Error).message); } finally { setProg(null); }
  };
  const apply = async (mode: 'merge' | 'replace') => {
    if (!res || !plan) return;
    if (mode === 'replace' && !confirm(L('替换会用识别结果覆盖现有资料（照片保留；替换前会自动存快照，可在「资料快照」里恢复）。确定吗？', 'Replace will discard your current profile (photo kept; a snapshot is saved first). Continue?'))) return;
    const before = structuredClone(profile);
    try {
      const n = mode === 'merge' ? applyImportPlan(profile, res.p, plan) : { ...res.p, glossary: profile.glossary, profile: { ...res.p.profile, photo: profile.profile.photo, photoAspect: profile.profile.photoAspect } };
      const checked = normalizeProfile(JSON.parse(JSON.stringify(n))); // 校验结果完整可序列化，失败则不写入
      await replaceProfile(checked, mode === 'merge' ? '智能导入合并前' : '智能导入替换前');
    } catch (e) {
      // 回退：任何一步失败都恢复导入前的资料
      try { await replaceProfile(before, '导入失败回退'); } catch { /* 写库失败时内存状态未变 */ }
      setErr(L('导入失败，资料已回退到导入前：', 'Import failed; profile rolled back: ') + (e as Error).message); return;
    }
    setUndoDoc(before); setRes(null); setPlan(null); setText('');
    setDone(mode === 'merge' ? L('已按你的选择导入。标 ⚠ 的条目请在下方核对，英文为机翻待校对。', 'Imported as selected. Review entries marked ⚠ below.') : L('已替换。请在下方各栏核对。', 'Replaced. Review below.'));
  };
  const undoImport = async () => { if (!undoDoc) return; await replaceProfile(undoDoc, '撤销导入前'); setUndoDoc(null); setDone(L('已撤销本次导入。', 'Import undone.')); };
  const setAction = (key: string, a: PlanAction) => setPlan((pl) => pl && { ...pl, items: pl.items.map((x) => (x.key === key ? { ...x, action: a } : x)) });
  const setConflict = (key: string, f: string, useNew: boolean) => setPlan((pl) => pl && { ...pl, items: pl.items.map((x) => (x.key === key ? { ...x, conflicts: x.conflicts.map((c) => (c.field === f ? { ...c, useNew } : c)) } : x)) });
  const setBasic = (path: string, useNew: boolean) => setPlan((pl) => pl && { ...pl, basics: pl.basics.map((b) => (b.path === path ? { ...b, useNew } : b)) });

  const p = res?.p;
  const pr = p?.profile;
  const uncertainOf = (sec: string) => res?.u.filter((x) => x.field.toLowerCase().startsWith(sec)) ?? [];
  const rows: [string, string, number, string][] = p ? [
    ['basic', L('基本信息', 'Basic info'), [pr!.name.zh || pr!.name.en, pr!.headline.zh || pr!.headline.en, pr!.contacts.phone, pr!.contacts.email, pr!.contacts.location?.zh || pr!.contacts.location?.en].filter(Boolean).length,
      [pr!.name.zh || pr!.name.en, pr!.headline.zh || pr!.headline.en, pr!.contacts.phone, pr!.contacts.email, pr!.contacts.location?.zh || pr!.contacts.location?.en].filter(Boolean).join(' · ')],
    ['personal', L('个人信息', 'Personal'), Object.values(pr!.personal ?? {}).filter(Boolean).length,
      [pr!.personal?.birth, pr!.personal?.gender, pr!.personal?.hometown, pr!.personal?.politics].filter(Boolean).join(' · ')],
    ['education', L('教育', 'Education'), p.education.length, p.education.map((e) => `${e.school.zh || e.school.en} ${e.major.zh || e.major.en || ''}`).join('；')],
    ['work', L('工作', 'Work'), p.work.length, p.work.map((e) => `${e.company.zh || e.company.en}·${e.title.zh || e.title.en}（${e.bullets.length}）`).join('；')],
    ['projects', L('项目', 'Projects'), p.projects.length, p.projects.map((e) => e.name.zh || e.name.en).join('；')],
    ['skills', L('技能', 'Skills'), p.skills.length, p.skills.map((e) => e.name.zh || e.name.en).join('、')],
    ['certificates', L('证书', 'Certificates'), p.certificates.length, p.certificates.map((e) => e.name.zh || e.name.en).join('；')],
    ['awards', L('获奖', 'Awards'), p.awards.length, p.awards.map((e) => e.name.zh || e.name.en).join('；')],
    ['evidence', L('证据（待你核对）', 'Evidence (unconfirmed)'), p.evidence.length, p.evidence.map((e) => e.fileName || e.location).join('；')],
  ] : [];
  const missingDates = p ? [...p.work, ...p.education, ...p.projects].filter((e) => !e.start).length : 0;
  const hasExisting = !!(profile.profile.name.zh || profile.profile.name.en || profile.work.length || profile.education.length);

  return (
    <div className="card smart-import" data-testid="smart-import">
      <h3>{L('✍️ 一次写完所有经历，AI 帮你分类填好', '✍️ Write everything once — AI sorts it into the fields')}</h3>
      <p className="muted small">{L('把个人信息、教育、工作、项目、技能、证书、获奖一股脑写进来，顺序和格式都不重要，也可以把旧简历文件拖进框里。AI 只整理你写的内容，不会编造；没写的字段保持空白。', 'Paste or type all your background in any order. You can also drop an old resume file into the box. AI only organizes what you wrote — nothing is invented; unknown fields stay empty.')}</p>
      <textarea className={`big-input ${drag ? 'drag' : ''}`} rows={10} value={text} placeholder={PLACEHOLDER} onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); }} />
      <div className="row">
        <label className="filebtn">📎 {L('或选择文件（PDF / Word / 图片 / txt）', 'or choose a file (PDF / Word / image / txt)')}<input type="file" hidden accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} /></label>
        <span className="muted small">{text.length ? L(`${text.length} 字`, `${text.length} chars`) : ''}</span>
        <span className="spacer" />
        <button className="primary big" disabled={!text.trim() || !!prog} onClick={run}>✨ {L('智能识别并填入', 'Recognize & fill')}</button>
      </div>
      {prog && <ProgressNote msg={prog.m} pct={prog.p} />}
      {err && <div className="notice error">{err}</div>}
      {done && <div className="notice ok">✓ {done}{undoDoc && <button className="link" onClick={undoImport}>{L('撤销本次导入', 'Undo import')}</button>}</div>}
      {res && (
        <div className="review" data-testid="import-review">
          <h4>{L('识别结果，请确认', 'Recognized — please review')}</h4>
          <table><tbody>{rows.map(([k, label, n, sum]) => {
            const u = uncertainOf(k === 'basic' ? 'name' : k);
            return (
              <tr key={k} className={n === 0 ? 'empty-row' : ''}>
                <td><b>{label}</b></td><td className="num">{n}</td>
                <td className="small">{sum || <span className="muted">{L('未识别到（保持空白）', 'none found (left empty)')}</span>}
                  {u.map((x, i) => <div key={i} className="uncertain">⚠ {x.field}：{x.note}</div>)}</td>
              </tr>);
          })}</tbody></table>
          {res.u.filter((x) => !rows.some(([k]) => x.field.toLowerCase().startsWith(k === 'basic' ? 'name' : k))).map((x, i) => <div key={i} className="uncertain small">⚠ {x.field}：{x.note}</div>)}
          {missingDates > 0 && <div className="uncertain small">⚠ {L(`${missingDates} 段经历没有识别到开始时间，请在下方补上`, `${missingDates} entries have no start date — please fill in below`)}</div>}
          <div className="muted small">{L('另一种语言为机翻，已标记「机翻待校对」。', 'The other language is machine-translated and marked for review.')}</div>
          {hasExisting && plan && (plan.items.length > 0 || plan.basics.length > 0) && (
            <div className="import-plan" data-testid="import-plan">
              <h4>{L('和现有资料对照（逐条选择怎么处理）', 'Compare with your profile')}</h4>
              <p className="muted small">{L('「合并」只会追加新要点、补空白字段；有冲突的字段默认保留你原来的值。', 'Merge only appends new points and fills blanks; conflicting fields keep your old value by default.')}</p>
              <table><tbody>
                {plan.basics.map((b) => (
                  <tr key={b.path} className={b.useNew ? '' : 'skip'}><td>{L('基本信息', 'Basic')}</td><td><b>{b.label}</b></td>
                    <td className="small">{b.old ? <><span className="old">{b.old}</span> → </> : null}<span className="new">{b.new}</span>{b.old && <div className="uncertain">⚠ {L('与现有值不同', 'differs from current value')}</div>}</td>
                    <td><label className="check"><input type="checkbox" checked={b.useNew} onChange={(e) => setBasic(b.path, e.target.checked)} /> {b.old ? L('用新值', 'use new') : L('填入', 'fill')}</label></td></tr>))}
                {plan.items.map((it) => (
                  <tr key={it.key} className={it.action === 'skip' ? 'skip' : ''}>
                    <td>{sectionLabel(it.section)}</td>
                    <td><b>{it.title}</b><div>{it.status === 'new' ? <span className="badge st-confirmed">{L('新增', 'new')}</span>
                      : it.status === 'duplicate' ? <span className="badge st-manual">{L('重复', 'duplicate')}</span>
                      : it.status === 'conflict' ? <span className="badge st-stale">{L('有冲突', 'conflict')}</span> : <span className="badge st-machine">{L('可能重复', 'maybe same')}</span>}</div></td>
                    <td className="small">
                      {it.matchTitle && <div className="muted">{L('对应已有：', 'Matches: ')}{it.matchTitle}{it.samePoints ? L(`（${it.samePoints} 条要点已存在，跳过）`, ` (${it.samePoints} points already there)`) : ''}</div>}
                      {it.newPoints.map((x, i) => <div key={i} className="new">＋ {x}</div>)}
                      {it.conflicts.map((c) => <div key={c.field} className="uncertain">⚠ {c.label}：<span className={c.useNew ? 'old' : ''}>{c.old}</span> / <span className={c.useNew ? 'new' : 'old'}>{c.new}</span>
                        <label className="check"><input type="checkbox" checked={c.useNew} onChange={(e) => setConflict(it.key, c.field, e.target.checked)} /> {L('用新值', 'use new')}</label></div>)}
                      {it.uncertain.map((x, i) => <div key={i} className="uncertain">⚠ {x}</div>)}
                    </td>
                    <td><select value={it.action} onChange={(e) => setAction(it.key, e.target.value as PlanAction)}>
                      {it.matchId && <option value="merge">{L('合并', 'Merge')}</option>}
                      <option value="add">{L('作为新条目', 'Add new')}</option>
                      <option value="skip">{L('不导入', 'Skip')}</option>
                    </select></td>
                  </tr>))}
              </tbody></table>
            </div>
          )}
          <div className="row end">
            <button onClick={() => { setRes(null); setPlan(null); }}>{L('取消', 'Cancel')}</button>
            {hasExisting && <button className="danger" onClick={() => apply('replace')}>{L('替换现有资料', 'Replace profile')}</button>}
            <button className="primary" onClick={() => apply('merge')}>{hasExisting ? L('按以上选择导入', 'Import as selected') : L('填入资料', 'Fill profile')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
