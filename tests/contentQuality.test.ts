import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import { cleanProfile, detectMeta, isResumeSafe, qualityReport, splitMeta, stripFirstPerson, contentView } from '../src/quality/contentQuality';
import { applyOrganize, planOrganize } from '../src/quality/organize';
import { emptyProfile, exportProfileJson, normalizeProfile } from '../src/storage/profileIO';
import { importProfileDetailed } from '../src/ai/importProfile';
import { legacyPolluted } from './helpers/legacyPolluted';
import type { ProfileDoc, Settings } from '../src/types';

const S = { demoMode: false, baseUrl: 'https://api.deepseek.com', apiKey: 'sk-FAKE-test', model: 'deepseek-flash' } as unknown as Settings;
const mock = chatJson as unknown as ReturnType<typeof vi.fn>;
const all = (p: ReturnType<typeof planOrganize> extends Promise<infer R> ? R : never) => new Set(p.proposals.map((x) => x.id));
const safeIds = (p: Awaited<ReturnType<typeof planOrganize>>) => new Set(p.proposals.filter((x) => x.risk === 'safe').map((x) => x.id));
const BANNED = ['实际职责以本人核实为准', '具体情况请自行确认', '该经历可能适用于某些岗位', '这可以作为求职材料', '建议在简历中强调', '尚需补充相关证据', '本人实际掌握程度有待确认', '以上信息仅供参考'];
function work(bullets: string[], extra: Record<string, unknown> = {}): ProfileDoc {
  const p = emptyProfile();
  p.work = [{ id: 'w1', enabled: true, company: { zh: '示例公司' }, title: { zh: '测试实习生' }, kind: 'internship', start: '2023-07', end: '2023-09', bullets: bullets.map((zh, i) => ({ id: `w1-b${i + 1}`, zh, status: { zh: 'manual' } })), ...extra } as unknown as ProfileDoc['work'][number]];
  return p;
}
beforeEach(() => mock.mockReset());

