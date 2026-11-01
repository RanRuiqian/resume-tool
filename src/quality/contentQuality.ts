import type { Lang, LocalizedText, ProfileDoc, ProjectDossier } from '../types';

/**
 * v1.9 资料内容质量：元信息污染检测 + 本地规范化（纯本地、确定性、幂等）。
 *
 * 四类内容（不升级 Dexie，均为条目上的可选字段，见 docs/DATA_SCHEMA.md）：
 *  A factual_content       → 条目 `factualContent`：被改写 / 移出前的原句存档（不打印）
 *  B resume_ready_content  → `bullets` / `highlights` / `summary`：可直接用于简历的客观表述
 *  C internal_notes        → `notes`：核验说明、写作建议、证据说明、信息不完整提示
 *  D uncertain_facts       → `uncertain`：原文无法确定的事实
 *
 * 检测按「句子 / 分句」进行：只移出元信息分句，同一句里的事实部分保留。
 * 不会因为出现「不确定 / 失败 / 局限」等字样就删除句子——项目里的失败方案、测试局限是技术事实，进入项目档案（dossier）。
 */
export const QUALITY_VERSION = 'q3';

export type MetaKind = 'verify' | 'advice' | 'evidence' | 'disclaimer' | 'selfpraise';
export const META_LABEL: Record<MetaKind, string> = {
  verify: '核验说明', advice: '写作 / 投递建议', evidence: '证据说明', disclaimer: '免责 / 参考说明', selfpraise: '空泛自我评价',
};

// 指向「这段资料本身 / 本人 / 简历」的主语信号：弱模式必须同时出现才算元信息，避免误伤技术句（如「需确认载荷工况」）
const META_SUBJECT = /本人|用户|求职者|你|简历|求职|投递|资料|信息|经历|职责|实际情况|具体情况|真实性|准确性|证据|证明|材料|掌握程度|熟练程度/;
const ZH_RULES: [RegExp, MetaKind, boolean][] = [
  // [模式, 类别, 是否需要同时出现 META_SUBJECT]
  [/以[^，。；]{0,24}为准/, 'verify', true],
  [/(?:请|需|需要|须|有待|尚需|仍需|待)(?:用户|本人|你)?(?:自行|进一步|再次|本人)?(?:确认|核实|核对|考证|查证)/, 'verify', true],
  [/未经(?:核实|确认|证实)|尚未(?:核实|证实)|待核实|待确认|有待(?:确认|核实|验证|考证)/, 'verify', false],
  [/(?:掌握|熟练|熟悉)程度[^，。；]{0,8}(?:待|需|有待|未|不明|不清楚)/, 'verify', false],
  [/仅供参考|供参考|仅作参考|以上(?:信息|内容)?[^，。；]{0,6}(?:参考|准确性)/, 'disclaimer', false],
  [/(?:可能|或许|也许|可)?(?:适用于|适合)[^，。；]{0,16}(?:岗位|职位|求职|投递|方向|工作)/, 'advice', false],
  [/(?:可以|可|能|可用|能够)?(?:作为|用作|当作|视为)[^，。；]{0,12}(?:求职|简历|面试|申请|投递)[^，。；]{0,6}(?:材料|素材|亮点|证明|内容|经历)?/, 'advice', false],
  [/建议[^，。；]{0,14}(?:强调|突出|写入|写进|简历|放在|展示|列出|补充|量化|包装|润色|删除)/, 'advice', false],
  [/(?:尚需|仍需|需要?|须|待|缺少?|没有)补充[^，。；]{0,8}(?:证据|证明|材料|信息|说明|细节|数据)/, 'evidence', false],
  [/(?:证据|证明材料|证明|截图|证书原件|佐证)[^，。；]{0,10}(?:待|需|尚未|未|缺|补充|在[^，。；]{0,8}(?:邮箱|电脑|文件夹|网盘|手机))/, 'evidence', false],
  [/(?:AI|系统|模型)[^，。；]{0,8}(?:推断|推测|生成|整理|识别|补充)/, 'disclaimer', false],
];
const EN_RULES: [RegExp, MetaKind][] = [
  [/\b(?:to be|pending|needs?|requires?|subject to)\s+(?:further\s+)?(?:verification|verified|confirmation|confirmed|checking|checked)\b/i, 'verify'],
  [/\bactual\s+(?:duties|responsibilities|scope|proficiency|role)\b[^.;]{0,40}\b(?:confirm|verif|check)/i, 'verify'],
  [/\b(?:for reference only|for reference purposes)\b/i, 'disclaimer'],
  [/\b(?:may|might|could)\s+be\s+(?:relevant|suitable|applicable|useful)\s+(?:to|for)\b[^.;]{0,30}\b(?:roles?|positions?|jobs?|applications?)/i, 'advice'],
  [/\b(?:could|can|may)\s+be\s+(?:used|highlighted|emphasi[sz]ed|presented)\s+(?:as|in)\b[^.;]{0,30}\b(?:resume|cv|application|job)/i, 'advice'],
  [/\b(?:recommend(?:ed)?|suggest(?:ed)?)\s+(?:to\s+)?(?:highlight|emphasi[sz]|includ|add|quantif)/i, 'advice'],
  [/\b(?:evidence|proof|documentation)\s+(?:is\s+)?(?:needed|required|pending|missing|to be (?:added|provided))\b/i, 'evidence'],
];
const SELF_PRAISE = /认真负责|积极主动|吃苦耐劳|团队合作精神|学习能力强|沟通能力强|抗压能力强|责任心强|勤奋好学|乐于助人|self-motivated|hard-working|team player|detail-oriented|fast learner/i;
const FAILED = /失败|未能|未成功|没有成功|没成功|放弃|不可行|行不通|效果不佳|failed|abandoned|did not work|didn't work|unsuccessful/i;
const LIMIT = /局限|不足之处|限制条件|误差较大|样本量?(?:较|太)?少|仅在实验室|limitation|limited to|only tested/i;
const RECOVERED = /改用|最终|随后|之后|从而|提升|降低|缩短|解决|switched|finally|then|improv|reduc|resolv/i;

