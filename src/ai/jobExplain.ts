import type { JobExplain, JobParse, RequirementExplanation, Settings } from '../types';
import { jobRequirements } from '../joint/jobs';
import { AiError, chatJson } from './provider';

/**
 * 2026-11：岗位要求解读。让 AI 按行业常识解释「这句职责 / 要求到底是什么意思、通常需要什么能力、什么样的经历算对口」。
 * 只读说明：不读取个人资料库，不参与选材和简历内容。只在用户点按钮时调用一次，便宜模型、不开深度思考，结果存在岗位上。
 */
export const EXPLAIN_PROMPT = `你是熟悉各行业招聘的职业顾问，帮应届毕业生读懂岗位描述。下面是某个岗位的职责 / 任职要求，每条有一个 id。
请对每一条用通俗中文解释：
- meaning：这句话在实际工作里具体指什么（1–2 句，举一个典型场景）；
- abilities：做好它通常需要的能力或知识（用顿号分隔，3–5 项，要具体，如“读懂客户技术规格书、基础机械制图、与销售和客户沟通”，不要写“沟通能力强”这类空话）；
- experience：什么样的经历算对口（1–2 句，如课程项目、实习、校内活动等应届生也可能有的经历）。
规则：只依据行业常识解释，不要编造这家公司的内部信息；不确定的地方写“通常”“一般”；不要涉及任何求职者个人信息。
只输出 JSON：{"items":[{"id":"原样复制的 id","meaning":"","abilities":"","experience":""}]}。`;

const clip = (v: unknown, n = 260) => String(v ?? '').trim().slice(0, n);
const label = (r: { text: { zh: string; en: string } }) => r.text.zh.trim() || r.text.en.trim();

/** 当前岗位里还没有（或原文已变化的）要求；用于「补充解读」。 */
export function unexplained(job: JobParse): { id: string; text: string }[] {
  const have = new Map((job.explain?.items ?? []).map((x) => [x.id, x.text]));
  return jobRequirements(job).map((r) => ({ id: r.id, text: label(r) })).filter((r) => have.get(r.id) !== r.text);
}

export async function explainJob(s: Settings, job: JobParse): Promise<JobExplain> {
  const todo = unexplained(job).slice(0, 40);
  if (!todo.length) return job.explain ?? { createdAt: new Date().toISOString(), items: [] };
  const names = job.joint ? job.joint.targets.map((t) => t.name).join(' / ') : (job.title.zh || job.title.en);
  const out = await chatJson<{ items?: { id?: string; meaning?: string; abilities?: string; experience?: string }[] }>(s, [
    { role: 'system', content: '你只输出 JSON。' },
    { role: 'user', content: `${EXPLAIN_PROMPT}\n\n${JSON.stringify({ company: job.company.full || job.company.short, job: names, requirements: todo })}` }],
  { thinking: 'disabled', timeoutMs: 120_000, maxTokens: 8_000 });
  const byId = new Map(todo.map((r) => [r.id, r.text]));
  const seen = new Set<string>();
  const fresh: RequirementExplanation[] = [];
  for (const x of Array.isArray(out?.items) ? out.items : []) {
    const id = String(x?.id ?? '');
    if (!byId.has(id) || seen.has(id)) continue;
    const meaning = clip(x.meaning), abilities = clip(x.abilities), experience = clip(x.experience);
    if (!meaning && !abilities && !experience) continue;
    seen.add(id); fresh.push({ id, text: byId.get(id)!, meaning, abilities, experience });
  }
  if (!fresh.length) throw new AiError('AI 没有返回可用的解读，请稍后重试', 'json');
  const keep = (job.explain?.items ?? []).filter((x) => !seen.has(x.id));
  const order = new Map(jobRequirements(job).map((r, i) => [r.id, i]));
  return { createdAt: new Date().toISOString(), items: [...keep, ...fresh].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)) };
}
