import type { JobParse } from '../types';
import type { JointSynthesis, RequirementAssessment } from '../types/joint';
import type { SelectionIssue } from '../ai/aiPlanner';
import { jobRequirements } from './jobs';

/** 结构、岗位归属和课程证据边界由本地验证；语义关联仍由 AI 作出，不用关键词替代选材。 */
export function validateJointReasoning(job: JobParse, requirements: RequirementAssessment[], synthesis: JointSynthesis | undefined): SelectionIssue[] {
  if (!job.joint) return [];
  const refs = jobRequirements(job), byId = new Map(refs.map((r) => [r.id, r])), seen = new Set<string>(), issues: SelectionIssue[] = [];
  const fail = (path: string, message: string, requirementText?: string) => issues.push({ path, code: 'inconsistent', message, requirementText });
  requirements.forEach((r, i) => {
    const ref = byId.get(r.requirementId ?? '');
    if (!ref || seen.has(ref.id)) fail(`/requirements/${i}`, `岗位要求 ID 无效或重复：${r.requirementId}，每份 JD 的每条要求必须独立判断`, r.text);
    else {
      seen.add(ref.id);
      if (r.tier !== ref.tier || ![ref.text.zh.trim(), ref.text.en.trim()].includes(r.text)) fail(`/requirements/${i}`, '不得改写、降低或挪用原 JD 要求，text 须复制该要求的任一语言原文', r.text);
    }
    if ((typeof r.reason !== 'string' || !r.reason.trim())) fail(`/requirements/${i}`, '联合岗位判断缺少语义关联依据', r.text);
  });
  const missing = refs.filter((r) => !seen.has(r.id));
  missing.forEach((r, i) => fail(`/requirements/${requirements.length + i}`, `遗漏岗位要求 ${r.id}：${r.text.zh || r.text.en}；请补充完整判断，保留其余要求`, r.text.zh || r.text.en));
  if (!synthesis || !['common', 'complementary', 'conflicts'].every((k) => Array.isArray(synthesis[k as keyof JointSynthesis]))) {
    fail('/jointSummary', '缺少共同 / 互补 / 冲突归纳'); return issues;
  }
  const grouped = new Set<string>();
  for (const kind of ['common', 'complementary', 'conflicts'] as const) for (const row of synthesis[kind]) {
    if (!row || !Array.isArray(row.requirementIds) || !row.requirementIds.length || (typeof row.reason !== 'string' || !row.reason.trim()) || new Set(row.requirementIds).size !== row.requirementIds.length || row.requirementIds.some((id) => !byId.has(id))) {
      fail('/jointSummary', `${kind} 包含错误岗位要求 ID 或缺少具体依据`); continue;
    }
    if (kind !== 'complementary' && new Set(row.requirementIds.map((id) => byId.get(id)!.jobId)).size < 2) fail('/jointSummary', `${kind} 必须关联至少两个不同岗位，不能拿同一 JD 自称联合分析`);
    if (kind !== 'conflicts') for (const id of row.requirementIds) {
      if (grouped.has(id)) fail('/jointSummary', `共同 / 互补重复计数：${id}`);
      grouped.add(id);
    }
  }
  if (refs.some((r) => !grouped.has(r.id))) fail('/jointSummary', '共同 / 互补归纳遗漏了岗位要求，必须逐条保留；冲突可额外标注');
  return issues;
}
