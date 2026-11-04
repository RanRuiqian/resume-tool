import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import type { Settings } from '../src/types';
import { fictionalEngineer, jobs } from './helpers/v110Fixture';
import { generateRules } from '../src/ai/generate';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { buildLayout } from '../src/render/layout';
import { englishResidue, applyEnFill, hasCjk } from '../src/render/enResidue';
import { fillEnglishResidue } from '../src/ai/enFill';

// 2026-11-04 负责人实测：英文版简历仍有中文（要点、技能分组名、部门 / 职务）。全部虚构资料。
const S = { demoMode: false, baseUrl: 'https://api.example.com', apiKey: 'sk-FAKE', model: 'm' } as unknown as Settings;
const mock = chatJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mock.mockReset());

const P = fictionalEngineer();
const tpl = BUILTIN_TEMPLATES[0];
function resumeWithChinese() {
  const r = generateRules(P, jobs().A, 'zh', 1);
  // 模拟：某条要点没有英文、技能分组名没有英文
  r.items[1] = { ...r.items[1], en: '' };
  r.skillGroups = [{ zh: '人工智能/模型训练', en: '', ids: r.selection.skills.slice(0, 1) }, { zh: '精益生产/供应链', en: '', ids: r.selection.skills.slice(1, 2) }];
  return r;
}

describe('英文版残留中文', () => {
  it('检测：缺英文的要点、技能分组名会出现在残留里，英文内容不算', () => {
    const r = resumeWithChinese();
    const res = englishResidue(buildLayout(P, tpl, 'en', r));
    expect(res.length).toBeGreaterThan(0);
    expect(res.every(hasCjk)).toBe(true);
    expect(res).toContain('人工智能/模型训练');
  });
  it('套用补译表后整句替换；资料库不变', () => {
    const r = resumeWithChinese();
    const before = JSON.stringify(P);
    const m = applyEnFill(buildLayout(P, tpl, 'en', r), { '人工智能/模型训练': 'AI / Model Training' });
    expect(JSON.stringify(m)).toContain('AI / Model Training');
    expect(JSON.stringify(P)).toBe(before);
  });
  it('buildLayout 自动套用 resume.enFill，中文版不受影响', () => {
    const r = { ...resumeWithChinese(), enFill: { '人工智能/模型训练': 'AI / Model Training' } };
    expect(JSON.stringify(buildLayout(P, tpl, 'en', r))).toContain('AI / Model Training');
    expect(JSON.stringify(buildLayout(P, tpl, 'zh', r))).not.toContain('AI / Model Training');
  });
  it('补译：采用合格译文；数字对不上 / 译文仍含中文的不采用（含一次重试）', async () => {
    const r = resumeWithChinese();
    const res = englishResidue(buildLayout(P, tpl, 'en', r));
    // 无数字的句子 → 合格译文；含数字的句子 → 译文编造数字 999（应被拒绝）；技能分组名 → 仍返回中文（应被拒绝）
    mock.mockImplementation(async (...a: unknown[]) => { const msgs = a[1] as { content: string }[]; if (!msgs) return { items: [] };
      const items = JSON.parse(msgs[1].content).items as { key: string; text: string }[];
      return { items: items.map((x) => ({ key: x.key, text: x.text === '人工智能/模型训练' ? '人工智能' : /\d/.test(x.text) ? 'Invented 999 result' : 'Good translation' })) };
    });
    const out = await fillEnglishResidue(S, P, tpl, r);
    const ok = res.filter((x) => x !== '人工智能/模型训练' && !/\d/.test(x)), bad = res.filter((x) => !ok.includes(x));
    expect(ok.length).toBeGreaterThan(0); expect(bad.length).toBeGreaterThan(0);
    for (const x of ok) expect(out.resume.enFill![x]).toBe('Good translation');
    for (const x of bad) expect(out.resume.enFill?.[x]).toBeUndefined();
    expect(out.filled).toBe(ok.length); expect(out.remaining).toBe(bad.length);
    expect(mock.mock.calls.filter((c: unknown[]) => c.length).length).toBe(2);
  });
  it('没有残留或演示模式：不调用 AI', async () => {
    const r = generateRules(P, jobs().A, 'zh', 1);
    mock.mockClear();
    const a = await fillEnglishResidue(S, P, tpl, { ...r, enFill: Object.fromEntries(englishResidue(buildLayout(P, tpl, 'en', r)).map((x) => [x, 'x'])) });
    expect(mock).not.toHaveBeenCalled(); expect(a.remaining).toBe(0);
    const b = await fillEnglishResidue({ ...S, demoMode: true } as Settings, P, tpl, resumeWithChinese());
    expect(mock).not.toHaveBeenCalled(); expect(b.filled).toBe(0);
  });
});

describe('姓名下方一行（求职方向）可编辑 / 可隐藏', () => {
  it('headlineHidden 时中英文版面都不显示；否则取简历自己的，缺省回退资料库', () => {
    const r = generateRules(P, jobs().A, 'zh', 1);
    const shown = { ...r, headline: { zh: '我自己写的方向', en: 'My direction' } };
    expect(buildLayout(P, tpl, 'zh', shown).header.headline).toBe('我自己写的方向');
    expect(buildLayout(P, tpl, 'en', shown).header.headline).toBe('My direction');
    const hidden = { ...shown, headlineHidden: true };
    expect(buildLayout(P, tpl, 'zh', hidden).header.headline).toBe('');
    expect(buildLayout(P, tpl, 'en', hidden).header.headline).toBe('');
  });
});
