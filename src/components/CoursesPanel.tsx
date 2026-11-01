import { useRef, useState } from 'react';
import { useApp } from '../store';
import { LTField } from './LTField';
import type { CourseEntry, ProfileDoc } from '../types';
import { uid } from '../locale/text';
import { applyCourseImport, COURSE_TXT_EXAMPLE, normalizeCourse, parseCourseDraft, previewCourseImport, restoreDeletedCourse, type CourseImportChoice, type CourseImportRow } from '../storage/courses';
import { downloadBytes } from '../utils/download';

const COURSE_EVIDENCE_LABEL = { official: '官方大纲 / 截图证实', inferred: '根据名称或同类课程推断', recalled: '本人回忆', unverified: '待核实' };
export function CoursesPanel() {
  const { profile, setProfile, replaceProfile } = useApp();
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [message, setMessage] = useState('');
  const [draft, setDraft] = useState(''), [preview, setPreview] = useState<CourseImportRow[] | null>(null);
  const [choices, setChoices] = useState<Record<string, CourseImportChoice>>({}), [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ course: CourseEntry; index: number } | null>(null);
  const previewBase = useRef('');
  const courses = profile.courses ?? [];
  const update = (id: string, fn: (c: CourseEntry) => void) => {
    const next = structuredClone(profile), c = next.courses?.find((e) => e.id === id);
    if (!c) return;
    fn(c); c.defaultGradeVisible = false;
    setProfile(next);
  };
  const edit = (id: string, fn: (c: CourseEntry) => void) => update(id, (c) => { fn(c); c.confirmation = 'pending'; });
  const changeWithBackup = async (next: ProfileDoc, reason: string) => {
    setBusy(true); setMessage('');
    try { await replaceProfile(next, reason); setMessage('已保存。修改前的完整资料已存入「资料快照」。'); return true; }
    catch { setMessage('保存或备份失败；本次操作未应用，请重试，不要关闭页面。'); return false; }
    finally { setBusy(false); }
  };
  const showPreview = (text: string, label: string) => {
    try {
      const rows = previewCourseImport(courses, parseCourseDraft(text, label));
      setPreview(rows); setChoices({}); previewBase.current = JSON.stringify(courses); setMessage('草稿尚未写入资料。逐项选择后再确认；默认全部跳过。');
    } catch (e) { setPreview(null); setMessage((e as Error).message); }
  };
  const filtered = courses.filter((c) => (!search || [c.school, c.name.zh, c.name.en, c.code, c.term, ...c.knowledgeTags, ...(c.aliases ?? [])].join(' ').toLowerCase().includes(search.toLowerCase()))
    && (filter === 'all' || c.confirmation === filter || c.kind === filter));
  return <div data-testid="courses-panel">
    <div className="notice">课程是教育知识，与项目实践分开保存。推断概述不证明已掌握软件或具有职业经验。成绩完整保存在本地母库，简历默认隐藏；每份简历需另行选择。请只填写官方课程名，缺少另一语言可留空。</div>
    <div className="row">
      <label className="grow">搜索课程 / 简称 / 学期 / 知识方向<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="例如 Supply Chain 或 热管理" /></label>
      <label>筛选<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部</option><option value="pending">待确认</option><option value="confirmed">已确认</option><option value="taught">授课课程</option><option value="project-credit">项目学分</option></select></label>
      <button disabled={busy} onClick={() => {
        const next = structuredClone(profile); (next.courses ??= []).push(normalizeCourse({ id: uid('course'), level: 'bachelor' })); setProfile(next);
      }}>+ 新增课程</button>
      {undo && <button disabled={busy} onClick={async () => { try { const next = restoreDeletedCourse(profile, undo.course, undo.index); if (await changeWithBackup(next, '撤销课程删除前')) setUndo(null); } catch (e) { setMessage((e as Error).message); } }}>撤销最近一次删除</button>}
    </div>
    {message && <div className="notice" role="status">{message}</div>}
    {(['bachelor', 'master'] as const).map((level) => {
      const list = filtered.filter((c) => c.level === level), taught = courses.filter((c) => c.level === level && c.kind === 'taught').length;
      return <details className="card" key={level} open data-testid={`course-group-${level}`}>
        <summary><b>{level === 'bachelor' ? '本科课程' : '硕士课程'}</b> · {taught} 门授课课程 · {courses.filter((c) => c.level === level && c.kind === 'project-credit').length} 项项目学分 · 当前显示 {list.length}</summary>
        {list.map((c) => <details className={`card entry ${c.enabled ? '' : 'disabled'}`} key={c.id} data-testid="course-row">
          <summary>{c.school || profile.education.find((e) => e.id === c.educationId)?.school.zh || profile.education.find((e) => e.id === c.educationId)?.school.en || '学校待填'} · {c.name.zh || c.name.en || '课程名待填'} · {c.term || '学期待填'} · {c.kind === 'project-credit' ? '项目学分（不计授课课程）' : '授课课程'} · {c.confirmation === 'confirmed' ? '已确认' : '待确认'}{!c.enabled ? ' · 已停用' : ''}</summary>
          <p className="muted small">{c.id} · 概述证据：{COURSE_EVIDENCE_LABEL[c.evidenceLevel]} · 成绩默认隐藏</p>
          <div className="row"><label className="check"><input type="checkbox" checked={c.enabled} onChange={(e) => update(c.id, (v) => { v.enabled = e.target.checked; })} />启用</label>
            <button onClick={() => update(c.id, (v) => { v.confirmation = v.confirmation === 'confirmed' ? 'pending' : 'confirmed'; v.userConfirmedAt = v.confirmation === 'confirmed' ? new Date().toISOString() : undefined; })}>{c.confirmation === 'confirmed' ? '改为待确认' : '我已核对课程记录'}</button>
            <span className="spacer" /><button className="danger" disabled={busy} onClick={async () => {
              if (!confirm('删除这门课程？相关项目本身不会删除。删除前自动备份，可撤销。')) return;
              const next = structuredClone(profile); next.courses = courses.filter((e) => e.id !== c.id);
              if (await changeWithBackup(next, '删除课程前')) setUndo({ course: structuredClone(c), index: courses.findIndex((e) => e.id === c.id) });
            }}>删除课程</button></div>
          <div className="grid2">
            <label>所属教育<select value={c.educationId} onChange={(e) => edit(c.id, (v) => { v.educationId = e.target.value; })}><option value="">未关联</option>{profile.education.map((e) => <option key={e.id} value={e.id}>{e.school.zh || e.school.en} · {e.id}</option>)}</select></label>
            <label>学校原名<input value={c.school} onChange={(e) => edit(c.id, (v) => { v.school = e.target.value; })} /></label>
            <label>层次<select value={c.level} onChange={(e) => edit(c.id, (v) => { v.level = e.target.value as CourseEntry['level']; })}><option value="bachelor">本科</option><option value="master">硕士</option></select></label>
            <label>学期<input value={c.term} onChange={(e) => edit(c.id, (v) => { v.term = e.target.value; })} /></label>
            <label>类型<select value={c.kind} onChange={(e) => edit(c.id, (v) => { v.kind = e.target.value as CourseEntry['kind']; })}><option value="taught">授课课程</option><option value="project-credit">项目学分（关联现有项目）</option></select></label>
            <label>官方代码<input value={c.code} onChange={(e) => edit(c.id, (v) => { v.code = e.target.value; })} /></label>
            <label>学分原文<input value={c.credits} onChange={(e) => edit(c.id, (v) => { v.credits = e.target.value; })} /></label>
            <label>成绩原文（仅本地母库）<input value={c.grade.raw} onChange={(e) => edit(c.id, (v) => { v.grade.raw = e.target.value; })} /></label>
            <label>成绩状态<select value={c.grade.status} onChange={(e) => edit(c.id, (v) => { v.grade.status = e.target.value as CourseEntry['grade']['status']; })}><option value="recorded">已登记原文</option><option value="not-released">尚未公布</option><option value="unverified">待核实 / 遮挡</option></select></label>
          </div>
          <LTField label="正式课程名（不要自行编造译名）" value={c.name} onChange={(v) => edit(c.id, (x) => { x.name = v; })} />
          <label>别名 / 简称<input value={(c.aliases ?? []).join(', ')} onChange={(e) => edit(c.id, (v) => { v.aliases = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean); })} /></label>
          <LTField label="一句课程概述（通常 20–50 汉字，仅作知识检索，不打印到简历）" value={c.synopsis} multiline onChange={(v) => edit(c.id, (x) => { x.synopsis = v; })} />
          {(c.synopsis.zh?.length ?? 0) > 50 && <p className="err-text">概述较长，请精简成一句；原文不会被自动截断。</p>}
          <div className="grid2"><label>知识标签<input value={c.knowledgeTags.join(', ')} onChange={(e) => edit(c.id, (v) => { v.knowledgeTags = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean); })} /></label>
            <label>概述证据等级<select value={c.evidenceLevel} onChange={(e) => edit(c.id, (v) => { v.evidenceLevel = e.target.value as CourseEntry['evidenceLevel']; })}>{Object.entries(COURSE_EVIDENCE_LABEL).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
          <label>资料来源说明<input value={c.sources.find((s) => s.id === `manual-${c.id}`)?.label ?? ''} onChange={(e) => edit(c.id, (v) => { v.sources = [...v.sources.filter((s) => s.id !== `manual-${c.id}`), { id: `manual-${c.id}`, label: e.target.value }]; })} /></label>
          <p className="small muted">来源原记录：{c.sources.map((s) => [s.id, s.reference].filter(Boolean).join(' · ')).join('；') || '待填写'}</p>
          <fieldset><legend>关联现有项目 / 课程作业（不会创建新项目）</legend>{profile.projects.map((p) => <label className="check" key={p.id}><input type="checkbox" checked={c.projectIds.includes(p.id)} onChange={(e) => edit(c.id, (v) => { v.projectIds = e.target.checked ? [...v.projectIds, p.id] : v.projectIds.filter((id) => id !== p.id); })} />{p.name.zh || p.name.en}</label>)}</fieldset>
          {c.kind === 'project-credit' && !c.projectIds.length && <p className="uncertain">项目学分尚未关联项目，请选择已存在的真实项目；程序不会新建项目。</p>}
          {c.projectIds.some((id) => !profile.projects.some((p) => p.id === id)) && <p className="uncertain">存在未找到的关联项目 ID，已保留原记录，请人工核对：{c.projectIds.filter((id) => !profile.projects.some((p) => p.id === id)).join('、')}</p>}
        </details>)}
      </details>;
    })}
    <details className="card" data-testid="course-import"><summary>导入课程草稿（TXT / JSON，先看差异）</summary>
      <p className="muted small">TXT 使用带表头的竖线或 Tab 表格，JSON 使用 courses 数组。中英同课请保留相同教育 ID、学期、官方代码或稳定 ID；无法确认是否同课时停止合并。Project A/B 请标为 project-credit 并指向同一个现有项目 ID。本入口不会猜测 V5 文本的未提供格式。</p>
      <button onClick={() => downloadBytes(new TextEncoder().encode(COURSE_TXT_EXAMPLE), 'fictional-course-format.txt', 'text/plain')}>下载虚构 TXT 格式示例</button>
      <input type="file" accept=".txt,.json,text/plain,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const text = await f.text(); setDraft(text); showPreview(text, f.name); } e.target.value = ''; }} />
      <textarea rows={4} aria-label="课程草稿文本" placeholder="粘贴 TXT 表格或 JSON" value={draft} onChange={(e) => { setDraft(e.target.value); setPreview(null); }} />
      <button onClick={() => showPreview(draft, '手动粘贴课程草稿')}>预览差异</button>
      {preview && <div data-testid="course-import-preview"><p>{preview.length} 项草稿；不会创建或删除项目，不自动确认课程。</p>
        <button onClick={() => setChoices(Object.fromEntries(preview.filter((r) => !r.existingId && !r.ambiguousIds.length).map((r) => [r.incoming.id, 'add'])))}>选择全部确定为新增的课程</button>
        {preview.map((r) => <div className="card small" key={r.incoming.id}><b>{r.incoming.name.zh || r.incoming.name.en}</b> · {r.incoming.code} · {r.existingId ? `现有 ${r.existingId}；差异字段：${r.changes.join('、') || '无'}` : '新增'}
          {r.ambiguousIds.length > 0 && <p className="err-text">可能重复：{r.ambiguousIds.join('、')}。请在草稿中填写相同稳定 ID 后重新预览；本次只能跳过。</p>}
          {r.existingId && r.changes.length > 0 && <details><summary>查看原值与草稿</summary><pre>{JSON.stringify({ current: courses.find((c) => c.id === r.existingId), draft: r.incoming }, null, 2)}</pre></details>}
          <select aria-label={`导入方式 ${r.incoming.id}`} value={choices[r.incoming.id] ?? 'skip'} onChange={(e) => setChoices({ ...choices, [r.incoming.id]: e.target.value as CourseImportChoice })}>
            <option value="skip">跳过（保留原记录）</option>{!r.ambiguousIds.length && (r.existingId ? <><option value="fill">仅补缺失字段</option><option value="replace">用草稿替换该课程（退回待确认）</option></> : <option value="add">新增待确认课程</option>)}
          </select>
        </div>)}
        <button className="primary" disabled={busy || !Object.values(choices).some((v) => v !== 'skip')} onClick={async () => {
          if (JSON.stringify(courses) !== previewBase.current) { setMessage('预览后资料已有变化，请重新预览；没有覆盖现有修改。'); return; }
          try { const next = applyCourseImport(profile, preview, choices); if (await changeWithBackup(next, '合并课程草稿前')) setPreview(null); }
          catch (e) { setMessage((e as Error).message); }
        }}>确认所选合并（先备份）</button>
      </div>}
    </details>
  </div>;
}
