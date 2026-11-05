import type { ResumeDB } from '../storage/db';
import type { JobParse, Lang, ProfileDoc, ResumeDoc, Settings } from '../types';
import { chatJson, type ChatMsg } from '../ai/provider';
import { sanitizeJob } from '../utils/sanitizeResume';
import { addAttachment, addPosting, changeStatus, createApplication, deleteAttachment, linkResumeSnapshot, nowIso, postingFromAnalysis, saveApplication, uid, updatePosting, type PostingInput } from './repo';
import type { AppStatus, Application, JobPosting, RecruitType, ResumeArtifact } from './types';

/**
 * 2026-11「记录投递」：投递成功截图 / 已生成的简历 → 一条完整的投递记录，尽量不手填。
 * - 截图字段只取截图里出现的文字，识别不到就留空（不猜）；
 * - 选了简历：公司 / 岗位 / JD 从该简历对应的岗位分析带入，并自动存放工具生成的 PDF；
 * - 简历 PDF 区：工具生成的默认 PDF 可删除，可上传自己微调后的 PDF（以最后放入的为「实际提交版本」）。
 */

/** ISO 时间（UTC，带 Z）→ 本地「YYYY-MM-DD HH:mm」；本来就是本地格式的原样截取 */
export function localStamp(s?: string, len: 10 | 16 = 16): string {
  if (!s) return '';
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s.slice(0, len).replace('T', ' ');
  const d = new Date(s); if (Number.isNaN(d.getTime())) return s.slice(0, len).replace('T', ' ');
  const p2 = (n: number) => String(n).padStart(2, '0');
  const out = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return out.slice(0, len);
}
const fmt = (s?: string) => localStamp(s);
const normKey = (s?: string) => (s ?? '').toLowerCase().replace(/[\s·・,，.。()（）\-_/|]+/g, '').replace(/(股份有限公司|有限责任公司|有限公司|集团|公司|coltd|inc|ltd|limited)$/g, '');

// ───────────────────────── 已生成的简历 ─────────────────────────

export interface GeneratedResumeOption { resume: ResumeDoc; job: JobParse | null; label: string; company: string; title: string; lang: Lang }

export function jobCompany(job: JobParse | null): string { return (job?.company.full || job?.company.short || '').trim(); }
export function jobTitle(job: JobParse | null): string {
  if (!job) return '';
  const l = job.jdLanguage === 'en' ? 'en' : 'zh';
  return (job.title[l] || job.title.zh || job.title.en || '').trim();
}
export function resumeOptionLabel(r: ResumeDoc, job: JobParse | null): string {
  if (job?.generic) return `公版简历 · 生成于 ${fmt(r.createdAt)}`;
  return `${jobCompany(job) || '未识别公司'} · ${jobTitle(job) || '岗位'} · 生成于 ${fmt(r.createdAt)}`;
}

/** 本机保存过的全部简历（新 → 旧），附带对应的岗位分析 */
export async function listGeneratedResumes(d: ResumeDB): Promise<GeneratedResumeOption[]> {
  const rs = (await d.resumes.toArray()).filter((r) => r && Array.isArray(r.items) && r.items.length > 0);
  const ids = [...new Set(rs.map((r) => r.jobId).filter(Boolean))];
  const jobs = new Map<string, JobParse>();
  (await d.jobs.bulkGet(ids)).forEach((j) => { if (j) jobs.set(j.id, sanitizeJob(j)); });
  return rs.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).map((resume) => {
    const job = jobs.get(resume.jobId) ?? null;
    return { resume, job, label: resumeOptionLabel(resume, job), company: jobCompany(job), title: jobTitle(job), lang: job?.jdLanguage === 'en' ? 'en' : 'zh' };
  });
}

/** 截图识别出的公司 / 岗位 → 自动挑最匹配的已生成简历（公司必须对得上） */
export function matchResume(options: GeneratedResumeOption[], f: Pick<ApplyFields, 'company' | 'title'>): GeneratedResumeOption | null {
  const c = normKey(f.company), t = normKey(f.title);
  if (!c) return null;
  const sameCo = (o: GeneratedResumeOption) => {
    const names = [o.job?.company.full, o.job?.company.short].map(normKey).filter((x) => x.length >= 2);
    return names.some((n) => n.includes(c) || c.includes(n));
  };
  const cands = options.filter((o) => !o.job?.generic && sameCo(o));
  if (!cands.length) return null;
  const titled = t ? cands.filter((o) => { const ot = normKey(o.title); return !!ot && (ot.includes(t) || t.includes(ot)); }) : [];
  if (titled.length) return titled[0];
  return cands.length === 1 || !t ? cands[0] : null;
}

