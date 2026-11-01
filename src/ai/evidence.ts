import type { Bi, JobParse, Lang, LocalizedText, ProfileDoc } from '../types';
import { lt } from '../locale/text';
import { isResumeSafe } from '../quality/contentQuality';
import { numberTokens } from './consistency';

/**
 * v1.11 简历内容选择（确定性、本地、对所有用户通用）。分四个阶段：
 * A. JD 能力分层：把 JD 的每一条（必备 / 职责 / 优先 / 关键词）映射到能力族，按出现位置加权；
 *    沟通 / 团队 / 文档 / 办公这类通用能力封顶为「一般协作」，不会因为 JD 提到就被抬成核心。
 * B. 候选人证据：每条要点抽取能力族、工具、数字、限定（讨论 / 计划 / 仿真 / 未完成 / 协助）和低价值标记。
 * C. 价值排序：岗位相关度 × 证明力（动作 / 工具 / 结果）× 可靠性 − 低价值惩罚。真实 ≠ 必须写进简历。
 * D. 篇幅分配：按条目价值分配要点数；放不下时先删低价值项，而不是把所有内容平均压缩。
 * 阶段 E（AI 只能重排 / 精简 / 改写 / 翻译这些已选事实）在 generate.ts。
 */
export type Tier = 'must' | 'practice' | 'preferred' | 'general' | 'extra';
export interface Family { key: string; label: Bi; zh: RegExp; en: RegExp; general?: boolean }

