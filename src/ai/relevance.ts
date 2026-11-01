import type { Bi, JobParse, Lang, LocalizedText, ProfileDoc } from '../types';
import { lt } from '../locale/text';
import { rewriteSafe } from '../quality/resumeGuard';
import { isResumeSafe } from '../quality/contentQuality';

/**
 * v1.10 JD 相关性筛选（确定性、本地）：决定简历副本里「留哪些经历、每段留几条、每条保留多少细节」。
 * 只作用于生成的简历；资料母库一字不改。规则对所有用户通用，不含任何个人内容。
 */
export interface Term { t: string; w: number }

/** 领域扩展词：JD 命中触发词时，这些细节词才算与岗位相关（例如机器视觉岗保留 MTF50 / SNR，机械岗保留结构 / CAD / 原型验证） */
const DOMAINS: { trigger: RegExp; terms: string[] }[] = [
  { trigger: /机械|结构设计|结构工程|CAD|SolidWorks|\bNX\b|Creo|Inventor|mechanical|structural|装配|钣金|模具|发电机|电机|generator/i,
    terms: ['机械', 'mechanical', 'SolidWorks', 'CAD', 'NX', 'Creo', 'Inventor', 'AutoCAD', '结构设计', 'structural design', '机械设计', 'mechanical design', '原型', '样机', 'prototype', '3D 打印', '3D打印', '3D print', '装配', 'assembl', '公差', 'tolerance', 'GD&T', '图纸', 'drawing', 'BOM', '有限元', 'FEA', 'ANSYS', '仿真', 'simulat', '制造', 'manufactur', 'DFM', '工艺', '验证', 'validat', '迭代', 'iterat', '建模', 'model', '模块化', 'modular', 'AMESim', '液压', 'hydraulic', '热', 'thermal'] },
  { trigger: /视觉|图像|成像|相机|摄像|光学|镜头|vision|imaging|image|camera|optic|lens/i,
    terms: ['MTF', 'MTF50', 'SNR', '信噪比', 'ISO 12233', 'FOV', '视场', '分辨率', 'resolution', '图像质量', 'image quality', '相机', 'camera', '镜头', 'lens', '光学', 'optic', '标定', 'calibrat', '畸变', 'distortion', 'OpenCV', 'FPS', '帧率', '传感器', 'sensor', '照明', 'illumination', '成像', 'imaging', '测试', 'test'] },
  { trigger: /机器人|机械臂|robot|运动控制|motion control|自动化|automation/i,
    terms: ['机器人', 'robot', '机械臂', 'arm', '仿真', 'simulat', '路径', 'path', 'trajector', '轨迹', '抓取', 'grasp', 'pick', '运动学', 'kinematic', 'ROS', '调试', 'debug', 'commission', 'PLC', '控制', 'control', 'RobotStudio', 'Process Simulate', '离线编程', 'offline programming'] },
];

/** 实验报告式的测量 / 参数词：与岗位无关时降低该句或该分句的权重（不是禁用词：岗位相关时照常保留） */
const METRIC = /MTF\d*|SNR|信噪比|FOV|视场|FPS|帧率|ISO\s?\d{3,5}|温升|lp\/mm|dB\b|分辨率|resolution|Temporal|PETG|PLA\b|PCB|线缆|cable|探头|probe|μm|mm\b|℃|°C/gi;

