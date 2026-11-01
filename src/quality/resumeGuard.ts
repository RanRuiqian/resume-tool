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
  return [...new Set(r)];
}
export const rewriteSafe = (src: string, out: string, lang: Lang) => guardRewrite(src, out, lang).length === 0;
