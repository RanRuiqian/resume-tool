import type { Settings } from '../types';

export class AiError extends Error {}

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: Content }

/** OpenAI 兼容 Chat Completions；请求直连用户配置的服务商（PRD 8） */
export async function chat(s: Settings, messages: ChatMsg[], opts: { model?: string; json?: boolean; timeoutMs?: number } = {}): Promise<string> {
  if (!s.apiKey) throw new AiError('未配置 API Key，请到「设置」页填写，或开启演示模式');
  const url = s.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  try {
    const body: Record<string, unknown> = { model: opts.model || s.model, messages, temperature: 0.2 };
    if (opts.json) body.response_format = { type: 'json_object' };
    const res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` }, body: JSON.stringify(body) });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 401) throw new AiError('API Key 无效（401）');
      if (res.status === 402 || res.status === 429) throw new AiError(`额度不足或请求过于频繁（${res.status}）`);
      throw new AiError(`AI 服务返回错误 ${res.status}: ${txt.slice(0, 300)}`);
    }
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content;
    if (typeof out !== 'string') throw new AiError('AI 返回格式异常');
    return out;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('AI 请求超时');
    throw e;
  } finally { clearTimeout(timer); }
}

export function parseJson<T>(s: string): T {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : s).trim();
  const start = raw.search(/[[{]/);
  try { return JSON.parse(start > 0 ? raw.slice(start) : raw) as T; }
  catch { throw new AiError('AI 输出不是合法 JSON'); }
}

export async function chatJson<T>(s: Settings, messages: ChatMsg[], opts: { model?: string } = {}): Promise<T> {
  try { return parseJson<T>(await chat(s, messages, { ...opts, json: true })); }
  catch (e) {
    // 部分服务不支持 response_format，降级重试一次
    if (e instanceof AiError && /400/.test(e.message)) return parseJson<T>(await chat(s, messages, opts));
    throw e;
  }
}