const F = (key: string, label: Bi, zh: RegExp, en: RegExp, general = false): Family => ({ key, label, zh, en, general });
export const FAMILIES: Family[] = [
  F('mech_design', { zh: '机械 / 结构设计', en: 'mechanical design' }, /结构设计|机械设计|结构|外壳|壳体|手柄|卡扣|支架|零部件|机械(?!臂|手)|CAD|SolidWorks|\bNX\b|\bUG\b|Creo|Inventor|AutoCAD|CATIA|建模|三维|3D 建模|图纸|工程图|公差|GD&T|BOM|装配体|钣金|模具|电机|发电机/i, /mechanical|structur|enclosure|housing|bracket|snap[- ]fit|CAD\b|SolidWorks|\bNX\b|Creo|Inventor|AutoCAD|CATIA|drawing|toleranc|GD&T|\bBOM|sheet metal|motor|generator/i),
  F('prototype', { zh: '原型制作与验证', en: 'prototyping & validation' }, /原型|样机|3D ?打印|光固化|装配|迭代|试制|验证/, /prototyp|3D[- ]print|resin print|assembl|iterat|build and test|validat/i),
  F('manufacturing', { zh: '制造 / 工艺', en: 'manufacturing' }, /制造|DFM|工艺|加工|生产|量产|注塑|机加工/, /manufactur|DFM|machining|production|injection mold/i),
  F('simulation', { zh: '工程仿真 / 有限元', en: 'engineering simulation' }, /仿真|有限元|FEA|ANSYS|Abaqus|AMESim|Simulink|模拟分析|压力响应|受力分析/i, /simulat|FEA|finite element|ANSYS|Abaqus|AMESim|Simulink|stress analys/i),
  F('hydraulics', { zh: '液压 / 流体', en: 'hydraulics' }, /液压|气动|气压|流体|回路/, /hydraul|pneumat|fluid power/i),
  F('imaging_test', { zh: '成像测试', en: 'imaging tests' }, /成像|图像质量|MTF|SNR|信噪比|FOV|视场|相机|ISO ?12233|畸变|照度|曝光|图像采集/i, /imag(?:e|ing)|MTF|SNR|signal-to-noise|FOV|field of view|camera|ISO ?12233|distortion|illuminat|exposure/i),
  F('vision_algo', { zh: '视觉算法 / 深度学习', en: 'vision algorithms / deep learning' }, /深度学习|机器学习|神经网络|视觉算法|目标检测|YOLO|模型训练/i, /deep learning|machine learning|neural|vision algorithm|object detection|YOLO|model training/i),
  F('programming', { zh: '编程 / 脚本', en: 'programming / scripting' }, /Python|MATLAB|C\+\+|脚本|(?<!离线)编程|OpenCV|自动化测试/i, /Python|MATLAB|C\+\+|script|(?<!offline )programm|OpenCV|test automation|automated test/i),
  F('robot_sim', { zh: '机器人仿真与离线编程', en: 'robot simulation & offline programming' }, /机器人|机械臂|Visual Components|RobotStudio|离线编程|路径|取放|pick|抓取|工作站|节拍|运动学/i, /robot|Visual Components|RobotStudio|offline programming|path|pick[- ]and[- ]place|grasp|workcell|robot cell|cycle[- ]time|kinemat/i),
  F('robot_deploy', { zh: '现场调试 / 部署', en: 'commissioning / deployment' }, /现场调试|调试|部署|实机|实体机器人|ROS/, /commission|on-site|deploy|physical robot|\bROS\b/i),
  F('marine', { zh: '轮机 / 设备维护', en: 'marine engineering / maintenance' }, /轮机|主机|辅机|船舶|拆装|检修|磨损/, /marine|engine overhaul|overhaul|shipyard|wear measurement/i),
  F('research_pub', { zh: '论文发表', en: 'publication' }, /论文|期刊|会议(?:论文)?录用|录用|发表|第一作者|作者：/, /paper|journal|conference|publication|first author|authors?:/i),
  F('documentation', { zh: '技术文档', en: 'technical documentation' }, /文档|报告|技术写作/, /documentation|technical writing|report/i, true),
  F('communication', { zh: '沟通协作', en: 'communication & teamwork' }, /沟通|协作|团队|跨部门|合作/, /communicat|teamwork|team ?work|cross-functional|collaborat|global teams?/i, true),
  F('clerical', { zh: '办公 / 行政事务', en: 'office / clerical' }, /会议纪要|周报|台账|Excel|Word|PowerPoint|PPT|Office|办公|签到|展台|布置/i, /meeting minutes|minutes|weekly report|ledger|Excel|Word\b|PowerPoint|Office|clerical|check-in|booth/i, true),
  F('language', { zh: '语言能力', en: 'language' }, /英语|英文|PTE|雅思|托福|CET/i, /English|PTE|IELTS|TOEFL|CET/i, true),
];
const FAM = new Map(FAMILIES.map((f) => [f.key, f]));
const both = (b?: Bi | LocalizedText) => `${b?.zh ?? ''} ${b?.en ?? ''}`;
/** 否定片段（「未在实体机器人上运行」「not implemented」）不算该能力的证据 */
const NEG_SPAN = /(?:未|没有|尚未|并未|不是)[^，。,;；）)]{0,14}|\b(?:not|never|no)\b[^,.;)]{0,30}/gi;
export const familiesOf = (text: string): string[] => FAMILIES.filter((f) => f.zh.test(text) || f.en.test(text)).map((f) => f.key);

export interface CapabilityModel { weights: Record<string, number>; tiers: Record<string, Tier>; sources: Record<string, string[]>; jdTools: string[]; docRole: boolean }
const TIER_W = { must: 3, practice: 2, preferred: 1.5, keyword: 1 } as const;
const GENERAL_CAP = 0.4;
const DEGREE_ITEM = /本科|学士|硕士|学历|专业|degree|bachelor|master'?s?|\bB\.?Eng|\bB\.?S\b/i;

