import type { Lang, LocalizedText, ProfileDoc, ResumeDoc, Settings } from '../types';
import { applyTranslation, needsTranslation } from '../locale/text';
import { translateTexts } from './translate';

/**
 * 简历「标题类」短字段（学校、学位、专业、单位、职位、项目名、技能名与分组、证书 / 奖项名、课程名）的按需补译。
 *
 * 之所以存在：英文简历曾直接显示中文单位、职位、学位和技能（ABB 案例），因为这些短字段在母库里只有中文。
 * 规则：只处理当前简历实际选中的条目；只填补缺失的另一语言，不改动已有文字；结果标记为 machine，
 * 写回母库（以后的简历复用），同时更新本简历的课程快照。要点正文不在这里处理（由撰写 / 本地化负责）。
 */
export interface LabelRef { key: string; t: LocalizedText; to: Lang; course?: { id: string } }

export function resumeLabelTargets(p: ProfileDoc, r: ResumeDoc): LabelRef[] {
  const out: LabelRef[] = [];
  let n = 0;
  const push = (t: LocalizedText | undefined, course?: { id: string }) => {
    if (!t) return;
    for (const to of ['zh', 'en'] as const) {
      if (!needsTranslation(t, to)) continue;
      // 中文简历里直接写英文工具名 / 官方英文名（SolidWorks、AI Industrial and Robotics）很正常，短的英文名称不必译成中文。
      if (to === 'zh' && (t.en ?? '').trim().split(/\s+/).length <= 6) continue;
      out.push({ key: `L${n++}`, t, to, ...(course ? { course } : {}) });
    }
  };
  const pick = <X extends { id: string }>(arr: X[], ids: string[] = []) => arr.filter((x) => ids.includes(x.id));
  const sel = r.selection;
  for (const e of pick(p.education, sel.education)) { push(e.school); push(e.degree); push(e.major); }
  for (const e of pick(p.work, sel.work)) { push(e.company); push(e.title); }
  for (const e of pick(p.projects, sel.projects)) { push(e.name); push(e.role); }
  const grouped = new Set((r.skillGroups ?? []).flatMap((g) => g.ids));
  for (const e of pick(p.skills, sel.skills)) { push(e.name); if (!grouped.has(e.id)) push(e.category); }
  for (const e of [...pick(p.certificates, sel.certificates), ...pick(p.awards, sel.awards)]) { push(e.name); push(e.issuer); }
  for (const c of p.courses ?? []) if (r.courseSelection?.ids.includes(c.id)) push(c.name, { id: c.id });
  return out;
}

/** 纯函数：把译文写进母库副本与本简历的课程快照。 */
export function applyResumeLabels(p: ProfileDoc, r: ResumeDoc, targets: LabelRef[], translated: Map<string, string>): { profile: ProfileDoc; resume: ResumeDoc; count: number } {
  let count = 0;
  for (const ref of targets) {
    const v = translated.get(ref.key)?.trim();
    if (!v) continue;
    Object.assign(ref.t, applyTranslation(ref.t, ref.to, v));
    count++;
  }
  const byId = new Map((p.courses ?? []).map((c) => [c.id, c]));
  const snapshots = r.courseSelection?.snapshots?.map((s) => {
    const c = byId.get(s.id);
    return c ? { ...s, name: { ...s.name, zh: s.name.zh || c.name.zh, en: s.name.en || c.name.en } } : s;
  });
  const resume = r.courseSelection && snapshots ? { ...r, courseSelection: { ...r.courseSelection, snapshots } } : r;
  return { profile: p, resume, count };
}

export async function fillResumeLabels(s: Settings, profile: ProfileDoc, resume: ResumeDoc): Promise<{ profile: ProfileDoc; resume: ResumeDoc; count: number }> {
  const p = structuredClone(profile);
  const targets = resumeLabelTargets(p, resume);
  if (!targets.length || s.demoMode) return { profile, resume, count: 0 };
  const translated = new Map<string, string>();
  for (const to of ['en', 'zh'] as const) {
    const batch = targets.filter((x) => x.to === to);
    if (!batch.length) continue;
    const out = await translateTexts(s, batch.map((x) => ({ key: x.key, text: x.t[to === 'en' ? 'zh' : 'en'] ?? '' })), to, p.glossary);
    out.forEach((v, k) => translated.set(k, v));
  }
  return applyResumeLabels(p, resume, targets, translated);
}