describe('content quality (v1.9)', () => {
  it('1. meta bullets move to notes, never deleted', () => {
    for (const b of BANNED) expect(detectMeta(b + '。'), b).toBeTruthy();
    const { profile } = cleanProfile(work(['完成样机振动测试。实际职责以本人核实为准。', '以上信息仅供参考。']));
    const w = profile.work[0] as unknown as { bullets: { zh: string }[]; notes: string[]; factualContent: string[] };
    expect(w.bullets.map((b) => b.zh)).toEqual(['完成样机振动测试。']);
    expect(w.notes.join()).toContain('实际职责以本人核实为准');
    expect(w.notes.join()).toContain('以上信息仅供参考');
    expect(contentView(w as never).internal_notes.length).toBe(2);
    expect(isResumeSafe('建议在简历中强调动手能力。')).toBe(false);
  });
  it('keeps real technical uncertainty and requirement sentences', () => {
    for (const t of ['测试结果存在不确定性，误差约 5%。', '需确认载荷工况后再选型。', '需要补充润滑油。']) expect(splitMeta(t).keep).toBe(t);
  });
  it('2. first person removed', () => {
    expect(stripFirstPerson('我在公司使用设备进行测试', 'zh')).toBe('在公司使用设备进行测试');
    expect(stripFirstPerson('我们小组完成测试', 'zh')).toBe('我们小组完成测试');
    expect(stripFirstPerson('I designed a fixture.', 'en')).toBe('Designed a fixture.');
    const { profile } = cleanProfile(work(['我在公司使用设备进行测试']));
    expect(profile.work[0].bullets[0].zh).not.toMatch(/我/);
  });
  it('3. expected conferral never becomes actual', async () => {
    const p = emptyProfile();
    p.education = [{ id: 'e1', enabled: true, school: { zh: '示例大学' }, degree: { zh: '硕士' }, major: { zh: '机械工程' }, start: '2024-09', end: '2027-01', expectedConferralDate: '2027-01', highlights: [{ id: 'e1-h1', zh: '预计2027年1月授予硕士学位', status: { zh: 'manual' } }] } as unknown as ProfileDoc['education'][number]];
    mock.mockResolvedValue({ items: [{ key: 'k0', category: 'resume', zh: '已于2027年1月获得硕士学位', en: 'Master degree conferred Jan 2027' }] });
    const plan = await planOrganize(S, p, { useAi: true });
    const pr = plan.proposals.find((x) => x.target === 'b:e1-h1')!;
    expect(pr.risk).toBe('high');
    const out = applyOrganize(p, plan, safeIds(plan));
    expect(out.education[0].expectedConferralDate).toBe('2027-01');
    expect(out.education[0].actualConferralDate ?? '').toBe('');
    expect(out.education[0].highlights[0].zh).toBe('预计2027年1月授予硕士学位');
  });
  it('4. course lab stays a lab; internship never full-time', async () => {
    const p = emptyProfile();
    p.projects = [{ id: 'p1', enabled: true, name: { zh: '机械设计课程实验' }, role: { zh: '组员' }, kind: 'auxiliary', nature: '课程实验', start: '', end: '', tags: [], bullets: [{ id: 'p1-b1', zh: '在课程实验中完成齿轮箱装配。', status: { zh: 'manual' } }] } as unknown as ProfileDoc['projects'][number]];
    p.work = work(['参与设备测试。']).work;
    mock.mockImplementation(async (...args: unknown[]) => { if (!args[1]) return { items: [] }; const msgs = args[1] as { content: string }[]; const c = msgs[1].content; const items = JSON.parse(c.slice(c.lastIndexOf('{"items"'))).items as { key: string; zh: string }[]; return { items: items.map((x) => ({ key: x.key, category: 'resume', zh: x.zh.includes('齿轮箱') ? '为客户完成商业齿轮箱项目装配。' : '作为全职工程师参与设备测试。' })) }; });
    const plan = await planOrganize(S, p, { useAi: true });
    expect(plan.proposals.filter((x) => x.source === 'ai').every((x) => x.risk === 'high')).toBe(true);
    const out = applyOrganize(p, plan, safeIds(plan));
    expect(out.projects[0].bullets[0].zh).toBe('在课程实验中完成齿轮箱装配。');
    expect(out.work[0].bullets[0].zh).toBe('参与设备测试。');
  });
  it('5. failed approaches go to the dossier, bullets stay concise', async () => {
    const p = emptyProfile();
    p.projects = [{ id: 'p1', enabled: true, name: { zh: '夹具设计' }, role: { zh: '组员' }, start: '', end: '', tags: [], bullets: [{ id: 'p1-b1', zh: '完成夹具三维建模与装配。', status: { zh: 'manual' } }, { id: 'p1-b2', zh: '第一版方案因刚度不足失败。', status: { zh: 'manual' } }, { id: 'p1-b3', zh: '测试仅在常温下进行，存在局限。', status: { zh: 'manual' } }] } as unknown as ProfileDoc['projects'][number]];
    const plan = await planOrganize(S, p, { useAi: false });
    const out = applyOrganize(p, plan, all(plan));
    expect(out.projects[0].bullets.map((b) => b.zh)).toEqual(['完成夹具三维建模与装配。']);
    expect(out.projects[0].dossier?.failedAttempts?.map((f) => f.approach).join()).toContain('刚度不足');
    expect(out.projects[0].dossier?.problems).toContain('常温');
  });
  it('6. idempotent: second run proposes nothing, AI not called again', async () => {
    const p = legacyPolluted();
    mock.mockImplementation(async (...args: unknown[]) => { if (!args[1]) return { items: [] }; const msgs = args[1] as { content: string }[]; const items = JSON.parse(msgs[1].content.slice(msgs[1].content.lastIndexOf('{"items"'))).items as { key: string; zh: string; en: string }[]; return { items: items.map((x) => ({ key: x.key, category: 'resume', zh: x.zh, en: x.en })) }; });
    const p1 = await planOrganize(S, p, { useAi: true });
    const o1 = applyOrganize(p, p1, all(p1));
    const calls = mock.mock.calls.length;
    const p2 = await planOrganize(S, o1, { useAi: true });
    expect(p2.proposals.length).toBe(0);
    expect(mock.mock.calls.length).toBe(calls);
    expect(JSON.stringify(cleanProfile(o1).profile)).toBe(JSON.stringify(cleanProfile(cleanProfile(o1).profile).profile));
  });
  it('7. failure / timeout leaves data unchanged', async () => {
    const p = legacyPolluted(); const before = JSON.stringify(p);
    mock.mockRejectedValue(new Error('请求超时'));
    await expect(planOrganize(S, p, { useAi: true })).rejects.toThrow('请求超时');
    mock.mockResolvedValue({ items: [] });
    await expect(planOrganize(S, p, { useAi: true })).rejects.toThrow(/资料没有任何改动/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('user-confirmed text is never auto-rewritten; userConfirmedAt never set', async () => {
    const p = work(['我负责测试。以上信息仅供参考。'], { userConfirmedAt: '2026-01-01T00:00:00Z' });
    p.work[0].bullets[0].status = { zh: 'confirmed' };
    const plan = await planOrganize(S, p, { useAi: false });
    expect(plan.proposals.every((x) => x.risk === 'high')).toBe(true);
    const out = applyOrganize(p, plan, safeIds(plan));
    expect(out.work[0].bullets[0].zh).toBe('我负责测试。以上信息仅供参考。');
    const q = await planOrganize(S, work(['我负责测试。']), { useAi: false });
    expect((applyOrganize(work(['我负责测试。']), q, all(q)).work[0] as { userConfirmedAt?: string }).userConfirmedAt).toBeUndefined();
  });
  it('legacy polluted dataset 2/7/14/29/2/5: before/after metrics, ids & JSON round-trip kept', async () => {
    const p = legacyPolluted();
    const b = qualityReport(p);
    const plan = await planOrganize(S, p, { useAi: false });
    const out = applyOrganize(p, plan, safeIds(plan));
    const a = qualityReport(out);
    console.log('[legacy] samples', JSON.stringify(a.pollutedSamples)); console.log('[legacy] before', JSON.stringify(b), 'after', JSON.stringify(a), 'proposals', plan.proposals.length, 'safe', safeIds(plan).size);
    expect(b.polluted).toBeGreaterThan(20); expect(a.polluted).toBe(0); expect(a.firstPerson).toBe(0);
    expect([out.education.length, out.work.length, out.projects.length, out.skills.length, out.certificates.length, out.awards.length]).toEqual([2, 7, 14, 29, 2, 5]);
    expect(out.work.map((w) => w.id)).toEqual(p.work.map((w) => w.id));
    const rt = normalizeProfile(JSON.parse(exportProfileJson(out)));
    expect((rt.work[0] as unknown as { notes: string[] }).notes.length).toBeGreaterThan(0);
    expect(rt.projects[0].dossier?.failedAttempts?.length).toBeGreaterThan(0);
    const bulletsText = JSON.stringify([out.profile.summary, ...out.work.flatMap((w) => w.bullets), ...out.projects.flatMap((w) => w.bullets), ...out.education.flatMap((w) => w.highlights), ...out.skills.map((x) => x.name)]);
    for (const x of BANNED) expect(bulletsText).not.toContain(x);
    expect(JSON.stringify(out.work.map((w) => (w as unknown as { notes: string[] }).notes))).toContain('实际职责以本人核实为准');
  });
  it('first import runs the same pipeline (meta → notes, no 我, archive → dossier, expected degree kept)', async () => {
    const src = '测试用户八\n示例公司 测试实习生 2023-07~2023-09\n我在公司使用设备进行测试。实际职责以本人核实为准。\n示例大学 硕士 预计2027年1月授予硕士学位\n课程实验：夹具设计，第一版方案因刚度不足失败。';
    mock.mockResolvedValue({ name: '测试用户八', work: [{ company: '示例公司', title: '测试实习生', kind: 'internship', start: '2023-07', end: '2023-09', bullets: ['我在公司使用设备进行测试。实际职责以本人核实为准。'] }], education: [{ school: '示例大学', degree: '硕士', expectedConferralDate: '2027-01' }], projects: [{ name: '夹具设计', nature: '课程实验', bullets: ['完成夹具设计。'], archive: ['第一版方案因刚度不足失败。'] }] });
    const { profile } = await importProfileDetailed(S, src);
    const w = profile.work[0] as unknown as { bullets: { zh: string }[]; notes: string[] };
    expect(w.bullets[0].zh).toBe('在公司使用设备进行测试。');
    expect(w.notes.join()).toContain('实际职责以本人核实为准');
    expect(profile.education[0].actualConferralDate ?? '').toBe('');
    expect(profile.projects[0].dossier?.failedAttempts?.[0].approach).toContain('刚度不足');
  });
});
