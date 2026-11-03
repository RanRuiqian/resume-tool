import type { ProfileDoc, ResumeDoc, TemplateConfig } from '../types';
import { lt } from '../locale/text';
import { sourceIdsOf } from './provenance';
import { toggleBullet, toggleEntry, type SelKey } from './selection';
import { estimateUsage, isCampusWork, isProfessionalWork } from './contentStrategy';

/**
 * 2026-11（第三轮）：选了「1 页内 / 2 页内」就保证不超页。
 *
 * 背景：第二轮要求「基本填满一页」后，AI 主选内容实测排到 1.4 页；旧的 fitContent 只会撤回候补，不删主选。
 * 做法：按「最不重要的先去掉」逐步取消勾选（进入本简历的暂存区，左侧可重新勾选；母库不变），直到实测页数符合。
 * 顺序：多余奖项 → 次要项目 / 校园经历多出的要点 → 多出的本科课程 → 多出的技能 → 次要项目只留 1 条
 *      → 多余的校园经历 → 整段次要项目 → 核心项目末尾要点 → 再收紧奖项 / 技能 / 课程。职业 / 实习经历不整段删除。
 */
export interface TrimStep { resume: ResumeDoc; label: string; /** 把这一步删掉的内容加回任意状态（用于回填） */ undo?: (x: ResumeDoc) => ResumeDoc }

const texts = (p: ProfileDoc, r: ResumeDoc, key: 'work' | 'projects', id: string) => {
  const entry = (p[key] as { id: string; bullets: { id?: string }[] }[]).find((x) => x.id === id);
  const ids = new Set((entry?.bullets ?? []).flatMap((b) => (b.id ? [b.id] : [])));
  return r.items.filter((i) => sourceIdsOf(i).some((s) => ids.has(s)));
};
const nameOf = (p: ProfileDoc, key: 'work' | 'projects', id: string) => {
  if (key === 'projects') { const e = p.projects.find((x) => x.id === id); return e ? lt(e.name, 'zh') : id; }
  const e = p.work.find((x) => x.id === id); return e ? [lt(e.company, 'zh'), lt(e.title, 'zh')].filter(Boolean).join(' · ') : id;
};

/** 下一步删减；没有可删的就返回 null。纯函数，便于测试。 */
export function nextTrim(p: ProfileDoc, r: ResumeDoc): TrimStep | null {
  const sel = r.selection;
  const minorProjects = sel.projects.filter((id) => p.projects.find((x) => x.id === id)?.kind !== 'core');
  const coreProjects = sel.projects.filter((id) => p.projects.find((x) => x.id === id)?.kind === 'core');
  const campus = sel.work.filter((id) => { const w = p.work.find((x) => x.id === id); return !!w && (isCampusWork(w) || w.kind === 'parttime'); });
  // 末尾 = 优先级最低（AI 按优先级给出顺序）
  const dropBullet = (key: 'work' | 'projects', ids: string[], keep: number): TrimStep | null => {
    for (const id of [...ids].reverse()) {
      const items = texts(p, r, key, id);
      if (items.length <= keep) continue;
      // 论文 / 发表 / 专利 / 获奖这类成果不先删：从末尾找第一条不是成果的要点。
      const protectedText = (i: (typeof items)[number]) => /论文|发表|录用|专利|获奖|一等奖|二等奖|三等奖|paper|publication|published|accepted|patent|award|IEEE|IECBES/i.test(`${i.zh} ${i.en}`);
      const last = [...items].reverse().find((i) => !protectedText(i)) ?? items[items.length - 1];
      const entry = (p[key] as { id: string; bullets: { id?: string }[] }[]).find((x) => x.id === id)!;
      const b = entry.bullets.find((x) => x.id && sourceIdsOf(last).includes(x.id));
      if (!b) continue;
      return { resume: toggleBullet(p, r, key as SelKey, id, b as never, false), label: `「${nameOf(p, key, id)}」的一条要点`, undo: (x) => toggleBullet(p, x, key as SelKey, id, b as never, true) };
    }
    return null;
  };
  const dropEntry = (key: 'work' | 'projects', ids: string[]): TrimStep | null => {
    const id = ids[ids.length - 1];
    return id ? { resume: toggleEntry(p, r, key, id, false), label: `「${nameOf(p, key, id)}」整段`, undo: (x) => toggleEntry(p, x, key, id, true) } : null;
  };
  const dropList = (field: 'awards' | 'skills', keep: number): TrimStep | null => {
    const ids = sel[field];
    if (ids.length <= keep) return null;
    // 技能按 AI 分组的显示顺序去掉最后一项
    const order = field === 'skills' && r.skillGroups?.length ? [...r.skillGroups.flatMap((g) => g.ids).filter((id) => ids.includes(id)), ...ids.filter((id) => !r.skillGroups!.some((g) => g.ids.includes(id)))] : ids;
    const id = order[order.length - 1];
    const name = field === 'awards' ? lt(p.awards.find((x) => x.id === id)?.name ?? {}, 'zh') : lt(p.skills.find((x) => x.id === id)?.name ?? {}, 'zh');
    const original = ids;
    return { resume: { ...r, selection: { ...sel, [field]: ids.filter((x) => x !== id) } }, label: `${field === 'awards' ? '奖项' : '技能'}「${name}」`,
      undo: (x) => x.selection[field].includes(id) ? x : { ...x, selection: { ...x.selection, [field]: [...x.selection[field], id].sort((a, b) => original.indexOf(a) - original.indexOf(b)) } } };
  };
  const dropCourse = (keepBachelor: number): TrimStep | null => {
    const cs = r.courseSelection; if (!cs) return null;
    const bachelor = cs.ids.filter((id) => p.courses?.find((c) => c.id === id)?.level === 'bachelor');
    if (bachelor.length <= keepBachelor) return null;
    const id = bachelor[bachelor.length - 1];
    const snap = cs.snapshots?.find((x) => x.id === id), order = cs.ids;
    return { resume: { ...r, courseSelection: { ...cs, ids: cs.ids.filter((x) => x !== id), gradeIds: cs.gradeIds.filter((x) => x !== id), ...(cs.snapshots ? { snapshots: cs.snapshots.filter((x) => x.id !== id) } : {}) } },
      label: `课程「${lt(p.courses?.find((c) => c.id === id)?.name ?? {}, 'zh')}」`,
      undo: (x) => { const c = x.courseSelection; if (!c || c.ids.includes(id)) return x;
        return { ...x, courseSelection: { ...c, ids: [...c.ids, id].sort((a, b) => order.indexOf(a) - order.indexOf(b)), ...(c.snapshots && snap ? { snapshots: [...c.snapshots, snap] } : {}) } }; } };
  };
  return dropList('awards', 3)
    ?? dropBullet('projects', minorProjects, 2) ?? dropBullet('work', campus, 1)
    ?? dropCourse(6) ?? dropList('skills', 14)
    ?? dropBullet('projects', minorProjects, 1)
    ?? (campus.length > 1 ? dropEntry('work', campus) : null)
    ?? dropEntry('projects', minorProjects)
    ?? dropBullet('projects', coreProjects.slice(1), 2) ?? dropBullet('projects', coreProjects.slice(0, 1), 4)
    ?? dropList('awards', 1) ?? dropCourse(3) ?? dropList('skills', 8)
    ?? (campus.length ? dropEntry('work', campus) : null)
    ?? dropBullet('projects', coreProjects, 2)
    ?? dropBullet('work', sel.work.filter((id) => { const w = p.work.find((x) => x.id === id); return !!w && isProfessionalWork(w); }), 1);
}

