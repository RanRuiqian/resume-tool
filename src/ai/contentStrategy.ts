import type { Lang, ProfileDoc, ResumeDoc, TemplateConfig } from '../types';
import { buildLayout, type LSection } from '../render/layout';
import { inferWorkKind, isCampusKind } from '../render/classify';
import { BUILTIN_TEMPLATES } from '../templates';
import { fixedSummaryText } from './fixedSummary';
import { extractEvidence } from './evidence';

export type ContentCategory = 'education' | 'professionalWork' | 'projects' | 'skills' | 'certificates' | 'campus';
export const CATEGORY_LABEL: Record<ContentCategory, string> = { education: '教育背景', professionalWork: '专业工作 / 实习', projects: '核心项目', skills: '技能', certificates: '证书', campus: '学生组织 / 志愿经历' };
// 旧资料未细分 kind 仍作为真实工作背景参与考虑，不能据此把它标成“全职”。
export const isProfessionalWork = (w: ProfileDoc['work'][number]) => ['fulltime', 'internship', '', 'other'].includes(inferWorkKind(w));
export const isCampusWork = (w: ProfileDoc['work'][number]) => isCampusKind(inferWorkKind(w));

export function pageBudget(pages: number, lang: Lang, template = BUILTIN_TEMPLATES[0], profile?: ProfileDoc) {
  const ty = template.locales[lang].typography;
  const height = (template.page.size === 'LETTER' ? 279.4 : 297) - template.page.marginMm.top - template.page.marginMm.bottom;
  const lineMm = ty.bodySizePt * ty.lineHeight * 25.4 / 72;
  const summary = profile ? fixedSummaryText(profile.profile.summary, lang) : '';
  const width = (template.page.size === 'LETTER' ? 215.9 : 210) - template.page.marginMm.left - template.page.marginMm.right;
  const summaryLines = Math.ceil([...summary].reduce((n, c) => n + (c.codePointAt(0)! > 255 ? 1 : 0.55), 0) * ty.bodySizePt * 25.4 / 72 / width);
  const modules = profile ? [!!summary, profile.education.some((x) => x.enabled), profile.work.some((x) => x.enabled && !isCampusWork(x)),
    profile.work.some((x) => x.enabled && isCampusWork(x)), ...[profile.projects, profile.skills, profile.certificates, profile.awards].map((a) => a.some((x) => x.enabled))].filter(Boolean).length : 0;
  const reservedLines = profile ? 8 + modules * 1.7 + summaryLines : 22;
  return { targetPages: pages, bodySizePt: ty.bodySizePt, lineHeight: ty.lineHeight, marginMm: template.page.marginMm,
    columns: template.layout.columns, sectionGapMm: template.spacing.sectionGapMm,
    availableLines: Math.floor(height / lineMm * pages),
    fixedSummaryCharacters: summary.length, fixedSummaryEstimatedLines: summaryLines, enabledModules: modules,
    softFactTarget: Math.max(4, Math.round((height / lineMm * pages - reservedLines) / 2.4)),
    note: '数量仅为软参考；结合标题、固定简介、模块与句长分配空间，不通过小字号或空话填满。' };
}

/** 排版前的保守估算，不能冒充 PDF 实测；双语较满的一侧决定是否补充候补。 */
export function estimateUsage(p: ProfileDoc, template: TemplateConfig, r: ResumeDoc): number {
  return Math.max(...(['zh', 'en'] as const).map((lang) => {
    const m = buildLayout(p, template, lang, r), ptMm = 25.4 / 72;
    const width = (m.pageSize === 'LETTER' ? 215.9 : 210) - m.marginMm.left - m.marginMm.right;
    const height = (m.pageSize === 'LETTER' ? 279.4 : 297) - m.marginMm.top - m.marginMm.bottom;
    const line = m.typography.bodySizePt * m.typography.lineHeight * ptMm;
    const lines = (text: string, mm: number) => text.split('\n').reduce((sum, row) => sum + Math.max(1, Math.ceil([...row].reduce((n, c) => n + (c.codePointAt(0)! > 255 ? 1 : 0.55), 0) * m.typography.bodySizePt * ptMm / Math.max(15, mm))), 0);
    const sectionHeight = (sections: LSection[], mm: number) => sections.reduce((sum, s) => sum + line * 1.6 + m.spacing.sectionGapMm + s.blocks.reduce((n, b) => n + m.spacing.itemGapMm
      + (b.title ? lines(b.title, mm - 20) * line : 0) + (b.subtitle ? lines(b.subtitle, mm) * line : 0)
      + (b.text ? lines(b.text, mm) * line : 0) + b.bullets.reduce((k, text) => k + lines(text, mm - 4) * line, 0), 0), 0);
    const header = m.typography.nameSizePt * ptMm * 1.4 + line * (2 + Math.ceil(m.header.contacts.length / 3));
    const cap = height * (template.page.targetPages || 1) - header;
    const mainWidth = m.columns === 2 ? width * (1 - m.sidebarWidthPercent / 100) - 5 : width;
    return Math.max(sectionHeight(m.main, mainWidth) / cap, m.side.length ? sectionHeight(m.side, width * m.sidebarWidthPercent / 100 - 4) / cap : 0);
  }));
}

