import type { Lang, LocalizedText, ProfileDoc } from '../types';
import { lt } from '../locale/text';

/** 事实来源记录（B2）：复用资料库已有的稳定 id（要点 id / 条目 id / 'summary'），不另建数据库 */
export type SourceType = 'summary' | 'education' | 'education-highlight' | 'work' | 'work-bullet' | 'project' | 'project-bullet' | 'project-dossier' | 'skill' | 'evidence' | 'certificate' | 'award';
export interface FactSource {
  sourceId: string;
  sourceType: SourceType;
  /** 例如 work[模拟科技 · 测试工程师].bullets[0] */
  sourcePath: string;
  originalText: { zh: string; en: string };
  /** 该条所属的经历 / 项目 / 教育条目 id */
  parentId?: string;
  relatedProjectId?: string;
  relatedEvidenceIds: string[];
  /** confirmed：用户已确认（译文确认或证据已核对）；manual：用户填写；machine：机翻 / AI 识别未确认 */
  confirmationStatus: 'confirmed' | 'manual' | 'machine' | 'unknown';
  /** 教育相关：是否尚未取得学位（只有预计日期，没有实际授予日期） */
  degreePending?: boolean;
  /** 来源的时间段（用于检查改写是否改了日期） */
  dates?: string[];
}

const both = (t?: LocalizedText) => ({ zh: lt(t ?? {}, 'zh', false), en: lt(t ?? {}, 'en', false) });
const status = (t?: LocalizedText): FactSource['confirmationStatus'] => {
  const v = Object.values(t?.status ?? {});
  return v.includes('confirmed') ? 'confirmed' : v.includes('manual') ? 'manual' : v.includes('machine') ? 'machine' : 'unknown';
};
const nm = (t?: LocalizedText) => lt(t ?? {}, 'zh') || lt(t ?? {}, 'en');

export function buildSourceIndex(p: ProfileDoc): Map<string, FactSource> {
  const m = new Map<string, FactSource>();
  const add = (s: FactSource) => { if (s.sourceId) m.set(s.sourceId, s); };
  add({ sourceId: 'summary', sourceType: 'summary', sourcePath: 'profile.summary', originalText: both(p.profile.summary), relatedEvidenceIds: [], confirmationStatus: status(p.profile.summary) });
  for (const e of p.work) {
    const path = `work[${nm(e.company)} · ${nm(e.title)}]`;
    add({ sourceId: e.id, sourceType: 'work', sourcePath: path, originalText: { zh: [lt(e.company, 'zh', false), lt(e.title, 'zh', false)].filter(Boolean).join(' · '), en: [lt(e.company, 'en', false), lt(e.title, 'en', false)].filter(Boolean).join(' · ') }, relatedEvidenceIds: [], confirmationStatus: status(e.title), dates: [e.start, e.end].filter(Boolean) });
    e.bullets.forEach((b, i) => b.id && add({ sourceId: b.id, sourceType: 'work-bullet', sourcePath: `${path}.bullets[${i}]`, originalText: both(b), parentId: e.id, relatedEvidenceIds: [], confirmationStatus: status(b), dates: [e.start, e.end].filter(Boolean) }));
  }
  for (const e of p.projects) {
    const path = `projects[${nm(e.name)}]`;
    const ev = e.evidenceIds ?? [];
    add({ sourceId: e.id, sourceType: 'project', sourcePath: path, originalText: both(e.name), relatedProjectId: e.id, relatedEvidenceIds: ev, confirmationStatus: status(e.name), dates: [e.start, e.end].filter(Boolean) });
    e.bullets.forEach((b, i) => b.id && add({ sourceId: b.id, sourceType: 'project-bullet', sourcePath: `${path}.bullets[${i}]`, originalText: both(b), parentId: e.id, relatedProjectId: e.id, relatedEvidenceIds: ev, confirmationStatus: status(b), dates: [e.start, e.end].filter(Boolean) }));
    if (e.dossier) {
      const d = e.dossier; const txt = [d.background, d.responsibility, d.technicalWork, d.solution, d.methods, d.quantResults, d.finalOutcome, (d.tools ?? []).join('、'), (d.keywords ?? []).join('、')].filter(Boolean).join('\n');
      if (txt) add({ sourceId: `${e.id}#dossier`, sourceType: 'project-dossier', sourcePath: `${path}.dossier`, originalText: { zh: txt, en: '' }, parentId: e.id, relatedProjectId: e.id, relatedEvidenceIds: ev, confirmationStatus: 'manual' });
    }
  }
  for (const e of p.education) {
    const path = `education[${nm(e.school)}]`;
    const degreePending = !e.actualConferralDate && (!!e.expectedConferralDate || e.degreeProofStatus === 'not-yet' || e.degreeProofStatus === 'pending');
    add({ sourceId: e.id, sourceType: 'education', sourcePath: path, originalText: { zh: [lt(e.school, 'zh', false), lt(e.major, 'zh', false), lt(e.degree, 'zh', false)].filter(Boolean).join(' · '), en: [lt(e.school, 'en', false), lt(e.major, 'en', false), lt(e.degree, 'en', false)].filter(Boolean).join(' · ') }, relatedEvidenceIds: [], confirmationStatus: status(e.degree), degreePending, dates: [e.start, e.end].filter(Boolean) });
    e.highlights.forEach((b, i) => b.id && add({ sourceId: b.id, sourceType: 'education-highlight', sourcePath: `${path}.highlights[${i}]`, originalText: both(b), parentId: e.id, relatedEvidenceIds: [], confirmationStatus: status(b), degreePending, dates: [e.start, e.end].filter(Boolean) }));
  }
  for (const k of p.skills) add({ sourceId: k.id, sourceType: 'skill', sourcePath: `skills[${nm(k.name)}]`, originalText: both(k.name), relatedEvidenceIds: k.evidenceIds ?? [], confirmationStatus: status(k.name) });
  for (const c of p.certificates) add({ sourceId: c.id, sourceType: 'certificate', sourcePath: `certificates[${nm(c.name)}]`, originalText: both(c.name), relatedEvidenceIds: [], confirmationStatus: status(c.name), dates: [c.date].filter(Boolean) });
  for (const c of p.awards) add({ sourceId: c.id, sourceType: 'award', sourcePath: `awards[${nm(c.name)}]`, originalText: both(c.name), relatedEvidenceIds: [], confirmationStatus: status(c.name), dates: [c.date].filter(Boolean) });
  for (const ev of p.evidence ?? []) add({ sourceId: ev.id, sourceType: 'evidence', sourcePath: `evidence[${ev.fileName}]`, originalText: { zh: ev.proves, en: '' }, relatedProjectId: ev.projectIds[0], relatedEvidenceIds: [ev.id], confirmationStatus: ev.confirmed ? 'confirmed' : 'unknown' });
  return m;
}

/** 某条事实在指定语言下的原文（该语言没有时退回另一语言，并说明） */
export function originalOf(s: FactSource | undefined, l: Lang): { text: string; lang: Lang } {
  if (!s) return { text: '', lang: l };
  const o = l === 'zh' ? 'en' : 'zh';
  return s.originalText[l] ? { text: s.originalText[l], lang: l } : { text: s.originalText[o], lang: o };
}
