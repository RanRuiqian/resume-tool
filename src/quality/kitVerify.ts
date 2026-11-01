import type { Bi, JobParse, Lang, LocalizedText, ProfileDoc } from '../types';
import { numberTokens } from '../ai/consistency';
import { hasTerm } from '../ai/relevance';
import { levels, XPAIRS } from './factCheck';

/**
 * v1.10.1 求职信 / 自我介绍的逐句事实核对（纯本地、确定性、可追溯）。
 * 原则：资料（母库启用条目）是「我做过 / 会 / 有」的唯一依据；JD 只能用于岗位需求、动机与学习方向。
 * 这里只能证明「每句自述都能在资料中找到对应条目、且没有抬高 / 删限定」，不能、也不宣称内容 100% 真实。
 */
export interface KitFact { id: string; zh: string; en: string; type: 'bullet' | 'entry' | 'meta'; core?: { zh: string; en: string } }
/**
 * 句子分类（v1.11）：
 * - self / other：候选人事实（A 类，严格对照资料）
 * - jd：岗位 / 公司事实（B 类，对照 JD 原文，不需要资料支撑，但不能出现 JD 里没有的名词 / 数字）
 * - learning：学习意愿 / 坦白「还没做过」（C 类，不得暗示已掌握）
 * - future：未来计划 / 兴趣（D 类，宽松，但不得把 JD 缺口写成已有能力）
 * - motivation / reflection / closing：动机、概括前文、称呼结尾
 * 限定词（仅仿真 / 未完成 / 参与等，E 类）在 self 句里继续严格保留。
 */
export type SentenceKind = 'closing' | 'self' | 'reflection' | 'motivation' | 'jd' | 'learning' | 'future' | 'other';
export interface SentenceTrace { field: 'coverLetter' | 'selfIntro'; lang: Lang; text: string; kind: SentenceKind; ok: boolean; factIds: string[]; reasons: string[] }
export interface KitContext { facts: KitFact[]; corpus: string; majors: string[]; jobNames: string[]; gapTerms: string[]; degreePending: string | null; name: string[]; jdText?: string; dateNums?: string[] }
export interface KitVerdict { passed: boolean; trace: SentenceTrace[]; issues: string[] }

const L = (t?: LocalizedText) => ({ zh: t?.zh ?? t?.en ?? '', en: t?.en ?? t?.zh ?? '' });
const ym = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** 资料事实清单：每条 bullet 带上所属条目的上下文（公司 / 项目名 / 角色 / 时间），便于判断性质与参与程度 */
export function profileFacts(p: ProfileDoc): KitFact[] {
  const f: KitFact[] = [];
  const add = (id: string, zh: string[], en: string[], type: KitFact['type'] = 'bullet', core?: LocalizedText) => f.push({ id, zh: zh.filter(Boolean).join(' | '), en: en.filter(Boolean).join(' | '), type, core: core ? L(core) : undefined });
  const h = p.profile; add('profile', [L(h.name).zh, L(h.headline).zh, L(h.summary).zh], [L(h.name).en, L(h.headline).en, L(h.summary).en], 'meta');
  for (const e of p.education.filter((x) => x.enabled)) {
    const c = (l: Lang) => [L(e.school)[l], L(e.degree)[l], L(e.major)[l], `${e.start}–${e.end}`, e.expectedConferralDate ? (l === 'zh' ? `预计 ${e.expectedConferralDate} 授予学位` : `degree expected ${e.expectedConferralDate}`) : ''];
    add(e.id, [...c('zh'), ...(e.courses ?? []), e.abilities ?? ''], [...c('en'), ...(e.courses ?? [])], 'entry');
    e.highlights.forEach((b, i) => add(b.id ?? `${e.id}-h${i}`, [...c('zh'), L(b).zh], [...c('en'), L(b).en], 'bullet', b));
  }
  for (const e of p.work.filter((x) => x.enabled)) {
    const c = (l: Lang) => [L(e.company)[l], L(e.title)[l], `${e.start}–${e.end}`, e.tags.join(' ')];
    add(e.id, c('zh'), c('en'), 'entry');
    e.bullets.forEach((b, i) => add(b.id ?? `${e.id}-b${i}`, [...c('zh'), L(b).zh], [...c('en'), L(b).en], 'bullet', b));
  }
  for (const e of p.projects.filter((x) => x.enabled)) {
    const c = (l: Lang) => [L(e.name)[l], L(e.role)[l], `${e.start}–${e.end}`, e.tags.join(' ')];
    add(e.id, c('zh'), c('en'), 'entry');
    e.bullets.forEach((b, i) => add(b.id ?? `${e.id}-b${i}`, [...c('zh'), L(b).zh], [...c('en'), L(b).en], 'bullet', b));
  }
  for (const e of p.skills.filter((x) => x.enabled)) add(e.id, [L(e.name).zh, e.level ?? '', e.scenarios ?? ''], [L(e.name).en, e.level ?? ''], 'meta');
  for (const e of [...p.certificates, ...p.awards].filter((x) => x.enabled)) add(e.id, [L(e.name).zh, L(e.issuer).zh, e.date], [L(e.name).en, L(e.issuer).en, e.date], 'meta');
  return f;
}