/** 阶段 A：JD 能力分层 */
export function analyzeJd(job: JobParse): CapabilityModel {
  const w: Record<string, number> = {}; const hits: Record<string, number> = {}; const sources: Record<string, string[]> = {};
  const docRole = /文档|文员|行政|助理|technical writer|documentation (?:engineer|specialist)|assistant|clerk/i.test(both(job.title));
  const add = (items: Bi[] | undefined, tw: number) => (items ?? []).forEach((k) => {
    const t = both(k); if (!t.trim()) return;
    // 「机械工程相关专业本科」这类学历要求只说明专业方向，不代表要有某项具体能力
    const fams = familiesOf(DEGREE_ITEM.test(t) ? '' : t);
    for (const f of fams) { w[f] = Math.max(w[f] ?? 0, tw); hits[f] = (hits[f] ?? 0) + 1; (sources[f] ??= []).push(k.zh || k.en || ''); }
  });
  add(job.mustHave, TIER_W.must); add(job.responsibilities, TIER_W.practice); add(job.niceToHave, TIER_W.preferred); add(job.keywords, TIER_W.keyword);
  add([job.title], TIER_W.practice);
  // 结构化字段没覆盖到的，从 JD 原文补一个低权重（避免解析遗漏）
  for (const f of familiesOf(job.rawText ?? '')) if (!(f in w)) w[f] = 0.5;
  const tiers: Record<string, Tier> = {};
  for (const [f, v0] of Object.entries(w)) {
    let v = v0 + Math.min(0.75, Math.max(0, (hits[f] ?? 1) - 1) * 0.25);
    if (FAM.get(f)?.general && !docRole) { v = Math.min(v, GENERAL_CAP); tiers[f] = 'general'; }
    else tiers[f] = v >= 3 ? 'must' : v >= 2 ? 'practice' : v >= 1 ? 'preferred' : 'extra';
    w[f] = v;
  }
  const jdTools = [...new Set((job.rawText ?? '').match(/\b(?:NX|UG|SolidWorks|Creo|CATIA|Inventor|AutoCAD|ANSYS|Abaqus|AMESim|Simulink|MATLAB|Python|C\+\+|OpenCV|Halcon|ROS2?|RobotStudio|Visual Components|PLC|LabVIEW)\b/gi) ?? [])];
  return { weights: w, tiers, sources, jdTools, docRole };
}
/** 相邻能力：JD 没直接写、但能部分证明相关能力（例如轮机检修 → 机械 / 制造动手能力）。只给部分权重 */
const RELATED: Record<string, Record<string, number>> = {
  marine: { mech_design: 0.4, manufacturing: 0.5, prototype: 0.3 },
  hydraulics: { simulation: 0.5, mech_design: 0.3 },
  robot_sim: { simulation: 0.4 },
  prototype: { manufacturing: 0.5, mech_design: 0.3 },
  manufacturing: { prototype: 0.4 },
};
export const weightOf = (m: CapabilityModel, f: string) => Math.max(m.weights[f] ?? 0, ...Object.entries(RELATED[f] ?? {}).map(([g, k]) => (m.weights[g] ?? 0) * k));
export const tierLabel: Record<Tier, string> = { must: '必备核心', practice: '主要职责', preferred: '优先 / 加分', general: '一般协作', extra: '低价值补充' };

