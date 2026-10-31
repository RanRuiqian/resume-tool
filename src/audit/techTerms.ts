import type { ProfileDoc } from '../types';
import { lt } from '../locale/text';

/**
 * 本地技术词许可清单（B4）。确定性规则，不调用 AI。
 * 许可清单只说明「资料里有使用记录」，不代表熟练程度。
 * 来源：用户填写的技能；工作 / 项目 tags；项目档案 tools / keywords；术语表（用户确认的专有名词）；经历要点原文中出现的技术词。
 * 明确不使用：专业名称、课程、岗位 JD。
 */

/** 只做拼写 / 缩写变体的规范化；相关但不同的技术（如 PyTorch 与 TensorFlow、YOLOv5 与 YOLOv8）绝不视为等价 */
const SYNONYMS: Record<string, string> = {
  js: 'javascript', ts: 'typescript', golang: 'go', k8s: 'kubernetes', postgres: 'postgresql', pg: 'postgresql',
  'c#': 'csharp', 'c sharp': 'csharp', 'cpp': 'c++', 'cplusplus': 'c++', 'node': 'nodejs', 'node.js': 'nodejs', 'react.js': 'react', 'reactjs': 'react',
  'vue.js': 'vue', 'vuejs': 'vue', 'sklearn': 'scikit-learn', 'scikitlearn': 'scikit-learn', 'tf': 'tensorflow', 'cv2': 'opencv', 'open cv': 'opencv',
  'ros 2': 'ros2', 'matlab/simulink': 'matlab', 'ms excel': 'excel', 'microsoft excel': 'excel', 'power bi': 'powerbi', 'mysql数据库': 'mysql',
};
export function normTerm(s: string): string {
  let x = s.trim().toLowerCase().replace(/[\s_]+/g, ' ');
  if (SYNONYMS[x]) return SYNONYMS[x];
  x = x.replace(/[\s\-_]/g, '').replace(/\.js$/, 'js');
  return SYNONYMS[x] ?? x;
}

/** 常见技术名词词典（用于从文本里识别技术词；不在词典里的英文词按形态识别：含数字 / 驼峰 / 全大写缩写 / + #） */
const DICT = [
  'python', 'java', 'javascript', 'typescript', 'go', 'rust', 'c++', 'csharp', 'matlab', 'r', 'sql', 'scala', 'kotlin', 'swift', 'php', 'ruby', 'bash', 'shell',
  'opencv', 'pytorch', 'tensorflow', 'keras', 'scikit-learn', 'pandas', 'numpy', 'scipy', 'spark', 'hadoop', 'hive', 'flink', 'kafka', 'airflow',
  'react', 'vue', 'angular', 'nodejs', 'django', 'flask', 'fastapi', 'spring', 'springboot', 'docker', 'kubernetes', 'linux', 'git', 'jenkins',
  'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'excel', 'tableau', 'powerbi', 'spss', 'sas', 'stata',
  'ros', 'ros2', 'gazebo', 'solidworks', 'autocad', 'ansys', 'abaqus', 'comsol', 'labview', 'plc', 'stm32', 'arduino', 'fpga', 'verilog', 'simulink',
  'cuda', 'tensorrt', 'onnx', 'yolo', 'transformer', 'bert', 'llm', 'langchain', 'aws', 'azure', 'gcp', 'unity', 'unreal', 'qt', 'halcon',
];
const ZH_DICT = ['深度学习', '机器学习', '强化学习', '计算机视觉', '自然语言处理', '大模型', '知识图谱', '数字孪生', '边缘计算', '点云', '激光雷达', '有限元', '神经网络', '卷积神经网络', '图像分割', '目标检测', '语义分割', 'SLAM'];
const DICTSET = new Set(DICT);
/** 普通英文词：形态像技术词也不算（避免误报） */
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'by', 'with', 'via', 'from', 'as', 'at', 'it', 'is', 'kpi', 'okr', 'ok', 'q1', 'q2', 'q3', 'q4', 'b2b', 'b2c', 'ai', 'it', 'ui', 'ux', 'pc', 'id', 'hr', 'pm', 'ceo', 'cto', 'mvp', 'roi', 'gmv', 'dau', 'mau', 'ab', 'a/b', 'etc', 'i', 'ii', 'iii', 'iv', 'v1', 'v2', 'v3']);

