import type { Lang, LocalizedText, TemplateConfig, ModuleKey, ProfileDoc } from '../types';

export const other = (l: Lang): Lang => (l === 'zh' ? 'en' : 'zh');

/** 读取某语言文本；缺失时回退到另一语言 */
export function lt(t: LocalizedText | undefined, lang: Lang, fallback = true): string {
  if (!t) return '';
  const v = t[lang]?.trim();
  if (v) return v;
  return fallback ? (t[other(lang)]?.trim() ?? '') : '';
}

/** 用户手动编辑某语言：标记 manual；若编辑的是源语言，另一侧已有译文则标为 stale（F5.3） */
export function editText(t: LocalizedText, lang: Lang, value: string): LocalizedText {
  const next: LocalizedText = { ...t, [lang]: value, status: { ...(t.status ?? {}) } };
  const o = other(lang);
  if (!next.source || !t[next.source]?.trim()) next.source = lang;
  if (next.source === lang) {
    next.status![lang] = 'manual';
    const os = next.status![o];
    if (next[o]?.trim() && (os === 'machine' || os === 'confirmed') && (t.srcSnapshot ?? t[lang] ?? "") !== value) {
      next.status![o] = 'stale';
    }
  } else {
    next.status![lang] = 'manual';
  }
  return next;
}

export function applyTranslation(t: LocalizedText, lang: Lang, value: string): LocalizedText {
  return { ...t, [lang]: value, status: { ...(t.status ?? {}), [lang]: 'machine' }, srcSnapshot: t[other(lang)] ?? '' };
}

export function needsTranslation(t: LocalizedText | undefined, lang: Lang): boolean {
  if (!t) return false;
  const has = (l: Lang) => !!t[l]?.trim();
  if (!has(other(lang))) return false;
  return !has(lang) || t.status?.[lang] === 'stale';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDate(iso: string, fmt: string, presentLabel: string): string {
  if (!iso) return '';
  if (iso === 'present') return presentLabel;
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(iso);
  if (!m) return iso;
  const y = m[1];
  const mo = m[2] ? parseInt(m[2], 10) : 0;
  if (!mo) return y;
  const mm = String(mo).padStart(2, '0');
  switch (fmt) {
    case 'MMM YYYY': return `${MONTHS[mo - 1]} ${y}`;
    case 'YYYY-MM': return `${y}-${mm}`;
    case 'MM/YYYY': return `${mm}/${y}`;
    default: return `${y}.${mm}`;
  }
}
export function formatRange(start: string, end: string, fmt: string, present: string): string {
  const a = formatDate(start, fmt, present), b = formatDate(end, fmt, present);
  return a && b ? `${a} – ${b}` : a || b;
}

export function moduleOrderFor(tpl: TemplateConfig, lang: Lang): ModuleKey[] {
  return tpl.locales[lang].moduleOrderOverride ?? tpl.moduleOrder;
}

/** 遍历资料库中所有 LocalizedText（用于批量补译） */
export function forEachText(p: ProfileDoc, fn: (t: LocalizedText, path: string) => void) {
  const pr = p.profile;
  fn(pr.name, 'profile.name'); fn(pr.headline, 'profile.headline'); fn(pr.summary, 'profile.summary');
  if (pr.contacts.location) fn(pr.contacts.location, 'profile.location');
  p.education.forEach((e) => { fn(e.school, e.id); fn(e.degree, e.id); fn(e.major, e.id); e.highlights.forEach((h) => fn(h, e.id)); });
  p.work.forEach((e) => { fn(e.company, e.id); fn(e.title, e.id); e.bullets.forEach((h) => fn(h, e.id)); });
  p.projects.forEach((e) => { fn(e.name, e.id); fn(e.role, e.id); e.bullets.forEach((h) => fn(h, e.id)); });
  p.skills.forEach((e) => { fn(e.name, e.id); if (e.category) fn(e.category, e.id); });
  [...p.certificates, ...p.awards].forEach((e) => { fn(e.name, e.id); fn(e.issuer, e.id); });
}

export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