export interface Evidence {
  id: string; entryId: string; section: 'work' | 'projects' | 'education'; entry: Bi; role: Bi;
  text: Bi; families: string[]; tools: string[]; numbers: string[]; qualifiers: string[]; flags: string[]; action: boolean; order: number;
}
const ACTION = /设计|搭建|完成|制作|编写|建立|测量|分析|仿真|修正|优化|迭代|装配|打印|开发|实现|测试|建模|编程|记录|对比|designed|built|completed|wrote|developed|measured|analy[sz]ed|simulated|fixed|optimi[sz]ed|iterated|assembled|printed|implemented|tested|modell?ed|programmed|recorded|compared/i;
const QUALS: [string, RegExp][] = [
  ['讨论 / 设想', /讨论|设想|构想|未实施|未实现|discussed|not implemented|idea of|envision/i],
  ['计划 / 未完成', /计划|拟|未完成|进行中|planned|ongoing|in progress|not (?:yet )?completed/i],
  ['仅仿真', /仅仿真|仅为仿真|未在实体|simulation only|not run on a physical|not on a real/i],
  ['课程', /课程|课设|course/i],
  ['协助 / 参与', /协助|参与|assist|took part|helped|participat/i],
  ['失败', /失败|未成功|放弃|failed|abandon|unsuccessful/i],
];
/** v1.11：简历要点里不放论文完整作者名单（「第一作者」等身份保留）；资料库原文不改 */
export function stripAuthorList(t: string): string {
  return t.replace(/\s*[（(]\s*(?:作者名单|作者|authors?|author list)\s*[:：][^）)]*[）)]/gi, '')
    .replace(/[，,；;]\s*(?:作者名单|作者|authors?)\s*[:：][^。；;.]*/gi, '').trim();
}
const AUTHOR_LIST = /作者[:：]|作者名单|authors?:|author list|(?:[A-Z][a-z]+ [A-Z][a-z]+, ){3,}/i;
const GPA_CONV = /(?:GPA|绩点)[^。]*(?:换算|自行|估算|非官方|converted|self-converted|estimat|unofficial)/i;
const GENERIC = /积极|认真负责|热情|吃苦耐劳|学习能力强|hard-working|passionate|motivated|detail-oriented/i;
const IRRELEVANT_COURSE = /选修|职业生涯|思政|近现代史|马克思|毛泽东|形势与政策|体育|军事理论|Elective|Career Planning|Modern Chinese History|Marxism|Physical Education/i;
const PARAM_UNIT = /\d+(?:\.\d+)?\s*(?:mm|cm|μm|dB|lux|ms|°|℃|cycles\/pixel|lp\/mm|fps|%|MPa|kN|N\b|Hz|kHz|V\b|A\b|W\b|kg|g\b)/gi;
const TOOL_RE = /\b(?:SolidWorks|NX|UG|Creo|CATIA|Inventor|AutoCAD|ANSYS|Abaqus|AMESim|Simulink|MATLAB|Python|C\+\+|OpenCV|Halcon|ROS2?|RobotStudio|Visual Components|PLC|LabVIEW|Excel)\b|ISO ?12233|3D ?打印|3D[- ]print/gi;

/** 阶段 B：候选人证据（每条要点一个；母库不改） */
export function extractEvidence(p: ProfileDoc): Evidence[] {
  const out: Evidence[] = []; let order = 0;
  const push = (section: Evidence['section'], entryId: string, entry: Bi, role: Bi, ctxText: string, bullets: LocalizedText[]) => bullets.forEach((b) => {
    if (!b.id || !isResumeSafe(b.zh || b.en || '')) return;
    const t = both(b); const flags: string[] = [];
    if (/论文|paper|journal|conference/i.test(t) && /录用|发表|accepted|published|作者|author/i.test(t)) flags.push('publication');
    if (AUTHOR_LIST.test(t)) flags.push('author-list');
    if (GPA_CONV.test(t)) flags.push('gpa-unconfirmed');
    if (GENERIC.test(t) && !ACTION.test(t)) flags.push('generic');
    if (section === 'education' && IRRELEVANT_COURSE.test(t)) flags.push('irrelevant-course');
    const params = (lt(b, 'zh', false).match(PARAM_UNIT) ?? []).length || (lt(b, 'en', false).match(PARAM_UNIT) ?? []).length;
    if (params >= 4) flags.push('param-list');
    let fams = familiesOf(t.replace(NEG_SPAN, ' '));
    // 论文条目：能力族只按「论文」本身算，标题里的「结构 / 成像」不算做过这些工作的证据
    if (flags.includes('publication')) fams = ['research_pub'];
    const onlyClerical = fams.length > 0 && fams.every((f) => FAM.get(f)?.general);
    if (onlyClerical && fams.includes('clerical')) flags.push('clerical');
    void ctxText;
    out.push({ id: b.id, entryId, section, entry, role, text: { zh: lt(b, 'zh', false), en: lt(b, 'en', false) }, families: fams,
      tools: [...new Set((t.match(TOOL_RE) ?? []).map((x) => x.replace(/\s+/g, ' ')))], numbers: numberTokens(lt(b, 'zh', false) || lt(b, 'en', false)),
      qualifiers: QUALS.filter(([, re]) => re.test(t)).map(([n]) => n), flags, action: ACTION.test(t), order: order++ });
  });
  for (const e of p.work.filter((x) => x.enabled)) push('work', e.id, { zh: lt(e.company, 'zh'), en: lt(e.company, 'en') }, { zh: lt(e.title, 'zh'), en: lt(e.title, 'en') }, both(e.title) + e.tags.join(' '), e.bullets);
  for (const e of p.projects.filter((x) => x.enabled)) push('projects', e.id, { zh: lt(e.name, 'zh'), en: lt(e.name, 'en') }, { zh: lt(e.role, 'zh'), en: lt(e.role, 'en') }, both(e.name) + e.tags.join(' '), e.bullets);
  for (const e of p.education.filter((x) => x.enabled)) push('education', e.id, { zh: lt(e.school, 'zh'), en: lt(e.school, 'en') }, { zh: lt(e.major, 'zh'), en: lt(e.major, 'en') }, '', e.highlights);
  return out;
}

