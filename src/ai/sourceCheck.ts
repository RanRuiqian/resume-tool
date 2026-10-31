import type { LocalizedText, ProfileDoc } from '../types';
import { normName } from './dedupe';

/**
 * 原文证据检查（v1.6.1，纯本地后处理）：AI 输出的日期 / 任职性质 / 证书信息必须能在原文中找到依据，
 * 找不到就清空并记入该条目的 uncertain。以「【严重】」开头的说明会在审核页列为重要问题。
 * 只依据通用的措辞信号（预计 / expected / 在读 / 已授予 …），不含任何特定用户、学校或单位的规则。
 */
export const CRITICAL = '【严重】';
const EXPECTED = /预计|预期|拟于|将于|有望|在读|尚未|未授予|expected|anticipated|in progress|ongoing|candidate|to be (?:awarded|conferred)/i;
const ACTUAL = /已于|已经?(?:获得|取得|授予|毕业)|已.{0,6}授予|实际授予|获授|学位授予日期|conferred on|awarded on|graduated (?:in|on)/i;
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** 原文里某个 YYYY-MM / YYYY 日期出现处的上下文（同一行内前后若干字）；找不到返回 [] */
export function dateContexts(src: string, date: string): string[] {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(date); if (!m) return [];
  const y = m[1], mo = m[2] ? String(Number(m[2])) : '';
  const re = mo
    ? new RegExp(`${y}\\s*(?:[.\\-/年]\\s*0?${mo}(?!\\d)|年\\s*0?${mo}\\s*月)|(?:${MON[Number(mo) - 1]}[a-z]*\\.?\\s*,?\\s*${y})`, 'gi')
    : new RegExp(`${y}(?!\\d)`, 'g');
  const out: string[] = [];
  for (const x of src.matchAll(re)) {
    const i = x.index ?? 0;
    const ls = src.lastIndexOf('\n', i) + 1, le = src.indexOf('\n', i); const lineEnd = le < 0 ? src.length : le;
    out.push(src.slice(Math.max(ls, i - 30), Math.min(lineEnd, i + x[0].length + 20)));
  }
  return out;
}

type E = Record<string, unknown> & { id: string; uncertain?: string[] };
const note = (e: E, s: string) => { e.uncertain = [...new Set([...(e.uncertain ?? []), s])]; };
const tx = (t: unknown) => { const v = (t ?? {}) as LocalizedText; return [v.zh, v.en].filter(Boolean) as string[]; };
/** 单位名在原文中出现处附近（±150 字）的文字，用于判断任职性质 */
function around(src: string, names: string[]): string {
  let out = '';
  for (const n of names) { const k = n.trim(); if (k.length < 2) continue; let i = src.indexOf(k); while (i >= 0) { out += src.slice(Math.max(0, i - 150), i + k.length + 150) + '\n'; i = src.indexOf(k, i + 1); } }
  return out;
}
const KIND_EVIDENCE: Record<string, RegExp> = { fulltime: /正式(?:员工|工作|入职)|全职|转正|full[- ]?time|permanent/i, internship: /实习|intern/i, parttime: /兼职|part[- ]?time/i };

export function checkAgainstSource(p: ProfileDoc, src: string): ProfileDoc {
  if (!src.trim()) return p;
  const flat = normName(src);
  const checkDate = (e: E, f: string, label: string) => {
    const v = e[f]; if (typeof v !== 'string' || !v.trim() || v === 'present') return;
    if (!dateContexts(src, v).length) { e[f] = ''; note(e, `${label}「${v}」在原文中找不到，已留空，请核对`); }
  };
  for (const e of p.education as unknown as E[]) {
    const ctx = (f: string) => (typeof e[f] === 'string' && e[f] ? dateContexts(src, e[f] as string) : []);
    // 实际授予：必须有明确的「已授予 / 已获得」措辞；只写「预计」的一律不算
    const act = e.actualConferralDate as string | undefined;
    if (act) {
      const c = ctx('actualConferralDate');
      const hasActual = c.some((x) => ACTUAL.test(x));
      const onlyExpected = c.length > 0 && c.every((x) => EXPECTED.test(x)) && !c.some((x) => ACTUAL.test(x));
      if (!hasActual) {
        e.actualConferralDate = '';
        if (onlyExpected) { if (!e.expectedConferralDate) e.expectedConferralDate = act; note(e, `${CRITICAL}原文只写了「预计」${act}，不能视为已授予学位：实际授予日期已留空，已作为预计授予日期`); }
        else note(e, `${CRITICAL}实际授予学位日期「${act}」在原文中没有「已授予 / 已获得」等明确证据，已留空，请核对`);
      }
    }
    if (e.actualConferralDate && e.expectedConferralDate && e.actualConferralDate === e.expectedConferralDate)
      note(e, `${CRITICAL}实际授予日期与预计授予日期相同（${e.actualConferralDate}），请确认学位是否真的已经授予`);
    // 结束日期只来自「预计」措辞：不是已完成的结束日期
    const end = e.end as string;
    if (end && end !== 'present') {
      const c = ctx('end');
      if (c.length && c.every((x) => EXPECTED.test(x)) && !c.some((x) => ACTUAL.test(x))) {
        e.end = ''; if (!e.expectedConferralDate) e.expectedConferralDate = end;
        note(e, `${CRITICAL}结束日期「${end}」在原文中是「预计」日期，尚未完成 / 授予：已从结束日期移出，保留为预计授予日期`);
      }
    }
    for (const [f, l] of [['start', '开始日期'], ['end', '结束日期'], ['courseCompletionDate', '课程结束日期'], ['expectedConferralDate', '预计授予日期'], ['availableFullTimeDate', '可全职入职日期']] as const) checkDate(e, f, l);
  }
  for (const sec of ['work', 'projects'] as const) for (const e of p[sec] as unknown as E[]) { checkDate(e, 'start', '开始日期'); checkDate(e, 'end', '结束日期'); }
  for (const e of p.work as unknown as E[]) {
    const k = e.kind as string | undefined; const re = k ? KIND_EVIDENCE[k] : undefined;
    if (re && !re.test(around(src, [...tx(e.company), ...((e.aliases as string[]) ?? [])]) + tx(e.title).join(' '))) { delete e.kind; note(e, `任职性质「${k}」在原文中找不到依据，已改为未区分，请核对`); }
  }
  for (const sec of ['certificates', 'awards'] as const) for (const e of p[sec] as unknown as E[]) {
    checkDate(e, 'date', '日期');
    const iss = tx(e.issuer); if (iss.length && !iss.some((x) => flat.includes(normName(x)))) { e.issuer = {}; note(e, '颁发机构在原文中找不到，已留空，请核对'); }
    const nm = tx(e.name); if (nm.length && !nm.some((x) => flat.includes(normName(x)))) note(e, '名称在原文中找不到原样写法，请核对是否为 AI 改写或补充');
  }
  return p;
}