export function extractTechTerms(text: string): string[] {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9+#.-]*[A-Za-z0-9+#]|[A-Za-z]\b/g)) {
    const raw = m[0].replace(/\.$/, ''); const n = normTerm(raw);
    if (!n || STOP.has(n)) continue;
    const looksTech = DICTSET.has(n) || /\d/.test(raw) || /[+#]/.test(raw) || /[a-z][A-Z]/.test(raw) || (/^[A-Z]{2,}$/.test(raw) && raw.length <= 8);
    if (n === 'r' && !/\bR\b/.test(raw)) continue;
    if (n.length === 1 && n !== 'r') continue;
    if (looksTech) out.set(n, raw);
  }
  for (const w of ZH_DICT) if (text.includes(w)) out.set(normTerm(w), w);
  return [...out.values()];
}

/** AI 智能导入新增或合并、且用户还没有在资料库中确认的条目：其标签 / 工具 / 要点不能作为可靠证据 */
export function isUnconfirmedImport(e: { importedFrom?: { at: string }; mergeHistory?: { at: string }[]; userConfirmedAt?: string }): boolean {
  const last = [e.importedFrom?.at, ...(e.mergeHistory ?? []).map((m) => m.at)].filter((x): x is string => !!x).sort().pop();
  if (!last) return false;
  return !e.userConfirmedAt || e.userConfirmedAt < last;
}
export interface UnconfirmedRef { why: string; entryId: string }
export interface Allowlist {
  /** 可靠来源：用户填写或已确认的资料 */
  terms: Map<string, string[]>;
  /** 未确认来源：只出现在 AI 导入、尚未确认的资料里（展示用，不作为可靠证据） */
  unconfirmed: Map<string, UnconfirmedRef[]>;
}
/** 构建许可清单；每个词记录来源说明，便于在界面上解释 */
export function buildAllowlist(p: ProfileDoc): Allowlist {
  const terms = new Map<string, string[]>();
  const unconfirmed = new Map<string, UnconfirmedRef[]>();
  const add = (t: string, why: string, e?: { id: string } & Parameters<typeof isUnconfirmedImport>[0]) => {
    const n = normTerm(t); if (!n) return;
    if (e && isUnconfirmedImport(e)) { const a = unconfirmed.get(n) ?? []; if (!a.some((x) => x.entryId === e.id && x.why === why)) a.push({ why, entryId: e.id }); unconfirmed.set(n, a); return; }
    terms.set(n, [...new Set([...(terms.get(n) ?? []), why])]);
  };
  const both = (x: { zh?: string; en?: string }) => [x.zh, x.en].filter((v): v is string => !!v);
  for (const k of p.skills) for (const n of both(k.name)) add(n, '技能', k);
  for (const w of p.work) { w.tags.forEach((t) => add(t, `工作「${lt(w.company, 'zh')}」标签`, w)); for (const b of w.bullets) for (const s of both(b)) extractTechTerms(s).forEach((t) => add(t, `工作「${lt(w.company, 'zh')}」要点`, w)); }
  for (const pr of p.projects) {
    pr.tags.forEach((t) => add(t, `项目「${lt(pr.name, 'zh')}」标签`, pr));
    for (const b of pr.bullets) for (const s of both(b)) extractTechTerms(s).forEach((t) => add(t, `项目「${lt(pr.name, 'zh')}」要点`, pr));
    (pr.dossier?.tools ?? []).forEach((t) => add(t, `项目「${lt(pr.name, 'zh')}」档案工具`, pr));
    (pr.dossier?.keywords ?? []).forEach((t) => add(t, `项目「${lt(pr.name, 'zh')}」档案关键词`, pr));
  }
  for (const g of p.glossary ?? []) { if (g.zh) add(g.zh, '术语表'); if (g.en) add(g.en, '术语表'); }
  // 注意：不使用 education.major / courses / abilities，也不使用岗位 JD
  return { terms, unconfirmed };
}

/** 改写中出现、但原文和许可清单里都没有的技术词 */
export function unknownTerms(rewrite: string, original: string, allow: Allowlist): string[] {
  const orig = new Set(extractTechTerms(original).map(normTerm));
  return extractTechTerms(rewrite).filter((t) => { const n = normTerm(t); return !orig.has(n) && !allow.terms.has(n); });
}
/** 改写中出现、原文没有、但许可清单里有的技术词（来源于其它经历：需要关注是否张冠李戴） */
export function borrowedTerms(rewrite: string, original: string, allow: Allowlist): string[] {
  const orig = new Set(extractTechTerms(original).map(normTerm));
  return extractTechTerms(rewrite).filter((t) => { const n = normTerm(t); return !orig.has(n) && allow.terms.has(n); });
}
