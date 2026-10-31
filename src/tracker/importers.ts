import type { ResumeDB } from '../storage/db';
import { createApplication, findDuplicates, newPosting, normUrl, nowIso, uid } from './repo';
import { latestByPosting } from './stats';
import type { Application, AppStatus, JobPosting, Priority, RecruitType, SourceInfo } from './types';
import { STATUS_LABEL } from './types';

export type RawRecord = Record<string, unknown>;
export type SourceKind = 'csv' | 'json' | 'ran-application-handoff';
export interface ParsedSource { kind: SourceKind; fileName: string; records: RawRecord[]; keys: string[]; warnings: string[]; meta?: Record<string, unknown> }

/* ---------- CSV ---------- */
/** RFC 4180 风格的 CSV 解析：支持引号、转义引号、字段内换行、BOM、逗号 / 制表符 / 分号分隔 */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', '\t', ';'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f === '') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
export function csvToSource(text: string, fileName: string): ParsedSource {
  const rows = parseCsv(text);
  if (!rows.length) return { kind: 'csv', fileName, records: [], keys: [], warnings: ['文件是空的'] };
  const keys = rows[0].map((h, i) => h.trim() || `列${i + 1}`);
  const records = rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
  const warnings = rows.slice(1).some((r) => r.length !== keys.length) ? ['部分行的列数与表头不一致，请在预览中核对'] : [];
  return { kind: 'csv', fileName, records, keys, warnings };
}