export interface Ranked extends Evidence { value: number; relevance: number; why: string[] }
/** 阶段 C：价值排序 */
export function rankEvidence(ev: Evidence[], m: CapabilityModel): Ranked[] {
  return ev.map((e) => {
    const ws = e.families.map((f) => weightOf(m, f)).sort((a, b) => b - a);
    const relevance = ws.reduce((s, w, i) => s + w * [1, 0.5, 0.25, 0.15][Math.min(i, 3)], 0);
    const why: string[] = [];
    let proof = 0;
    if (e.action) proof += 0.3;
    if (e.tools.some((t) => m.jdTools.some((j) => j.toLowerCase() === t.toLowerCase()))) proof += 0.25; else if (e.tools.length) proof += 0.15;
    if (e.numbers.length) proof += 0.15;
    let v = relevance * (1 + proof);
    let rel = 1;
    if (e.qualifiers.includes('讨论 / 设想') || e.qualifiers.includes('计划 / 未完成')) { rel *= 0.3; why.push('只是讨论 / 计划，未实施'); }
    if (e.qualifiers.includes('失败')) { rel *= 0.4; why.push('失败方案'); }
    v *= rel;
    if (e.flags.includes('publication')) { const tf = familiesOf(both(e.text).replace(/作者[:：].*|authors?:.*/i, '')).filter((f) => f !== 'research_pub').map((f) => weightOf(m, f)); v = Math.min(2, 0.4 + 0.3 * Math.max(0, ...tf) + weightOf(m, 'research_pub')); why.push('论文：可简要写录用 / 作者顺位，作者名单不作为成果'); }
    if (e.flags.includes('clerical')) { v = Math.min(v, 0.15); why.push('事务性工作'); }
    if (e.flags.includes('generic')) { v -= 0.5; why.push('空泛表述'); }
    if (e.flags.includes('param-list')) { const top = Math.max(0, ...e.families.map((f) => weightOf(m, f))); if (top < 2) { v = Math.min(v, 0.2); why.push('参数清单与岗位关系弱'); } else v *= 0.75; }
    if (e.flags.includes('gpa-unconfirmed')) why.push('GPA 为自行换算 / 未经正式确认');
    if (e.flags.includes('irrelevant-course')) { v = 0; why.push('与岗位无关的课程'); }
    if (!e.families.length && !e.flags.includes('publication')) v = Math.min(v, 0.1);
    return { ...e, value: +v.toFixed(3), relevance: +relevance.toFixed(3), why };
  }).sort((a, b) => b.value - a.value || a.order - b.order);
}

