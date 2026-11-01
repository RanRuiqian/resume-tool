// v1.9.3 虚构数据集：结构模仿一次真实整理（约 65 条文字），全部为虚构人物 / 单位 / 成果
import type { ProfileDoc } from '../../src/types';
import { emptyProfile } from '../../src/storage/profileIO';

export const DISC = '实际职责以本人核实为准。';
export const CASE_A = '完成项目交付成果：硬件原型、Windows 软件、展示照片、视频、完整 Demo、GitHub 项目和技术报告。';
export const CASE_B = '原型核心材料估算成本约22美元，不代表经过验证的量产成本或零售价。';
export const CASE_C = '历史平均分约77/100，GPA约2.7/4.0，属于历史估算，并非官方成绩单计算结果。';
export const CASE_D = '与示例医院医生讨论过可变焦需求，尚未实现可变焦功能。';
export const KFC = '本科期间曾在肯德基兼职。';
/** 每条都必须在整理后原样可找到的关键事实 */
export const KEY_FACTS = ['硬件原型', 'Windows 软件', '展示照片', '视频', '完整 Demo', 'GitHub 项目', '技术报告', '估算成本约22美元', '不代表经过验证的量产成本或零售价', '约77/100', 'GPA约2.7/4.0', '属于历史估算', '并非官方成绩单计算结果', '讨论过可变焦需求', '尚未实现', '曾在肯德基兼职', '室温', '三人团队', '协助'];

type B = { id: string; zh: string; en?: string; status: Record<string, string>; source?: 'zh' };
const b = (id: string, zh: string, en?: string, enSt?: string): B => ({ id, zh, ...(en !== undefined ? { en } : {}), status: { zh: 'manual', ...(en !== undefined ? { en: enSt ?? 'machine' } : {}) } });

export function realRunLike(): ProfileDoc {
  const p = emptyProfile();
  p.profile.name = { zh: '测试用户十二' }; (p.profile as unknown as { email: string }).email = 't12@example.com';
  // 30 条干净、事实完整的条目（含 A–D、肯德基），英文多为机翻 —— 应全部「无需修改」
  const clean = [CASE_A, CASE_B, CASE_C, CASE_D, KFC, '仅在室温条件下完成样机标定。', '参与三人团队完成耳镜结构设计。', '协助维护自动化生产设备。',
    ...Array.from({ length: 22 }, (_, i) => `在示例测控公司完成第${i + 1}组传感器标定，记录误差并整理测试报告。`)];
  // 15 条带说明句（其中 4 条是 A–D 的「脏」版本，用于检验 AI 删事实时的拦截与重试）
  const polluted = [CASE_A, CASE_B, CASE_C, CASE_D, ...Array.from({ length: 11 }, (_, i) => `完成第${i + 1}轮夹具装配测试。`)].map((x) => `${x}${DISC}`);
  // 8 条第一人称
  const first = Array.from({ length: 8 }, (_, i) => `我在实验室搭建第${i + 1}套数据采集流程。`);
  // 7 条缺英文 + 5 条英文过期（需要补译）
  const noEn = Array.from({ length: 7 }, (_, i) => `协助整理第${i + 1}批实验数据。`);
  const stale = Array.from({ length: 5 }, (_, i) => `参与开发第${i + 1}版上位机软件。`);
  let n = 0; const id = () => `r-b${++n}`;
  const bullets: B[] = [
    ...clean.map((x, i) => b(id(), x, `Machine translation ${i + 1}.`)),
    ...polluted.map((x) => b(id(), x)),
    ...first.map((x) => b(id(), x)),
    ...noEn.map((x) => b(id(), x)),
    ...stale.map((x, i) => b(id(), x, `Old translation ${i + 1}.`, 'stale')),
  ];
  const per = Math.ceil(bullets.length / 5);
  p.projects = Array.from({ length: 5 }, (_, k) => ({ id: `rp${k}`, enabled: true, name: { zh: `示例项目${k + 1}` }, role: { zh: '组员' }, kind: 'core', nature: '个人项目', start: '2025-01', end: '2025-06', tags: [], link: `https://example.com/p${k}`, bullets: bullets.slice(k * per, (k + 1) * per) })) as never;
  return p;
}

/** 模拟 DeepSeek 的坏习惯：删「曾」、删并列成果、删估算 / 非官方、讨论 → 实现、协助 → Led；收到 lostFacts（重试）时一半条目改正、一半继续犯错 */
export function badAi(items: { key: string; zh: string; en: string; needEn?: boolean; lostFacts?: string[] }[]) {
  return items.map((x, i) => {
    const retry = !!x.lostFacts; const fixes = retry && i % 2 === 0;
    let zh = x.zh.replace('曾在', '在');
    if (!fixes) zh = zh.replace('、展示照片、视频、完整 Demo、GitHub 项目', '').replace(/原型核心材料估算成本约22美元，不代表经过验证的量产成本或零售价。/, '产品成本仅22美元。').replace('，属于历史估算，并非官方成绩单计算结果', '').replace('讨论过可变焦需求，尚未实现可变焦功能', '实现了可变焦功能');
    zh = zh.replace(/^我/, '');
    let en = x.en;
    if (x.needEn) en = /协助整理第[12]批/.test(x.zh) ? 'Led the organization of experimental data' : /协助整理第(\d+)批/.test(x.zh) ? `Assisted in organizing batch ${/第(\d+)批/.exec(x.zh)![1]} of experimental data` : /参与开发第(\d+)版/.test(x.zh) ? `Participated in developing version ${/第(\d+)版/.exec(x.zh)![1]} of the host software` : en;
    return { key: x.key, category: 'resume', zh, en, notes: [], archive: [], uncertain: [] };
  });
}
