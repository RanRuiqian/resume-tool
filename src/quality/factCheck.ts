import type { Lang } from '../types';

/**
 * v1.9.1 事实完整性核对（纯本地、确定性）。
 * 判定原则：AI 改写只有在与「本地机械清洗版本」逐字等价（忽略标点 / 空白 / 大小写 / 少量虚词）时才算 A 类；
 * 其它任何改写都是 B 类——即使数字、工具、单位都没变。这里的语义类别只用于向用户解释「可能丢了什么」，
 * 不用于把改写判为安全（宁可自动接受范围窄，也不把信息丢失当作安全）。
 */
const PUNCT = /[\s\p{P}\p{S}]/gu;
const ZH_FILLER = /进行|的|了|地|着/g;
export const normZh = (s: string) => s.replace(PUNCT, '').replace(ZH_FILLER, '');
const EN_STOP = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'in', 'on', 'for', 'with', 'by', 'at', 'as', 'from', 'into', 'using', 'via']);
const enWords = (s: string) => (s.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []).map((w) => w.replace(/[.]+$/, ''));
export function equivalent(a: string, b: string, lang: Lang): boolean {
  if (lang === 'zh') return normZh(a) === normZh(b);
  return enWords(a).join(' ') === enWords(b).join(' ');
}

/** LCS 对齐，返回 a 中没有出现在 b 的连续片段（missing）与 b 中新增的片段（added） */
function diffRuns<T>(a: T[], b: T[], join: (xs: T[]) => string): { missing: string[]; added: string[] } {
  const n = a.length, m = b.length; const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const missing: string[] = [], added: string[] = []; let ma: T[] = [], ad: T[] = [];
  const flush = () => { if (ma.length) missing.push(join(ma)); if (ad.length) added.push(join(ad)); ma = []; ad = []; };
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { flush(); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ma.push(a[i++]); else ad.push(b[j++]); }
  while (i < n) ma.push(a[i++]); while (j < m) ad.push(b[j++]); flush();
  return { missing, added };
}
/** 覆盖率核对：原文（已去掉批准的说明句 / 主语）中每个有内容的片段是否仍在改写里 */
export function coverage(src: string, out: string, lang: Lang): { missing: string[]; added: string[] } {
  if (lang === 'zh') {
    const r = diffRuns([...normZh(src)], [...normZh(out)], (x) => x.join(''));
    return { missing: r.missing.filter((x) => x.length >= 1), added: r.added };
  }
  const r = diffRuns(enWords(src), enWords(out), (x) => x.join(' '));
  return { missing: r.missing.filter((x) => x.split(' ').some((w) => !EN_STOP.has(w))), added: r.added.filter((x) => x.split(' ').some((w) => !EN_STOP.has(w))) };
}