export interface PageMeasure { zh: { pages: number }; en: { pages: number } }

/**
 * 按目标页数删减：先把逐步删减的各个状态都算出来（纯本地、很快），再用实际 PDF 页数二分查找
 * 「刚好放得下」所需的最少步数，避免删过头。measure 不可用时退回本地排版估算。
 */
export async function trimToPages(p: ProfileDoc, template: TemplateConfig, r: ResumeDoc, measure?: (r: ResumeDoc) => Promise<PageMeasure | null>, refillMeasures = 24): Promise<ResumeDoc> {
  const target = template.page.targetPages || 1;
  const states: TrimStep[] = [{ resume: r, label: '' }];
  for (let i = 0; i < 80; i++) { const s = nextTrim(p, states[states.length - 1].resume); if (!s) break; states.push(s); }
  let measurable = !!measure;
  const fits = async (k: number): Promise<boolean> => {
    if (measurable) {
      const m = await measure!(states[k].resume).catch(() => null);
      if (m) return Math.max(m.zh.pages, m.en.pages) <= target;
      measurable = false;
    }
    return estimateUsage(p, template, states[k].resume) <= 1;
  };
  if (await fits(0)) return r;
  let lo = 0, hi = states.length - 1;          // lo 不合格；hi 为候选
  if (!(await fits(hi))) {
    const cur = states[hi].resume;
    return { ...cur, notes: [...(cur.notes ?? []), `为保持 ${target} 页内已删减到下限，仍超出目标页数；请改用「${target + 1} 页内」或手动取消部分内容。`] };
  }
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await fits(mid)) hi = mid; else lo = mid; }
  // 回填：删减步骤较粗（例如最后一步删掉整段），可能删过头留下空白。从「最后删、相对重要」的开始，
  // 逐个试着加回单项（第 hi 步本身就是让它放得下的那一步，跳过），仍然放得下就保留。最多再测 refillMeasures 次。
  let cur = states[hi].resume;
  const restored = new Set<number>();
  let budget = refillMeasures;
  // 2026-11（负责人实测：删了 21 项后只剩 2 个项目、页面只有七成满）：先试着加回项目 / 要点（价值高），再试奖项、技能、课程。
  const content = (j: number) => /整段|要点/.test(states[j].label);
  const order = Array.from({ length: Math.max(0, hi - 1) }, (_, i) => hi - 1 - i).sort((a, b) => Number(!content(a)) - Number(!content(b)) || b - a);
  for (const j of order) {
    if (budget <= 0) break;
    const undo = states[j].undo; if (!undo) continue;
    const cand = undo(cur); if (cand === cur) continue;
    budget--;
    states.push({ resume: cand, label: '' });
    if (await fits(states.length - 1)) { cur = cand; restored.add(j); }
    states.pop();
  }
  const removed = states.slice(1, hi + 1).filter((_, i) => !restored.has(i + 1)).map((s) => s.label);
  return { ...cur, notes: [...(cur.notes ?? []).filter((x) => !x.startsWith('为保持')),
    `为保持 ${target} 页内，已暂时取消 ${removed.length} 项（可在左侧素材库重新勾选，或改为「${target + 1} 页内」）：${removed.slice(0, 12).join('；')}${removed.length > 12 ? '……' : ''}`] };
}
