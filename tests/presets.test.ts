import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { TemplateConfig } from '../src/types';
import { buildLayout, natureLabel } from '../src/render/layout';
import { ALL_TEMPLATES, BUILTIN_TEMPLATES, ENGINEERING_TEMPLATES, FORMAL_PRESETS, engineeringBaseOf, initialTemplateId, normalizeTemplate } from '../src/templates';
import { renderPdfFit } from '../src/export/zip';
import { docxBytes } from '../src/export/docx/resumeDocx';
import { registerPdfFonts, fontFor } from '../src/export/pdf/fonts';
import { engineerProfile } from './fixtures/presets/engineerProfile';
import { mukuProfile } from './fixtures/presets/mukuProfile';
import { inferWorkKind } from '../src/render/classify';
import { skillName } from '../src/render/layout';
import { degreeStatus, degreeWarnings } from '../src/render/degree';
import type { ProfileDoc } from '../src/types';

const tpl = (id: string) => ALL_TEMPLATES.find((t) => t.id === id)!;
const titles = (m: ReturnType<typeof buildLayout>) => m.main.map((s) => s.title);
const pdfText = (b: Uint8Array) => b.length; // 内容校验在 artifacts 脚本中用 pdftotext 完成
registerPdfFonts(resolve(__dirname, '../public/fonts'));

