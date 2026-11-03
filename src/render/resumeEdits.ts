import type { ProfileDoc, ResumeDoc } from '../types';

export const ENTRY_TEXT_FIELDS = { school: '学校', degree: '学位', major: '专业', company: '公司', title: '职位', name: '名称', role: '角色', category: '分类', issuer: '颁发机构' } as const;

/** 渲染/导出使用临时副本，来源 ID、素材与历史记录不改变。 */
export function profileWithResumeEdits(p: ProfileDoc, r?: ResumeDoc | null): ProfileDoc {
  if (!r?.entryEdits) return p;
  const copy = structuredClone(p);
  for (const e of [...copy.work, ...copy.projects, ...copy.education, ...copy.skills, ...copy.certificates, ...copy.awards]) {
    const edit = r.entryEdits[e.id];
    if (!edit) continue;
    const fields = e as unknown as Record<string, unknown>;
    for (const key of Object.keys(ENTRY_TEXT_FIELDS) as (keyof typeof ENTRY_TEXT_FIELDS)[]) {
      if (key in fields && edit.texts?.[key]) fields[key] = { ...(fields[key] as object), ...edit.texts[key] };
    }
    for (const key of ['start', 'end', 'date'] as const) if (key in fields && edit[key] !== undefined) fields[key] = edit[key];
  }
  return copy;
}
