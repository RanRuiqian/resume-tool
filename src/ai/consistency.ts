import type { ConsistencyIssue, GenItem } from '../types';

const UNIT: Record<string, number> = { 万: 1e4, 亿: 1e8, k: 1e3, K: 1e3, thousand: 1e3, m: 1e6, M: 1e6, mn: 1e6, million: 1e6, b: 1e9, B: 1e9, bn: 1e9, billion: 1e9 };
/**
 * 抽取数字 token 并做单位归一：全角转半角、去千分位、"20 万" = "200K" = "200,000"、"1200 万" = "12 million"。
 * 字母中间的数字（B2B、H5）不计。
 */
export function numberTokens(s: string): string[] {
  const norm = s.replace(/[\uff10-\uff19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/(\d),(?=\d{3}\b)/g, '$1');
  const re = /(?<![A-Za-z\d.])(\d+(?:\.\d+)?)(?:\s*(万|亿|thousand|million|billion|mn|bn|[kKmMbB])(?![A-Za-z]))?/g;
  const out: string[] = [];
  for (const m of norm.matchAll(re)) {
    let v = parseFloat(m[1]);
    const u = m[2];
    // 小写 m 仅在紧跟数字时视为 million 不可靠（如 5m 可能是分钟/米），仅接受大写 M 与单词
    if (u && u !== 'm' && u !== 'b') v *= UNIT[u];
    out.push(String(Math.round(v * 1000) / 1000));
  }
  return out.sort();
}

/**
 * 一致性校验（F5.7）：sourceId 集合、条目数量、两侧非空、数字 token 多重集合相同。
 * 中文常用"万/亿"，英文用"k/M"——此类差异会被报告为疑似问题，交给用户确认。
 */
export function checkConsistency(items: GenItem[], expectedIds?: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.sourceId)) issues.push({ sourceId: it.sourceId, type: 'extra', message: `条目重复：${it.sourceId}` });
    seen.add(it.sourceId);
    if (!it.zh.trim() || !it.en.trim()) {
      issues.push({ sourceId: it.sourceId, type: 'empty', message: `${it.sourceId} 缺少${!it.zh.trim() ? '中文' : '英文'}内容` });
      continue;
    }
    const a = numberTokens(it.zh), b = numberTokens(it.en);
    if (a.join('|') !== b.join('|')) {
      issues.push({ sourceId: it.sourceId, type: 'number', message: `${it.sourceId} 数字/日期不一致：中文 [${a.join(', ')}] vs 英文 [${b.join(', ')}]` });
    }
  }
  if (expectedIds) {
    const exp = new Set(expectedIds);
    for (const id of exp) if (!seen.has(id)) issues.push({ sourceId: id, type: 'missing', message: `缺少条目：${id}` });
    for (const id of seen) if (!exp.has(id)) issues.push({ sourceId: id, type: 'extra', message: `多出条目（不在资料库中）：${id}` });
  }
  return issues;
}