describe('v1.7 工科正式版预设（测试用途 · 虚构数据）', () => {
  it('4 套预设 = 2 个模板 × 中英文，走同一 buildLayout', () => {
    expect(FORMAL_PRESETS).toHaveLength(4);
    expect(FORMAL_PRESETS.filter((p) => p.recommended).map((p) => p.photo)).toEqual([false, false]);
    FORMAL_PRESETS.forEach((p) => expect(ENGINEERING_TEMPLATES.some((t) => t.id === p.templateId)).toBe(true));
  });
  it('CN 默认模块顺序与标题；不显示出生年月 / 性别 / 籍贯 / 政治面貌', () => {
    const m = buildLayout(engineerProfile(), tpl('tpl-eng'), 'zh');
    expect(titles(m)).toEqual(['教育背景', '项目经历', '实习 / 工作经历', '专业技能', '校园经历', '证书及奖项']);
    expect(m.header.personal).toEqual([]);
    expect(m.photo).toBeNull();
    expect(m.titleStyle).toBe('rule');
  });
  it('EN 模块顺序、自然英文日期与 (expected)，不是中文结构的直译', () => {
    const m = buildLayout(engineerProfile(), tpl('tpl-eng'), 'en');
    expect(titles(m)).toEqual(['EDUCATION', 'PROJECT EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'TECHNICAL SKILLS', 'LEADERSHIP & ACTIVITIES', 'CERTIFICATIONS AND AWARDS']);
    const ed = m.main[0].blocks;
    expect(ed[0].date).toBe('Sep 2025 – Mar 2028 (expected)');
    expect(ed[0].subtitle).toBe('Master of Engineering in Mechanical Engineering');
    expect(ed[1].date).toBe('Sep 2021 – Jun 2025'); // 已授予学位，不加 expected
    // v1.8：社团经历进入 LEADERSHIP & ACTIVITIES，不再混入 Professional Experience
    expect(m.main[2].blocks.map((b) => b.title)).toEqual(['Test Heavy Equipment Co., Ltd. (fictional)']);
    expect(m.main[4].blocks.map((b) => b.title)).toEqual(['Mechanical Innovation Society (student club)']);
    expect(m.header.personal).toEqual([]);
  });
  it('中文预计毕业标注（预计）；课程设计 / 课程实验性质随角色显示', () => {
    const m = buildLayout(engineerProfile({ nearOnePage: true }), tpl('tpl-eng'), 'zh');
    expect(m.main[0].blocks[0].date).toBe('2025.09 – 2028.03（预计）');
    const pr = m.main.find((s) => s.key === 'projects')!.blocks;
    expect(pr[1].subtitle).toBe('小组组长（3 人） | 课程设计');
    expect(pr[2].subtitle).toContain('课程实验');
    expect(pr.every((b) => !b.tags)).toBe(true);
  });
  it('英文版项目性质用英文标准说法，不混入中文', () => {
    const pr = buildLayout(engineerProfile({ nearOnePage: true }), tpl('tpl-eng'), 'en').main.find((s) => s.key === 'projects')!.blocks;
    expect(pr[1].subtitle).toBe('Team Lead (3 students), Course Project');
    expect(pr[2].subtitle).toBe('Individual, Course Lab');
    expect(natureLabel('某种未知性质', 'en')).toBe('');
  });
  it('有照片版：有照片时右上角 28mm；无照片时 photo=null，页眉自动收拢', () => {
    const withP = buildLayout(engineerProfile({ photo: true }), tpl('tpl-eng-photo'), 'zh');
    expect(withP.photo).toMatchObject({ position: 'right', sizeMm: 28 });
    expect(buildLayout(engineerProfile({ photo: true }), tpl('tpl-eng-photo'), 'en').photo).toMatchObject({ position: 'right' });
    expect(buildLayout(engineerProfile(), tpl('tpl-eng-photo'), 'zh').photo).toBeNull();
    // 无照片版即使资料库有照片也不显示
    expect(buildLayout(engineerProfile({ photo: true }), tpl('tpl-eng'), 'en').photo).toBeNull();
  });
  it('缺失模块自动隐藏', () => {
    const m = buildLayout(engineerProfile({ noWork: true }), tpl('tpl-eng'), 'zh');
    expect(titles(m)).toEqual(['教育背景', '项目经历', '专业技能', '证书及奖项']);
  });
  it('切换预设不修改母库', () => {
    const p = engineerProfile({ photo: true });
    const snap = JSON.stringify(p);
    for (const pr of FORMAL_PRESETS) buildLayout(p, tpl(pr.templateId), pr.lang);
    expect(JSON.stringify(p)).toBe(snap);
  });
  it('JD 调整顺序：语言单独排序后生效', () => {
    const t = structuredClone(tpl('tpl-eng'));
    t.locales.zh.moduleOrderOverride = ['projects', 'education', 'skills'];
    expect(titles(buildLayout(engineerProfile(), t, 'zh'))).toEqual(['项目经历', '教育背景', '专业技能']);
  });
  it('旧模板与旧 JSON 兼容：旧模板渲染不变，缺 campus 标题 / style 字段可补齐', () => {
    const p = engineerProfile();
    const old = buildLayout(p, BUILTIN_TEMPLATES[0], 'zh');
    expect(old.style).toBe('default');
    expect(old.main.find((s) => s.key === 'work')!.blocks).toHaveLength(2); // 社团经历仍在工作经历里
    expect(old.main.some((s) => s.key === 'awards')).toBe(true); // 不合并
    const legacyJson = JSON.parse(JSON.stringify(BUILTIN_TEMPLATES[0])) as TemplateConfig & { layout: Record<string, unknown> };
    delete (legacyJson.locales.zh.sectionTitles as Partial<Record<string, string>>).campus;
    delete legacyJson.layout.titleStyle;
    const n = normalizeTemplate(legacyJson);
    expect(n.locales.zh.sectionTitles.campus).toBe('校园经历');
    expect(n.layout).toMatchObject({ titleStyle: 'underline', style: 'default' });
    expect(buildLayout(p, n, 'zh').main.map((s) => s.title)).toEqual(old.main.map((s) => s.title));
    // 旧模板加上 campus 也能用，缺标题时回退默认
    legacyJson.moduleOrder = [...legacyJson.moduleOrder, 'campus'];
    expect(buildLayout(p, legacyJson, 'zh').main.find((s) => s.key === 'campus')?.title).toBe('校园经历');
  });
  it('默认模板：新用户 → 工科正式版；老用户（有资料、未保存过选择）保持经典单栏；已保存的选择不覆盖', () => {
    expect(initialTemplateId(undefined, false)).toBe('tpl-eng');
    expect(initialTemplateId(undefined, true)).toBe('tpl-classic');
    expect(initialTemplateId('tpl-compact', true)).toBe('tpl-compact');
    expect(initialTemplateId('tpl-custom-abc', false)).toBe('tpl-custom-abc');
  });
  it('自定义副本仍识别为对应预设，切回内置预设不受影响', () => {
    const c = { ...structuredClone(tpl('tpl-eng-photo')), id: 'tpl-eng-photo-custom-x1', builtin: false };
    expect(engineeringBaseOf(c)).toBe('tpl-eng-photo');
    expect(engineeringBaseOf({ ...c, id: 'tpl-eng-custom-x2' })).toBe('tpl-eng');
    expect(engineeringBaseOf(BUILTIN_TEMPLATES[0])).toBeNull();
    c.colors.text = '#000000';
    expect(tpl('tpl-eng-photo').colors.text).toBe('#1a1a1a');
  });
  it('英文标准字体缺字回退：μ / ≤ / Φ 走内嵌字体', () => {
    const m = { lang: 'en', typography: { fontFamily: 'Helvetica' } };
    expect(fontFor(m, 'Ra 1.6 μm')).toBe('NotoSansSC');
    expect(fontFor(m, 'flatness ≤ 0.02 mm')).toBe('NotoSansSC');
    expect(fontFor(m, 'Feb 2026 – Jan 2027 (expected) · Dassault Systèmes')).toBe('Helvetica');
  });

  it.each(FORMAL_PRESETS.map((p) => [p.id, p] as const))('导出 PDF + DOCX：%s', async (_id, pr) => {
    const p = engineerProfile({ photo: pr.photo });
    const t = tpl(pr.templateId);
    const f = await renderPdfFit(p, t, pr.lang, null);
    expect(new TextDecoder().decode(f.bytes.slice(0, 5))).toBe('%PDF-');
    expect(f.pages).toBe(1);
    expect(f.overflow).toBe(false);
    const d = await docxBytes(buildLayout(p, f.tpl, pr.lang, null));
    const z = await JSZip.loadAsync(d);
    const xml = await z.file('word/document.xml')!.async('string');
    expect(xml).toContain(pr.lang === 'zh' ? '教育背景' : 'EDUCATION');
    expect(!!z.file(/media\//).length).toBe(pr.photo);
    if (process.env.P11_OUT) {
      mkdirSync(process.env.P11_OUT, { recursive: true });
      const base = `${pr.lang === 'zh' ? 'CN' : 'EN'}_${pr.photo ? (pr.lang === 'zh' ? '有照片' : 'WithPhoto') : (pr.lang === 'zh' ? '无照片' : 'NoPhoto')}`;
      const stem = pr.lang === 'zh' ? `测试用途_张测试_机械设计_${base}` : `TEST_Ce-Zhang_Mechanical-Design_${base}`;
      writeFileSync(resolve(process.env.P11_OUT, `${stem}.pdf`), f.bytes);
      writeFileSync(resolve(process.env.P11_OUT, `${stem}.docx`), d);
    }
    expect(pdfText(f.bytes)).toBeGreaterThan(1000);
  }, 60000);

  it.each([['zh'], ['en']] as const)('超长内容（%s）：自动收紧后允许两页，字号不低于下限', async (lang) => {
    const p = engineerProfile({ long: true, photo: true });
    const f = await renderPdfFit(p, tpl('tpl-eng-photo'), lang, null);
    expect(f.pages).toBe(2);
    expect(f.tpl.locales[lang].typography.bodySizePt).toBeGreaterThanOrEqual(8.5);
    if (process.env.P11_OUT) {
      writeFileSync(resolve(process.env.P11_OUT, `edge_long_two_pages_${lang}.pdf`), f.bytes);
      writeFileSync(resolve(process.env.P11_OUT, `edge_long_two_pages_${lang}.docx`), await docxBytes(buildLayout(p, f.tpl, lang, null)));
    }
  }, 90000);

  it.each([['zh'], ['en']] as const)('接近一页上限（%s）：仍为一页', async (lang) => {
    const p = engineerProfile({ nearOnePage: true });
    const f = await renderPdfFit(p, tpl('tpl-eng'), lang, null);
    expect(f.pages).toBe(1);
    if (process.env.P11_OUT) writeFileSync(resolve(process.env.P11_OUT, `edge_near_one_page_${lang}.pdf`), f.bytes);
  }, 90000);

  it('有照片版缺照片：导出不含图片，仍正常生成', async () => {
    const p = engineerProfile();
    const f = await renderPdfFit(p, tpl('tpl-eng-photo'), 'zh', null);
    expect(f.pages).toBe(1);
    const z = await JSZip.loadAsync(await docxBytes(buildLayout(p, tpl('tpl-eng-photo'), 'zh', null)));
    expect(z.file(/media\//)).toHaveLength(0);
    if (process.env.P11_OUT) writeFileSync(resolve(process.env.P11_OUT, 'edge_photo_missing_zh.pdf'), f.bytes);
  }, 60000);
});

describe('v1.8 经历分类 / 英文细节（测试用途 · 虚构数据）', () => {
  const W = (zh: string, en: string, title = '', kind?: string) => ({ kind, company: { zh, en }, title: { zh: title, en: '' } }) as never;
  it('旧资料无 kind：按名称谨慎推断；显式 kind 优先', () => {
    expect(inferWorkKind(W('机械创新协会', 'Mechanical Innovation Society'))).toBe('club');
    expect(inferWorkKind(W('学院学生会', '', '学术部部长'))).toBe('club');
    expect(inferWorkKind(W('机械 2101 班', '', '班长'))).toBe('club');
    expect(inferWorkKind(W('', 'Robotics Club', '', 'other'))).toBe('club');
    expect(inferWorkKind(W('城市马拉松', '', '赛事志愿者'))).toBe('volunteer');
    expect(inferWorkKind(W('', 'Sample Co.', 'Design Intern'))).toBe('internship');
    expect(inferWorkKind(W('样例精密测量研究所', '', '科研助理'))).toBe('');
    expect(inferWorkKind(W('某行业协会', '', '', 'fulltime'))).toBe('fulltime');
    expect(inferWorkKind(W('', 'Clubhouse Software Inc.', 'Engineer'))).toBe(''); // 单词边界：Clubhouse 不是社团
  });
  it('仿母库结构：CN 各经历进入正确模块，条目一条不少', () => {
    const p = mukuProfile();
    const m = buildLayout(p, tpl('tpl-eng'), 'zh');
    const sec = (k: string) => m.main.find((s) => s.key === k)?.blocks.map((b) => b.title) ?? [];
    expect(titles(m)).toEqual(['教育背景', '项目经历', '实习 / 工作经历', '专业技能', '校园经历', '证书及奖项']);
    expect(sec('work')).toEqual(['样例轨道装备有限公司（虚构）', '样例精密测量研究所（虚构）']);
    expect(sec('campus')).toEqual(['样例工业大学机械学院学生会（虚构）', '机械 2101 班（虚构）', '机器人创新俱乐部（虚构）', '样例城市马拉松赛事（虚构）']);
    expect(sec('projects')).toHaveLength(4);
    expect(sec('work').length + sec('campus').length).toBe(p.work.length);
    expect(m.main[0].blocks[0].date).toContain('（预计）');
    expect(m.main[0].blocks[1].date).not.toContain('预计');
    const pr = m.main.find((s) => s.key === 'projects')!.blocks;
    expect(pr.map((b) => b.subtitle)).toEqual(['课题组成员 | 硕士课题', '个人完成 | 本科毕业设计', '实验小组成员 | 课程实验', '个人完成 | 课程设计']);
    expect(sec('certificates')).toHaveLength(4);
  });
  it('仿母库结构：EN 社团 / 学生干部 / 志愿进入 LEADERSHIP & ACTIVITIES，不进 PROFESSIONAL EXPERIENCE', () => {
    const m = buildLayout(mukuProfile(), tpl('tpl-eng-photo'), 'en');
    const sec = (k: string) => m.main.find((s) => s.key === k)?.blocks.map((b) => b.title) ?? [];
    expect(titles(m)).toEqual(['EDUCATION', 'PROJECT EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'TECHNICAL SKILLS', 'LEADERSHIP & ACTIVITIES', 'CERTIFICATIONS AND AWARDS']);
    expect(sec('work').join(' ')).not.toMatch(/Union|Class|Club|Marathon|Society/);
    expect(sec('campus')).toHaveLength(4);
    expect(m.main[0].blocks[0].date).toMatch(/\(expected\)$/);
    const pr = m.main.find((s) => s.key === 'projects')!.blocks.map((b) => b.subtitle);
    expect(pr).toEqual(["Research Team Member, Master's Research", 'Individual, Capstone Project', 'Lab Group Member, Course Lab', 'Individual, Course Project']);
    expect(JSON.stringify(m.main)).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it('技能去重复标签：不出现 Languages: English: CET-6', () => {
    expect(skillName('English: CET-6 (score 532)', 'Languages')).toBe('English CET-6 (score 532)');
    expect(skillName('Languages: English: CET-6', 'Languages')).toBe('English CET-6');
    expect(skillName('SolidWorks', 'Design Software')).toBe('SolidWorks');
    expect(skillName('英语 CET-6（532 分）', '语言')).toBe('英语 CET-6（532 分）');
    const sk = buildLayout(engineerProfile(), tpl('tpl-eng'), 'en').main.find((s) => s.key === 'skills')!.blocks;
    expect(sk.find((b) => b.title === 'Languages')!.text).toBe('English CET-6 (score 532)');
  });
  it('旧版工科自定义模板（英文顺序没有 campus）导入后自动补上，不影响非工科模板', () => {
    const old = structuredClone(tpl('tpl-eng')) as TemplateConfig;
    old.locales.en.moduleOrderOverride = ['summary', 'education', 'projects', 'work', 'skills', 'certificates', 'awards'];
    expect(normalizeTemplate(old).locales.en.moduleOrderOverride).toEqual(['summary', 'education', 'projects', 'work', 'skills', 'campus', 'certificates', 'awards']);
    const cls = normalizeTemplate(structuredClone(BUILTIN_TEMPLATES[0]));
    expect(cls.moduleOrder).toEqual(BUILTIN_TEMPLATES[0].moduleOrder);
    // 非工科旧模板：社团仍归入原 work 模块（渲染结果不变）
    const m = buildLayout(mukuProfile(), BUILTIN_TEMPLATES[0], 'en');
    expect(m.main.find((s) => s.key === 'work')!.blocks).toHaveLength(6);
  });
  it('丰富经历：自动分到多页，字号不低于下限（PDF + DOCX）', async () => {
    for (const [id, lang] of [['tpl-eng', 'zh'], ['tpl-eng-photo', 'en']] as const) {
      const p = mukuProfile({ rich: true, photo: true });
      const f = await renderPdfFit(p, tpl(id), lang, null);
      expect(f.pages).toBeGreaterThanOrEqual(2);
      expect(f.tpl.locales[lang].typography.bodySizePt).toBeGreaterThanOrEqual(9.5);
      const d = await docxBytes(buildLayout(p, f.tpl, lang, null));
      if (process.env.P11_OUT) {
        writeFileSync(resolve(process.env.P11_OUT, `edge_rich_multipage_${lang}.pdf`), f.bytes);
        writeFileSync(resolve(process.env.P11_OUT, `edge_rich_multipage_${lang}.docx`), d);
        const m2 = mukuProfile({ photo: true });
        const f2 = await renderPdfFit(m2, tpl(id), lang, null);
        writeFileSync(resolve(process.env.P11_OUT, `edge_muku_structure_${lang}.pdf`), f2.bytes);
        writeFileSync(resolve(process.env.P11_OUT, `edge_muku_structure_${lang}.docx`), await docxBytes(buildLayout(m2, f2.tpl, lang, null)));
      }
    }
  }, 120000);
  it('DOCX 长标题：证书 / 奖项长标题用无边框两列表格，日期留在首行右侧；短标题仍用制表位', async () => {
    const d = await docxBytes(buildLayout(mukuProfile(), tpl('tpl-eng'), 'en'));
    const xml = await (await JSZip.loadAsync(d)).file('word/document.xml')!.async('string');
    const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
    expect(tables.some((t) => t.includes('First Prize (Team)') && t.includes('May 2023') && t.includes('w:jc w:val="right"'))).toBe(true);
    expect(xml).not.toContain('<w:txbxContent'); // 不用文本框
    expect(xml).toMatch(/Mechanical CAD Drafter Certificate \(test sample\)<\/w:t>[\s\S]{0,200}?>\tJun 2023</);
  });
});

/** 学位日期边界样例（测试用途 · 虚构学校） */
export function degreeProfile(photo = false): ProfileDoc {
  const p = engineerProfile({ photo });
  const L = (zh: string, en: string) => ({ id: `dg-${zh}`, zh, en, source: 'zh', status: { zh: 'manual', en: 'confirmed' } }) as never;
  const base = { enabled: true, major: L('机械工程', 'Mechanical Engineering'), degree: L('工学硕士', 'Master of Engineering'), highlights: [] };
  p.education = [
    { id: 'dg-a', school: L('甲测试大学（虚构）', 'Alpha Test University (fictional)'), ...base, start: '2024-09', end: '2026-12', expectedConferralDate: '2027-01' },
    { id: 'dg-b', school: L('乙测试大学（虚构）', 'Beta Test University (fictional)'), ...base, degree: L('工学学士', 'Bachelor of Engineering'), start: '2020-09', end: '', expectedConferralDate: '2024-06' },
    { id: 'dg-c', school: L('丙测试大学（虚构）', 'Gamma Test University (fictional)'), ...base, degree: L('工学学士', 'Bachelor of Engineering'), start: '2016-09', end: '2020-06', actualConferralDate: '2020-06', degreeProofStatus: 'pending' },
  ] as never;
  return p;
}

describe('v1.8 学位日期：就读结束 / 预计授位 / 实际授位分开（测试用途）', () => {
  const ed = (lang: 'zh' | 'en') => buildLayout(degreeProfile(), tpl('tpl-eng'), lang).main.find((s) => s.key === 'education')!.blocks.map((b) => b.date);
  it('课程结束 2026-12、预计授位 2027-01、实际为空：两者都写明，不混用', () => {
    expect(ed('zh')[0]).toBe('2024.09 – 2026.12（预计 2027.01 授予学位）');
    expect(ed('en')[0]).toBe('Sep 2024 – Dec 2026 (degree expected Jan 2027)');
  });
  it('预计授位日期已过、实际为空：仍显示预计，不按今天推断为已授位；并提示人工确认', () => {
    expect(ed('zh')[1]).toBe('2020.09 – 2024.06（预计）');
    expect(ed('en')[1]).toBe('Sep 2020 – Jun 2024 (expected)');
    expect(degreeStatus({ end: '', expectedConferralDate: '2024-06' })).toBe('expected');
    expect(degreeWarnings({ end: '', expectedConferralDate: '2024-06' } as never, '2026-10')[0]).toContain('已过');
    expect(degreeWarnings({ end: '', expectedConferralDate: '2028-06' } as never, '2026-10')).toEqual([]);
  });
  it('实际授位只在资料明确确认时使用；矛盾时保留原始区间、不加状态并提示', () => {
    expect(ed('zh')[2]).toBe('2016.09 – 2020.06');
    expect(degreeStatus({ end: '2020-06', actualConferralDate: '2020-06', degreeProofStatus: 'pending' })).toBe('conflict');
    expect(degreeStatus({ end: '2020-06', actualConferralDate: '2020-06' })).toBe('conferred');
    expect(degreeStatus({ end: '2020-06', degreeProofStatus: 'issued' })).toBe('conflict');
    expect(degreeStatus({ end: '2027-06', expectedConferralDate: '2027-01' })).toBe('conflict');
    expect(degreeWarnings({ end: '2020-06', actualConferralDate: '2020-06', degreeProofStatus: 'pending' } as never)).toHaveLength(1);
  });
  it('旧资料（没有任何授位字段）：按原就读区间显示，不加状态', () => {
    expect(degreeStatus({ end: '2025-06' })).toBe('unknown');
    const p = engineerProfile(); p.education[1].actualConferralDate = undefined;
    expect(buildLayout(p, BUILTIN_TEMPLATES[0], 'zh').main.find((s) => s.key === 'education')!.blocks[1].date).toBe('2021.09 – 2025.06');
  });
  it('四套预设导出学位边界样例（PDF + DOCX，供 verify 脚本比对）', async () => {
    for (const pr of FORMAL_PRESETS) {
      const p = degreeProfile(pr.photo);
      const f = await renderPdfFit(p, tpl(pr.templateId), pr.lang, null);
      const d = await docxBytes(buildLayout(p, f.tpl, pr.lang, null));
      if (process.env.P11_OUT) {
        writeFileSync(resolve(process.env.P11_OUT, `edge_degree_${pr.id}.pdf`), f.bytes);
        writeFileSync(resolve(process.env.P11_OUT, `edge_degree_${pr.id}.docx`), d);
      }
      const xml = await (await JSZip.loadAsync(d)).file('word/document.xml')!.async('string');
      expect(xml).toContain(pr.lang === 'zh' ? '（预计 2027.01 授予学位）' : '(degree expected Jan 2027)');
    }
  }, 120000);
});

// 供浏览器端 e2e 注入的虚构资料（测试用途），仅在 P11_OUT 下输出
if (process.env.P11_OUT) {
  it('导出 e2e 用虚构资料', () => {
    mkdirSync(process.env.P11_OUT!, { recursive: true });
    writeFileSync(resolve(process.env.P11_OUT!, 'e2e_profile_photo.json'), JSON.stringify(engineerProfile({ photo: true })));
    writeFileSync(resolve(process.env.P11_OUT!, 'e2e_profile_nophoto.json'), JSON.stringify(engineerProfile({})));
  });
}