// ───────────────────────── 截图字段 ─────────────────────────

export interface ApplyFields {
  company: string; title: string; city: string;
  /** 'YYYY-MM-DDTHH:mm'（datetime-local 格式）；识别不到为空 */
  appliedAt: string;
  sourcePlatform: string; recruitType?: RecruitType; programYear?: string; applyUrl?: string;
  /** 截图里的状态原文，如「投递成功」 */
  statusText?: string;
}
export const EMPTY_FIELDS: ApplyFields = { company: '', title: '', city: '', appliedAt: '', sourcePlatform: '' };

const CITIES = ['北京', '上海', '天津', '重庆', '深圳', '广州', '杭州', '南京', '苏州', '无锡', '常州', '宁波', '合肥', '武汉', '长沙', '郑州', '西安', '成都', '青岛', '济南', '厦门', '福州', '东莞', '佛山', '珠海', '大连', '沈阳', '哈尔滨', '长春', '石家庄', '太原', '南昌', '南宁', '柳州', '昆明', '贵阳', '兰州', '乌鲁木齐', '呼和浩特', '海口', '温州', '嘉兴', '绍兴', '烟台', '芜湖', '襄阳', '株洲', '宜宾', '香港', '澳门', '台北', '新加坡', 'Kuala Lumpur', '吉隆坡', 'Singapore', 'Shanghai', 'Beijing', 'Shenzhen'];
const PLATFORMS: [RegExp, string][] = [
  [/牛客|nowcoder/i, '牛客'], [/boss\s*直聘|zhipin/i, 'Boss直聘'], [/智联/i, '智联招聘'], [/前程无忧|51job/i, '前程无忧'], [/猎聘|liepin/i, '猎聘'],
  [/linkedin|领英/i, 'LinkedIn'], [/实习僧/i, '实习僧'], [/应届生求职|yingjiesheng/i, '应届生求职网'], [/jobstreet/i, 'JobStreet'],
  [/mokahr|moka/i, '官网（Moka）'], [/北森|beisen/i, '官网（北森）'], [/飞书招聘|feishu|jobs\.bytedance/i, '官网（飞书）'], [/hotjob|大易|dayee/i, '官网'],
  [/官网|校园招聘|careers?\.|campus/i, '官网'],
];
const pad = (n: number) => String(n).padStart(2, '0');

