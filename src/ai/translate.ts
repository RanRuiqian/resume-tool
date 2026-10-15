import type { GlossaryEntry, Lang, ProfileDoc, Settings } from '../types';
import { chatJson } from './provider';
import { TRANSLATE_PROMPT } from './prompts';
import { applyTranslation, forEachText, needsTranslation, other } from '../locale/text';

const NAME: Record<Lang, string> = { zh: '中文', en: '英文' };

/** 演示模式的"翻译"：仅套用术语表，并加标记提示用户校对 */
export function mockTranslate(text: string, to: Lang, glossary: GlossaryEntry[]): string {
  let out = text;
  for (const g of glossary) { const [a, b] = to === 'en' ? [g.zh, g.en] : [g.en, g.zh]; if (a && b) out = out.split(a).join(b); }
  return `[${to === 'en' ? 'EN' : '中'}·演示机翻] ${out}`;
}

export async function translateTexts(s: Settings, texts: { key: string; text: string }[], to: Lang, glossary: GlossaryEntry[]): Promise<Map<string, string>> {
  const res = new Map<string, string>();
  if (!texts.length) return res;
  if (s.demoMode) { texts.forEach((t) => res.set(t.key, mockTranslate(t.text, to, glossary))); return res; }
  for (let i = 0; i < texts.length; i += 40) {
    const batch = texts.slice(i, i + 40);
    const r = await chatJson<{ items: { key: string; text: string }[] }>(s, [
      { role: 'system', content: TRANSLATE_PROMPT(NAME[other(to)], NAME[to]) },
      { role: 'user', content: JSON.stringify({ glossary, items: batch }) },
    ], { model: s.translateModel || s.model });
    for (const it of r.items ?? []) if (batch.some((b) => b.key === it.key) && it.text) res.set(it.key, it.text);
  }
  return res;
}

/** 资料库一键补译：所有缺失或过期的目标语言字段（F5.2/F5.3） */
export async function translateProfile(s: Settings, p: ProfileDoc, to: Lang): Promise<{ profile: ProfileDoc; count: number }> {
  const next: ProfileDoc = structuredClone(p);
  const refs: { key: string; text: string; t: import('../types').LocalizedText }[] = [];
  let n = 0;
  forEachText(next, (t) => { if (needsTranslation(t, to)) refs.push({ key: `k${n++}`, text: t[other(to)]!, t }); });
  const out = await translateTexts(s, refs.map(({ key, text }) => ({ key, text })), to, p.glossary);
  let count = 0;
  for (const r of refs) { const v = out.get(r.key); if (v) { Object.assign(r.t, applyTranslation(r.t, to, v)); count++; } }
  return { profile: next, count };
}