const isZh = (s: string) => /[\u4e00-\u9fff]/.test(s);

/** 单个分句是否是元信息；返回类别与命中原因 */
export function detectMeta(clause: string): { kind: MetaKind; reason: string } | null {
  const c = clause.trim(); if (!c) return null;
  for (const [re, kind, needSubj] of ZH_RULES) { const m = re.exec(c); if (m && (!needSubj || META_SUBJECT.test(c))) return { kind, reason: `命中「${m[0]}」` }; }
  for (const [re, kind] of EN_RULES) { const m = re.exec(c); if (m) return { kind, reason: `matched "${m[0]}"` }; }
  // 空泛自我评价：整句短、没有具体对象（数字 / 工具 / 动作宾语）时才算
  if (SELF_PRAISE.test(c) && c.replace(/\s/g, '').length <= (isZh(c) ? 30 : 80) && !/\d|[A-Z]{2,}/.test(c)) return { kind: 'selfpraise', reason: '空泛自我评价，没有具体事实' };
  return null;
}

/** 句子切分：保留结尾标点 */
export function sentences(s: string): string[] {
  // 英文句号后接空格 + 大写字母视为分句（不拆 v1.2 / 3.5 等）
  return (s.replace(/(?<=[a-z0-9)%][.])\s+(?=[A-Z])/g, '\n').match(/[^。！？；;!?\n]+[。！？；;!?]*|\n/g) ?? []).map((x) => x.trim()).filter(Boolean);
}
const clauses = (s: string) => s.split(/(?<=[，,])/).map((x) => x.trim()).filter(Boolean);
const tidy = (s: string) => s.replace(/[，,、]\s*([。；;!?！？]|$)/g, '$1').replace(/^[，,、；;\s]+/, '').replace(/\s{2,}/g, ' ').trim();

export interface Moved { text: string; kind: MetaKind; reason: string }
/** 清洗一段文字：移出元信息分句，其余原样保留 */
export function splitMeta(text: string): { keep: string; moved: Moved[] } {
  const moved: Moved[] = []; const out: string[] = [];
  for (const s of sentences(text)) {
    const hit = detectMeta(s);
    if (!hit) { out.push(s); continue; }
    // 同一句里「事实，元信息」并存：按逗号分句，只移出元信息分句
    const cs = clauses(s); const kept = cs.filter((c) => !detectMeta(c));
    if (cs.length > 1 && kept.length && kept.length < cs.length) {
      out.push(tidy(kept.join('')).replace(/[，,]$/, '') + (/[。.!?！？]$/.test(s) && !/[。.!?！？]$/.test(tidy(kept.join(''))) ? (isZh(s) ? '。' : '.') : ''));
      for (const c of cs.filter((x) => detectMeta(x))) { const h = detectMeta(c)!; moved.push({ text: tidy(c).replace(/[，,]$/, ''), ...h }); }
    } else moved.push({ text: s, ...hit });
  }
  const keep = tidy(out.join(isZh(text) ? '' : ' ')).replace(/[;；，,]\s*$/, moved.length ? (isZh(text) ? '。' : '.') : '$&');
  return { keep: /^[。.；;，,\s]*$/.test(keep) ? '' : keep, moved };
}