type Cat = { label: string; zh: RegExp; en: RegExp; mode: 'drop' | 'add' | 'both' };
const CATS: Cat[] = [
  { label: '地点 / 场景', zh: /公司|企业|医院|诊所|学校|校内|校外|实验室|车间|现场|工厂|产线|生产线|课堂|门店|海外|基地|船上|码头/g, en: /\b(?:company|hospital|clinic|school|campus|lab(?:oratory)?|workshop|site|factory|plant|production line|on-site|onboard)\b/gi, mode: 'drop' },
  { label: '工作对象 / 合作对象', zh: /导师|老师|教授|客户|患者|病人|同事|组员|医生|护士|工程师|供应商|用户|学生|团队|小组/g, en: /\b(?:supervisor|advisor|mentor|professor|client|customer|patient|colleague|teammate|doctor|engineer|supplier|user|team|group)s?\b/gi, mode: 'drop' },
  { label: '否定 / 限定条件', zh: /仅|只在|只对|尚未|未能|未|没有|不是|无法|初步|部分|室温|常温|条件下|模拟|仿真|小规模|样机|试点/g, en: /\b(?:only|not|never|no|yet|preliminary|partial(?:ly)?|room[- ]temperature|under|simulated|simulation|prototype|pilot|limited)\b/gi, mode: 'both' },
  { label: '时间状态', zh: /尚未|正在|进行中|预计|计划|拟|即将|在读|已经|已于|已获得|已授予|已完成|已上线/g, en: /\b(?:expected|ongoing|in progress|planned|upcoming|pending|currently|completed|conferred|obtained|awarded|launched|delivered|finished)\b/gi, mode: 'both' },
  { label: '因果关系 / 技术结论', zh: /因为|由于|因此|导致|从而|所以|使得|以便|为了|结果表明|证明了|验证了/g, en: /\b(?:because|due to|therefore|thus|resulting|so that|which led|proved|demonstrated|validated|verified)\b/gi, mode: 'both' },
  { label: '职责范围', zh: /全部|整个|整体|全流程|部分|主要|核心|局部|子模块|日常|辅助性/g, en: /\b(?:entire|whole|end-to-end|full|all|part of|main|core|key|daily|routine)\b/gi, mode: 'both' },
  { label: '估算 / 适用范围', zh: /(?<![预节制契])约(?![束定])|大约|左右|估算|估计|预估|粗略|历史|不代表|并非|非官方|不是官方|核心材料|原型|样机|量产|零售/g, en: /\b(?:about|approximately|approx|around|roughly|estimated?|estimates?|historical|represents?|unofficial|official|prototype|core materials?|mass[- ]production|retail)\b|~/gi, mode: 'both' },
  { label: '讨论 / 设想（未实现）', zh: /讨论|探讨|考虑|设想|构想|提出|调研|评估|需求|建议/g, en: /\b(?:discuss\w*|consider\w*|explor\w*|propos\w*|evaluat\w*|requirements?|suggest\w*)\b/gi, mode: 'drop' },
  { label: '实现 / 完成', zh: /实现|完成|开发了|做出|落地|研制|搭建了/g, en: /\b(?:implement\w*|realiz\w*|achiev\w*|built|enabled|completed|developed)\b/gi, mode: 'add' },
  { label: '商业 / 正式性质', zh: /商业|客户项目|公司项目|企业项目|量产|交付|上线|正式员工|全职|转正/g, en: /\b(?:commercial|client project|production|deliver(?:ed|y)|full[- ]time|permanent)\b/gi, mode: 'add' },
];
const PART_ZH: [RegExp, number][] = [[/参与|配合|辅助/, 1], [/协助|支持/, 2], [/负责|承担/, 3], [/主导|牵头|主持|带领|领导|统筹/, 4], [/独立完成|独立开发|独立设计|独立|单独完成|个人完成|一人完成/, 5]];
const PART_EN: [RegExp, number][] = [[/\b(?:participated|contributed|took part|involved)\b/i, 1], [/\b(?:assisted|supported|helped)\b/i, 2], [/\b(?:responsible|in charge|handled|maintained)\b/i, 3], [/\b(?:led|lead|headed|directed|managed|spearheaded|owned)\b/i, 4], [/\b(?:independently|single-handedly|solely|on (?:my|his|her) own|alone)\b/i, 5]];
export const levels = (s: string, lang: Lang) => new Set((lang === 'zh' ? PART_ZH : PART_EN).filter(([re]) => re.test(s)).map(([, n]) => n));
const PART_NAME = ['', '参与', '协助', '负责', '主导', '独立完成'];
const SOLO = { zh: /独立|个人|单独|一人/, en: /\b(?:independently|single-handedly|solely|alone|on (?:my|his|her) own)\b/i };
const TEAM = { zh: /团队|小组|合作|协作|共同|与[^，。]{0,8}(?:一起|共同|合作)|[两二三四五六七八九十\d]人/, en: /\b(?:team|group|collaborat\w*|jointly|together|with (?:a|the|my)?\s*(?:team|colleagues|peers))\b/i };
const terms = (s: string, re: RegExp) => new Set((s.match(re) ?? []).map((x) => x.toLowerCase()));
const parts = (s: string, lang: Lang) => (lang === 'zh' ? s.split(/及|以及|和|与|、|并且|并|，|,/) : s.split(/\band\b|,|;/i)).map((x) => x.trim()).filter((x) => x.replace(PUNCT, '').length >= 2).length;

const listItems = (s: string, lang: Lang) => (lang === 'zh' ? s.replace(/^.*?(?:包括|包含|有|：|:)/, '').split(/、|，|,|以及|及|和|与/) : s.replace(/^.*?(?:including|includes|:)/i, '').split(/,|;|\band\b/i)).map((x) => x.replace(/[。.；;]+$/, '').trim()).filter((x) => x.replace(PUNCT, '').length >= 2);
/** 只差有边界的虚词（曾 / 曾经 / 了 / 进行 / 的 / 地 / 着；英文冠词），视为无价值改动 */
const TRIV_ZH = /(?<![未不何])曾经?|了|进行|的|地|着/g;
export const trivialOnly = (a: string, b: string, lang: Lang) => lang === 'zh' ? normZh(a.replace(TRIV_ZH, '')) === normZh(b.replace(TRIV_ZH, '')) : enWords(a).filter((w) => !/^(?:the|a|an)$/.test(w)).join(' ') === enWords(b).filter((w) => !/^(?:the|a|an)$/.test(w)).join(' ');
/** 未丢事实、只新增很少字词的改写：价值低，不产生审核项 */
export function lowValue(a: string, b: string, lang: Lang): boolean { const cv = coverage(a, b, lang); return !cv.missing.length && (lang === 'zh' ? cv.added.join('').replace(TRIV_ZH, '').length <= 2 : cv.added.length === 0); }