const STOP_ASCII = new Set(['i', 'ok', 'a', 'jd', 'hr', 'cv', 'pdf', 'word', 'dear', 'hello', 'hi', 'sincerely', 'regards', 'thank', 'thanks']);
const TOOL_WORDS = /^(?:python|java|matlab|simulink|ansys|abaqus|autocad|creo|catia|inventor|solidworks|nx|ug|ros|ros2|opencv|halcon|labview|plc|pytorch|tensorflow|c\+\+|c#|excel|photoshop|premiere|revit|fluent|comsol|keil|stm32|arduino|linux|git|docker|sql)$/i;
/** 工具 / 专有名词候选（中文句子里的所有英文词；英文句子里含大写缩写、驼峰、数字或已知工具名的词） */
export function entityTokens(s: string, lang: Lang): string[] {
  const out = new Set<string>();
  for (const m of s.match(/[A-Za-z][A-Za-z0-9+#]*(?:[.\-/][A-Za-z0-9+#]+)*/g) ?? []) {
    const t = m.replace(/[.]+$/, ''); if (STOP_ASCII.has(t.toLowerCase())) continue;
    if (lang === 'zh' ? t.length >= 2 : (/[A-Z].*[A-Z]|[a-z][A-Z]/.test(t) || (/\d/.test(t) && t.length >= 2) || TOOL_WORDS.test(t))) out.add(t);
  }
  return [...out];
}
const ORG_ZH = /[\u4e00-\u9fa5A-Za-z]{2,16}?(?:公司|集团|大学(?!生)|学院|研究院|研究所|实验室|医院|工厂)/g;
const MAJOR_ZH = /([\u4e00-\u9fa5与和及]{2,12})专业/g;
const MAJOR_EN = /\b(?:study|studied|studying|majored in|majoring in|major in|degree in|graduate in|student in|B\.?Eng\.? in|B\.?S\.? in|bachelor'?s? (?:degree )?in|studying)\s+((?:[A-Z][a-z]+\s(?:and\s|&\s)?){0,4}(?:Engineering|Science|Technology|Studies|Management|Design|Automation|Mechanics|Physics|Mathematics|Chemistry|Architecture))\b/g;
const ORG_EN = /\b((?:[A-Z][A-Za-z]+\s){1,5}(?:Co\.|Inc\.?|Ltd\.?|Company|University|Institute|Laboratory|Lab|Group))/g;
const inCorpus = (corpus: string, s: string) => corpus.toLowerCase().includes(s.toLowerCase().trim());
/** 任一长度 ≥ min 的尾部片段出现在资料里即视为同一机构 / 专业（兼容「我在 X 公司」这类前缀） */
const suffixIn = (corpus: string, s: string, min: number) => { for (let k = s.length; k >= Math.min(min, s.length); k--) if (corpus.includes(s.slice(s.length - k))) return true; return false; };

/** 资料中没有的工具、机构、专业（不分句子类型；JD 缺口词由调用方另行判断学习表述） */
/** v1.11：「船舶修造公司」是资料中「虚构船舶修造有限公司」的简称——去掉公司后缀后的主体（≥4 字）出现在资料的机构名里即视为同一机构 */
const orgStemIn = (corpus: string, core: string) => { const stem = core.replace(/(?:股份)?(?:有限)?(?:责任)?(?:公司|集团)$/, ''); return stem.length >= 4 && stem !== core && new RegExp(`${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\u4e00-\u9fa5]{0,6}(?:公司|集团)`).test(corpus); };
export function unsupportedEntities(s: string, lang: Lang, corpus: string, allow: string[] = [], majors?: string[]): string[] {
  const majorText = majors ? majors.join('\n') : corpus;
  const bad: string[] = [];
  for (const t of entityTokens(s, lang)) if (!hasTerm(corpus, t) && !allow.some((a) => hasTerm(a, t))) bad.push(t);
  if (lang === 'zh') {
    for (const m of s.match(ORG_ZH) ?? []) { const core = m.replace(/^.*?(?:在|于|到|是|为|和|与|的)/, ''); if (core.length > 3 && !/^(?:贵|该|本|这家|一家|大型)/.test(core) && !/(?:贵|该|本|这家|一家|贵司)(?:公司|集团|大学|学院|研究院|研究所|实验室|医院|工厂)$/.test(core) && !suffixIn(corpus, core, 5) && !orgStemIn(corpus, core)) bad.push(core); }
    for (const m of s.matchAll(MAJOR_ZH)) { const core = m[1].replace(/^.*?(?:是|读|学|的|在|于)/, ''); if (core.length >= 2 && !/^(?:相关|对口|本|该|这个|所学)$/.test(core) && !suffixIn(majorText, core, 4)) bad.push(`${core}专业`); }
    if (/主修|就读|在读|攻读|读的是|学的是/.test(s)) for (const m of s.match(/[\u4e00-\u9fa5]{2,6}工程/g) ?? []) if (!suffixIn(majorText, m, 4)) bad.push(m);
  } else {
    for (const m of s.matchAll(MAJOR_EN)) { const core = m[1].trim(); if (core && !inCorpus(majorText, core)) bad.push(core); }
    for (const m of s.match(/\b(?:[A-Z][a-z]+\s(?:and\s|&\s)?){1,4}Engineering\b/g) ?? []) if (!inCorpus(corpus, m)) bad.push(m);
    for (const m of s.matchAll(ORG_EN)) { const core = m[1].replace(/^(?:The|At|In|From|A|An)\s/, '').trim(); if (!inCorpus(corpus, core) && !inCorpus(corpus, core.replace(/\s(?:Co\.|Inc\.?|Ltd\.?|Company)$/, ''))) bad.push(core); }
  }
  return [...new Set(bad)];
}

export function buildKitContext(p: ProfileDoc, job: JobParse | null, now = new Date()): KitContext {
  const facts = profileFacts(p);
  const corpus = facts.map((f) => `${f.zh}\n${f.en}`).join('\n');
  const jdTerms = job ? [...job.mustHave, ...job.keywords, ...job.niceToHave, ...(job.responsibilities ?? [])].flatMap((k) => [k.zh, k.en]) : [];
  const jdTools = job ? entityTokens(job.rawText ?? '', 'en') : [];
  const jobNames = job ? [job.title?.zh, job.title?.en, job.company?.full, job.company?.short].filter((x): x is string => !!x && x.trim().length >= 2) : [];
  const cw = words(corpus); const cb = bigrams(corpus);
  const gapTerms = [...new Set([...jdTerms, ...jdTools].filter((t): t is string => !!t && t.trim().length >= 2 && t.length <= 24).map((t) => t.trim()))].filter((t) => !hasTerm(corpus, t) && !jobNames.some((n) => hasTerm(n, t)) && !fuzzyIn(t, cw, cb));
  const pend = p.education.filter((e) => e.enabled && !e.actualConferralDate && ((e.expectedConferralDate && e.expectedConferralDate.slice(0, 7) > ym(now)) || (e.end && e.end.slice(0, 7) > ym(now))));
  const degreePending = pend.length ? (pend[0].expectedConferralDate || pend[0].end) : null;
  const majors = p.education.filter((e) => e.enabled).flatMap((e) => [e.major.zh ?? '', e.major.en ?? '']).filter(Boolean);
  const jdText = job ? [job.rawText ?? '', ...jdTerms, ...jobNames].filter(Boolean).join('\n') : '';
  // 资料里出现过的年份 / 月份（入学、毕业、预计授予、证书日期）：「预计 2026 年 6 月获得学位」这类句子里的日期不算新数字
  const dates = [...p.education.filter((e) => e.enabled).flatMap((e) => [e.start, e.end, e.expectedConferralDate, e.actualConferralDate]), ...p.work.filter((e) => e.enabled).flatMap((e) => [e.start, e.end]), ...p.projects.filter((e) => e.enabled).flatMap((e) => [e.start, e.end]), ...[...p.certificates, ...p.awards].filter((e) => e.enabled).map((e) => e.date)];
  const dateNums = [...new Set(dates.filter((d): d is string => !!d && /^\d{4}/.test(d)).flatMap((d) => { const [y, m] = d.split('-'); return [y, ...(m ? [String(parseInt(m, 10))] : [])]; }))];
  return { facts, corpus, majors, jobNames, gapTerms, degreePending, name: [p.profile.name.zh ?? '', p.profile.name.en ?? ''].filter(Boolean), jdText, dateNums };
}

export const splitSentences = (s: string, l: Lang) => s.split(l === 'zh' ? /(?<=[。！？!?；;\n])/ : /(?<=[.!?;])\s+|\n+/).map((x) => x.trim()).filter((x) => x.replace(/[\s\p{P}]/gu, '').length > 0);

const CLOSING = { zh: /^(?:您好|你好|尊敬的|各位面试官|面试官|大家好|此致|敬礼|谢谢|感谢|期待您的回复|期待.{0,6}(?:回复|面试|沟通|交流))/, en: /^(?:Dear\b|Hello\b|Hi\b|Good (?:morning|afternoon)|Sincerely|Best regards|Kind regards|Regards|Yours|Thank you|Thanks|I look forward to (?:hearing|discussing|the opportunity|talking|speaking))/i };
const SELF = {
  zh: /我(?!希望|期待|想|愿意|计划|打算|将|会尽快|非常期待|很期待|很希望|非常希望|也希望|也期待|们)|(?:^|[，,])(?:曾|在[^，。]{0,20}(?:实习|项目|课程))|我(?:曾|在|做|参与|协助|负责|用|使用|设计|完成|掌握|熟悉|具备|有|会|能|了解|接触|学习过|修读|主修|是|的(?:实习|项目|经历|课程|专业)|还|也|主要|目前|通过|对|将|已|独立|主导|带领)|实习(?:期间|中|时)|项目中|课程中|课设中|在校期间/,
  en: /\bI(?:'ve| have| had| am| was| did| took| assisted| designed| led| worked| built| wrote| ran| used| completed| developed| know| can| gained| learned| studied| helped| participated| contributed| prepared| compiled| iterated| validated| measured| tested| modeled| analyzed| created| managed| also| then| mainly| currently| recently)\b|\bmy (?:internship|project|experience|coursework|course|studies|degree|background|skills|role|work|major|team)\b|\bduring (?:my|the|a)\b|\bas an? (?:intern|student|participant|team member|member)\b|\bI(?:'m|'ve)?\s+(?!would\b|'d\b|hope|wish|want|plan|look|am (?:eager|keen|excited|interested|applying|writing|ready|willing)|apply|believe)[a-z]+/i,
};
const REFLECT = { zh: /^(?:这段|这些|这次|这个|通过这|这让我|由此|从中)/, en: /^(?:This|These|That|Through (?:this|these|that))\b/i };
const MOTIVE = { zh: /希望|期待|愿意|想要|渴望|期望|计划|打算|入职后|未来|接下来|将来|求职方向|应聘|申请|贵公司|贵岗位|贵团队|该岗位|这个岗位|此岗位|岗位(?:要求|职责|关注|需要|看重)|学习/, en: /\b(?:eager|hope|hoping|look(?:ing)? forward|would like|wish|plan to|aim to|apply|applying|the role|this role|this position|the position|your team|keen to|want to|excited|interested)\b/i };
const LEARN_FRAME = { zh: /(?:希望|愿意|计划|打算|想要|想|准备|正在|继续|进一步|系统地?|尽快|入职后)[^。！？]{0,14}(?:学习|学会|补齐|补上|掌握|提升|积累)|(?:在工作中|在实践中|在项目中|工作中)(?:继续)?学习|(?:想|要|去|多|再)学(?![校位历生院科])|学习[^。！？]{0,8}(?:并|再)/, en: /\b(?:eager|keen|hope|hoping|want|plan|would like|look(?:ing)? forward|ready|willing|intend)\b[^.!?]{0,40}\b(?:to learn|to pick up|to build|to develop|to gain|learning|to study)\b|\bto learn\b/i };
const PSEUDO = { zh: /基础|熟悉|了解|接触过|接触|掌握|具备|会用|能够使用|能用|有.{0,4}经验|入门|懂/, en: /\bfoundation|\bfamiliar|\bexposure|\bexposed\b|\bbasic\b|\bknowledge of|\bunderstanding of|\bexperience (?:with|in)\b|\bproficien|\bknow how\b|\bbackground in\b|\bskilled\b|\bcomfortable with\b/i };
const NEG = { zh: /(?:没有|尚无|还没有|暂无|并无|未曾|尚未|还未|不具备|缺少|缺乏|还没|从没|从未|没(?=做|用|接触|学|参与|实践))[^，。,.；;]{0,14}/g, en: /\b(?:no|not yet|don't have|do not have|haven't|have not|without|lack|lacking|not)\b[^,.;]{0,40}/gi };
const JD_DESC = { zh: /岗位|职位|JD|招聘|贵公司|贵司|贵团队/, en: /\b(?:the role|this role|the position|this position|the job|job description|requirements?|requires?|calls for|asks for)\b/i };
const MOTIVE_LEAD = { zh: /^(?:我?(?:希望|期待|盼望|很希望|非常希望|也希望|愿意)|如有机会|若有机会|我?的?求职(?:的)?方向是[^，。]{1,16}[，,](?=[^，。]*(?:希望|愿意|计划|打算|想)[^，。]{0,8}学))/, en: /^(?:I (?:would|'d) (?:be glad|welcome|like|love|appreciate)|I hope|I look forward|Looking forward|I am (?:eager|keen|excited|happy|glad) to)\b/i };
const JD_INTRO = { zh: /我?(?:了解到|注意到|看到)/g, en: /\bI (?:understand|see|noticed|note|learned)(?: that)?\b/gi };
const APPLY = { zh: /应聘|申请|投递/, en: /\b(?:apply|applying|application)\b/i };
const ACT = { zh: /完成|设计了|设计|编写|搭建|开发|制作|实现|测量|建模|做了|做过|负责|主导|带领|编程|调试|测试|整理|绘制|打印/, en: /\b(?:designed|built|wrote|developed|completed|created|ran|measured|modeled|made|implemented|programmed|conducted|performed|did|tested|compiled|prepared|printed|iterated|validated|led)\b/i };
const GENERIC_ORG = { zh: /贵公司|贵司|贵团队|该公司|贵单位/g, en: /\byour (?:company|team|organization)\b/gi };
const DEPLOY = { zh: /部署|上线|实机|真机|实物机器人|产线|生产线|现场调试|量产|落地|交付/, en: /\bdeploy\w*|\breal (?:robot|hardware|line)|\bphysical robot|\bproduction line|\bon[- ]site\b|\bcommission\w*|\bshop floor\b|\bmass production\b/i };
const GRAD = { zh: /已毕业|毕业于|已经毕业|已获得.{0,8}学位|获得了?.{0,8}学位|取得了?.{0,8}学位|学位已/, en: /\bgraduated\b|\bhold(?:s|ing)? an? .{0,30}\bdegree\b|\b(?:have|has) (?:earned|received|obtained|been awarded)\b.{0,30}\b(?:degree|bachelor)|\bearned my\b|\bdegree (?:was )?(?:awarded|conferred)\b/i };
/** 未来计划 / 兴趣（D 类）：不含「继续」——「继续做 X」暗示做过，按自述严格核对 */
const FUTURE = { zh: /^(?:我)?(?:也|还)?(?:希望|期待|计划|打算|想|愿意|准备)?(?:在)?(?:未来|今后|将来|入职后|以后|加入后)|对[^，。]{1,24}(?:很|非常|十分|也)?(?:感兴趣|有兴趣|充满兴趣|有热情)|(?:希望|期待|计划|打算)(?:能|可以|有机会|能有机会)?(?:在|把|将|参与|投入|从事|成为|加入)(?![^，。]{0,10}继续)/, en: /^(?:In the future|Going forward|Looking ahead|In the long term)\b|\bI(?: am|'m) (?:very |particularly |also |especially )?(?:interested in|passionate about|curious about)\b|\bI (?:hope|would like|'d like|want|plan|aim|intend) to (?!continue\b)|\bmy (?:goal|aim|plan) is\b/i };
/** 坦白「还没做过 / 没有接触」：否定的是候选人自己的经历 */
const SELF_NEG = { zh: /(?:我)?(?:目前|暂时|还|尚)?(?:没有|尚无|还没有|暂无|并无|未曾|尚未|还未|不具备|缺少|缺乏)(?:实际)?(?:使用|做|接触|学习|参与|掌握|用)?过?/, en: /I (?:have|'ve|had)? ?(?:not|never|n't)(?: yet)? (?:worked|used|had|done|touched|learned|been)|I (?:do not|don't|did not|didn't) (?:yet )?(?:have|know)|I have no|I lack|not yet (?:worked|used|had)|haven't (?:yet )?(?:worked|used|had)/i };
/** 「岗位要求 X，这我已经具备」：把 JD 里的要求整体认领为已有能力 */
const POSSESS = { zh: /我(?:都|也)?(?:已经|已)(?:具备|拥有|有|满足|符合|掌握)|我(?:完全)?(?:具备|拥有|满足|符合)(?:这|此|该|上述|以上)|这些我(?:都)?(?:有|会|具备)/, en: /\b(?:which|that) I (?:already )?(?:have|possess|meet|bring)\b(?! not\b| never\b| yet to\b| no\b)|\bI (?:already )?(?:have|possess|meet|bring) (?:this|these|that|it|them|all)\b|\bI already (?:have|possess|meet)\b/i };
const FP_RE = /我|\bI\b|\bmy\b|\bme\b|\bI'm\b|\bI've\b/i;
const KEEP_CORE = new Set(['否定 / 未完成', '进行中', '仅 / 限定', '仿真 / 模拟', '预计 / 尚未授予', '讨论 / 设想']);
const NO_GAIN = new Set(['已完成', '已获得 / 已授予', '实现', '全职 / 正式', '商业', '独立 / 个人', '公司', '医院', '实验室', '工厂 / 车间 / 现场', '导师']);
const PART_NAME = ['', '参与', '协助', '负责', '主导', '独立完成'];

const bigrams = (s: string) => { const t = s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase(); const b = new Set<string>(); for (let i = 0; i < t.length - 1; i++) b.add(t.slice(i, i + 2)); return b; };
const EN_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'was', 'were', 'have', 'has', 'had', 'are', 'which', 'when', 'what', 'where', 'while', 'then', 'than', 'also', 'about', 'there', 'their', 'they', 'them', 'your', 'you', 'our', 'role', 'position', 'team', 'during', 'using', 'used']);
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9][a-z0-9+#]{2,}/g) ?? []).filter((w) => !EN_STOP.has(w)).map((w) => w.replace(/(?:ing|ed|es|s)$/, '')));
const ZH_FILL = /方面|方向|相关|实践|经历|工作|这些|这段|一些|我|在|与|和|的|了|及|并|也|中|过|这|对|使|让|把|将|是|有/g;
function containment(s: string, f: string, l: Lang): number {
  const a = l === 'zh' ? bigrams(s.replace(ZH_FILL, '')) : words(s), b = l === 'zh' ? bigrams(f) : words(f);
  if (!a.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / a.size;
}
/** 多词 / 中文短语的宽松包含：英文所有实词（去词尾）都在资料里；中文 ≥75% 的二字组在资料里 */
function fuzzyIn(t: string, cw: Set<string>, cb: Set<string>): boolean {
  if (/^[\x20-\x7e]+$/.test(t)) { const w = [...words(t)]; return w.length >= 2 && w.every((x) => cw.has(x)); }
  const b = bigrams(t); if (b.size < 2) return false; let n = 0; for (const x of b) if (cb.has(x)) n++; return n / b.size >= 0.75;
}
const stripNeg = (s: string, l: Lang) => s.replace(NEG[l], ' ');
const kindOf = (s: string, l: Lang, ctx: KitContext): SentenceKind => {
  const plain = s.replace(/[\s\p{P}]/gu, '');
  if (ctx.name.some((n) => plain === n.replace(/[\s\p{P}]/gu, ''))) return 'closing';
  if (CLOSING[l].test(s) && (l === 'zh' ? plain.length <= 24 : s.split(/\s+/).length <= 14) && !SELF[l].test(s.replace(CLOSING[l], ''))) return 'closing';
  // B 类：不含第一人称、在描述岗位 / 公司（JD 事实）
  if (!FP_RE.test(s) && (JD_DESC[l].test(s) || /^(?:该公司|公司|团队|贵公司|贵司|贵团队|The company|Your company|Your team|The team)/i.test(s))) return 'jd';
  // C 类：坦白「还没做过 X」+ 学习意愿；去掉否定片段和学习表述后不再含动作 / 能力 / 数字
  if (SELF_NEG[l].test(s) && (LEARN_FRAME[l].test(s) || MOTIVE[l].test(s))) { const rest = stripNeg(s, l).replace(LEARN_FRAME[l], ' '); if (!ACT[l].test(rest) && !PSEUDO[l].test(rest) && !numberTokens(rest).length && !DEPLOY[l].test(rest)) return 'learning'; }
  if (LEARN_FRAME[l].test(s)) { const ns = stripNeg(s, l); const mi = ns.search(LEARN_FRAME[l]); /* v1.11：学习框架之后是「要学的内容」，只看之前的部分有没有自述动作；「求职方向是 X」不是经历 */ const rest = (mi >= 0 && ACT[l].test(ns.slice(mi)) && !/[，,;；。](?=[^，,;；。]*$)/.test(ns.slice(mi, -1)) ? ns.slice(0, mi) : ns.replace(LEARN_FRAME[l], ' ')).replace(/我?的?求职(?:的)?方向是[^，。,]*/, ' '); if (!ACT[l].test(rest) && !PSEUDO[l].test(rest) && !numberTokens(rest).length && !DEPLOY[l].test(rest) && !/继续|continue/i.test(s)) return 'learning'; }
  if (FUTURE[l].test(s) && !(l === 'zh' ? /继续|仍然|一直|再次/ : /\bcontinu|\bagain\b|\bkeep\b/i).test(s) && !numberTokens(s.replace(l === 'zh' ? /\d{4}\s*年|\d{1,2}\s*月/g : /\b20\d\d\b/g, ' ')).length) return 'future';
  if (REFLECT[l].test(s) && !unsupportedEntities(s, l, ctx.corpus, [], ctx.majors).length && !ctx.gapTerms.some((g) => hasTerm(s, g)) && !numberTokens(s).length && !DEPLOY[l].test(stripNeg(s, l))) return 'reflection';
  if (MOTIVE_LEAD[l].test(s) && !ACT[l].test(s)) return 'motivation';
  if (APPLY[l].test(s) && !ACT[l].test(s)) return 'motivation';
  if (SELF[l].test(s)) return 'self';
  if (MOTIVE[l].test(s)) return 'motivation';
  return 'other';
};

/** 单句核对。返回该句的类型、对应资料条目与未通过原因 */
export function verifySentence(s: string, l: Lang, field: SentenceTrace['field'], ctx: KitContext): SentenceTrace {
  const reasons: string[] = []; let factIds: string[] = [];
  let sj0 = s.replace(JD_INTRO[l], ' '); for (const n of ctx.jobNames) sj0 = sj0.split(n).join(' ');
  let kind = kindOf(sj0, l, ctx);
  if (kind === 'closing') return { field, lang: l, text: s, kind, ok: true, factIds, reasons };
  const noNeg = stripNeg(s, l);
  const sj = sj0;
  if (kind === 'jd') {
    // B 类：岗位 / 公司事实，对照 JD 原文；不需要资料支撑，但 JD 和资料里都没有的名词 / 数字仍要拦下
    const ref = `${ctx.jdText ?? ''}\n${ctx.corpus}\n${ctx.jobNames.join('\n')}`;
    const ents = unsupportedEntities(sj, l, ref, [], undefined).filter((e) => !/公司|集团|team|company/i.test(e));
    if (ents.length) reasons.push(`描述岗位时提到了 JD 里没有的：${ents.join('、')}`);
    const jdRef = `${ctx.jdText ?? ''}\n${ctx.jobNames.join('\n')}`; const exN = numberTokens(s).filter((n) => !numberTokens(jdRef).includes(n));
    if (exN.length) reasons.push(`描述岗位时使用了 JD 里没有的数字：${[...new Set(exN)].join(', ')}`);
    return { field, lang: l, text: s, kind, ok: reasons.length === 0, factIds, reasons: [...new Set(reasons)] };
  }
  if (kind === 'learning' || kind === 'future') {
    // C / D 类：学习意愿、坦白没做过、未来计划。只拦「把缺口写成已有能力」、资料与 JD 都没有的名词、学位状态
    const selfC = sj.split(/[，,；;：:]|(?<=[A-Za-z]) (?=and |but |which )/).filter((c) => !SELF_NEG[l].test(c) && !LEARN_FRAME[l].test(c) && !(JD_DESC[l].test(c) && !FP_RE.test(c)));
    const gapsHit = ctx.gapTerms.filter((g) => selfC.some((c) => hasTerm(c, g) && PSEUDO[l].test(stripNeg(c, l))));
    for (const g of gapsHit) reasons.push(`资料中没有「${g}」，这里写成了「基础 / 了解 / 熟悉」，只能写成希望学习`);
    const ents = unsupportedEntities(sj, l, `${ctx.corpus}\n${ctx.jdText ?? ''}\n${ctx.jobNames.join('\n')}`, ctx.gapTerms, ctx.majors).filter((e) => !/公司|集团|team|company/i.test(e));
    if (ents.length) reasons.push(`提到了资料和 JD 中都没有的：${ents.join('、')}`);
    if (ctx.degreePending && GRAD[l].test(noNeg.replace(l === 'zh' ? /(?:预计|预期|将于|拟于|即将|有望)[^，。；]{0,16}/g : /\b(?:expected|will|to be|anticipated)\b[^,.;]{0,30}/gi, ' '))) reasons.push(`学位尚未授予（资料：预计 ${ctx.degreePending}），不能写成已毕业 / 已获得学位`);
    return { field, lang: l, text: s, kind, ok: reasons.length === 0, factIds, reasons: [...new Set(reasons)] };
  }
  // 1) JD 中有、资料中没有的技能 / 工具：只允许出现在明确的「希望学习」表述里；「有相关基础 / 了解 / 熟悉」不是出口
  const gaps = ctx.gapTerms.filter((g) => hasTerm(sj, g));
  const learn = LEARN_FRAME[l].test(s);
  const jdOnly = JD_DESC[l].test(s) && !SELF[l].test(s);
  // 按分句判断：「岗位要求熟悉 X」这类复述 JD 的分句不算自述；其余分句出现「基础 / 了解 / 熟悉」才算伪装成已有能力
  const FP = /我|\bI\b|\bmy\b|\bme\b/i; const wholeJd = JD_DESC[l].test(sj) && !FP.test(sj);
  const isJdClause = (c: string) => wholeJd || (JD_DESC[l].test(c) && !FP.test(c));
  const selfPart = () => sj.split(/[，,；;：:]/).filter((c) => !isJdClause(c) && !LEARN_FRAME[l].test(c)).join('，') || s;
  const clauses = sj.split(/[，,；;：:]|(?<=[A-Za-z]) (?=and |but |which )/);
  // v1.11：「the role involves X and ROS」被 and 切开后，「and ROS」承接前一个复述 JD 的分句
  const jdAt: boolean[] = []; clauses.forEach((c, i) => { jdAt[i] = isJdClause(c) || (i > 0 && jdAt[i - 1] && (l === 'zh' ? /^\s*(?:需要|要求|涉及|包括|主要|并要求|以及|并且需要)/ : /^\s*(?:and|or|together with|as well as|along with|including|plus)\b/i).test(c) && !FP.test(c)); });
  const selfClauses = clauses.filter((_, i) => !jdAt[i]);
  // v1.11：「基础 / 熟悉 / exposure」只对它自己所在的分句（或悬空的「familiar with and …」前一分句）生效，
  // 不再因为同句另一分句里对资料内经历的 exposure，就把后面「希望学习 X」的 X 判成伪装
  const pseudoOf = (c: string) => PSEUDO[l].test(stripNeg(c, l).replace(LEARN_FRAME[l], ' ').replace(/了解到?(?=岗位|贵|该|这|此|职位|公司|团队|你们)|\bI understand (?:that )?(?=the|this|your)/gi, ' ').replace(/\b(?:gain|gaining|build|building|get|getting|acquire|acquiring)\s+(?:[\w-]+\s+)?experience (?:with|in)\b/gi, ' '));
  const dangling = (c: string) => { const m = stripNeg(c, l).match(PSEUDO[l]); if (!m || m.index === undefined) return false; const after = c.slice(m.index + m[0].length).replace(/\b(?:with|in|of|to|and)\b/gi, '').replace(/[\s，,]/g, ''); return after.length < 2; };
  // 学习框架之后的内容是「要学什么」（如「学习 NX 和基础有限元」「learn NX and basic FEA」），其中的「基础 / basic」不是自述
  const learnAt: boolean[] = []; selfClauses.forEach((c, i) => { learnAt[i] = LEARN_FRAME[l].test(c) || (i > 0 && learnAt[i - 1] && !FP.test(c) && !ACT[l].test(stripNeg(c, l))); });
  const ownPart = (c: string, i: number) => { if (!learnAt[i]) return c; const k = c.search(LEARN_FRAME[l]); return k > 0 ? c.slice(0, k) : ''; };
  const pseudoFor = (g: string) => selfClauses.some((c, i) => pseudoOf(ownPart(c, i)) && (hasTerm(c, g) || (dangling(ownPart(c, i)) && selfClauses.slice(i + 1).some((d) => hasTerm(d, g)))));
  for (const g of gaps) {
    const own = selfClauses.filter((c) => hasTerm(c, g));
    if (!own.length) continue; // 只在复述 JD 的分句里出现
    const li = sj.search(LEARN_FRAME[l]); const actFor = li > 0 && own.some((c) => { const at = sj.indexOf(c); return at >= 0 && at + c.length <= li && (l === 'zh' ? /(?:做|用|参与|完成|负责|设计|测|开发|搭建|编写|调试|测试|实现)(?:过|了)|已(?:经)?(?:完成|做|实现|掌握)/ : ACT.en).test(stripNeg(c, l)) && !JD_DESC[l].test(c); }); // 「我做过 X，希望学习 Y」：X 仍是自述
    if (learn && !pseudoFor(g) && !actFor) continue;
    reasons.push(learn && !actFor ? `资料中没有「${g}」，同句又写了「基础 / 了解 / 熟悉」类表述，只能写成希望学习` : `资料中没有「${g}」（只出现在 JD），不能写成已有能力或基础，只能放在「希望学习」的表述里`);
  }
  if (POSSESS[l].test(s)) for (const g of gaps) reasons.push(`「${g}」只出现在 JD，不能声称已经具备`);
  if (POSSESS[l].test(s) && JD_DESC[l].test(s)) { const jdN = numberTokens(s).filter((n) => !numberTokens(ctx.corpus).includes(n)); if (jdN.length) reasons.push(`把 JD 的要求（${jdN.join(', ')}）写成了自己已具备`); }
  // 2) 资料中没有的工具 / 机构 / 专业（JD 缺口词已在上面单独判断）
  const ents = unsupportedEntities(sj, l, ctx.corpus + '\n' + ctx.jobNames.join('\n'), gaps, ctx.majors);
  if (ents.length && kind !== 'motivation') reasons.push(`提到了资料中没有的：${ents.join('、')}`);
  else if (ents.length && kind === 'motivation') { const own = ents.filter((e) => !/公司|集团|team|company/i.test(e)); if (own.length && !jdOnly && !learn) reasons.push(`提到了资料和 JD 中都没有的：${own.join('、')}`); }
  // 3) 学位状态
  if (ctx.degreePending && GRAD[l].test(noNeg.replace(l === 'zh' ? /(?:预计|预期|将于|拟于|即将|有望)[^，。；]{0,16}/g : /\b(?:expected|will|to be|anticipated)\b[^,.;]{0,30}/gi, ' '))) reasons.push(`学位尚未授予（资料：预计 ${ctx.degreePending}），不能写成已毕业 / 已获得学位`);
  const ownEnts = entityTokens(s, l).filter((t) => !gaps.some((g) => hasTerm(g, t) || hasTerm(t, g)));
  const learningOnly = learn && gaps.length > 0 && !ownEnts.length && !numberTokens(s).length;
  if (learningOnly && (kind === 'self' || kind === 'other')) kind = 'motivation';
  // 「岗位涉及 X，与我做过的 Y 方向相关」：只做关联、不含具体动作 / 数字 / 新名词的句子按动机处理
  { const sp0 = selfPart(); if ((kind === 'self' || kind === 'other') && sj.split(/[，,；;：:]/).some(isJdClause) && !ACT[l].test(sp0) && !PSEUDO[l].test(stripNeg(sp0, l)) && !numberTokens(sp0).length && !DEPLOY[l].test(stripNeg(sp0, l)) && !GRAD[l].test(sp0)) kind = 'motivation'; }
  if (kind === 'self' || kind === 'other') {
    // 4) 找支撑条目
    const sp = selfPart();
    const scored = ctx.facts.map((f) => {
      const ft = f[l] || f.zh; const sharedEnt = entityTokens(sp, l).filter((t) => hasTerm(ft, t)).length; const sharedNum = numberTokens(sp).filter((n) => numberTokens(ft).includes(n)).length;
      const c = containment(sp, ft, l); return { f, ft, c, score: c + sharedEnt * 0.15 + sharedNum * 0.1 };
    }).sort((a, b) => b.score - a.score);
    const top = scored[0];
    const thr = l === 'zh' ? 0.3 : 0.35;
    const content = l === 'zh' ? s.replace(/[\s\p{P}]/gu, '').length >= 10 : s.split(/\s+/).length >= 6;
    if (!top || top.score < thr) {
      if (kind === 'self' || (content && (entityTokens(s, l).length || numberTokens(s).length || PSEUDO[l].test(noNeg)))) reasons.push('自述内容在资料中找不到对应条目（无法追溯）');
    } else {
      const sup = scored.filter((x) => x.score >= Math.max(thr, top.score * 0.6)).slice(0, 3);
      factIds = sup.map((x) => x.f.id);
      const union = sup.map((x) => x.ft).join('\n');
      const exN = numberTokens(s).filter((n) => !numberTokens(union).includes(n) && !numberTokens(ctx.corpus).includes(n));
      if (exN.length) reasons.push(`使用了资料中没有的数字：${[...new Set(exN)].join(', ')}`);
      else { const dateCtx = /年|月|\b(?:19|20)\d\d\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(s); const wide = scored.filter((x) => x.score >= thr).map((x) => x.ft).join('\n'); /* v1.11：一句合并两条事实时，数字可来自任一条本身就能对上的事实 */ const exT = numberTokens(s).filter((n) => !numberTokens(union).includes(n) && !numberTokens(wide).includes(n) && !(dateCtx && (ctx.dateNums ?? []).includes(n))); if (exT.length) reasons.push(`数字 ${[...new Set(exT)].join(', ')} 与所述经历对不上`); }
      const topText = top.f.core?.[l] || ''; const sNoNegForKeep = s; const sOrg = s.replace(GENERIC_ORG[l], ' ');
      const bulletTop = top.f.type === 'bullet' || (top.f.type === 'entry' && /^edu/.test(top.f.id));
      const degreeTalk = /学位|毕业|degree|graduat|conferr/i.test(s);
      for (const [name, rz, re] of XPAIRS) {
        const rx = l === 'zh' ? rz : re;
        if (name === '预计 / 尚未授予' && !degreeTalk && /^edu/.test(top.f.id)) continue;
        if (bulletTop && (ACT[l].test(sp) || DEPLOY[l].test(noNeg)) && KEEP_CORE.has(name) && rx.test(topText) && !rx.test(sNoNegForKeep)) {
          const simKept = (l === 'zh' ? /仿真|模拟/ : /simulat/i).test(s);
          if ((name === '仅 / 限定' || name === '否定 / 未完成') && simKept && !DEPLOY[l].test(noNeg) && (!/完成|completed|finished/i.test(s) || /完成|completed|finished/i.test(topText))) continue;
          reasons.push(`删去了资料里的限定「${name}」（${top.f.id}）`);
        }
        if (NO_GAIN.has(name) && rx.test(sOrg) && !sup.some((x) => rz.test(x.f.zh) || re.test(x.f.en))) reasons.push(`新增了资料没有的事实「${name}」`);
      }
      if (DEPLOY[l].test(noNeg) && !sup.some((x) => DEPLOY.zh.test(stripNeg(x.f.zh, 'zh')) || DEPLOY.en.test(stripNeg(x.f.en, 'en')))) reasons.push('把仿真 / 课程工作写成了实机部署、产线或现场调试');
      // 资料的中英文是同一事实：任一语言写明的参与程度都算（如中文角色「负责结构设计」、英文只写「Team member」）
      const ls = sup.flatMap((x) => [...levels(x.f.zh, 'zh'), ...levels(x.f.en, 'en')]), lo = [...levels(s, l)];
      const maxS = ls.length ? Math.max(...ls) : 0, maxO = lo.length ? Math.max(...lo) : 0;
      if (maxO > maxS && maxO >= 3) reasons.push(`参与程度被抬高：资料为「${PART_NAME[maxS] || '未写明'}」，这里写成「${PART_NAME[maxO]}」`);
      const lt = topText ? [...levels(topText, l)] : []; const minT = lt.length ? Math.min(...lt) : 0;
      if (minT && minT <= 2 && !lo.length && ACT[l].test(sp) && /^(?:[^，,；;]*)/.test(s) && coreClauseLevel(s, top.f.core?.[l] ?? '', l)) reasons.push(`删去了「${PART_NAME[minT]}」这一参与程度（${top.f.id}）`);
    }
  }
  return { field, lang: l, text: s, kind, ok: reasons.length === 0, factIds, reasons: [...new Set(reasons)] };
}

/** 句子对应到 bullet 中带「参与 / 协助」的那个分句时才要求保留（bullet 的其它分句可能本来就没有程度词） */
function coreClauseLevel(s: string, core: string, l: Lang): boolean {
  const cl = core.split(/[；;，,。]|\band\b/).map((c) => c.trim()).filter(Boolean);
  if (!cl.length) return false;
  const best = cl.map((c) => ({ c, v: containment(c, s, l) })).sort((a, b) => b.v - a.v)[0];
  const lv = [...levels(best.c, l)];
  return lv.length > 0 && Math.min(...lv) <= 2 && best.v >= 0.4;
}
const FIELD = { coverLetter: '求职信', selfIntro: '自我介绍' } as const;
export function verifyKit(kit: { coverLetter?: Bi; selfIntro?: Bi }, ctx: KitContext): KitVerdict {
  const trace: SentenceTrace[] = [];
  for (const field of ['coverLetter', 'selfIntro'] as const) for (const l of ['zh', 'en'] as const) {
    const t = kit[field]?.[l] ?? ''; for (const s of splitSentences(t, l)) trace.push(verifySentence(s, l, field, ctx));
  }
  const issues = trace.filter((x) => !x.ok).map((x) => `${FIELD[x.field]}（${x.lang === 'zh' ? '中文' : '英文'}）「${x.text.length > 50 ? x.text.slice(0, 50) + '…' : x.text}」：${x.reasons.join('；')}`);
  return { passed: issues.length === 0, trace, issues };
}

/** 只保留通过核对的句子（不改写、不调用 AI）；自述句少于 2 句时该段不提供 */
export function verifiedOnly(kit: { coverLetter: Bi; selfIntro: Bi }, ctx: KitContext): { coverLetter: Bi; selfIntro: Bi } | null {
  const out = { coverLetter: { zh: '', en: '' }, selfIntro: { zh: '', en: '' } };
  for (const field of ['coverLetter', 'selfIntro'] as const) for (const l of ['zh', 'en'] as const) {
    const tr = splitSentences(kit[field][l] ?? '', l).map((s) => verifySentence(s, l, field, ctx));
    if (tr.filter((x) => x.ok && (x.kind === 'self' || x.kind === 'other')).length < 2) return null;
    out[field][l] = tr.filter((x) => x.ok).map((x) => x.text).join(l === 'zh' ? '' : ' ');
  }
  return out;
}

/** 文本指纹：人工覆盖确认只对确认时的那份文本有效 */
const hstr = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h >>> 0); };
export const kitHash = (kit: { coverLetter?: Bi; selfIntro?: Bi }) => hstr(JSON.stringify([kit.coverLetter ?? {}, kit.selfIntro ?? {}]));

/** 人工确认的指纹（v1.10.1）：资料事实 / 岗位 JD / 当前简历 任一变化，旧确认即失效 */
export interface KitFingerprint { profileHash: string; jobHash: string; resumeHash: string }
export function kitFingerprint(p: ProfileDoc, job: JobParse | null, resume?: { id?: string; createdAt?: string; generatedBy?: string } | null): KitFingerprint {
  const edu = (p.education ?? []).filter((e) => e.enabled !== false).map((e) => [e.id, e.degree, e.major, e.school, e.start, e.end, e.expectedConferralDate, e.actualConferralDate]);
  const profileHash = hstr(JSON.stringify([profileFacts(p), edu]));
  const jobHash = job ? hstr(JSON.stringify([job.id, job.rawText, job.title, job.company, job.mustHave, job.niceToHave, job.responsibilities, job.keywords])) : '';
  const resumeHash = resume ? hstr(JSON.stringify([resume.id, resume.createdAt, resume.generatedBy])) : '';
  return { profileHash, jobHash, resumeHash };
}
export type KitReview = { overrideAt: string; textHash: string; issues: number; profileHash?: string; jobHash?: string; resumeHash?: string };
export function makeKitReview(p: ProfileDoc, job: JobParse | null, resume: { id?: string; createdAt?: string; generatedBy?: string } | null | undefined, ex: { coverLetter?: Bi; selfIntro?: Bi }, issues: number): KitReview {
  return { overrideAt: new Date().toISOString(), textHash: kitHash(ex), issues, ...kitFingerprint(p, job, resume) };
}
/** 确认是否仍有效：文本、资料事实、岗位、简历四项指纹都一致；旧确认缺少指纹 → 视为无效 */
export function overrideValid(p: ProfileDoc, job: JobParse | null, resume: { id?: string; createdAt?: string; generatedBy?: string } | null | undefined, ex?: { coverLetter?: Bi; selfIntro?: Bi; kitReview?: KitReview }): boolean {
  const r = ex?.kitReview;
  if (!r || !r.profileHash || !r.jobHash || !r.resumeHash) return false;
  const f = kitFingerprint(p, job, resume);
  return r.textHash === kitHash(ex ?? {}) && r.profileHash === f.profileHash && r.jobHash === f.jobHash && r.resumeHash === f.resumeHash;
}

export function kitExportState(p: ProfileDoc, job: JobParse | null, ex?: { coverLetter?: Bi; selfIntro?: Bi; kitReview?: KitReview }, resume?: { id?: string; createdAt?: string; generatedBy?: string } | null): { hasText: boolean; verdict: KitVerdict; overridden: boolean; exportable: boolean } {
  const hasText = !!(ex?.coverLetter?.zh || ex?.coverLetter?.en || ex?.selfIntro?.zh || ex?.selfIntro?.en);
  const verdict = hasText ? verifyKit(ex ?? {}, buildKitContext(p, job)) : { passed: true, trace: [], issues: [] };
  const overridden = overrideValid(p, job, resume, ex);
  return { hasText, verdict, overridden, exportable: verdict.passed || overridden };
}