/* ---------- JSON ---------- */
const ARRAY_KEYS = ['applications', 'jobs', 'postings', 'records', 'items', 'data', 'list', 'entries'];
function findRecordArray(v: unknown, depth = 0): RawRecord[] | null {
  if (Array.isArray(v)) return v.every((x) => x && typeof x === 'object' && !Array.isArray(x)) && v.length ? (v as RawRecord[]) : null;
  if (!v || typeof v !== 'object' || depth > 3) return null;
  const o = v as RawRecord;
  for (const k of ARRAY_KEYS) { const r = findRecordArray(o[k], depth + 1); if (r) return r; }
  for (const k of Object.keys(o)) { const r = findRecordArray(o[k], depth + 1); if (r) return r; }
  return null;
}
/** 展平一层嵌套（如 { job: { company } } → job.company），便于字段映射 */
function flatten(r: RawRecord, pre = '', out: RawRecord = {}, depth = 0): RawRecord {
  for (const [k, v] of Object.entries(r)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flatten(v as RawRecord, `${pre}${k}.`, out, depth + 1);
    else out[`${pre}${k}`] = v;
  }
  return out;
}
export const HANDOFF_FORMAT = 'ran-application-handoff';
export function jsonToSource(text: string, fileName: string): ParsedSource {
  let doc: unknown;
  try { doc = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { throw new Error(`不是有效的 JSON：${(e as Error).message}`); }
  const o = (doc && typeof doc === 'object' ? doc : {}) as RawRecord;
  const isHandoff = o.format === HANDOFF_FORMAT;
  const warnings: string[] = [];
  if (o.format === 'resume-tool-archive') throw new Error('这是「完整求职档案」备份，请在「备份与恢复」里导入');
  if (isHandoff && String(o.schemaVersion) !== '1.0') warnings.push(`导航工具数据版本为 ${String(o.schemaVersion)}，本工具按 1.0 适配，请仔细核对字段映射`);
  const arr = findRecordArray(doc);
  if (!arr) throw new Error('没有在 JSON 里找到岗位 / 申请记录列表');
  const records = arr.map((r) => flatten(r));
  const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  if (isHandoff) warnings.push('「2027 求职投递导航」格式：字段结构尚未有实际样本确认，已按字段名自动猜测映射，请在下方逐项核对');
  return { kind: isHandoff ? 'ran-application-handoff' : 'json', fileName, records, keys, warnings, meta: isHandoff ? { format: o.format, schemaVersion: o.schemaVersion, exportedAt: o.exportedAt ?? o.generatedAt } : undefined };
}
export function parseImportFile(text: string, fileName: string): ParsedSource {
  return /\.json$/i.test(fileName) || /^\s*[[{]/.test(text) ? jsonToSource(text, fileName) : csvToSource(text, fileName);
}

/* ---------- 字段映射 ---------- */
export const TARGET_FIELDS = ['company', 'title', 'city', 'category', 'status', 'applyUrl', 'officialUrl', 'recruitType', 'companyType', 'sourcePlatform', 'programYear', 'publishedAt', 'deadline', 'appliedAt', 'priority', 'salary', 'jdText', 'notes'] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];
export const TARGET_LABEL: Record<TargetField, string> = {
  company: '企业', title: '岗位', city: '城市', category: '类别', status: '状态', applyUrl: '投递链接', officialUrl: '官方招聘网址', recruitType: '招聘类型',
  companyType: '企业类型', sourcePlatform: '来源平台', programYear: '项目年份', publishedAt: '发布日期', deadline: '截止日期', appliedAt: '投递日期', priority: '优先级',
  salary: '薪资', jdText: 'JD 原文', notes: '备注',
};
const ALIASES: Record<TargetField, string[]> = {
  company: ['企业', '公司', '公司名称', '企业名称', '单位', 'company', 'companyname', 'employer', 'org', 'organization'],
  title: ['岗位', '职位', '岗位名称', '职位名称', 'title', 'position', 'role', 'job', 'jobtitle', 'name'],
  city: ['城市', '工作城市', '工作地点', '地点', '地区', 'city', 'location', 'region', 'place'],
  category: ['类别', '岗位类别', '方向', '分类', 'category', 'track', 'field'],
  status: ['状态', '投递状态', '进度', 'status', 'stage', 'state', 'progress'],
  applyUrl: ['投递链接', '投递网址', '链接', '网址', '申请链接', 'url', 'link', 'applyurl', 'applylink', 'apply_url', 'joburl'],
  officialUrl: ['官网', '官方招聘网址', '招聘官网', 'officialurl', 'careersurl', 'website', 'homepage'],
  recruitType: ['招聘类型', '类型', '性质', 'recruittype', 'jobtype', 'kind', 'employmenttype'],
  companyType: ['企业类型', '公司类型', '企业性质', 'companytype', 'orgtype'],
  sourcePlatform: ['来源', '来源平台', '平台', 'source', 'platform', 'channel'],
  programYear: ['年份', '届', '项目年份', 'year', 'programyear', 'cohort'],
  publishedAt: ['发布日期', '发布时间', 'publishedat', 'postedat', 'published'],
  deadline: ['截止日期', '截止时间', '截止', 'deadline', 'due', 'closingdate'],
  appliedAt: ['投递日期', '投递时间', '申请日期', 'appliedat', 'applydate', 'applied_at', 'date', 'submittedat'],
  priority: ['优先级', '意向', 'priority', 'rank'],
  salary: ['薪资', '薪酬', '薪资范围', 'salary', 'pay', 'compensation'],
  jdText: ['jd', '岗位描述', '职位描述', 'jd原文', '岗位职责', 'description', 'jobdescription', 'jdtext'],
  notes: ['备注', '笔记', '说明', 'notes', 'note', 'remark', 'comment', 'memo'],
};
export type FieldMapping = Partial<Record<TargetField, string>>;
const k0 = (s: string) => s.toLowerCase().replace(/[\s_\-.]/g, '');
/** 根据列名自动猜测映射；完全匹配优先，其次匹配展平后的末段 */
export function guessMapping(keys: string[]): FieldMapping {
  const m: FieldMapping = {}; const used = new Set<string>();
  for (const pass of [0, 1]) for (const f of TARGET_FIELDS) {
    if (m[f]) continue;
    const al = ALIASES[f].map(k0);
    const hit = keys.find((k) => !used.has(k) && al.includes(k0(pass ? (k.split('.').pop() ?? k) : k)));
    if (hit) { m[f] = hit; used.add(hit); }
  }
  return m;
}

const STATUS_WORDS: [AppStatus, RegExp][] = [
  ['offer', /offer|录用|意向书|签约/i], ['rejected', /拒|未通过|挂|fail|reject|淘汰|不合适/i], ['withdrawn', /撤回|放弃|withdraw/i],
  ['closed', /结束|关闭|closed|过期|expired/i], ['interviewing', /面试|interview|一面|二面|三面|hr面|终面/i],
  ['assessment', /笔试|测评|测试题|oa\b|assessment|test|online/i], ['applied', /已投|投递成功|已申请|applied|submitted|已提交|投了/i],
  ['preparing', /准备|材料|preparing|draft/i], ['saved', /收藏|关注|saved|bookmark|wish|想投|待投|计划/i], ['screening', /待筛选|筛选|new|未处理|todo/i],
];
/** 识别状态文本；无法识别返回 null（绝不猜成「已投递」） */
export function mapStatus(raw: unknown): AppStatus | null {
  const s = String(raw ?? '').trim(); if (!s) return null;
  for (const st of Object.keys(STATUS_LABEL) as AppStatus[]) if (STATUS_LABEL[st] === s || st === s.toLowerCase()) return st;
  for (const [st, re] of STATUS_WORDS) if (re.test(s)) return st;
  return null;
}
function mapRecruit(raw: unknown): RecruitType | undefined {
  const s = String(raw ?? ''); if (/实习|intern/i.test(s)) return 'intern'; if (/校招|校园|应届|campus|graduate/i.test(s)) return 'campus'; if (/社招|experienced|social/i.test(s)) return 'social'; return undefined;
}
function mapPriority(raw: unknown): Priority | undefined {
  const s = String(raw ?? '').trim(); if (!s) return undefined;
  if (/高|high|^1$|a|★★★/i.test(s)) return 1; if (/低|low|^3$|c/i.test(s)) return 3; return 2;
}
function toDate(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim(); if (!s) return undefined;
  const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
/** 稳定哈希（FNV-1a 32 位 ×2），用作导入幂等键 */
export function stableHash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return h1.toString(36) + h2.toString(36);
}

export interface Candidate {
  index: number; rowKey: string;
  posting: Omit<JobPosting, 'id' | 'createdAt' | 'updatedAt'>;
  status: AppStatus | null; statusRaw: string; appliedAt?: string;
  problems: string[];
}
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
export function buildCandidates(src: ParsedSource, mapping: FieldMapping, importedAt = nowIso()): Candidate[] {
  return src.records.map((r, index) => {
    const g = (f: TargetField) => (mapping[f] ? str(r[mapping[f]!]) : '');
    const statusRaw = g('status'); const status = mapStatus(statusRaw);
    const problems: string[] = [];
    if (!g('company')) problems.push('缺少企业'); if (!g('title')) problems.push('缺少岗位');
    if (statusRaw && !status) problems.push(`无法识别状态「${statusRaw}」，只导入岗位，不创建申请状态`);
    const p = {
      company: g('company'), title: g('title'), city: g('city'), category: g('category') || undefined,
      applyUrl: g('applyUrl') || undefined, officialUrl: g('officialUrl') || undefined, recruitType: mapRecruit(g('recruitType') || g('category')),
      companyType: g('companyType') || undefined, sourcePlatform: g('sourcePlatform') || undefined, programYear: g('programYear') || undefined,
      publishedAt: toDate(g('publishedAt')), deadline: toDate(g('deadline')), priority: mapPriority(g('priority')) ?? 2,
      salary: g('salary') || undefined, jdText: g('jdText') || undefined,
      notes: [g('notes'), statusRaw && !status ? `原始状态：${statusRaw}` : ''].filter(Boolean).join('\n') || undefined,
    };
    const rowKey = `${src.kind}:${stableHash([p.company, p.title, p.city, p.applyUrl ?? ''].map((x) => x.toLowerCase().replace(/\s+/g, '')).join('|'))}`;
    const source: SourceInfo = { kind: src.kind, fileName: src.fileName, importedAt, rowKey, raw: r };
    return { index, rowKey, posting: { ...p, source, importKeys: [rowKey] } as Candidate['posting'], status, statusRaw, appliedAt: toDate(g('appliedAt')), problems };
  });
}

export type PlanKind = 'new' | 'duplicate' | 'conflict' | 'invalid';
export type RowAction = 'skip' | 'merge' | 'new';
export interface PlanRow { cand: Candidate; kind: PlanKind; match?: JobPosting; diffs: string[]; defaultAction: RowAction }
const CMP: (keyof JobPosting)[] = ['city', 'applyUrl', 'officialUrl', 'deadline', 'category', 'salary', 'recruitType'];
/** 生成导入预览：新增 / 重复（含同文件重复导入）/ 冲突 / 无效 */
export function planImport(cands: Candidate[], postings: JobPosting[], apps: Application[]): PlanRow[] {
  const latest = latestByPosting(apps); const seen = new Map<string, Candidate>();
  return cands.map((cand): PlanRow => {
    if (!cand.posting.company || !cand.posting.title) return { cand, kind: 'invalid', diffs: cand.problems, defaultAction: 'skip' };
    const same = seen.get(cand.rowKey); seen.set(cand.rowKey, cand);
    if (same) return { cand, kind: 'duplicate', diffs: [`与本文件第 ${same.index + 1} 行相同`], defaultAction: 'skip' };
    const byKey = postings.find((p) => p.importKeys?.includes(cand.rowKey));
    const match = byKey ?? findDuplicates(postings, cand.posting).filter((h) => h.reason !== 'similar').map((h) => h.posting)[0];
    if (!match) return { cand, kind: 'new', diffs: [], defaultAction: 'new' };
    const diffs: string[] = [];
    for (const k of CMP) { const a = match[k], b = cand.posting[k as keyof Candidate['posting']]; if (b && a && (k.endsWith('Url') ? normUrl(String(a)) !== normUrl(String(b)) : String(a) !== String(b))) diffs.push(`${String(k)}：现有「${String(a)}」/ 导入「${String(b)}」`); }
    const cur = latest.get(match.id)?.status;
    if (cand.status && cur !== cand.status) diffs.push(`状态：现有「${cur ? STATUS_LABEL[cur] : '未建立申请'}」/ 导入「${STATUS_LABEL[cand.status]}」`);
    return diffs.length ? { cand, kind: 'conflict', match, diffs, defaultAction: 'skip' } : { cand, kind: 'duplicate', match, diffs: byKey ? ['已导入过（同一来源记录）'] : ['与现有岗位相同'], defaultAction: 'skip' };
  });
}

export interface ImportResult { created: number; merged: number; skipped: number; applications: number; events: number }
/** 执行导入：单个事务，任一步出错整体回滚，数据库恢复原状 */
export async function applyImport(d: ResumeDB, plan: PlanRow[], actions: Record<number, RowAction>): Promise<ImportResult> {
  const res: ImportResult = { created: 0, merged: 0, skipped: 0, applications: 0, events: 0 };
  await d.transaction('rw', d.postings, d.applications, d.appEvents, async () => {
    for (const row of plan) {
      const act = row.kind === 'invalid' ? 'skip' : actions[row.cand.index] ?? row.defaultAction;
      const c = row.cand; const at = c.posting.source.importedAt ?? nowIso();
      if (act === 'skip') { res.skipped++; continue; }
      if (act === 'new' || !row.match) {
        const p = { ...newPosting(c.posting, at), source: c.posting.source, importKeys: [c.rowKey] };
        await d.postings.add(p); res.created++;
        if (c.status) { await createApplication(d, p.id, c.status, importNote(c), c.appliedAt ? `${c.appliedAt}T00:00:00.000Z` : at, c.posting.source); res.applications++; res.events++; }
        continue;
      }
      // merge：只补空字段，不覆盖已有内容；状态变化追加历史
      const m = (await d.postings.get(row.match.id))!; const n: JobPosting = { ...m };
      const nr = n as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(c.posting)) {
        if (v === undefined || v === '' || ['source', 'importKeys', 'notes', 'priority'].includes(k)) continue;
        if (nr[k] === undefined || nr[k] === '') nr[k] = v;
      }
      if (c.posting.notes && !(m.notes ?? '').includes(c.posting.notes)) n.notes = [m.notes, c.posting.notes].filter(Boolean).join('\n');
      n.importKeys = [...new Set([...(m.importKeys ?? []), c.rowKey])]; n.updatedAt = nowIso();
      await d.postings.put(n); res.merged++;
      if (c.status) {
        const apps = await d.applications.where('postingId').equals(m.id).toArray();
        const cur = apps.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (!cur) { await createApplication(d, m.id, c.status, importNote(c), at, c.posting.source); res.applications++; res.events++; }
        else if (cur.status !== c.status) {
          await d.appEvents.add({ id: uid('evt'), applicationId: cur.id, from: cur.status, to: c.status, at, note: importNote(c), by: 'import' });
          await d.applications.put({ ...cur, status: c.status, updatedAt: nowIso(), ...(c.status === 'applied' && !cur.appliedAt ? { appliedAt: c.appliedAt ? `${c.appliedAt}T00:00:00.000Z` : at } : {}) }); res.events++;
        }
      }
    }
  });
  return res;
}
const importNote = (c: Candidate) => `导入自 ${c.posting.source.fileName ?? c.posting.source.kind}（第 ${c.index + 1} 行${c.statusRaw ? `，原始状态「${c.statusRaw}」` : ''}）`;