/** 语义类别检查：返回人能读懂的风险原因（用于解释，不用于放行） */
export function semanticFlags(before: string, after: string, lang: Lang): string[] {
  const r: string[] = []; if (!after.trim()) return r;
  for (const c of CATS) {
    const re = lang === 'zh' ? c.zh : c.en; const tb = terms(before, re), ta = terms(after, re);
    const lost = [...tb].filter((x) => !ta.has(x) && ![...ta].some((y) => y.includes(x) || x.includes(y)));
    const gain = [...ta].filter((x) => !tb.has(x) && ![...tb].some((y) => y.includes(x) || x.includes(y)));
    if (lost.length && c.mode !== 'add') r.push(`删除了${c.label}：${lost.join('、')}`);
    if (gain.length && c.mode !== 'drop') r.push(`新增了${c.label}：${gain.join('、')}`);
  }
  const lb = levels(before, lang), la = levels(after, lang);
  if ([...lb].join() !== [...la].join() && (lb.size || la.size)) r.push(`参与程度变化：${[...lb].map((n) => PART_NAME[n]).join('/') || '（未写明）'} → ${[...la].map((n) => PART_NAME[n]).join('/') || '（未写明）'}`);
  const s = lang === 'zh' ? SOLO.zh : SOLO.en, t = lang === 'zh' ? TEAM.zh : TEAM.en;
  if (t.test(before) && !t.test(after)) r.push('删除了团队 / 合作关系');
  if (s.test(after) && !s.test(before)) r.push('团队合作被改成独立完成');
  // 并列成果 / 内容逐项核对：任何一项在改写后找不到即为丢失
  const na = lang === 'zh' ? normZh(after) : enWords(after).join(' ');
  const lostItems = listItems(before, lang).filter((x) => !na.includes(lang === 'zh' ? normZh(x) : enWords(x).join(' ')));
  if (lostItems.length && listItems(before, lang).length >= 2) r.push(`删除了并列成果 / 内容：${lostItems.join('、')}`);
  const pb = parts(before, lang), pa = parts(after, lang);
  if (pa < pb) r.push(`并列内容减少：${pb} 项 → ${pa} 项`);
  return [...new Set(r)];
}

/** 完整的 B 类原因：覆盖率（丢失 / 新增的原文片段）+ 语义类别 */
export function lossReport(local: string, ai: string, lang: Lang): string[] {
  const r: string[] = [];
  const cv = coverage(local, ai, lang);
  if (cv.missing.length) r.push(`改写后找不到原文片段：${cv.missing.map((x) => `「${x}」`).join('、')}`);
  if (cv.added.length) r.push(`改写新增了原文没有的内容：${cv.added.map((x) => `「${x}」`).join('、')}`);
  r.push(...semanticFlags(local, ai, lang));
  return r;
}