/** 从截图文字里找投递时间：优先「投递 / 申请 / 提交」所在行，跳过「截止 / 有效期」 */
export function findApplyDate(text: string, now = new Date()): string {
  const lines = text.split(/\n+/);
  const ordered = [...lines.filter((l) => /投递|申请|提交|applied|submitted/i.test(l)), ...lines].filter((l) => !/截止|有效期|deadline|expire|结束/i.test(l));
  for (const l of ordered) {
    let m = l.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})[:：](\d{2}))?/);
    if (m) {
      const [y, mo, d] = [+m[1], +m[2], +m[3]];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}T${m[4] ? `${pad(+m[4])}:${m[5]}` : '12:00'}`;
    }
    m = l.match(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})[:：](\d{2}))?/);
    if (m) {
      const [mo, d] = [+m[1], +m[2]];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      let y = now.getFullYear();
      if (new Date(y, mo - 1, d).getTime() > now.getTime() + 86400000) y -= 1;
      return `${y}-${pad(mo)}-${pad(d)}T${m[3] ? `${pad(+m[3])}:${m[4]}` : '12:00'}`;
    }
  }
  return '';
}

/** 规则提取（无 API / AI 失败时兜底）：只拿截图里写明的内容 */
export function parseApplyRules(text: string, now = new Date()): ApplyFields {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const after = (re: RegExp) => { for (const l of lines) { const m = l.match(re); if (m?.[1]?.trim()) return m[1].trim().replace(/[，,;；|].*$/, '').slice(0, 60); } return ''; };
  const compM = text.match(/([一-龥A-Za-z（）()]{2,30}?(?:股份有限公司|有限责任公司|有限公司|集团))/);
  const company = after(/(?:公司名称|公司|企业|招聘单位|Company)\s*[:：]\s*(.+)/i) || (compM ? compM[1].trim() : '');
  const title = after(/(?:申请职位|投递职位|应聘职位|职位名称|岗位名称|职位|岗位|Position|Job title)\s*[:：]\s*(.+)/i)
    || (lines.find((l) => l.length <= 30 && /工程师|专员|管培生|培训生|实习生|设计师|分析师|经理|研究员|技术员|engineer|intern|trainee|analyst|designer/i.test(l) && !/公司|有限/.test(l)) ?? '');
  let city = after(/(?:工作地点|工作城市|工作地|地点|城市|Location)\s*[:：]\s*(.+)/i);
  if (!city) city = CITIES.find((c) => text.includes(c)) ?? '';
  const sourcePlatform = PLATFORMS.find(([re]) => re.test(text))?.[1] ?? '';
  const recruitType: RecruitType | undefined = /社招|社会招聘/.test(text) ? 'social' : /实习|intern/i.test(text) ? 'intern' : /校招|校园|应届|管培|届\b|graduate|campus/i.test(text) ? 'campus' : undefined;
  const yr = text.match(/(20\d{2})\s*届/);
  const statusText = lines.find((l) => /投递成功|申请成功|已投递|提交成功|已申请|简历已提交|已提交|application (?:submitted|received)|successfully/i.test(l))?.slice(0, 40);
  const url = text.match(/https?:\/\/[^\s"'<>，。]+/)?.[0];
  return { company, title: title.slice(0, 60), city: city.slice(0, 30), appliedAt: findApplyDate(text, now), sourcePlatform, recruitType, programYear: yr ? `${yr[1]} 届` : undefined, applyUrl: url, statusText };
}

const APPLY_PROMPT = (today: string) => `这是一张求职「投递成功 / 申请记录」的截图（或其文字）。只根据截图里实际出现的文字，提取下面字段，输出 JSON：
{"company":"公司全称或截图里的公司名","title":"岗位名称","city":"工作城市","appliedAt":"投递时间，格式 YYYY-MM-DD HH:mm，只有日期就写 YYYY-MM-DD","sourcePlatform":"投递平台：官网 / 牛客 / Boss直聘 / 智联招聘 / 前程无忧 / 猎聘 / LinkedIn / 实习僧 等","recruitType":"campus（校招）/ intern（实习）/ social（社招）/ 空","programYear":"如 2027 届","applyUrl":"截图里出现的网址","statusText":"状态原文，如 投递成功"}
规则：截图里没有的字段一律填空字符串，不要猜测、不要编造；「截止日期」不是投递时间；年份没写时按今天 ${today} 推断（不能晚于今天）。只输出 JSON。`;

function cleanFields(raw: unknown, now = new Date()): Partial<ApplyFields> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (k: string, max = 60) => (typeof o[k] === 'string' ? (o[k] as string).trim().slice(0, max) : '');
  const rt = s('recruitType');
  let appliedAt = '';
  const at = s('appliedAt', 30).match(/(20\d{2})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (at) {
    const d = `${at[1]}-${pad(+at[2])}-${pad(+at[3])}T${at[4] ? `${pad(+at[4])}:${at[5]}` : '12:00'}`;
    if (new Date(d).getTime() <= now.getTime() + 86400000) appliedAt = d;
  }
  const url = s('applyUrl', 500);
  return {
    company: s('company'), title: s('title'), city: s('city', 30), appliedAt, sourcePlatform: s('sourcePlatform', 30),
    recruitType: rt === 'campus' || rt === 'intern' || rt === 'social' ? rt : undefined,
    programYear: s('programYear', 20) || undefined, applyUrl: /^https?:\/\//i.test(url) ? url : undefined, statusText: s('statusText', 40) || undefined,
  };
}
/** AI 结果为主，空字段用规则结果补 */
export function mergeFields(ai: Partial<ApplyFields>, rules: ApplyFields): ApplyFields {
  const out = { ...rules };
  (Object.keys(ai) as (keyof ApplyFields)[]).forEach((k) => { const v = ai[k]; if (v) (out as Record<string, unknown>)[k] = v; });
  return out;
}

const today = (now: Date) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** 文字 → 字段：有 API 用文字模型，否则规则 */
export async function extractApplyFields(s: Settings, text: string, now = new Date()): Promise<{ fields: ApplyFields; via: 'ai' | 'rules' }> {
  const rules = parseApplyRules(text, now);
  if (s.demoMode || !s.apiKey || !text.trim()) return { fields: rules, via: 'rules' };
  try {
    const raw = await chatJson<unknown>(s, [{ role: 'user', content: `${APPLY_PROMPT(today(now))}\n\n截图文字：\n${text.slice(0, 6000)}` }], { model: s.model, maxTokens: 800, timeoutMs: 60_000 });
    return { fields: mergeFields(cleanFields(raw, now), rules), via: 'ai' };
  } catch { return { fields: rules, via: 'rules' }; }
}

/** 看图模型一次完成：图片 → 字段（失败抛错，由调用方回退本机识别） */
export async function visionApplyFields(vs: Settings, dataUrl: string, now = new Date()): Promise<ApplyFields> {
  const msg: ChatMsg = { role: 'user', content: [{ type: 'text', text: APPLY_PROMPT(today(now)) }, { type: 'image_url', image_url: { url: dataUrl } }] } as ChatMsg;
  const raw = await chatJson<unknown>(vs, [msg], { model: vs.visionModel || vs.model, maxTokens: 800, timeoutMs: 90_000 });
  return mergeFields(cleanFields(raw, now), EMPTY_FIELDS);
}

/** 用哪套配置识别截图：指定的配置（须有看图模型）→ 返回可直接调用的 Settings；没有则 null（本机识别） */
export function visionSettingsFor(s: Settings, profileId: string | null | undefined): Settings | null {
  if (s.demoMode || !profileId) return null;
  const p = (s.apiProfiles ?? []).find((x) => x.id === profileId);
  if (!p || !p.visionModel?.trim() || !p.apiKey?.trim()) return null;
  return { ...s, provider: p.provider, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, translateModel: p.translateModel, visionModel: p.visionModel, ocrMode: 'vision' };
}
/** 可用于截图识别的配置（有看图模型且填了 Key） */
export const visionProfiles = (s: Settings) => (s.apiProfiles ?? []).filter((p) => p.visionModel?.trim() && p.apiKey?.trim());
/** 默认识别配置：上次的选择 → 当前启用的配置（若有看图模型）→ 第一套有看图模型的配置 → 本机 */
export function defaultVisionProfileId(s: Settings, saved: string | null): string {
  const ok = visionProfiles(s);
  if (saved === 'local') return 'local';
  if (saved && ok.some((p) => p.id === saved)) return saved;
  if (s.activeProfileId && ok.some((p) => p.id === s.activeProfileId)) return s.activeProfileId;
  return ok[0]?.id ?? 'local';
}

// ───────────────────────── 草稿 → 投递记录 ─────────────────────────

/** 截图字段 + 所选简历 → 岗位字段。截图里有的以截图为准，空的由岗位分析补 */
export function draftPosting(f: ApplyFields, opt: GeneratedResumeOption | null): PostingInput {
  const job = opt?.job && !opt.job.generic ? opt.job : null;
  const base: PostingInput = job ? postingFromAnalysis(job) : { company: '', title: '', city: '', source: { kind: 'manual' } };
  return {
    ...base,
    company: f.company || base.company, title: f.title || base.title, city: f.city || base.city || '',
    ...(f.sourcePlatform ? { sourcePlatform: f.sourcePlatform } : {}), ...(f.recruitType ? { recruitType: f.recruitType } : {}),
    ...(f.programYear ? { programYear: f.programYear } : {}), ...(f.applyUrl ? { applyUrl: f.applyUrl } : {}),
  };
}

const PRE_APPLY: AppStatus[] = ['screening', 'saved', 'pending', 'preparing'];
const ENDED: AppStatus[] = ['rejected', 'withdrawn', 'closed'];

export interface FileBytes { name: string; type: string; data: Uint8Array }
export interface RecordArgs {
  posting: PostingInput;
  /** 合并到已有岗位（只补空字段，不覆盖已有内容） */
  mergeInto?: string;
  /** ISO 时间 */
  appliedAt: string;
  screenshots: FileBytes[];
  snapshot?: { resume: ResumeDoc; profile: ProfileDoc; job: JobParse | null; label: string; languages: Lang[] };
  pdfs?: (FileBytes & { lang: Lang })[];
  note?: string;
}

/** 已有岗位只补空字段 */
function fillEmpty(p: JobPosting, v: PostingInput): JobPosting | null {
  const n = { ...p } as Record<string, unknown>; let changed = false;
  for (const [k, x] of Object.entries(v)) {
    if (['company', 'title', 'source', 'priority'].includes(k) || x === undefined || x === '') continue;
    if (n[k] === undefined || n[k] === '') { n[k] = x; changed = true; }
  }
  return changed ? (n as unknown as JobPosting) : null;
}

/** 一次写完：岗位（新建或合并）→ 申请（已投递）→ 截图附件 → 简历快照 → 工具生成的 PDF。返回岗位与申请 ID */
export async function recordApplication(d: ResumeDB, a: RecordArgs): Promise<{ postingId: string; applicationId: string; merged: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const note = a.note ?? '记录投递';
  let posting: JobPosting | undefined;
  if (a.mergeInto) {
    posting = await d.postings.get(a.mergeInto);
    if (posting) { const f = fillEmpty(posting, a.posting); if (f) posting = await updatePosting(d, f); }
  }
  const merged = !!posting;
  if (!posting) posting = (await addPosting(d, a.posting)).posting;

  const apps = (await d.applications.where('postingId').equals(posting.id).toArray()).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  let app: Application | undefined = apps.find((x) => !ENDED.includes(x.status));
  if (app && PRE_APPLY.includes(app.status)) app = await changeStatus(d, app.id, 'applied', note, a.appliedAt);
  else if (app && !app.appliedAt) app = await saveApplication(d, { ...app, appliedAt: a.appliedAt });
  if (!app) app = await createApplication(d, posting.id, 'applied', note, a.appliedAt);

  for (const f of a.screenshots) {
    try { await addAttachment(d, f, { postingId: posting.id, applicationId: app.id, kind: 'apply-proof', note: '投递成功截图' }); }
    catch (e) { warnings.push(`截图「${f.name}」没有保存：${(e as Error).message}`); }
  }
  if (a.snapshot) {
    await linkResumeSnapshot(d, app.id, { resume: a.snapshot.resume, profile: a.snapshot.profile, job: a.snapshot.job, label: a.snapshot.label, languages: a.snapshot.languages, submitted: !a.pdfs?.length });
  }
  if (a.pdfs?.length) {
    try { await storeResumePdfs(d, app.id, posting.id, a.pdfs, 'generated'); }
    catch (e) { warnings.push(`简历 PDF 没有保存：${(e as Error).message}`); }
  }
  if (!a.screenshots.length && !app.todos.some((t) => !t.done && /投递成功截图/.test(t.text))) {
    const cur = (await d.applications.get(app.id))!;
    await saveApplication(d, { ...cur, todos: [...cur.todos, { id: uid('todo'), text: '补上传投递成功截图（可选）', done: false, createdAt: nowIso() }] });
  }
  return { postingId: posting.id, applicationId: app.id, merged, warnings };
}

// ───────────────────────── 简历 PDF 区 ─────────────────────────

export const isPdfArtifact = (a: ResumeArtifact) => a.kind === 'uploaded' && !!a.attachmentId;

/**
 * 存放简历文件（一次可多份，如中文 + 英文），都设为「实际提交版本」，同一申请里之前的版本取消该标记。
 * origin=generated：工具生成；origin=user：自己修改后上传。replaceGenerated：先删除已有的工具生成版本。
 */
export async function storeResumePdfs(d: ResumeDB, appId: string, postingId: string, files: (FileBytes & { lang?: Lang; languages?: Lang[] })[], origin: 'generated' | 'user', opts: { replaceGenerated?: boolean } = {}): Promise<ResumeArtifact[]> {
  if (!files.length) return [];
  if (opts.replaceGenerated) {
    const old = (await d.artifacts.where('applicationId').equals(appId).toArray()).filter((x) => isPdfArtifact(x) && x.origin === 'generated');
    for (const o of old) await deleteAttachment(d, o.attachmentId!);
  }
  const out: ResumeArtifact[] = [];
  for (const file of files) {
    const att = await addAttachment(d, { name: file.name, type: file.type, data: file.data }, { applicationId: appId, postingId, kind: 'resume-submitted', note: origin === 'generated' ? '工具生成' : '我修改后的版本' });
    if (!out.length) await d.artifacts.where('applicationId').equals(appId).modify((x: ResumeArtifact) => { x.submitted = false; });
    const art: ResumeArtifact = { id: uid('art'), applicationId: appId, kind: 'uploaded', label: file.name, languages: file.languages ?? (file.lang ? [file.lang] : ['zh']), createdAt: nowIso(), attachmentId: att.id, submitted: true, origin };
    await d.artifacts.add(art); out.push(art);
  }
  return out;
}

/** 删除一份简历文件；若删掉的是实际提交版本，把剩下最新的一份文件设为实际提交版本 */
export async function removeResumePdf(d: ResumeDB, art: ResumeArtifact): Promise<void> {
  if (art.attachmentId) await deleteAttachment(d, art.attachmentId); else await d.artifacts.delete(art.id);
  if (!art.submitted) return;
  const rest = (await d.artifacts.where('applicationId').equals(art.applicationId).toArray()).filter(isPdfArtifact).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (rest[0]) await d.artifacts.update(rest[0].id, { submitted: true });
}

/** 默认 PDF 语言：英文 JD → 英文，其余中文 */
export const defaultPdfLangs = (job: JobParse | null | undefined): Lang[] => (job?.jdLanguage === 'en' ? ['en'] : ['zh']);