const bigr = (s: string) => { const n = s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''); const set = new Set<string>(); for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2)); return set; };
export const overlapBi = (a: string, b: string) => { const x = bigr(a), y = bigr(b); if (!x.size || !y.size) return 0; let i = 0; x.forEach((v) => { if (y.has(v)) i++; }); return i / (x.size + y.size - i); };

export interface Allocation {
  entries: { kind: 'work' | 'projects' | 'education'; id: string; score: number; core: boolean; bulletIds: string[] }[];
  budgets: Record<string, number>; dropped: { id: string; reason: string }[]; ranked: Ranked[]; model: CapabilityModel;
}
/** 阶段 D：按岗位分配篇幅。先删低价值项；高价值要点给更多字数，低价值要点不进简历（母库保留，可手动勾选） */
export function allocate(p: ProfileDoc, job: JobParse, lang: Lang, targetPages = 1): Allocation {
  const model = analyzeJd(job); const ranked = rankEvidence(extractEvidence(p), model);
  const two = targetPages > 1;
  const total = two ? 18 : 11; const maxProj = two ? 5 : 3;
  const topV = ranked.find((r) => r.section !== 'education')?.value ?? 0;
  const minV = Math.max(0.35, topV * 0.15);
  const dropped: Allocation['dropped'] = [];
  // 条目价值 = 最好的几条要点价值
  const entryScore = new Map<string, number>();
  for (const id of new Set(ranked.map((r) => r.entryId))) { const vs = ranked.filter((r) => r.entryId === id).map((r) => r.value).sort((a, b) => b - a); entryScore.set(id, (vs[0] ?? 0) + 0.5 * (vs[1] ?? 0) + 0.25 * (vs[2] ?? 0)); }
  const work = p.work.filter((x) => x.enabled).map((x) => x.id);
  const projs = p.projects.filter((x) => x.enabled).map((x) => x.id).sort((a, b) => (entryScore.get(b) ?? 0) - (entryScore.get(a) ?? 0));
  const topE = Math.max(0, ...[...work, ...projs].map((id) => entryScore.get(id) ?? 0));
  const keepProj = projs.filter((id, i) => i < maxProj && (entryScore.get(id) ?? 0) >= Math.max(0.5, topE * 0.2));
  const order = [...work, ...keepProj].sort((a, b) => (entryScore.get(b) ?? 0) - (entryScore.get(a) ?? 0));
  const capOf = (id: string) => { const i = order.indexOf(id); const base = two ? [5, 4, 3, 2] : [4, 3, 2, 1]; return base[Math.min(i, base.length - 1)]; };
  const chosen = new Map<string, Ranked[]>(); let n = 0;
  const why = new Map<string, string>();
  const tryAdd = (r: Ranked, cap: number) => {
    const list = chosen.get(r.entryId) ?? [];
    if (n >= total || list.length >= cap) { why.set(r.id, '篇幅有限，优先保留更有价值的要点'); return false; }
    const t = r.text[lang] || r.text.zh || r.text.en;
    if (list.some((x) => overlapBi(x.text[lang] || x.text.zh, t) > 0.45)) { why.set(r.id, '与已选要点重复'); return false; }
    list.push(r); chosen.set(r.entryId, list); n++; why.delete(r.id); return true;
  };
  // 第一轮：岗位相关的高价值要点
  for (const r of ranked) {
    if (r.section === 'education' || !order.includes(r.entryId)) continue;
    if (r.value < minV) { why.set(r.id, r.why[0] ?? '与岗位关系弱'); continue; }
    tryAdd(r, capOf(r.entryId));
  }
  // 第二轮：一页还有空间时，补入部分相关的要点（事务性 / 空泛 / 只讨论过 / 无关课程不补）
  const fillTarget = two ? 14 : 8;
  const LOW = ['clerical', 'generic', 'irrelevant-course'];
  for (const r of ranked) {
    if (n >= fillTarget) break;
    if (r.section === 'education' || chosen.get(r.entryId)?.some((x) => x.id === r.id)) continue;
    if (r.value < 0.25 || r.flags.some((f) => LOW.includes(f)) || r.qualifiers.includes('讨论 / 设想') || r.qualifiers.includes('计划 / 未完成')) continue;
    const isProj = r.section === 'projects';
    if (isProj && !order.includes(r.entryId)) { if (order.filter((id) => !work.includes(id)).length >= maxProj) continue; order.push(r.entryId); }
    tryAdd(r, order.indexOf(r.entryId) < 2 ? capOf(r.entryId) : 2);
  }
  for (const id of projs) if (!order.includes(id)) dropped.push({ id, reason: '与岗位相关度低，默认不放进一页简历（母库保留，可手动勾选）' });
  for (const r of ranked) if (r.section !== 'education' && !chosen.get(r.entryId)?.some((x) => x.id === r.id)) dropped.push({ id: r.id, reason: why.get(r.id) ?? r.why[0] ?? '与岗位关系弱' });
  const budgets: Record<string, number> = {};
  const picked = [...chosen.values()].flat().sort((a, b) => b.value - a.value);
  picked.forEach((r, i) => { budgets[r.id] = i < 4 ? (lang === 'zh' ? 90 : 45) : (lang === 'zh' ? 62 : 32); });
  const finalOrder = order.filter((id) => work.includes(id) || (chosen.get(id) ?? []).length).sort((a, b) => (entryScore.get(b) ?? 0) - (entryScore.get(a) ?? 0));
  const entries: Allocation['entries'] = finalOrder.map((id, i) => ({ kind: work.includes(id) ? 'work' as const : 'projects' as const, id, score: +(entryScore.get(id) ?? 0).toFixed(3), core: i < (two ? 3 : 2) && (entryScore.get(id) ?? 0) >= topE * 0.4 && (entryScore.get(id) ?? 0) > 0,
    bulletIds: (chosen.get(id) ?? []).sort((a, b) => a.order - b.order).map((r) => r.id) }));
  // 教育：GPA 只在不是自行换算 / 未确认时默认保留；无关课程不放
  for (const e of p.education.filter((x) => x.enabled)) {
    const hs = ranked.filter((r) => r.entryId === e.id);
    const ids: string[] = [];
    for (const r of hs.sort((a, b) => a.order - b.order)) {
      const isGpa = /GPA|绩点|均分|平均分|排名|rank/i.test(both(r.text));
      if (isGpa) { if (r.flags.includes('gpa-unconfirmed') && !/GPA|绩点/i.test(job.rawText ?? '')) { dropped.push({ id: r.id, reason: 'GPA 为自行换算 / 未经正式确认，默认不写（可手动勾选）' }); continue; } ids.push(r.id); continue; }
      if (r.flags.includes('irrelevant-course') || r.value < 0.3) { dropped.push({ id: r.id, reason: r.why[0] ?? '与岗位关系弱' }); continue; }
      if (ids.length < (two ? 3 : 2)) ids.push(r.id);
    }
    entries.push({ kind: 'education', id: e.id, score: 0, core: false, bulletIds: ids });
  }
  return { entries, budgets, dropped, ranked, model };
}