export function completenessNotes(p: ProfileDoc, r: ResumeDoc, omissions: Partial<Record<ContentCategory, string>> = {}): string[] {
  const usefulEntries = new Set(extractEvidence(p).filter((x) => x.text.zh.trim() || x.text.en.trim()).map((x) => x.entryId));
  const usefulWork = p.work.filter((w) => w.enabled && usefulEntries.has(w.id));
  const categories: Record<ContentCategory, [boolean, boolean]> = {
    education: [p.education.some((x) => x.enabled), !!r.selection.education.length],
    professionalWork: [usefulWork.some(isProfessionalWork), usefulWork.some((x) => isProfessionalWork(x) && r.selection.work.includes(x.id))],
    campus: [usefulWork.some(isCampusWork), usefulWork.some((x) => isCampusWork(x) && r.selection.work.includes(x.id))],
    projects: [p.projects.some((x) => x.enabled && usefulEntries.has(x.id)), !!r.selection.projects.length],
    skills: [p.skills.some((x) => x.enabled), !!r.selection.skills.length],
    certificates: [p.certificates.some((x) => x.enabled), !!r.selection.certificates.length],
  };
  return (Object.keys(categories) as ContentCategory[]).filter((k) => !categories[k][1]).map((k) =>
    `${CATEGORY_LABEL[k]}未展示：${!categories[k][0] ? '资料库没有启用的有效素材' : omissions[k] || 'AI 未说明省略原因；可在素材池补选，或重新生成并核对职业背景完整性'}`);
}

export interface ContentMeasure { zh: { pages: number }; en: { pages: number } }
export interface ContentOptions { targetPages?: number; template?: TemplateConfig; measure?: (r: ResumeDoc) => Promise<ContentMeasure | null> }

/** 候补完全由 AI 指定并已通过同一事实护栏；这里只按版面决定是否展示，不另做关键词选材。 */
export async function fitContent(p: ProfileDoc, pool: ResumeDoc, reserveIds: string[], omissions: Partial<Record<ContentCategory, string>>, options: ContentOptions = {}): Promise<ResumeDoc> {
  const template = options.template ?? { ...BUILTIN_TEMPLATES[0], page: { ...BUILTIN_TEMPLATES[0].page, targetPages: options.targetPages ?? 1 } };
  const owner = new Map([...p.work, ...p.projects].flatMap((x) => x.bullets.flatMap((b) => b.id ? [[b.id, x.id] as const] : [])));
  const reserve = new Set(reserveIds), shown = new Set<string>();
  const make = () => ({ ...pool, selection: { ...pool.selection,
    work: pool.selection.work.filter((id) => !reserve.has(id) || shown.has(id)), projects: pool.selection.projects.filter((id) => !reserve.has(id) || shown.has(id)) },
    items: pool.items.filter((i) => !reserve.has(owner.get(i.sourceId) ?? '') || shown.has(owner.get(i.sourceId)!)) });
  let r = make();
  for (const id of reserveIds) {
    const w = p.work.find((x) => x.id === id);
    const missingBackground = w && ((isProfessionalWork(w) && !p.work.some((x) => r.selection.work.includes(x.id) && isProfessionalWork(x)))
      || (isCampusWork(w) && !p.work.some((x) => r.selection.work.includes(x.id) && isCampusWork(x))));
    if (estimateUsage(p, template, r) >= 0.84 && !missingBackground) continue;
    shown.add(id); const next = make();
    if (estimateUsage(p, template, next) > 1) { shown.delete(id); continue; }
    r = next;
  }
  const notes: string[] = [];
  if (options.measure) {
    try {
      const measured = await options.measure(r);
      if (!measured) notes.push('PDF 页数测量暂不可用，当前仅为排版估算；请在导出预览中核对。');
      if (measured && Math.max(measured.zh.pages, measured.en.pages) > (template.page.targetPages || 1)) {
        if (shown.size) {
          shown.clear(); r = make();
          notes.push('按实际 PDF 页数撤回候补内容；已保留主要工作与项目，未缩小正文或删除固定简介。');
          const base = await options.measure(r);
          if (base && Math.max(base.zh.pages, base.en.pages) > (template.page.targetPages || 1)) notes.push('主要内容超过目标页数：请改用两页或手动精简，不自动删除职业背景。');
        } else notes.push('主要内容超过目标页数：请改用两页或手动精简，不自动删除职业背景。');
      }
    } catch { notes.push('PDF 页数测量暂不可用，当前仅为排版估算；请在导出预览中核对。'); }
  } else notes.push('内容空间为本地排版估算；实际 PDF / Word 仍需检查。');
  if (estimateUsage(p, template, r) < 0.55) notes.push('内容较少：已考虑 AI 提供的候补；可在素材池补选真实经历，留白不以废话或重复内容填充。');
  const finalOmissions = { ...omissions };
  for (const id of reserveIds.filter((x) => !shown.has(x))) {
    const work = p.work.find((x) => x.id === id);
    const category = work ? (isCampusWork(work) ? 'campus' : isProfessionalWork(work) ? 'professionalWork' : undefined) : 'projects';
    if (category && !finalOmissions[category]) finalOmissions[category] = 'AI 已列为候补；按当前字体、模块和目标页数估算未补入，或实际 PDF 超页后撤回。可改用两页或在素材池手工补选。';
  }
  return { ...r, notes: [...(r.notes ?? []), ...notes, ...completenessNotes(p, r, finalOmissions)] };
}