const lower = (s: string) => s.toLowerCase();
const asciiRe = (t: string) => new RegExp(`(^|[^a-z0-9])${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
export function hasTerm(text: string, t: string): boolean {
  if (!t) return false;
  return /^[\x20-\x7e]+$/.test(t) ? asciiRe(t).test(text) : lower(text).includes(lower(t));
}

export function jobTerms(job: JobParse): Term[] {
  const out = new Map<string, number>();
  const add = (s: string | undefined, w: number) => { const k = (s ?? '').trim(); if (k.length < 2 || k.length > 40) return; const key = lower(k); out.set(key, Math.max(out.get(key) ?? 0, w)); };
  const addBi = (a: Bi[] | undefined, w: number) => (a ?? []).forEach((k) => { add(k.zh, w); add(k.en, w); });
  addBi(job.mustHave, 3); addBi(job.keywords, 2); addBi(job.responsibilities, 1.5); addBi(job.niceToHave, 1);
  const ctx = [job.title.zh, job.title.en, job.summary, ...job.mustHave.flatMap((k) => [k.zh, k.en]), ...job.keywords.flatMap((k) => [k.zh, k.en]), ...(job.responsibilities ?? []).flatMap((k) => [k.zh, k.en])].join(' ');
  for (const d of DOMAINS) if (d.trigger.test(ctx)) d.terms.forEach((t) => add(t, 1));
  return [...out].map(([t, w]) => ({ t, w }));
}

/** 文本与岗位的相关分：命中的岗位词权重之和；与岗位无关的测量参数越多扣分越多 */
export function relevance(text: string, terms: Term[]): number {
  let s = 0;
  for (const { t, w } of terms) if (hasTerm(text, t)) s += w;
  const metrics = (text.match(METRIC) ?? []).filter((m) => !terms.some(({ t }) => hasTerm(m, t) || hasTerm(t, m)));
  return Math.max(0, s - 0.5 * metrics.length);
}

/** 两条要点是否表达同一件事（字符二元组 Jaccard） */
export function overlap(a: string, b: string): number {
  const g = (s: string) => { const n = lower(s).replace(/[\s\p{P}\p{S}]/gu, ''); const set = new Set<string>(); for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2)); return set; };
  const x = g(a), y = g(b); if (!x.size || !y.size) return 0;
  let inter = 0; x.forEach((v) => { if (y.has(v)) inter++; });
  return inter / (x.size + y.size - inter);
}

const QUALIFIER = /约|大约|估算|估计|预计|仅|只|未|尚未|非官方|不代表|讨论|考虑|参与|协助|实习|课程|仿真|模拟|approx|about|around|estimat|expected|only|not|unofficial|discuss|consider|particip|assist|intern|course|simulat/i;
const FAILED = /失败|未成功|放弃|弃用|不可行|failed|abandon|did not work|unsuccessful/i;

/**
 * 确定性精简一条要点（AI 不可用 / AI 改写未通过护栏时使用）：
 * 按句（；。;）切分，始终保留第一句（做了什么），其余句只保留与岗位相关且不是失败方案的；
 * 去掉不含限定词、纯参数罗列的括号说明。结果必须通过 guardRewrite，否则返回原文。
 */
export function conciseBullet(text: string, lang: Lang, terms: Term[], budget = lang === 'zh' ? 70 : 38): string {
  const src = text.trim(); if (!src) return src;
  const size = (s: string) => (lang === 'zh' ? s.replace(/\s/g, '').length : s.split(/\s+/).filter(Boolean).length);
  const stripParen = (s: string) => s.replace(/[（(]([^（）()]{4,})[）)]/g, (m, inner: string) => (!QUALIFIER.test(inner) && (/[、,，;；]/.test(inner) || (inner.match(/\d/g)?.length ?? 0) >= 2) ? '' : m));
  const sentences = src.split(lang === 'zh' ? /(?<=[；;。])/ : /(?<=[;.])\s+(?=[A-Z])|(?<=;)\s*/).map((x) => x.trim()).filter(Boolean);
  if (sentences.length <= 1 && size(src) <= budget) { const s = stripParen(src); return s !== src && rewriteSafe(src, s, lang) ? s : src; }
  const kept: string[] = [stripParen(sentences[0])];
  const rest = sentences.slice(1).map((s, i) => ({ s, i, r: relevance(s, terms) })).filter((x) => x.r > 0 && !FAILED.test(x.s)).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const x of rest) { const c = stripParen(x.s); if (size([...kept, c].join('')) <= budget) kept.push(c); }
  const order = (s: string) => sentences.findIndex((y) => stripParen(y) === s);
  let out = kept.sort((a, b) => order(a) - order(b)).join(lang === 'zh' ? '' : ' ').trim();
  if (lang === 'zh') out = out.replace(/[；;]$/, '。'); else out = out.replace(/;$/, '.');
  return out && rewriteSafe(src, out, lang) ? out : src;
}

export interface PlanEntry { kind: 'work' | 'projects' | 'education'; id: string; score: number; core: boolean; bulletIds: string[] }
export interface ResumePlan { entries: PlanEntry[]; skills: string[]; certificates: string[]; awards: string[]; caps: { core: number; minor: number } }

export const LANG_TEST = /\b(?:PTE|IELTS|TOEFL|TOEIC|Duolingo|CET-?[46]|TEM-?[48]|HSK|JLPT|TOPIK|DELF|DALF|TestDaF)\b|雅思|托福|大学英语[四六]级|英语[四六]级|专业英语[四八]级|专[四八]|多邻国|日语能力|普通话水平/i;

/** 按相关性挑选要点：高分优先、跳过与已选高度重叠的、不凑数（0 分要点只在一条都没有时补 1 条） */
export function pickRelevant(bullets: LocalizedText[], terms: Term[], cap: number, lang: Lang): LocalizedText[] {
  const ranked = bullets.filter((b) => b.id && isResumeSafe(b.zh || b.en || '')).map((b, i) => ({ b, i, s: relevance(`${lt(b, 'zh', false)} ${lt(b, 'en', false)}`, terms) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const chosen: typeof ranked = [];
  for (const x of ranked) {
    if (chosen.length >= cap) break;
    if (x.s <= 0 && chosen.length) break;
    if (chosen.some((c) => overlap(lt(c.b, lang), lt(x.b, lang)) > 0.45)) continue;
    chosen.push(x);
  }
  return chosen.sort((a, b) => a.i - b.i).map((x) => x.b);
}

/** 一页默认：核心项目 2–3 条、次要项目 1 条或不选；两页适当放宽。都是软上限，不要求凑满 */
export function planResume(p: ProfileDoc, job: JobParse, lang: Lang, targetPages = 1): ResumePlan {
  const terms = jobTerms(job);
  const two = targetPages > 1;
  const caps = { core: two ? 4 : 3, minor: two ? 2 : 1 };
  const txt = (x: unknown) => JSON.stringify(x);
  const entries: PlanEntry[] = [];
  const work = p.work.filter((x) => x.enabled).map((w) => ({ w, s: relevance(txt([w.title, w.company, w.tags, w.bullets]), terms) })).sort((a, b) => b.s - a.s);
  work.forEach(({ w, s }, i) => { const core = i < 2 && s > 0; entries.push({ kind: 'work', id: w.id, score: s, core, bulletIds: pickRelevant(w.bullets, terms, core ? caps.core : Math.max(2, caps.minor), lang).map((b) => b.id!) }); });
  const projs = p.projects.filter((x) => x.enabled).map((x) => ({ x, s: relevance(txt([x.name, x.role, x.tags, x.bullets]), terms) })).sort((a, b) => b.s - a.s);
  const maxProj = two ? 5 : 3;
  projs.forEach(({ x, s }, i) => {
    if (i >= maxProj || (s <= 0 && i > 0)) return; // 与岗位无关的次要项目默认不选（母库保留，可手动勾选）
    const core = i < (two ? 3 : 2) && s >= (projs[0]?.s ?? 0) * 0.4 && s > 0;
    const ids = pickRelevant(x.bullets, terms, core ? caps.core : caps.minor, lang).map((b) => b.id!);
    if (ids.length) entries.push({ kind: 'projects', id: x.id, score: s, core, bulletIds: ids });
  });
  p.education.filter((x) => x.enabled).forEach((e) => {
    const hs = e.highlights.filter((b) => b.id && isResumeSafe(b.zh || b.en || ''));
    const gpa = hs.filter((b) => /GPA|绩点|均分|平均分|排名|rank/i.test(`${b.zh} ${b.en}`));
    const rel = pickRelevant(hs.filter((b) => !gpa.includes(b)), terms, two ? 2 : 1, lang).filter((b) => relevance(`${b.zh} ${b.en}`, terms) > 0);
    entries.push({ kind: 'education', id: e.id, score: 0, core: false, bulletIds: [...gpa.slice(0, 1), ...rel].map((b) => b.id!) });
  });
  const skillsR = p.skills.filter((x) => x.enabled).map((k, i) => ({ k, i, s: relevance(`${k.name.zh} ${k.name.en}`, terms) }));
  const rel = skillsR.filter((x) => x.s > 0 || LANG_TEST.test(`${x.k.name.zh} ${x.k.name.en}`) || /语言|language/i.test(`${x.k.category?.zh} ${x.k.category?.en}`));
  const skills = (rel.length >= 4 ? rel : [...rel, ...skillsR.filter((x) => !rel.includes(x)).slice(0, 4 - rel.length)]).sort((a, b) => a.i - b.i).map((x) => x.k.id);
  const certificates = p.certificates.filter((x) => x.enabled && (LANG_TEST.test(`${x.name.zh} ${x.name.en}`) || relevance(`${x.name.zh} ${x.name.en}`, terms) > 0)).map((x) => x.id);
  const awards = p.awards.filter((x) => x.enabled && relevance(`${x.name.zh} ${x.name.en}`, terms) > 0).map((x) => x.id);
  return { entries, skills, certificates, awards, caps };
}

const splitSent = (s: string, lang: Lang) => s.trim().split(lang === 'zh' ? /(?<=[；;。])/ : /(?<=[;.])\s+(?=[A-Z])|(?<=;)\s*/).map((x) => x.trim()).filter(Boolean);
const sizeOf = (s: string, lang: Lang) => (lang === 'zh' ? s.replace(/\s/g, '').length : s.split(/\s+/).filter(Boolean).length);
const endWith = (s: string, lang: Lang) => (lang === 'zh' ? s.replace(/[；;]$/, '。') : s.replace(/;$/, '.'));

/**
 * 中英两侧同步精简（规则模式 / AI 降级）：两种语言句数相同时按同一组句子下标取舍，保证两版说的是同一件事；
 * 句数不同或任一侧未通过护栏 → 两侧都保留原文。
 */
export function conciseBi(b: LocalizedText, terms: Term[], primary: Lang, budget?: number): { zh: string; en: string } {
  const zh = lt(b, 'zh', false), en = lt(b, 'en', false);
  if (!zh.trim() || !en.trim()) return { zh: zh ? conciseBullet(zh, 'zh', terms, budget) : '', en: en ? conciseBullet(en, 'en', terms, budget) : '' };
  const zs = splitSent(zh, 'zh'), es = splitSent(en, 'en');
  const lim = budget ?? (primary === 'zh' ? 70 : 38);
  if (zs.length !== es.length || zs.length <= 1) return { zh, en };
  const P = primary === 'zh' ? zs : es;
  const keep = [0];
  const rest = zs.map((_, i) => i).slice(1).filter((i) => !FAILED.test(zs[i] + ' ' + es[i])).map((i) => ({ i, r: relevance(`${zs[i]} ${es[i]}`, terms) })).filter((x) => x.r > 0).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const x of rest) if (sizeOf([...keep, x.i].map((i) => P[i]).join(' '), primary) <= lim) keep.push(x.i);
  keep.sort((a, b) => a - b);
  if (keep.length === zs.length) return { zh, en };
  const oz = endWith(keep.map((i) => zs[i]).join(''), 'zh'), oe = endWith(keep.map((i) => es[i]).join(' '), 'en');
  return rewriteSafe(zh, oz, 'zh') && rewriteSafe(en, oe, 'en') ? { zh: oz, en: oe } : { zh, en };
}

/** 个人简介精简：只保留开头 1–2 句（不超过约 80 字 / 45 词），并通过护栏 */
export function compactSummary(text: string, lang: Lang): string {
  const ss = splitSent(text.replace(/([。.!?！？])\s*/g, '$1\n').replace(/\n/g, ' '), lang).flatMap((s) => s.split(lang === 'zh' ? /(?<=[。！？])/ : /(?<=[.!?])\s+/)).map((x) => x.trim()).filter(Boolean);
  const lim = lang === 'zh' ? 80 : 45;
  if (sizeOf(text, lang) <= lim) return text.trim();
  const J = (xs: string[]) => xs.join(lang === 'zh' ? '' : ' ');
  const out: string[] = [];
  for (const s of ss) { if (out.length >= 2 || (out.length && sizeOf(J([...out, s]), lang) > lim)) break; out.push(s); }
  // 最短的、通过护栏的开头（1 句不够保留限定时退到 2 句）；都不通过则保留原文
  for (const r of [J(out), J(ss.slice(0, 2))]) if (r && rewriteSafe(text, r, lang)) return r;
  return text.trim();
}
