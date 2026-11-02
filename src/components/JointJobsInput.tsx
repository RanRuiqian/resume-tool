import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { db } from '../storage/db';
import type { JobParse } from '../types';
import type { JointGroup, JointRole } from '../types/joint';
import { newJointGroup, newJointRole, roleInput, roleInputHash, makeJointJob } from '../joint/jobs';
import { analyzeJob } from '../ai/jd';
import { recognizeScreenshot } from '../ai/ocr';
import { fileToText } from '../ai/fileText';
import { fileToDataUrl } from '../utils/download';
import { extractJdBody } from '../ai/jdText';

export function JointJobsInput({ next, back }: { next: () => void; back: () => void }) {
  const { settings, setJob } = useApp();
  const [group, setGroup] = useState<JointGroup | null>(null), [groups, setGroups] = useState<JointGroup[]>([]), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const current = useRef<JointGroup | null>(null), active = useRef(true);
  const [parsedJobs, setParsedJobs] = useState<JobParse[]>([]);
  const [readyId, setReadyId] = useState('');
  const select = async (g: JointGroup) => { current.current = g; setGroup(g); setReadyId(''); await db.state.put({ id: 'jointGroupId', value: g.id }); };
  useEffect(() => { active.current = true; let alive = true; (async () => {
    const all = await db.jdGroups.orderBy('updatedAt').reverse().toArray(), selected = await db.state.get('jointGroupId');
    if (!alive) return; setParsedJobs(await db.jobs.toArray()); setGroups(all); const g = all.find((x) => x.id === selected?.value) ?? all[0] ?? newJointGroup();
    await db.jdGroups.put(g); if (alive) await select(g);
  })().catch(() => setError('联合草稿读取失败；旧数据没有删除，请重试。')); return () => { alive = false; active.current = false; }; }, []);
  const mutate = (fn: (g: JointGroup) => void) => {
    if (!current.current) return;
    const g = structuredClone(current.current); fn(g); g.updatedAt = new Date().toISOString(); current.current = g; setGroup(g); setReadyId('');
    db.jdGroups.put(g).catch(() => setError('联合草稿保存失败，请先导出备份并检查存储空间。'));
  };
  const role = (id: string, fn: (r: JointRole) => void) => mutate((g) => { const r = g.roles.find((x) => x.id === id); if (r) fn(r); });
  const files = async (id: string, incoming: FileList | File[]) => {
    setError('');
    try {
      for (const f of [...incoming]) {
        setBusy(`正在提取 ${f.name}；仅更新所属岗位…`);
        let text: string;
        if (f.type.startsWith('image/')) {
          const url = await fileToDataUrl(f), ocr = await recognizeScreenshot(settings, url, (m) => setBusy(m)); text = ocr.text;
          role(id, (r) => { r.screenshots.push({ url, raw: text }); });
        } else text = await fileToText(f);
        role(id, (r) => { r.text = [r.text, extractJdBody(text).text].filter(Boolean).join('\n'); });
      }
    } catch (e) { setError(`提取失败：${(e as Error).message}；可手动粘贴 OCR 原文。`); }
    finally { setBusy(''); }
  };
  const parse = async (id: string, force: boolean) => {
    const g = current.current!, r = g.roles.find((x) => x.id === id)!;
    if (!g.company.trim() || !r.name.trim() || !r.text.trim()) throw new Error('先填写企业、岗位名称与 JD 正文');
    setBusy(`正在独立解析「${r.name}」${force ? '（创建新版本）' : '（未变化时复用）'}…`);
    const previous = r.analysisId ? await db.jobs.get(r.analysisId) : undefined;
    const result = await analyzeJob(settings, roleInput(g, r), { current: previous ?? null, history: (await db.jobs.toArray()).filter((j) => !j.joint), force });
    if (result.aiError) throw new Error(`${r.name} 解析失败：${result.aiError}；联合模式不会把规则结果伪装为语义分析成功`);
    if (result.reused === 'current') return;
    // 同一 JD 复用原 ID，显式强制重新解析才新增 revision；旧原文/截图/解析从不覆盖。
    const parsed = { ...result.job, screenshots: r.screenshots.map((s) => s.url), ocrRawText: r.screenshots.map((s) => s.raw).join('\n') };
    if (roleInputHash(current.current!, current.current!.roles.find((x) => x.id === id)!) !== roleInputHash(g, r)) throw new Error('解析期间输入已变化，保留旧分析，请按新输入重试');
    await db.jobs.add(parsed); setParsedJobs(await db.jobs.toArray());
    role(id, (target) => {
      if (!target.analyses.some((a) => a.jobId === parsed.id)) target.analyses.push({ jobId: parsed.id, revision: target.analyses.length + 1, inputHash: roleInputHash(g, r), at: parsed.createdAt });
      target.analysisId = parsed.id; target.companyConfirmed = false;
    });
  };
  const run = async (id?: string, force = false) => {
    setError('');
    try {
      if (id) await parse(id, force);
      else {
        for (const r of current.current!.roles) { if (!active.current) return; await parse(r.id, false); }
        const job = makeJointJob(current.current!, await db.jobs.toArray());
        const old = await db.jobs.get(job.id);
        if (old && JSON.stringify(old.joint) !== JSON.stringify(job.joint)) throw new Error('联合岗位版本 ID 冲突，未覆盖旧分析，请新建联合组后重试');
        if (!active.current) return; // 离开该页面后只保留历史，不抢占用户当前选中的岗位。
        setJob(old ?? job); setReadyId(job.id);
        await db.jdGroups.put(current.current!);
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  if (!group) return <p role="status">读取联合岗位草稿…</p>;
  return <div className="step" data-testid="joint-jobs-input">
    <h2>② 同一企业多岗位联合匹配</h2><p className="notice">分别解析 1–3 份 JD，再在生成阶段由 AI 归纳共同、互补与冲突要求，只生成一份共同简历。所有草稿/历史留在本机，重新解析不覆盖已编辑简历；岗位差异过大时会明确提示。</p>
    <div className="row"><label>已有联合组<select aria-label="已有联合组" value={group.id} disabled={!!busy} onChange={(e) => { const g = groups.find((x) => x.id === e.target.value); if (g) select(g); }}><option value={group.id}>{group.company || '未命名联合组'}</option>{groups.filter((g) => g.id !== group.id).map((g) => <option key={g.id} value={g.id}>{g.company || g.id}</option>)}</select></label>
      <button disabled={!!busy} onClick={async () => { await db.jdGroups.put(current.current!); const g = newJointGroup(); await db.jdGroups.put(g); setGroups(await db.jdGroups.orderBy('updatedAt').reverse().toArray()); await select(g); }}>新建联合组（保留当前）</button></div>
    <label>共同企业名称<input data-testid="joint-company" value={group.company} disabled={!!busy} onChange={(e) => mutate((g) => { g.company = e.target.value; g.roles.forEach((r) => { r.companyConfirmed = false; }); })} /></label>
    {group.roles.map((r, i) => {
      const parsed = parsedJobs.find((j) => j.id === r.analysisId);
      const revision = r.analyses.find((a) => a.jobId === r.analysisId), stale = !revision || revision.inputHash !== roleInputHash(group, r);
      return <div className="card" key={r.id} data-testid="joint-role">
        <div className="row"><b>岗位 {i + 1}</b><span className="muted small">{r.id} · {revision ? `解析版本 ${revision.revision}` : '未解析'}{stale ? ' · 待解析 / 已过期' : ' · 分析可用'}</span><span className="spacer" /><button disabled={!!busy || group.roles.length === 1} onClick={() => mutate((g) => { const old = g.roles.find((x) => x.id === r.id)!; g.archivedRoles.push(old); g.roles = g.roles.filter((x) => x.id !== r.id); })}>移除此岗位（归档保留）</button></div>
        <label>岗位名称<input data-testid="joint-role-name" disabled={!!busy} value={r.name} onChange={(e) => role(r.id, (x) => { x.name = e.target.value; x.companyConfirmed = false; })} /></label>
        <label>岗位链接（可选，不自动抓取网页）<input type="url" value={r.url} disabled={!!busy} onChange={(e) => role(r.id, (x) => { x.url = e.target.value; })} /></label>
        <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) files(r.id, e.dataTransfer.files); }} onPaste={(e) => { if (e.clipboardData.files.length && !busy) { e.preventDefault(); files(r.id, e.clipboardData.files); } }}>
          <label>该岗位文件 / 截图（支持多文件、拖拽、粘贴截图）<input type="file" multiple disabled={!!busy} accept="image/*,.txt,.pdf,.docx,.json" onChange={(e) => { if (e.target.files) files(r.id, e.target.files); e.target.value = ''; }} /></label>
        </div>
        <label>该岗位 JD 正文 / 已有 OCR 原文<textarea rows={6} data-testid="joint-role-text" value={r.text} disabled={!!busy} onChange={(e) => role(r.id, (x) => { x.text = e.target.value; x.companyConfirmed = false; })} /></label>
        {r.screenshots.map((s, n) => <details key={n}><summary>截图 {n + 1} 与 OCR 原文</summary><img src={s.url} style={{ maxWidth: 240 }} /><pre className="src-pre">{s.raw}</pre><button disabled={!!busy} onClick={() => role(r.id, (x) => { x.screenshots.splice(n, 1); })}>移除草稿截图（正文保留，可手动替换）</button></details>)}
        {parsed && <details><summary>查看该岗位独立解析结果（请核对企业与要求）</summary><p>解析企业：{parsed.company.full || parsed.company.short || '未识别'} · {parsed.title.zh || parsed.title.en}</p>{[['硬性要求', parsed.mustHave], ['职责', parsed.responsibilities ?? []], ['可选要求', parsed.niceToHave], ['工具 / 关键词', parsed.keywords]].map(([label, rows]) => <div key={String(label)}><b>{String(label)}</b><ul>{(rows as typeof parsed.mustHave).map((q, n) => <li key={n}>{q.zh || q.en}</li>)}</ul></div>)}</details>}
        <label className="check"><input type="checkbox" checked={r.companyConfirmed === true} disabled={!!busy || stale} onChange={(e) => role(r.id, (x) => { x.companyConfirmed = e.target.checked; })} />如解析企业名称存在异语或简称差异：我已核对该 JD 与共同企业为同一公司</label>
        <div className="row"><button disabled={!!busy} onClick={() => run(r.id)}>独立解析 / 复用</button><button disabled={!!busy || !r.analysisId} onClick={() => run(r.id, true)}>强制重新解析（新版本）</button></div>
        {r.analyses.length > 0 && <details><summary>该岗位解析历史（{r.analyses.length}）</summary>{r.analyses.map((a) => <p className="small" key={a.jobId}>v{a.revision} · {a.jobId} · {a.at}</p>)}</details>}
      </div>;
    })}
    <button disabled={!!busy || group.roles.length >= 3} onClick={() => mutate((g) => { g.roles.push(newJointRole()); })}>+ 添加岗位（最多三个）</button>
    {group.archivedRoles.length > 0 && <details className="card"><summary>已归档岗位（{group.archivedRoles.length}，可恢复）</summary>{group.archivedRoles.map((r, i) => <div key={`${r.id}-${i}`}>{r.name || r.id}<button disabled={!!busy || group.roles.length >= 3 || group.roles.some((x) => x.id === r.id)} onClick={() => mutate((g) => { g.roles.push(g.archivedRoles.splice(i, 1)[0]); })}>恢复</button></div>)}</details>}
    {busy && <div role="status" className="notice">{busy}</div>}{error && <div className="notice error">{error}</div>}
    {readyId && <div className="notice ok" data-testid="joint-ready">各 JD 已独立保存。下一步进行联合选材与证据归纳；已有简历会保留，需明确重新生成。</div>}
    <div className="row nav-row"><button disabled={!!busy} onClick={back}>← 上一步</button><span className="spacer" /><button disabled={!!busy} onClick={() => run()}>解析全部并准备联合生成</button><button className="primary" disabled={!!busy || !readyId} onClick={next}>生成共同简历 →</button></div>
  </div>;
}
