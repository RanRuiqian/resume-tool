/** 文件命名规则（PRD 3.6 / F6.6–F6.8） */
// oxlint-disable-next-line no-control-regex -- 需要剔除控制字符（F6.7）
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** 按「字符」截断（中文按字计数，兼容代理对） */
function truncate(s: string, max: number) {
  return Array.from(s).slice(0, max).join('');
}

export function sanitizeSegment(input: string, max: number): string {
  let s = (input ?? '').normalize('NFC').replace(ILLEGAL, '_');
  s = s.replace(/\s+/g, ' ').trim().replace(/ /g, '-');
  s = s.replace(/_+/g, '_').replace(/-+/g, '-').replace(/^[_.-]+|[_.-]+$/g, '');
  s = truncate(s, max).replace(/[_.-]+$/g, '');
  return s;
}

export const sanitizeCompany = (s: string) => sanitizeSegment(s, 20) || 'Company';
export const sanitizeAbbr = (s: string) => sanitizeSegment(s, 12) || 'Role';

export function formatDateStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export interface ExportNames { base: string; zipName: string; files: { cnPdf: string; cnDocx: string; enPdf: string; enDocx: string }; company: string; roleAbbr: string; date: string; seq: number }

/** seq = 同 company+roleAbbr+date 的已有导出数 + 1 */
export function buildExportNames(company: string, roleAbbr: string, date: Date | string, existingCount: number): ExportNames {
  const c = sanitizeCompany(company), a = sanitizeAbbr(roleAbbr);
  const ds = typeof date === 'string' ? date : formatDateStamp(date);
  const seq = Math.max(1, existingCount + 1);
  const base = `${c}_${a}`;
  return {
    base, company: c, roleAbbr: a, date: ds, seq,
    zipName: `${base}_${ds}${seq > 1 ? `_${seq}` : ''}.zip`,
    files: { cnPdf: `${base}_CN.pdf`, cnDocx: `${base}_CN.docx`, enPdf: `${base}_EN.pdf`, enDocx: `${base}_EN.docx` },
  };
}

/** 常见岗位缩写（规则兜底，AI 不可用时使用） */
const ABBR_RULES: [RegExp, string][] = [
  [/前端|front[- ]?end|web developer/i, 'FE'], [/后端|back[- ]?end|server/i, 'BE'], [/全栈|full[- ]?stack/i, 'FS'],
  [/产品经理|product manager/i, 'PM'], [/数据分析|data analy/i, 'DA'], [/数据科学|data scien/i, 'DS'],
  [/算法|机器学习|machine learning|\bML\b|AI 工程/i, 'MLE'], [/测试|QA|quality/i, 'QA'], [/运维|devops|SRE/i, 'SRE'],
  [/设计师|designer|UI|UX/i, 'UX'], [/安卓|android/i, 'Android'], [/iOS/i, 'iOS'], [/运营|operation/i, 'OPS'],
  [/项目经理|project manager/i, 'PjM'], [/数据工程|data engineer/i, 'DE'], [/嵌入式|embedded/i, 'EMB'],
];
export function guessRoleAbbr(title: string): string {
  for (const [re, ab] of ABBR_RULES) if (re.test(title)) return ab;
  return '';
}
/** 公司简称：去掉常见后缀与地名前缀 */
export function shortCompanyName(full: string): string {
  let s = full.trim();
  s = s.replace(/(股份)?有限(责任)?公司$|集团$|(网络|信息)?科技$|技术$/g, '').replace(/(网络|信息)?科技$|技术$/g, '');
  s = s.replace(/^(北京|上海|深圳|广州|杭州|成都|南京|武汉|西安|苏州)(市)?/, '');
  s = s.replace(/,?\s*(Inc\.?|LLC|Ltd\.?|Co\.,? Ltd\.?|Corporation|Corp\.?)$/i, '').trim();
  return s;
}
