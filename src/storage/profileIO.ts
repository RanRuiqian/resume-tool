import type { Evidence, EvidenceType, LocalizedText, ProfileDoc, Proficiency, ProjectDossier } from '../types';
import { forEachText } from '../locale/text';
import { normalizeCourses } from './courses';

export const PROFILE_VERSION = '1.4';

export function emptyProfile(): ProfileDoc {
  const e = (): LocalizedText => ({});
  return {
    version: PROFILE_VERSION, primaryLanguage: 'zh', glossary: [],
    profile: { name: e(), headline: e(), summary: e(), contacts: { location: e() }, personal: {} },
    education: [], work: [], projects: [], skills: [], certificates: [], awards: [], evidence: [], courses: [],
  };
}

/** v1.0 → v1.1 迁移：纯字符串字段转为 LocalizedText（按是否含中文推断 source） */
function toLT(v: unknown): LocalizedText {
  if (v && typeof v === 'object') return v as LocalizedText;
  if (typeof v === 'string') { const l = /[\u4e00-\u9fff]/.test(v) ? 'zh' : 'en'; return { [l]: v, source: l, status: { [l]: 'manual' } }; }
  return {};
}

export function normalizeProfile(raw: unknown): ProfileDoc {
  if (!raw || typeof raw !== 'object') throw new Error('不是合法的资料库 JSON');
  const r = raw as Record<string, unknown> & Partial<ProfileDoc>;
  const base = emptyProfile();
  const p: ProfileDoc = { ...base, ...r, profile: { ...base.profile, ...(r.profile ?? {}) } } as ProfileDoc;
  p.version = PROFILE_VERSION;
  p.glossary = Array.isArray(r.glossary) ? r.glossary : [];
  const pr = p.profile;
  pr.name = toLT(pr.name); pr.headline = toLT(pr.headline); pr.summary = toLT(pr.summary);
  pr.contacts = { ...(pr.contacts ?? {}), location: toLT(pr.contacts?.location) };
  pr.personal = pr.personal ?? {};
  let n = 0;
  const fixId = (prefix: string) => (x: { id?: string }) => { if (!x.id) x.id = `${prefix}-${++n}`; };
  for (const k of ['education', 'work', 'projects', 'skills', 'certificates', 'awards'] as const) {
    const arr = (Array.isArray(r[k]) ? r[k] : []) as unknown as Record<string, unknown>[];
    (p as unknown as Record<string, unknown>)[k] = arr.map((e) => {
      const o: Record<string, unknown> = { enabled: true, ...e };
      for (const f of ['school', 'degree', 'major', 'company', 'title', 'name', 'role', 'issuer', 'category']) if (f in o || ['school', 'degree', 'major', 'company', 'title', 'name', 'role', 'issuer'].includes(f)) o[f] = toLT(o[f]);
      for (const f of ['bullets', 'highlights']) if (Array.isArray(o[f])) o[f] = (o[f] as unknown[]).map(toLT);
      if (['work', 'projects'].includes(k)) { o.bullets = o.bullets ?? []; o.tags = o.tags ?? []; o.start = o.start ?? ''; o.end = o.end ?? ''; }
      if (k === 'education') { o.highlights = o.highlights ?? []; o.start = o.start ?? ''; o.end = o.end ?? ''; }
      if (k === 'certificates' || k === 'awards') o.date = o.date ?? '';
      fixId(k)(o);
      for (const f of ['bullets', 'highlights']) if (Array.isArray(o[f])) (o[f] as LocalizedText[]).forEach((b, i) => { if (!b.id) b.id = `${o.id}-b${i + 1}-${n}`; });
      return o;
    });
  }
  p.evidence = (Array.isArray(r.evidence) ? r.evidence : []).map((e, i) => normalizeEvidence(e, i));
  p.courses = normalizeCourses(r.courses ?? []);
  // 清理指向已不存在条目的关联（不删除任何用户写的内容）
  const ids = new Set([...p.work, ...p.projects].map((x) => x.id));
  const evIds = new Set(p.evidence.map((x) => x.id));
  const skIds = new Set(p.skills.map((x) => x.id));
  for (const sk of p.skills) {
    sk.proficiency = (PROF.includes(sk.proficiency as Proficiency) ? sk.proficiency : '') as Proficiency;
    sk.usedIn = strArr(sk.usedIn).filter((x) => ids.has(x));
    sk.evidenceIds = strArr(sk.evidenceIds).filter((x) => evIds.has(x));
  }
  for (const pj of p.projects) {
    pj.evidenceIds = strArr(pj.evidenceIds).filter((x) => evIds.has(x));
    if (pj.dossier) pj.dossier = normalizeDossier(pj.dossier);
  }
  for (const ev of p.evidence) { ev.projectIds = ev.projectIds.filter((x) => ids.has(x)); ev.skillIds = ev.skillIds.filter((x) => skIds.has(x)); }
  forEachText(p, () => {});
  return p;
}

export function exportProfileJson(p: ProfileDoc): string { return JSON.stringify(p, null, 2); }

const PROF: Proficiency[] = ['', 'aware', 'used', 'proficient', 'expert'];
const EV_TYPES: EvidenceType[] = ['paper', 'patent', 'certificate', 'transcript', 'code', 'report', 'photo', 'video', 'award', 'other'];
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

export function normalizeEvidence(raw: unknown, i = 0): Evidence {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const location = str(e.location);
  return {
    id: str(e.id) || `ev-${Date.now().toString(36)}-${i}`,
    fileName: str(e.fileName), type: EV_TYPES.includes(e.type as EvidenceType) ? (e.type as EvidenceType) : 'other',
    location, locationKind: isUrl(location) ? 'url' : 'note',
    projectIds: strArr(e.projectIds), skillIds: strArr(e.skillIds), proves: str(e.proves),
    confirmed: e.confirmed === true, publicOk: e.publicOk === true, ...(e.note ? { note: str(e.note) } : {}),
  };
}

function normalizeDossier(d: ProjectDossier): ProjectDossier {
  const o: ProjectDossier = { ...d };
  for (const k of ['tools', 'keywords'] as const) o[k] = strArr(o[k]);
  o.failedAttempts = (Array.isArray(o.failedAttempts) ? o.failedAttempts : []).map((f, i) => ({ id: str(f?.id) || `fa-${i + 1}`, approach: str(f?.approach), reason: str(f?.reason) }));
  o.phases = (Array.isArray(o.phases) ? o.phases : []).map((f, i) => ({ ...f, id: str(f?.id) || `ph-${i + 1}`, name: str(f?.name) }));
  return o;
}
