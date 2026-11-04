import type { ProfileDoc, ResumeDoc, Settings, TemplateConfig } from '../types';
import { buildLayout } from '../render/layout';
import { englishResidue, hasCjk } from '../render/enResidue';
import { translateTexts } from './translate';
import { compareFacts } from './consistency';

/**
 * 英文版兜底补译：不管中文是从哪个字段漏进来的（要点、技能分组名、部门 / 职务、中英混写的句子……），
 * 只要最终英文版面里还有汉字，就把这整句译成英文，存进 resume.enFill。
 * 只翻译不润色；数字 / 日期对不上、或译文里仍有汉字的结果不采用（该句保持原样并继续提示）。
 */
export async function fillEnglishResidue(s: Settings, profile: ProfileDoc, template: TemplateConfig, resume: ResumeDoc): Promise<{ resume: ResumeDoc; filled: number; remaining: number }> {
  const todo = englishResidue(buildLayout(profile, template, 'en', resume)).slice(0, 80);
  if (!todo.length || s.demoMode) return { resume, filled: 0, remaining: todo.length };
  const accepted: Record<string, string> = {};
  let pending = todo;
  for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
    const out = await translateTexts(s, pending.map((text, i) => ({ key: `E${i}`, text })), 'en', profile.glossary);
    const failed: string[] = [];
    pending.forEach((text, i) => {
      const v = out.get(`E${i}`)?.trim();
      if (v && !hasCjk(v) && !compareFacts(text, v).length) accepted[text] = v; else failed.push(text);
    });
    pending = failed;
  }
  const filled = Object.keys(accepted).length;
  const next = filled ? { ...resume, enFill: { ...(resume.enFill ?? {}), ...accepted } } : resume;
  return { resume: next, filled, remaining: pending.length };
}
