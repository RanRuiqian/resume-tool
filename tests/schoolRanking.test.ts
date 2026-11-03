import { describe, expect, it } from 'vitest';
import { fictionalEngineer, jobs } from './helpers/v110Fixture';
import { buildLayout } from '../src/render/layout';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { generateRules } from '../src/ai/generate';
import { buildKitContext, verifySentence } from '../src/quality/kitVerify';

// 2026-11-03：学校排名字段（全部虚构）
const titles = (p: ReturnType<typeof fictionalEngineer>, l: 'zh' | 'en') => {
  const r = generateRules(p, jobs().A, l); const m = buildLayout(p, BUILTIN_TEMPLATES[0], l, r);
  return [...m.main, ...m.side].flatMap((s) => s.blocks.map((b) => b.title)).join('\n');
};
describe('学校排名显示在学校名后', () => {
  it('中英文各用各的', () => {
    const p = fictionalEngineer(); p.education[0].ranking = { zh: 'QS 世界大学排名 2027 第 99 位', en: 'QS World University Rankings 2027: #99' };
    expect(titles(p, 'zh')).toContain('虚构海事大学（QS 世界大学排名 2027 第 99 位）');
    expect(titles(p, 'en')).toContain('Fictional Maritime University (QS World University Rankings 2027: #99)');
  });
  it('只填中文时英文简历不显示（不夹中文）；纯英文写在中文栏也可用于英文版', () => {
    const p = fictionalEngineer(); p.education[0].ranking = { zh: 'QS 世界排名第 99 位' };
    expect(titles(p, 'en')).not.toMatch(/QS|排名/);
    p.education[0].ranking = { zh: 'QS 2027 #99' };
    expect(titles(p, 'en')).toContain('(QS 2027 #99)');
  });
  it('不填时与原来完全一样', () => {
    expect(titles(fictionalEngineer(), 'zh')).toContain('虚构海事大学');
    expect(titles(fictionalEngineer(), 'zh').split('\n')).toContain('虚构海事大学');
  });
  it('求职信写到排名不算资料外数字', () => {
    const p = fictionalEngineer(); p.education[0].ranking = { zh: 'QS 世界大学排名 2027 第 99 位', en: 'QS World University Rankings 2027: #99' };
    const t = verifySentence('我就读于虚构海事大学（QS 世界大学排名第 99 位）轮机工程专业，预计 2026 年 12 月获得学位。', 'zh', 'coverLetter', buildKitContext(p, jobs().A, new Date('2026-11-01')));
    expect(t.reasons.join('')).not.toMatch(/数字/);
  });
});
