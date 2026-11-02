import { useState } from 'react';
import { useApp } from '../store';
import { courseSelectionSnapshot, printableCourse } from '../privacy/resume';
import { applySummaryVariant, restoreSummaryBaseline } from '../ai/summaryVariant';
import { runConsistency } from '../ai/generate';

/** 本份简历的显式选择，资料母库保持原样；全局撤销同时保留本次编辑。 */
export function ResumeFactsOptions() {
  const { profile, resume, setResume } = useApp();
  const [draft, setDraft] = useState<{ zh: string; en: string } | null>(null), [error, setError] = useState('');
  if (!resume) return null;
  const selection = resume.courseSelection ?? { ids: [], gradeIds: [] };
  const candidates = (profile.courses ?? []).filter((c) => printableCourse(profile, c));
  const selected = selection.ids;
  const change = (ids: string[], grades: string[]) => {
    setResume({ ...resume, courseSelection: courseSelectionSnapshot(profile, ids, grades) });
  };
  return <details className="card" data-testid="resume-facts-options"><summary>本份简历：课程、成绩、链接与简介变体</summary>
    <p className="muted small">课程只列正式名称和「课程知识」标签，不复制概述，不当作项目或职业经验。仅显示人工确认、已关联教育的授课课程；Project A/B 仅作为项目关联保存在母库。</p>
    <div className="row">{(['github', 'linkedin', 'website', 'portfolio'] as const).map((key) => <label className="check" key={key}><input type="checkbox" checked={(resume.contactVisibility ?? profile.profile.contacts.visibility)?.[key] === true} onChange={(e) => setResume({ ...resume, contactVisibility: { ...(resume.contactVisibility ?? profile.profile.contacts.visibility), [key]: e.target.checked } })} />显示 {key}</label>)}</div>
    {candidates.length === 0 && <p className="muted">暂无已确认并关联教育的课程。请先到「我的资料 → 课程」核对。</p>}
    {candidates.map((c) => <div className="row" key={c.id} data-testid="resume-course-choice">
      <label className="check"><input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => change(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id), selection.gradeIds.filter((id) => e.target.checked || id !== c.id))} />{c.name.zh || c.name.en} · {c.code} · {c.evidenceLevel === 'inferred' ? '概述为推断，非实操证明' : '课程知识'}</label>
      {selected.includes(c.id) && <><label className="check"><input type="checkbox" disabled={c.grade.status !== 'recorded' || !c.grade.raw.trim()} checked={selection.gradeIds.includes(c.id)} onChange={(e) => {
        if (e.target.checked && !confirm('仅在本份简历中显示这门课的成绩原文？中英文、PDF 和 Word 均会显示，不换算。')) return;
        change(selected, e.target.checked ? [...selection.gradeIds, c.id] : selection.gradeIds.filter((id) => id !== c.id));
      }} />显示该课成绩原文{c.grade.status !== 'recorded' ? '（待公布 / 核实，不可公开）' : ''}</label>
        <button disabled={selected.indexOf(c.id) === 0} onClick={() => { const ids = [...selected], i = ids.indexOf(c.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; change(ids, selection.gradeIds); }}>↑</button>
        <button disabled={selected.indexOf(c.id) === selected.length - 1} onClick={() => { const ids = [...selected], i = ids.indexOf(c.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; change(ids, selection.gradeIds); }}>↓</button>
      </>}
    </div>)}
    <p className="muted small">课程和链接的选择仅影响本份简历，可使用「撤销」。AI 已按课程内容与岗位能力选择课程；推断不等于实操。手工调整会保留，证据报告会标明当前是否采用来源。</p>
    <button onClick={() => { const item = resume.items.find((i) => i.sourceId === 'summary'); if (item) { setDraft({ zh: item.zh, en: item.en }); setError(''); } else setError('没有固定简介快照，请在资料页保存后重新生成。'); }}>特殊岗位微调（人工候选，确认后应用）</button>
    {resume.summaryBaseline && <button onClick={() => { setResume(runConsistency(restoreSummaryBaseline(resume))); setDraft(null); }}>恢复本份简历的固定简介</button>}
    {draft && <div className="notice" data-testid="summary-variant-draft"><p>只修改本份简历，绝不写回母库。请保留学位原名、经历性质、限定和数值，并同时核对双语。应用后仍进入事实审查。</p>
      <label>中文<textarea value={draft.zh} onChange={(e) => setDraft({ ...draft, zh: e.target.value })} /></label><label>English<textarea value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} /></label>
      <button onClick={() => { try { setResume(runConsistency(applySummaryVariant(resume, draft))); setDraft(null); setError(''); } catch (e) { setError((e as Error).message); } }}>确认仅应用到本份简历</button><button onClick={() => setDraft(null)}>放弃候选</button>
    </div>}
    {error && <div className="notice error">{error}</div>}
  </details>;
}
