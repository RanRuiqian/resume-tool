import type { Lang } from '../types';
import { numberTokens, factTokens } from '../ai/consistency';
import { levels, XPAIRS } from './factCheck';

/**
 * v1.10 简历副本事实护栏（只用于「按 JD 生成的简历」，母库不受影响）。
 * 原则：生成简历可以省略次要事实，但不能新增 / 修改 / 歪曲事实：
 * - 使用的每个数字、百分比、币种都必须能在原文找到（多重集合子集，而非要求全部保留）；
 * - 原文的限定（否定 / 仅 / 预计 / 非官方 / 讨论或考虑 / 课程 / 实习 / 仿真 / 进行中）在改写里必须保留；
 *   估算 / 约数只在保留了数字时必须保留；
 * - 不得新增原文没有的完成 / 授予 / 实现 / 全职 / 商业 / 独立 / 团队 / 场所类事实；
 * - 参与程度不得抬高；原文是「参与 / 协助」时改写必须保留同级或更低的说法。
 */
const KEEP = new Set(['否定 / 未完成', '仅 / 限定', '预计 / 尚未授予', '非官方 / 不代表', '讨论 / 设想', '实习', '课程 / 教学', '仿真 / 模拟', '进行中', '室温条件']);
const NO_GAIN = new Set(['已完成', '已获得 / 已授予', '实现', '全职 / 正式', '兼职', '商业', '独立 / 个人', '团队协作', '公司', '医院', '工厂 / 车间 / 现场', '导师', '医生', '实验室']);
const ESTIMATE = '估算 / 约数';

function subset(a: string[], b: string[]): string[] {
  const pool = [...b]; const extra: string[] = [];
  for (const x of a) { const i = pool.indexOf(x); if (i >= 0) pool.splice(i, 1); else extra.push(x); }
  return extra;
}

/** v1.11：机构 / 会议 / 期刊名称不能被缩写（如「虚构国际医学工程会议」→「国际医学工程会议」）。返回被截短的原名称 */
export function truncatedNames(src: string, out: string): string[] {
  const bad: string[] = [];
  const FN = /[被在于的由与和及、，,。（(\s]/;
  for (const m of out.matchAll(/(?:会议|大学|公司|学院|医院|研究院|研究所|期刊|集团|实验室)/g)) {
    const end = (m.index ?? 0) + m[0].length; const win = out.slice(Math.max(0, end - 16), end);
    let hit = '';
    for (let k = win.length; k >= m[0].length + 2; k--) { const t = win.slice(win.length - k); if (src.includes(t)) { hit = t; break; } }
    if (!hit) continue;
    const before = out[end - hit.length - 1] ?? '';
    const idxs: number[] = []; for (let i = src.indexOf(hit); i >= 0; i = src.indexOf(hit, i + 1)) idxs.push(i);
    if (idxs.length && idxs.every((i) => i > 0 && !FN.test(src[i - 1]) && src[i - 1] !== before)) { const i = idxs[0]; let j = i; while (j > 0 && !FN.test(src[j - 1])) j--; const pre = src.slice(j, i); if (FN.test(before) && pre.length <= 8 && !/(?:参加|参与|加入|就职|任职|入职|实习|就读|进入|获得|代表|受邀|协助|服务|供职|通过|前往|赴|到|获)$/.test(pre)) bad.push(src.slice(j, i + hit.length)); }
  }
  for (const m of src.matchAll(/\b((?:[A-Z][a-zA-Z&.-]*\s){1,7}(?:Conference|University|Company|Institute|Journal|Hospital|Laboratory|Group)(?: on(?: [A-Z][a-z]+){1,4})?)/g)) {
    const full = m[1]; const ws = full.split(/\s+/);
    if (out.includes(full)) continue;
    for (let k = 1; k < ws.length - 1; k++) { const tail = ws.slice(k).join(' '); if (new RegExp(`(?<![A-Za-z])${tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(out)) { bad.push(full); break; } }
  }
  return [...new Set(bad)];
}

export function guardRewrite(src: string, out: string, lang: Lang): string[] {
  const r: string[] = [];
  if (!out.trim()) return ['改写为空'];
  if (!src.trim()) return r;
  const exN = subset(numberTokens(out), numberTokens(src));
  if (exN.length) r.push(`使用了原文没有的数字：${exN.join(', ')}`);
  const fs = factTokens(src), fo = factTokens(out);
  const exP = subset(fo.pct, fs.pct); if (exP.length) r.push(`使用了原文没有的百分比：${exP.join(', ')}`);
  const exC = fo.cur.filter((c) => !fs.cur.includes(c)); if (exC.length) r.push(`新增了币种：${exC.join(', ')}`);
  for (const [name, rz, re] of XPAIRS) {
    const rx = lang === 'zh' ? rz : re;
    const a = rx.test(src), b = rx.test(out);
    if (a && !b && KEEP.has(name)) r.push(`删除了限定：${name}`);
    if (a && !b && name === ESTIMATE && numberTokens(out).length) r.push('保留了数字但删除了「约 / 估算」限定');
    if (!a && b && NO_GAIN.has(name)) r.push(`新增了原文没有的事实：${name}`);
  }
  const ls = [...levels(src, lang)], lo = [...levels(out, lang)];
  const maxS = ls.length ? Math.max(...ls) : 0, maxO = lo.length ? Math.max(...lo) : 0;
  if (maxO > maxS) r.push('参与程度被抬高');
  const minS = ls.length ? Math.min(...ls) : 0;
  if (minS && minS <= 2 && !lo.some((n) => n <= minS)) r.push('删除了「参与 / 协助」限定');
  for (const n of truncatedNames(src, out)) r.push(`机构 / 会议名称被缩写：${n}`);
  return [...new Set(r)];
}
export const rewriteSafe = (src: string, out: string, lang: Lang) => guardRewrite(src, out, lang).length === 0;
