import type { Settings } from '../types';
import { baseUrlProblem, isOfficialDeepSeek } from '../storage/defaults';

export type AiErrorKind = 'nokey' | 'auth' | 'balance' | 'rate' | 'model' | 'timeout' | 'network' | 'server' | 'format' | 'other';
export class AiError extends Error {
  kind: AiErrorKind; status?: number;
  constructor(msg: string, kind: AiErrorKind = 'other', status?: number) { super(msg); this.kind = kind; this.status = status; }
}

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: Content }

/** v1.11：每次调用的用量（不含任何 Key / 正文），供调试面板或测试脚本统计耗时与费用 */
export interface AiUsage { model: string; ms: number; promptTokens?: number; completionTokens?: number; cacheHitTokens?: number; cacheMissTokens?: number; finishReason?: string }
const usageListeners = new Set<(u: AiUsage) => void>();
export function onAiUsage(fn: (u: AiUsage) => void): () => void { usageListeners.add(fn); return () => { usageListeners.delete(fn); }; }

/** OpenAI 兼容 Chat Completions；请求直连用户配置的服务商（PRD 8） */
export async function chat(s: Settings, messages: ChatMsg[], opts: { model?: string; json?: boolean; timeoutMs?: number; maxTokens?: number } = {}): Promise<string> {
  if (!s.apiKey) throw new AiError('尚未启用 API：请到「设置 → AI API 管理」添加或启用一套 API，或开启演示模式', 'nokey');
  const bad = baseUrlProblem(s.baseUrl);
  if (bad) throw new AiError(`已阻止发送请求：${bad}。请到「设置 → AI API 管理」编辑这套配置的 Base URL`, 'other');
  const url = s.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  const t0 = Date.now();
  try {
    const body: Record<string, unknown> = { model: opts.model || s.model, messages, temperature: 0.2 };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
    // DeepSeek 官方接口默认开启思考模式；简历整理 / 生成 / JSON 等普通任务显式关闭，减少延迟与费用（https://api-docs.deepseek.com/guides/thinking_mode ）。
    // 只对 DeepSeek 官方地址发送该参数，其他服务商不受影响。
    if (isOfficialDeepSeek(s)) body.thinking = { type: 'disabled' };
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` }, body: JSON.stringify(body) });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      // 网络中断 / DNS / CORS / 服务不可达：不是 Key 的问题
      throw new AiError('无法连接到 AI 服务（网络中断、地址不可达或服务暂时不可用），请稍后重试', 'network');
    }
    if (!res.ok) {
      const txt = (await res.text().catch(() => '')).replaceAll(s.apiKey, '***');
      throw httpError(res.status, txt);
    }
    const data = await res.json();
    const fin: string | undefined = data?.choices?.[0]?.finish_reason;
    const u = data?.usage ?? {};
    const usage: AiUsage = { model: String(data?.model ?? body.model), ms: Date.now() - t0, promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, cacheHitTokens: u.prompt_cache_hit_tokens, cacheMissTokens: u.prompt_cache_miss_tokens, finishReason: fin };
    usageListeners.forEach((fn) => { try { fn(usage); } catch { /* 统计回调出错不影响主流程 */ } });
    // 输出被 max_tokens 截断时，JSON 往往不完整；明确提示而不是报「格式异常」
    if (fin === 'length') throw new AiError('AI 输出过长被截断（finish_reason=length），请减少一次处理的内容或稍后重试', 'format');
    const out = data?.choices?.[0]?.message?.content;
    if (typeof out !== 'string') throw new AiError('AI 返回格式异常', 'format');
    return out;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('AI 请求超时：服务响应太慢或网络不稳定，请稍后重试', 'timeout');
    throw e;
  } finally { clearTimeout(timer); }
}

/** HTTP 错误 → 友好提示（保留状态码数字，chatJson 的 400 降级依赖它） */
export function httpError(status: number, txt: string): AiError {
  const t = txt.slice(0, 300);
  if (status === 401 || status === 403) return new AiError(`API Key 无效或没有权限（${status}），请检查 Key 是否复制完整`, 'auth', status);
  if (status === 402) return new AiError('账户余额不足（402），请到服务商后台充值', 'balance', status);
  if (status === 429) return new AiError('请求过于频繁或额度用尽（429），请稍后重试', 'rate', status);
  if (status === 404 || /model/i.test(t) && (status === 400 || status === 422)) return new AiError(`模型名称或接口地址可能不正确（${status}）：${t}`, 'model', status);
  if (status >= 500) return new AiError(`AI 服务暂时不可用（${status}），请稍后重试`, 'server', status);
  return new AiError(`AI 服务返回错误 ${status}: ${t}`, 'other', status);
}

/** 连接测试：用给定配置发一次最小真实请求，不改变当前启用配置 */
export async function testConnection(s: Settings): Promise<{ ok: true; ms: number } | { ok: false; kind: AiErrorKind; message: string }> {
  const t0 = Date.now();
  try {
    await chat(s, [{ role: 'user', content: '只回复 OK' }], { timeoutMs: 20000, maxTokens: 8 });
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    const a = e instanceof AiError ? e : new AiError((e as Error).message);
    return { ok: false, kind: a.kind, message: a.message.replaceAll(s.apiKey || '\u0000', '***') };
  }
}

export function parseJson<T>(s: string): T {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : s).trim();
  const start = raw.search(/[[{]/);
  try { return JSON.parse(start > 0 ? raw.slice(start) : raw) as T; }
  catch { throw new AiError('AI 输出不是合法 JSON'); }
}

export async function chatJson<T>(s: Settings, messages: ChatMsg[], opts: { model?: string; maxTokens?: number; timeoutMs?: number } = {}): Promise<T> {
  try { return parseJson<T>(await chat(s, messages, { ...opts, json: true })); }
  catch (e) {
    // 部分服务不支持 response_format，降级重试一次
    if (e instanceof AiError && /400/.test(e.message)) return parseJson<T>(await chat(s, messages, opts));
    throw e;
  }
}