/** 简历表述去掉机械的第一人称主语：「我在公司…」→「在公司…」；"I tested" → "Tested" */
export function stripFirstPerson(text: string, lang: Lang): string {
  if (lang === 'zh') return text.replace(/^(?:我|本人|笔者)(?![们方国])\s*(?:主要)?/, '').replace(/^(?:我|本人)(?:负责|参与)/, (m) => m.slice(m.length - 2));
  let t = text.replace(/^I\s+(?:was|am|have been|had been)\s+(?=responsible|in charge|involved|part)/, '').replace(/^I\s+(?=[a-z])/, '');
  if (t !== text) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

export interface Change {
  entryId: string; section: string; path: string; lang?: Lang;
  before: string; after: string;
  /** safe = 移除套话 / 语序 / 备注归类，可批量接受；review = 涉及用户已确认内容或事实，需要单独确认 */
  risk: 'safe' | 'review';
  reason: string;
}

type Entry = Record<string, unknown> & { id: string; notes?: string[]; factualContent?: string[]; userConfirmedAt?: string; dossier?: ProjectDossier };
const addUniq = (a: string[] | undefined, xs: string[]) => { const s = new Set(a ?? []); for (const x of xs) if (x.trim()) s.add(x.trim()); return [...s]; };
const NOTE_PREFIX: Record<MetaKind, string> = { verify: '【核验】', advice: '【建议】', evidence: '【证据】', disclaimer: '【说明】', selfpraise: '【自评】' };
export const noteOf = (m: Moved) => `${NOTE_PREFIX[m.kind]}${m.text.replace(/[。.]$/, '')}`;

/**
 * 对整份资料执行本地规范化。幂等：对结果再次执行不会产生任何变化。
 * - 元信息分句 → notes（不删除）；整条都是元信息的要点 → 从要点移除，原句进 notes 与 factualContent
 * - 第一人称主语 → 去掉（原句存 factualContent）
 * - 项目要点中的失败方案 / 测试局限 → 复制进项目档案（dossier）；纯失败描述从简历要点移出
 * - 用户已确认的文字（status=confirmed 或条目 userConfirmedAt）不自动修改，只生成 review 建议
 */
export function cleanProfile(src: ProfileDoc, opts: { applyReview?: boolean } = {}): { profile: ProfileDoc; changes: Change[] } {
  const p = structuredClone(src); const changes: Change[] = [];
  const confirmed = (e: Entry, t: LocalizedText, l: Lang) => t.status?.[l] === 'confirmed' || (!!e.userConfirmedAt && t.status?.[l] !== 'machine');
  const fixText = (e: Entry, section: string, path: string, t: LocalizedText, { firstPerson }: { firstPerson: boolean }): 'drop' | 'keep' => {
    let allMoved = true, any = false;
    for (const l of ['zh', 'en'] as Lang[]) {
      const v = t[l]; if (!v?.trim()) continue;
      const { keep, moved } = splitMeta(v);
      let next = keep; const reasons = moved.map((m) => `${META_LABEL[m.kind]}移入备注（${m.reason}）`);
      if (firstPerson && next) { const fp = stripFirstPerson(next, l); if (fp !== next) { reasons.push('去掉机械的第一人称主语'); next = fp; } }
      if (next) allMoved = false;
      if (next === v) continue;
      any = true;
      const risk: Change['risk'] = confirmed(e, t, l) ? 'review' : 'safe';
      changes.push({ entryId: e.id, section, path, lang: l, before: v, after: next, risk, reason: reasons.join('；') + (risk === 'review' ? '（这是你确认过的内容，需要单独确认）' : '') });
      if (risk === 'review' && !opts.applyReview) { allMoved = false; continue; }
      e.notes = addUniq(e.notes, moved.map(noteOf));
      e.factualContent = addUniq(e.factualContent, [v]);
      if (next) t[l] = next; else delete t[l];
    }
    return any && allMoved ? 'drop' : 'keep';
  };
  const lists: [string, string][] = [['work', 'bullets'], ['projects', 'bullets'], ['education', 'highlights']];
  for (const [sec, f] of lists) for (const e of p[sec as 'work'] as unknown as Entry[]) {
    const arr = e[f] as LocalizedText[];
    e[f] = arr.filter((b, j) => fixText(e, sec, `${f}[${b.id ?? j}]`, b, { firstPerson: true }) !== 'drop');
    if (sec === 'projects') archiveFailures(e, changes);
  }
  const me = p.profile as unknown as Entry; me.id = 'profile';
  for (const k of ['summary', 'headline'] as const) if (fixText(me, 'profile', k, p.profile[k], { firstPerson: k === 'summary' }) === 'drop') p.profile[k] = {};
  delete (me as { id?: string }).id;
  // 名称类字段（技能 / 证书 / 获奖名称）里的括注元信息：「Python（掌握程度待确认）」
  for (const sec of ['skills', 'certificates', 'awards'] as const) for (const e of p[sec] as unknown as Entry[]) {
    const t = e.name as LocalizedText;
    for (const l of ['zh', 'en'] as Lang[]) {
      const v = t[l]; if (!v) continue;
      const m = /^(.+?)\s*[（(]([^（）()]+)[）)]\s*$/.exec(v);
      if (m && detectMeta(m[2])) {
        const risk: Change['risk'] = confirmed(e, t, l) ? 'review' : 'safe';
        changes.push({ entryId: e.id, section: sec, path: 'name', lang: l, before: v, after: m[1], risk, reason: `名称里的${META_LABEL[detectMeta(m[2])!.kind]}移入备注` });
        if (risk === 'safe' || opts.applyReview) { e.notes = addUniq(e.notes, [noteOf({ text: m[2], ...detectMeta(m[2])! })]); t[l] = m[1]; }
      }
    }
  }
  return { profile: p, changes };
}

/** 项目要点里的失败方案 / 局限：存入项目档案；只描述失败、没有后续结果的要点移出简历候选 */
function archiveFailures(e: Entry, changes: Change[]) {
  const bs = (e.bullets as LocalizedText[]) ?? []; const keep: LocalizedText[] = [];
  for (const b of bs) {
    const v = b.zh || b.en || ''; const failed = FAILED.test(v), limit = LIMIT.test(v);
    if (!failed && !limit) { keep.push(b); continue; }
    const d: ProjectDossier = (e.dossier ??= {});
    if (failed) { d.failedAttempts ??= []; if (!d.failedAttempts.some((x) => x.approach === v)) d.failedAttempts.push({ id: `${b.id ?? e.id}-fa`, approach: v, reason: '' }); }
    else if (!(d.problems ?? '').includes(v)) d.problems = [d.problems, v].filter(Boolean).join('\n');
    if (RECOVERED.test(v)) { keep.push(b); continue; } // 失败后有后续方案 / 结果：保留在简历候选
    e.factualContent = addUniq(e.factualContent, [v]);
    changes.push({ entryId: e.id, section: 'projects', path: `bullets[${b.id}]`, before: v, after: '', risk: 'safe', reason: failed ? '失败方案移入项目档案（失败尝试），不作为简历要点' : '技术局限移入项目档案（问题与局限），不作为简历要点' });
  }
  e.bullets = keep;
}

/** 质量报告：用于整理前后对比与「待处理」汇总 */
export interface QualityReport { polluted: number; pollutedSamples: string[]; firstPerson: number; machine: number; stale: number; uncertain: number; critical: number; unconfirmedImports: number; perFieldTasks: number }
export function qualityReport(p: ProfileDoc, isUnconfirmed: (e: Entry) => boolean = () => false): QualityReport {
  const r: QualityReport = { polluted: 0, pollutedSamples: [], firstPerson: 0, machine: 0, stale: 0, uncertain: 0, critical: 0, unconfirmedImports: 0, perFieldTasks: 0 };
  const look = (t: LocalizedText | undefined) => {
    if (!t) return;
    for (const l of ['zh', 'en'] as Lang[]) {
      const v = t[l]; if (!v) continue;
      if (sentences(v).some((s) => detectMeta(s))) { r.polluted++; if (r.pollutedSamples.length < 5) r.pollutedSamples.push(v); }
      if (stripFirstPerson(v, l) !== v) r.firstPerson++;
      if (t.status?.[l] === 'machine') r.machine++;
      if (t.status?.[l] === 'stale') r.stale++;
    }
  };
  look(p.profile.summary); look(p.profile.headline);
  for (const sec of ['education', 'work', 'projects', 'skills', 'certificates', 'awards'] as const) for (const e of p[sec] as unknown as Entry[]) {
    for (const v of Object.values(e)) { if (Array.isArray(v)) v.forEach((x) => x && typeof x === 'object' && ('zh' in x || 'en' in x) && look(x as LocalizedText)); else if (v && typeof v === 'object' && ('zh' in (v as object) || 'en' in (v as object))) look(v as LocalizedText); }
    const u = (e.uncertain as string[] | undefined) ?? []; r.uncertain += u.length; r.critical += u.filter((x) => x.startsWith('【严重】')).length;
    if (isUnconfirmed(e)) r.unconfirmedImports++;
  }
  r.perFieldTasks = r.machine + r.stale + r.uncertain + r.polluted;
  return r;
}

/** 四类内容视图（只读）：便于调试与测试 */
export function contentView(e: Entry & { bullets?: LocalizedText[]; highlights?: LocalizedText[]; uncertain?: string[] }) {
  return {
    factual_content: e.factualContent ?? [],
    resume_ready_content: [...(e.bullets ?? []), ...(e.highlights ?? [])].map((b) => b.zh || b.en || ''),
    internal_notes: e.notes ?? [],
    uncertain_facts: e.uncertain ?? [],
  };
}

/** 生成简历时的最后一道防线：元信息要点不进入简历 */
export const isResumeSafe = (t: string) => !!t.trim() && !sentences(t).some((s) => detectMeta(s));
