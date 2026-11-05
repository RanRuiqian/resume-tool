import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/ai/provider', () => ({ chatJson: vi.fn(), chat: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import { ResumeDB } from '../src/storage/db';
import { normalizeProfile } from '../src/storage/profileIO';
import { rawToProfile } from '../src/ai/importProfile';
import { addFromAnalysis, addPosting, changeStatus, createApplication } from '../src/tracker/repo';
import {
  defaultVisionProfileId, draftPosting, extractApplyFields, findApplyDate, listGeneratedResumes, matchResume, parseApplyRules,
  recordApplication, removeResumePdf, storeResumePdfs, visionSettingsFor, type GeneratedResumeOption,
} from '../src/tracker/quickRecord';
import type { JobParse, ResumeDoc, Settings } from '../src/types';

// 全部为虚构资料
let n = 0; const fresh = () => new ResumeDB(`qr-${++n}-${Math.random().toString(36).slice(2)}`);
const profile = () => normalizeProfile(rawToProfile({ name: '测试用户壬', work: [{ company: '模拟装备有限公司', title: '实习生', start: '2025-03', end: '2025-08', bullets: ['完成零件装配检查'] }] }));
const job = (id: string, full: string, title: string, lang: 'zh' | 'en' = 'zh'): JobParse => ({ id, createdAt: '2026-11-01T00:00:00.000Z', rawText: `${full} ${title} 岗位职责：负责整车结构设计`, jdLanguage: lang, company: { full, short: full.replace(/(股份)?有限公司$/, '') }, roleAbbr: 'ME', title: { zh: lang === 'zh' ? title : '', en: lang === 'en' ? title : '' }, mustHave: [{ zh: 'CATIA', en: 'CATIA' }], niceToHave: [], yearsRequired: null, keywords: [], summary: '' });
const resumeFor = (p: ReturnType<typeof profile>, id: string, jobId: string, at: string): ResumeDoc => ({ id, jobId, templateId: 'classic', primaryLanguage: 'zh', createdAt: at, matchScore: 80, gaps: [], selection: { work: [p.work[0].id], projects: [], education: [], skills: [], certificates: [], awards: [] }, items: [{ sourceId: p.work[0].bullets[0].id!, zh: '完成零件装配检查', en: 'Checked part assembly', syncStatus: 'in-sync' }], consistency: { checkedAt: '', issues: [] }, generatedBy: 'ai' } as unknown as ResumeDoc);
const NOW = new Date('2026-11-05T17:00:00+08:00');
const S = (over: Partial<Settings> = {}) => ({ demoMode: false, apiKey: 'k', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', visionModel: '', ocrMode: 'local', apiProfiles: [], activeProfileId: null, ...over }) as unknown as Settings;
const pdf = (name: string, lang: 'zh' | 'en' = 'zh') => ({ name, type: 'application/pdf', data: new TextEncoder().encode(`%PDF ${name}`), lang });

beforeEach(() => vi.mocked(chatJson).mockReset());

describe('截图文字 → 投递字段（规则兜底）', () => {
  const shot = `虚构汽车股份有限公司 2027届校园招聘\n投递成功\n申请职位：车身结构设计工程师\n工作地点：柳州\n投递时间：2026-11-05 15:32\n申请截止日期：2026-12-31`;
  it('取公司、岗位、城市、投递时间，不把截止日期当投递时间', () => {
    const f = parseApplyRules(shot, NOW);
    expect(f).toMatchObject({ company: '虚构汽车股份有限公司', title: '车身结构设计工程师', city: '柳州', appliedAt: '2026-11-05T15:32', recruitType: 'campus', programYear: '2027 届', statusText: '投递成功' });
  });
  it('只有月日时按今天推断年份，不会落在未来', () => {
    expect(findApplyDate('已投递 11月3日 09:10', NOW)).toBe('2026-11-03T09:10');
    expect(findApplyDate('已投递 12月20日', NOW)).toBe('2025-12-20T12:00');
    expect(findApplyDate('截止日期：2026-12-31', NOW)).toBe('');
  });
  it('识别投递平台', () => {
    expect(parseApplyRules('牛客网 投递成功', NOW).sourcePlatform).toBe('牛客');
    expect(parseApplyRules('app.mokahr.com 申请已提交', NOW).sourcePlatform).toBe('官网（Moka）');
    expect(parseApplyRules('随便一段字', NOW).sourcePlatform).toBe('');
  });
});

describe('AI 整理字段', () => {
  it('AI 有的以 AI 为准，空的用规则补；未来时间丢弃', async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({ company: '虚构汽车股份有限公司', title: '', city: '柳州', appliedAt: '2027-01-01 10:00', sourcePlatform: '官网', recruitType: 'campus' });
    const r = await extractApplyFields(S(), '申请职位：车身工程师\n投递时间：2026-11-04', NOW);
    expect(r.via).toBe('ai');
    expect(r.fields).toMatchObject({ company: '虚构汽车股份有限公司', title: '车身工程师', city: '柳州', appliedAt: '2026-11-04T12:00', sourcePlatform: '官网', recruitType: 'campus' });
  });
  it('没有 Key 或 AI 失败 → 规则', async () => {
    expect((await extractApplyFields(S({ apiKey: '' }), '申请职位：测试岗', NOW)).via).toBe('rules');
    vi.mocked(chatJson).mockRejectedValueOnce(new Error('timeout'));
    const r = await extractApplyFields(S(), '申请职位：测试岗', NOW);
    expect(r.via).toBe('rules'); expect(r.fields.title).toBe('测试岗');
  });
});

describe('截图识别配置', () => {
  const prof = (id: string, vision: string, key = 'k') => ({ id, name: id, provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: key, model: 'qwen-plus', translateModel: '', visionModel: vision, createdAt: '', updatedAt: '' });
  it('只用明确选中的、有看图模型和 Key 的配置', () => {
    const s = S({ apiProfiles: [prof('ds', ''), prof('qw', 'qwen-vl-plus'), prof('nokey', 'qwen-vl-plus', '')] as never, activeProfileId: 'ds' });
    expect(visionSettingsFor(s, 'qw')).toMatchObject({ visionModel: 'qwen-vl-plus', ocrMode: 'vision', model: 'qwen-plus' });
    expect(visionSettingsFor(s, 'ds')).toBeNull();
    expect(visionSettingsFor(s, 'nokey')).toBeNull();
    expect(visionSettingsFor({ ...s, demoMode: true }, 'qw')).toBeNull();
    expect(defaultVisionProfileId(s, null)).toBe('qw');
    expect(defaultVisionProfileId(s, 'local')).toBe('local');
    expect(defaultVisionProfileId(S(), null)).toBe('local');
  });
});

describe('已生成的简历', () => {
  it('列出全部简历（新→旧），按截图里的公司 / 岗位自动匹配', async () => {
    const d = fresh(), p = profile();
    await d.jobs.bulkPut([job('j1', '虚构汽车股份有限公司', '车身结构设计工程师'), job('j2', '模拟电子有限公司', '硬件工程师'), job('j3', 'Mock Robotics Ltd', 'Robotics Engineer', 'en')]);
    await d.resumes.bulkPut([resumeFor(p, 'r1', 'j1', '2026-11-01T10:00:00Z'), resumeFor(p, 'r2', 'j2', '2026-11-03T10:00:00Z'), resumeFor(p, 'r3', 'j3', '2026-11-02T10:00:00Z')]);
    const o = await listGeneratedResumes(d);
    expect(o.map((x) => x.resume.id)).toEqual(['r2', 'r3', 'r1']);
    expect(o[2].label).toMatch(/^虚构汽车股份有限公司 · 车身结构设计工程师 · 生成于 2026-11-01/);
    expect(matchResume(o, { company: '虚构汽车', title: '车身结构设计工程师（2027届）' })?.resume.id).toBe('r1');
    expect(matchResume(o, { company: '虚构汽车股份有限公司', title: '' })?.resume.id).toBe('r1');
    expect(matchResume(o, { company: '没有这家', title: '硬件工程师' })).toBeNull();
    expect(o.find((x) => x.resume.id === 'r3')?.lang).toBe('en');
  });
});

describe('记录投递', () => {
  const setup = async () => {
    const d = fresh(), p = profile(), j = job('j1', '虚构汽车股份有限公司', '车身结构设计工程师');
    await d.jobs.put(j); const r = resumeFor(p, 'r1', 'j1', '2026-11-01T10:00:00Z'); await d.resumes.put(r);
    const opt = (await listGeneratedResumes(d))[0] as GeneratedResumeOption;
    return { d, p, j, r, opt };
  };
  it('只选简历：公司 / 岗位 / JD 从岗位分析带入，建「已投递」申请、快照、工具 PDF，并提醒补截图', async () => {
    const { d, p, opt } = await setup();
    const posting = draftPosting({ company: '', title: '', city: '', appliedAt: '', sourcePlatform: '' }, opt);
    expect(posting).toMatchObject({ company: '虚构汽车股份有限公司', title: '车身结构设计工程师', jobParseId: 'j1' });
    expect(posting.jdText).toContain('整车结构设计');
    const res = await recordApplication(d, { posting, appliedAt: '2026-11-05T07:00:00.000Z', screenshots: [], snapshot: { resume: opt.resume, profile: p, job: opt.job, label: opt.label, languages: ['zh'] }, pdfs: [pdf('虚构汽车_ME_CN.pdf')] });
    const app = (await d.applications.get(res.applicationId))!;
    expect(app.status).toBe('applied'); expect(app.appliedAt).toBe('2026-11-05T07:00:00.000Z');
    expect(app.todos.map((t) => t.text)).toContain('补上传投递成功截图（可选）');
    const arts = await d.artifacts.where('applicationId').equals(app.id).toArray();
    expect(arts.find((a) => a.kind === 'snapshot')?.submitted).toBe(false);
    expect(arts.find((a) => a.kind === 'uploaded')).toMatchObject({ origin: 'generated', submitted: true, languages: ['zh'] });
    expect((await d.attachments.toArray()).map((a) => a.kind)).toEqual(['resume-submitted']);
  });
  it('截图 + 合并到岗位分析时自动建的「待投递」岗位：状态改为已投递并保留历史，只补空字段', async () => {
    const { d, j } = await setup();
    const { posting: existing } = await addFromAnalysis(d, j);
    const res = await recordApplication(d, {
      posting: { company: '虚构汽车', title: '别的名字', city: '柳州', sourcePlatform: '官网' }, mergeInto: existing.id, appliedAt: '2026-11-05T07:32:00.000Z',
      screenshots: [{ name: 'ok.png', type: 'image/png', data: new Uint8Array([1, 2, 3]) }],
    });
    expect(res.merged).toBe(true);
    const p = (await d.postings.get(existing.id))!;
    expect(p).toMatchObject({ company: '虚构汽车股份有限公司', title: '车身结构设计工程师', city: '柳州', sourcePlatform: '官网' });
    expect(await d.postings.count()).toBe(1);
    const apps = await d.applications.where('postingId').equals(existing.id).toArray();
    expect(apps).toHaveLength(1); expect(apps[0].status).toBe('applied');
    const ev = await d.appEvents.where('applicationId').equals(apps[0].id).toArray();
    expect(ev.map((e) => e.to)).toEqual(['pending', 'applied']);
    expect((await d.attachments.toArray())[0]).toMatchObject({ kind: 'apply-proof', applicationId: apps[0].id });
    expect(apps[0].todos).toHaveLength(0);
  });
  it('已在面试中的申请不被改回已投递；已结束的申请另建一次新申请', async () => {
    const d = fresh();
    const { posting, application } = await addPosting(d, { company: '虚构甲公司', title: '工程师', city: '' }, 'applied');
    await changeStatus(d, application!.id, 'interviewing');
    await recordApplication(d, { posting: { company: '虚构甲公司', title: '工程师', city: '' }, mergeInto: posting.id, appliedAt: '2026-11-05T00:00:00.000Z', screenshots: [] });
    expect((await d.applications.get(application!.id))!.status).toBe('interviewing');
    await changeStatus(d, application!.id, 'rejected');
    const r = await recordApplication(d, { posting: { company: '虚构甲公司', title: '工程师', city: '' }, mergeInto: posting.id, appliedAt: '2026-11-06T00:00:00.000Z', screenshots: [] });
    expect(r.applicationId).not.toBe(application!.id);
    expect(await d.applications.where('postingId').equals(posting.id).count()).toBe(2);
  });
});

describe('简历 PDF 区', () => {
  it('上传自己的版本可替换工具版；删掉实际提交版本时最新的一份接替', async () => {
    const d = fresh();
    const { posting } = await addPosting(d, { company: '虚构乙公司', title: '工程师', city: '' });
    const app = await createApplication(d, posting.id, 'applied');
    const gen = await storeResumePdfs(d, app.id, posting.id, [pdf('gen_CN.pdf', 'zh'), pdf('gen_EN.pdf', 'en')], 'generated');
    expect(gen.every((a) => a.submitted)).toBe(true);
    const [mine] = await storeResumePdfs(d, app.id, posting.id, [{ ...pdf('我的_CN.pdf'), languages: ['zh'] }], 'user', { replaceGenerated: true });
    let arts = await d.artifacts.where('applicationId').equals(app.id).toArray();
    expect(arts.map((a) => [a.label, a.origin, a.submitted])).toEqual([['我的_CN.pdf', 'user', true]]);
    expect((await d.attachments.toArray()).map((a) => a.name)).toEqual(['我的_CN.pdf']);
    expect(await d.attachmentBlobs.count()).toBe(1);
    // 不替换：两份并存，新上传的是实际提交版本
    await storeResumePdfs(d, app.id, posting.id, [pdf('gen2_CN.pdf')], 'generated');
    arts = await d.artifacts.where('applicationId').equals(app.id).toArray();
    expect(arts.find((a) => a.id === mine.id)?.submitted).toBe(false);
    const gen2 = arts.find((a) => a.label === 'gen2_CN.pdf')!;
    await removeResumePdf(d, gen2);
    arts = await d.artifacts.where('applicationId').equals(app.id).toArray();
    expect(arts).toHaveLength(1); expect(arts[0]).toMatchObject({ id: mine.id, submitted: true });
  });
});

describe('时间按本地显示', () => {
  it('UTC 时间戳转本地，本地格式原样', async () => {
    const { localStamp } = await import('../src/tracker/quickRecord');
    const iso = new Date(2026, 10, 5, 15, 32).toISOString();
    expect(localStamp(iso)).toBe('2026-11-05 15:32');
    expect(localStamp(iso, 10)).toBe('2026-11-05');
    expect(localStamp('2026-11-05T09:00')).toBe('2026-11-05 09:00');
    expect(localStamp(undefined)).toBe('');
  });
});
