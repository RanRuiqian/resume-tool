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
    expect(titles(m)).toEqual(['EDUCATION', 'PROJECT EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'TECHNICAL SKILLS', 'CERTIFICATIONS AND AWARDS']);
    const ed = m.main[0].blocks;
    expect(ed[0].date).toBe('Sep 2025 – Mar 2028 (expected)');
    expect(ed[0].subtitle).toBe('Master of Engineering in Mechanical Engineering');
    expect(ed[1].date).toBe('Sep 2021 – Jun 2025'); // 已授予学位，不加 expected
    // EN 无「校园经历」单独模块：社团经历留在 Professional Experience 中，不丢内容
    expect(m.main[2].blocks.map((b) => b.title)).toContain('Mechanical Innovation Society (student club)');
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

// 供浏览器端 e2e 注入的虚构资料（测试用途），仅在 P11_OUT 下输出
if (process.env.P11_OUT) {
  it('导出 e2e 用虚构资料', () => {
    mkdirSync(process.env.P11_OUT!, { recursive: true });
    writeFileSync(resolve(process.env.P11_OUT!, 'e2e_profile_photo.json'), JSON.stringify(engineerProfile({ photo: true })));
    writeFileSync(resolve(process.env.P11_OUT!, 'e2e_profile_nophoto.json'), JSON.stringify(engineerProfile({})));
  });
}