const LANG_TEST_RE = /\b(?:PTE|IELTS|TOEFL|TOEIC|Duolingo|CET-?[46]|TEM-?[48])\b|雅思|托福|英语[四六]级|专业英语[四八]级/i;
/** 技能 / 证书 / 奖项：只放与岗位相关的；办公软件、文档写作这类通用技能除非 JD 明确需要，否则不放 */
export function pickSide(p: ProfileDoc, job: JobParse, m: CapabilityModel): { skills: string[]; certificates: string[]; awards: string[] } {
  const raw = `${job.rawText ?? ''} ${[...job.mustHave, ...job.niceToHave, ...job.keywords, ...(job.responsibilities ?? [])].map(both).join(' ')}`;
  const inJd = (t: string) => t.trim().length >= 2 && raw.toLowerCase().includes(t.trim().toLowerCase());
  const score = (t: string) => { const fs = familiesOf(t); return Math.max(0, ...fs.map((f) => (FAM.get(f)?.general ? (inJd(t) ? 0.5 : 0) : weightOf(m, f)))); };
  const sk = p.skills.filter((x) => x.enabled).map((k, i) => ({ id: k.id, i, t: both(k.name), s: score(both(k.name)) + (inJd(k.name.en ?? '') || inJd(k.name.zh ?? '') ? 1 : 0), lang: LANG_TEST_RE.test(both(k.name)) || /语言|language/i.test(both(k.category)) }));
  let skills = sk.filter((x) => x.lang || x.s >= 1).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 8);
  if (skills.length < 3) skills = [...skills, ...sk.filter((x) => !skills.includes(x) && x.s > 0).slice(0, 3 - skills.length)];
  const certificates = p.certificates.filter((x) => x.enabled && (LANG_TEST_RE.test(both(x.name)) || score(both(x.name)) >= 1)).map((x) => x.id);
  const awards = p.awards.filter((x) => x.enabled && score(both(x.name)) >= 1).map((x) => x.id);
  return { skills: skills.sort((a, b) => a.i - b.i).map((x) => x.id), certificates, awards };
}

