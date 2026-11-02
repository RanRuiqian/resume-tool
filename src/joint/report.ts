import type { JobParse, ProfileDoc, ResumeDoc } from '../types';
import type { EvidenceRef, EvidenceReport, RequirementAssessment, JointSynthesis } from '../types/joint';
import { buildSourceIndex } from '../audit/sourceIndex';
import { inferWorkKind, isCampusKind } from '../render/classify';
import { sourceIdsOf } from '../ai/provenance';
import { profileForGeneration } from '../privacy/resume';

export function createEvidenceReport(p: ProfileDoc, job: JobParse, requirements: RequirementAssessment[], selectionReasons: string[], synthesis?: JointSynthesis): EvidenceReport {
  // 已验证的决定 + 确定性来源摘录；不额外调用模型生成漂亮但无依据的“亮点”。
  p = profileForGeneration(p);
  const index = buildSourceIndex(p), targets = job.joint?.targets.map((t) => t.job) ?? [job];
  const source = (id: string): EvidenceRef => {
    const c = p.courses?.find((x) => x.id === id);
    if (c) return { id, category: 'course', label: c.name.zh || c.name.en || c.code, zh: c.synopsis.zh || c.name.zh || '', en: c.synopsis.en || c.name.en || '', level: c.evidenceLevel, selected: false };
    const f = index.get(id); if (!f) throw new Error(`报告引用未知来源：${id}`);
    const work = p.work.find((w) => w.id === f.parentId || w.id === id);
    const category = work ? isCampusKind(inferWorkKind(work)) ? 'campus' : 'work' : f.sourceType.startsWith('project') ? 'project' : f.sourceType.startsWith('education') ? 'education' : f.sourceType === 'certificate' ? 'certificate' : f.sourceType === 'award' ? 'award' : 'skill';
    return { id, category, label: f.sourcePath, zh: f.originalText.zh, en: f.originalText.en, selected: false };
  };
  return { createdAt: new Date().toISOString(), synthesis, selectionReasons, targets: targets.map((j) => ({ jobId: j.id, title: j.title,
    requirements: requirements.filter((r) => !job.joint || r.requirementId?.startsWith(`${j.id}:`)).map((r) => ({ ...r, evidence: r.evidenceIds.map(source),
      risks: r.assessment === 'learning' ? ['仅课程知识支持；实践、任职或软件熟练度仍未证实。', ...(r.evidenceIds.some((id) => p.courses?.find((c) => c.id === id)?.evidenceLevel !== 'official') ? ['课程概述含推断/回忆/待核实信息，请人工核对，不得抬高为实操。'] : [])] : r.assessment === 'transferable' ? ['可迁移背景不等于已在该岗位执行同一职责。'] : r.assessment === 'gap' ? ['尚无可靠证据；不写进事实正文。'] : ['AI 对应判断待人工审查，不能作为录用保证。'] })) })) };
}
/** 报告随手工选材现算“本简历是否采用”，不因 JD 重解析或勾选变化编造新的覆盖结论。 */
export function refreshReportSelection(r: ResumeDoc): EvidenceReport | undefined {
  if (!r.evidenceReport) return undefined;
  const used = new Set([...r.items.flatMap(sourceIdsOf), ...Object.values(r.selection).flat(), ...(r.courseSelection?.ids ?? [])]);
  return { ...r.evidenceReport, targets: r.evidenceReport.targets.map((t) => ({ ...t, requirements: t.requirements.map((q) => ({ ...q, evidence: q.evidence.map((e) => ({ ...e, selected: used.has(e.id) })) })) })) };
}
