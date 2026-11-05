import { describe, expect, it } from 'vitest';
import { fictionalEngineer, jobs } from './helpers/v110Fixture';
import { generateRules } from '../src/ai/generate';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { buildLayout, isLanguageSkill } from '../src/render/layout';

// 2026-11-05 负责人：专业技能里「办公与语言：英语；PTE」语言不要和办公混在一起，单拉一栏。全部虚构资料。
const tpl = BUILTIN_TEMPLATES[0];
function setup(groupLabel: { zh: string; en: string }) {
  const p = fictionalEngineer();
  const base = p.skills[0];
  p.skills.push(
    { ...structuredClone(base), id: 'sk-en', name: { zh: '英语', en: 'English' }, category: { zh: '办公与语言', en: 'Office & Languages' } },
    { ...structuredClone(base), id: 'sk-pte', name: { zh: 'PTE Academic 成绩：58 分', en: 'PTE Academic score: 58' }, category: { zh: '办公与语言', en: 'Office & Languages' } },
    { ...structuredClone(base), id: 'sk-word', name: { zh: 'Word、PowerPoint', en: 'Word, PowerPoint' }, category: { zh: '办公与语言', en: 'Office & Languages' } });
  const r = generateRules(p, jobs().A, 'zh', 1);
  r.selection.skills = [...r.selection.skills, 'sk-en', 'sk-pte', 'sk-word'];
  r.skillGroups = [{ ...groupLabel, ids: ['sk-word', 'sk-en', 'sk-pte'] }];
  return { p, r };
}
const skillBlocks = (p: ReturnType<typeof setup>['p'], r: ReturnType<typeof setup>['r'], l: 'zh' | 'en') => buildLayout(p, tpl, l, r).main.concat(buildLayout(p, tpl, l, r).side).find((s) => s.key === 'skills')!.blocks;

describe('语言类技能单独成栏', () => {
  it('AI 把语言和办公分在一组：拆成「办公」和「语言」两栏，办公标题去掉「与语言」', () => {
    const { p, r } = setup({ zh: '办公与语言', en: 'Office & Languages' });
    const zh = skillBlocks(p, r, 'zh');
    const lang = zh.find((b) => b.title === '语言')!, office = zh.find((b) => /办公/.test(b.title ?? ''))!;
    expect(lang.text).toContain('英语'); expect(lang.text).toContain('PTE'); expect(lang.text).not.toContain('Word');
    expect(office.title).toBe('办公'); expect(office.text).toContain('Word'); expect(office.text).not.toMatch(/英语|PTE/);
    const en = skillBlocks(p, r, 'en');
    expect(en.find((b) => b.title === 'Languages')!.text).toContain('English');
    expect(en.find((b) => /Office/.test(b.title ?? ''))!.title).toBe('Office');
  });
  it('整组都是语言：只有一个「语言」栏；没被分组的办公软件按分类留在「办公」，标题不再带「语言」', () => {
    const { p, r } = setup({ zh: '办公与语言', en: 'Office & Languages' });
    r.skillGroups = [{ zh: '办公与语言', en: 'Office & Languages', ids: ['sk-en', 'sk-pte'] }];
    const zh = skillBlocks(p, r, 'zh');
    expect(zh.filter((b) => /语言/.test(b.title ?? '')).length).toBe(1);
    expect(zh.find((b) => b.title === '办公')!.text).toContain('Word');
    expect(zh.find((b) => b.title === '语言')!.text).not.toContain('Word');
  });
  it('识别：语言与考试成绩算语言类；编程语言、办公软件不算', () => {
    const n = (zh: string, en = '') => ({ name: { zh, en } });
    for (const x of ['英语', 'English', 'PTE Academic 成绩：58 分', '雅思 6.5', 'CET-6', 'IELTS 7', '日语 N2']) expect(isLanguageSkill(n(x)), x).toBe(true);
    for (const x of ['Python', 'C++', 'MATLAB', 'Word、PowerPoint', 'SolidWorks', 'Excel']) expect(isLanguageSkill(n(x)), x).toBe(false);
    expect(isLanguageSkill({ name: { zh: 'Python' }, category: { zh: '语言' } })).toBe(false);
  });
});
