import type { LocalizedText, ProfileDoc } from '../types';
import { forEachText } from '../locale/text';

export function emptyProfile(): ProfileDoc {
  const e = (): LocalizedText => ({});
  return {
    version: '1.2', primaryLanguage: 'zh', glossary: [],
    profile: { name: e(), headline: e(), summary: e(), contacts: { location: e() }, personal: {} },
    education: [], work: [], projects: [], skills: [], certificates: [], awards: [],
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
  p.version = '1.2';
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
  forEachText(p, () => {});
  return p;
}

export function exportProfileJson(p: ProfileDoc): string { return JSON.stringify(p, null, 2); }