/** 给 AI 的岗位能力摘要（按层级列出，不含资料） */
export function capabilityBrief(m: CapabilityModel, lang: Lang): { tier: string; capability: string }[] {
  return Object.entries(m.weights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([f]) => ({ tier: tierLabel[m.tiers[f]], capability: FAM.get(f)?.label[lang] ?? f }));
}
export const familyLabel = (f: string, lang: Lang) => FAM.get(f)?.label[lang] ?? f;
export const isGeneralFamily = (f: string) => !!FAM.get(f)?.general;

/**
 * 本地匹配度与缺口（不再采用 AI 自报分数）：
 * matchScore = 有证据覆盖的岗位能力权重 / 全部岗位能力权重（一般协作类不计）；
 * gaps = JD 点名但资料里没有的工具 + 必备 / 加分要求中没有任何证据的条目。
 */
export function coverage(p: ProfileDoc, job: JobParse, m: CapabilityModel, ranked: Ranked[], lang: Lang): { matchScore: number; gaps: string[] } {
  const corpus = JSON.stringify({ w: p.work, pr: p.projects, s: p.skills, e: p.education, c: p.certificates }).toLowerCase();
  const evid = new Set(ranked.filter((r) => r.value > 0 && !r.qualifiers.includes('讨论 / 设想')).flatMap((r) => r.families));
  for (const k of p.skills.filter((x) => x.enabled)) familiesOf(both(k.name)).forEach((f) => evid.add(f));
  let tot = 0, cov = 0;
  for (const [f, w] of Object.entries(m.weights)) { if (FAM.get(f)?.general || w < 1) continue; tot += w; if (evid.has(f)) cov += w; }
  const has = (t: string) => !!t && corpus.includes(t.toLowerCase());
  const gaps: string[] = [];
  for (const t of m.jdTools) if (!has(t)) gaps.push(t);
  for (const k of [...job.mustHave, ...job.niceToHave]) {
    const t = both(k); if (!t.trim()) continue;
    const fs = familiesOf(t).filter((f) => !FAM.get(f)?.general);
    const ok = DEGREE_ITEM.test(t) ? has(k.zh ?? '') || has(k.en ?? '') || /工程|engineering/i.test(corpus) : fs.length ? fs.some((f) => evid.has(f)) : has(k.zh ?? '') || has(k.en ?? '');
    const label = k[lang] || k.zh || k.en || '';
    if (!ok && label && !gaps.some((g) => label.toLowerCase().includes(g.toLowerCase()))) gaps.push(label);
  }
  return { matchScore: tot ? Math.round((cov / tot) * 100) : 0, gaps: [...new Set(gaps)].slice(0, 8) };
}
