import type { JobParse, Lang } from '../types';
import type { JointGroup, JointRole, RequirementRef } from '../types/joint';
import { jdHash } from '../ai/jd';
import { uid } from '../locale/text';

export const newJointRole = (): JointRole => ({ id: uid('role'), name: '', text: '', url: '', screenshots: [], analyses: [] });
export const newJointGroup = (): JointGroup => ({ id: uid('jdgroup'), company: '', roles: [newJointRole()], archivedRoles: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
export const roleInput = (group: JointGroup, role: JointRole) => `企业：${group.company.trim()}\n岗位：${role.name.trim()}\n\n${role.text.trim()}`;
export const roleInputHash = (group: JointGroup, role: JointRole) => jdHash(roleInput(group, role));
export function jobRequirements(job: JobParse): RequirementRef[] {
  return (job.joint?.targets.map((t) => t.job) ?? [job]).flatMap((j) => ([['must', j.mustHave], ['responsibility', j.responsibilities ?? []], ['preferred', j.niceToHave]] as const)
    .flatMap(([tier, rows]) => rows.filter((r) => r.zh.trim() || r.en.trim()).map((text, i) => ({ id: `${j.id}:${tier}:${i}`, jobId: j.id, text, tier }))));
}
export const sameCompany = (a: string, b: string) => { const n = (s: string) => s.toLowerCase().replace(/[\s·.,，。]/g, '').replace(/(?:股份有限公司|有限责任公司|有限公司|公司|co(?:ltd)?|ltd|limited)$/, ''); return !!n(a) && n(a) === n(b); };
export function makeJointJob(group: JointGroup, analyses: JobParse[], lang: Lang = 'zh'): JobParse {
  if (!group.company.trim() || group.roles.length < 1 || group.roles.length > 3) throw new Error('请填写同一企业，并保留 1–3 个岗位');
  if (new Set(group.roles.map((r) => r.id)).size !== group.roles.length) throw new Error('联合岗位 ID 重复');
  const targets = group.roles.map((r) => {
    if (!r.name.trim() || !r.text.trim()) throw new Error('每个岗位都需要名称与 JD 正文');
    if (r.url && !/^https?:\/\//i.test(r.url)) throw new Error('岗位链接须为 http(s) URL');
    const revision = r.analyses.find((a) => a.jobId === r.analysisId);
    const job = analyses.find((j) => j.id === r.analysisId);
    if (!revision || revision.inputHash !== roleInputHash(group, r) || !job || job.joint) throw new Error(`${r.name} 的分析已过期或不存在，请独立解析后继续`);
    if (!r.companyConfirmed && ![job.company.full, job.company.short].some((s) => sameCompany(s, group.company))) throw new Error(`${r.name} 的解析企业与共同企业名称不同，请核对并明确确认同一企业后继续`);
    if (!job.mustHave.length && !job.responsibilities?.length && !job.niceToHave.length) throw new Error(`${r.name} 没有解析出岗位要求，请补充 JD 后重试`);
    return { roleId: r.id, revision: revision.revision, name: r.name, url: r.url, job: structuredClone(job) };
  });
  if (new Set(targets.map((t) => t.job.id)).size !== targets.length) throw new Error('各岗位必须有独立的分析 ID');
  const serialized = JSON.stringify({ company: group.company, targets });
  let hash = 2166136261; for (const ch of serialized) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const key = `${serialized.length.toString(36)}-${(hash >>> 0).toString(36)}`;
  const title = { zh: `${group.company} · 联合岗位简历`, en: `${group.company} · Shared role resume` };
  return { id: `joint-${group.id}-${key}`, createdAt: new Date().toISOString(), rawText: '联合岗位：各 JD 原文与独立分析见 joint.targets，不把多个 JD 拼成一段。', jdLanguage: lang,
    company: { full: group.company, short: group.company }, title, roleAbbr: 'JOINT', yearsRequired: null,
    mustHave: targets.flatMap((t) => t.job.mustHave), responsibilities: targets.flatMap((t) => t.job.responsibilities ?? []), niceToHave: targets.flatMap((t) => t.job.niceToHave), keywords: targets.flatMap((t) => t.job.keywords), summary: targets.map((t) => t.name).join(' / '),
    joint: { groupId: group.id, company: group.company, targets } };
}