// ---- v1.9.2 中英交叉事实一致性（保守：任一概念只在一侧出现即判为待核对）----
type Pair = [name: string, zh: RegExp, en: RegExp];
export const XPAIRS: Pair[] = [
  ['否定 / 未完成', /尚未|未完成|未能|没有|未经|无法|不能|未|不代表|并非|不是|非官方/, /\bnot\b|\bno\b|n't|\byet\b|\bpending\b|\bincomplete\b|\bunfinished\b|\bwithout\b|\bunable\b|\bnever\b/i],
  ['进行中', /正在|进行中|在研|持续/, /\bongoing\b|\bin progress\b|\bcurrently\b|\bongoing\b|\bcontinu\w*/i],
  ['仅 / 限定', /仅|只在|只对|只有|仅限/, /\bonly\b|\bsolely\b|\bmerely\b|\blimited to\b|\bexclusively\b/i],
  ['室温条件', /室温|常温/, /room[- ]temperature|ambient/i],
  ['仿真 / 模拟', /仿真|模拟/, /simulat\w*|\bemulat\w*/i],
  ['预计 / 尚未授予', /预计|预期|拟于|将于|即将/, /\bexpected\b|\banticipated\b|\bexpect\w*|\bwill\b|\bto be (?:awarded|conferred)\b|\bupcoming\b/i],
  ['已获得 / 已授予', /已获得|已授予|已取得|(?<!(?:预计|预期|将于|拟于|即将).{0,12})(?:获得.{0,6}学位|授予(?!.{0,2}日期))/, /\bawarded\b|\bconferred\b|\bobtained\b|\breceived\b|\bearned\b|\bgranted\b/i],
  ['已完成', /已完成|完成了|已经完成|完成/, /\bcompleted\b|\bfinished\b|\baccomplished\b|\bdelivered\b/i],
  ['估算 / 约数', /(?<![预节制契])约(?![束定])|大约|左右|估算|估计|预估|粗略/, /\babout\b|\bapprox\w*|\baround\b|\broughly\b|\bestimat\w*|~/i],
  ['非官方 / 不代表', /非官方|并非官方|不是官方|不代表|并不代表/, /unofficial|not (?:an |the )?official|non-official|not represent|does not represent|not reflect|not indicative/i],
  // v1.11：「考虑装配间隙」是设计时的考量、不是设想；只有「考虑（过）加入 / 采用…」才算未实现的设想
  ['讨论 / 设想', /讨论|探讨|考虑(?:过|了)?(?:加入|引入|采用|增加|改用|后续|是否|将来)|设想|构想|提出(?:了)?(?:方案|设想|想法|思路)/, /discuss\w*|consider(?:ed|ing)? (?:\w+ing\b|whether|the idea)|explor\w*|propos\w*|envision\w*/i],
  ['实现', /实现/, /implement\w*|realiz\w*|achiev\w*|\benabled\b/i],
  ['实习', /实习/, /\bintern\w*/i],
  ['全职 / 正式', /全职|正式员工|正式工作|正式入职/, /full[- ]time|\bpermanent\b|\bemployment\b|\bemployee\b/i],
  ['兼职', /兼职/, /part[- ]time/i],
  ['课程 / 教学', /课程|课堂|课设|教学|作业/, /\bcourse\w*|\bclass\b|\bcoursework\b|\bacademic\b|\bassignment\b/i],
  ['商业', /商业|商用|商业化|客户项目/, /\bcommercial\w*|\bclient\b|\bcustomer\b/i],
  ['团队协作', /团队|小组|合作|协作|共同|[两二三四五六七八九十\d]人/, /\bteam\w*|\bgroup\b|collaborat\w*|\bjointly\b|\btogether\b|\bwith (?:colleagues|peers)\b/i],
  ['独立 / 个人', /独立|个人完成|单独|一人/, /\bindependent\w*|single-handedly|\bsolely\b|\balone\b|\bon (?:my|his|her) own\b/i],
  ['公司', /公司|企业/, /\bcompany\b|\bcorporate\b|\bfirm\b|\benterprise\b/i],
  ['医院', /医院|临床/, /\bhospital\b|\bclinic\w*/i],
  ['实验室', /实验室/, /\blab\b|\blaboratory\b/i],
  ['工厂 / 车间 / 现场', /工厂|车间|产线|现场/, /\bfactory\b|\bplant\b|\bworkshop\b|\bproduction line\b|\bon[- ]site\b|\bfield\b(?![- ]of[- ]view)|\bshop floor\b/i],
  ['学校 / 校内', /学校|校内|校园/, /\bschool\b|\bcampus\b|\buniversity\b/i],
  ['导师', /导师/, /\badvisor\b|\badviser\b|\bsupervisor\b|\bmentor\b/i],
  ['医生', /医生|医师/, /\bdoctor\w*|\bphysician\w*|\bclinician\w*/i],
];
const XPART_EN: [RegExp, number][] = [[/\b(?:participated|participating|contributed|took part|involved)\b/i, 1], [/\b(?:assisted|assisting|supported|helped)\b/i, 2], [/\b(?:responsible|in charge)\b/i, 3], [/\b(?:led|leading|headed|directed|spearheaded|managed)\b/i, 4], [/\b(?:independently|single-handedly)\b/i, 5]];
/** 中英两侧事实是否一致；返回不一致项（空数组 = 保守规则下未发现差异） */
export function crossCheck(zh: string, en: string): string[] {
  const out: string[] = [];
  const lz = [...levels(zh, 'zh')].sort().join(), le = [...new Set(XPART_EN.filter(([re]) => re.test(en)).map(([, n]) => n))].sort().join();
  if (lz !== le) out.push(`参与程度不一致：中文「${lz.split(',').filter(Boolean).map((n) => PART_NAME[+n]).join('/') || '未写明'}」↔ 英文「${le.split(',').filter(Boolean).map((n) => PART_NAME[+n]).join('/') || '未写明'}」`);
  for (const [name, rz, re] of XPAIRS) {
    const a = rz.test(zh), b = re.test(en);
    if (a !== b) out.push(`${name}：${a ? '中文有、英文没有' : '英文有、中文没有'}`);
  }
  return out;
}
