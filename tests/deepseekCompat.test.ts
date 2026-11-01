import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, migrateSettings, PROVIDERS, RETIRED_DEEPSEEK_MODEL } from '../src/storage/defaults';
import { chat, chatJson, parseJson, onAiUsage, AiError } from '../src/ai/provider';
import type { Settings } from '../src/types';

// 模拟测试：不访问网络，fetch 被替换为假实现；不使用真实 API Key
const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, apiKey: 'sk-test-fake', setupDone: true, ...o });

describe('DeepSeek 默认模型', () => {
  it('默认使用 deepseek-flash，不再使用已停用的 deepseek-chat', () => {
    expect(PROVIDERS.deepseek.model).toBe('deepseek-flash');
    expect(DEFAULT_SETTINGS.model).toBe('deepseek-flash');
    expect(DEFAULT_SETTINGS.provider).toBe('deepseek');
    expect(DEFAULT_SETTINGS.baseUrl).toBe('https://api.deepseek.com');
    expect(RETIRED_DEEPSEEK_MODEL).toBe('deepseek-chat');
  });
});

describe('已保存设置的迁移规则', () => {
  it('DeepSeek 官方接口 + 旧默认 deepseek-chat → deepseek-flash（生成与翻译模型）', () => {
    const r = migrateSettings(S({ model: 'deepseek-chat', translateModel: 'deepseek-chat' }));
    expect(r.changed).toBe(true); expect(r.settings.model).toBe('deepseek-flash'); expect(r.settings.translateModel).toBe('deepseek-flash');
    expect(r.settings.apiKey).toBe('sk-test-fake');
  });
  it('末尾带斜杠或 /v1 的官方地址同样迁移', () => {
    expect(migrateSettings(S({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/' })).settings.model).toBe('deepseek-flash');
    expect(migrateSettings(S({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' })).settings.model).toBe('deepseek-flash');
  });
  // v1.11：deepseek-reasoner 与 deepseek-chat 同日（2026-07-24）停用，改为迁移（见下方 v1.11 用例）；其他自选模型仍不动
  it('用户自选的其他 DeepSeek 模型不动（deepseek-v4-pro、deepseek-flash）', () => {
    for (const m of ['deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4-flash']) {
      const r = migrateSettings(S({ model: m })); expect(r.changed).toBe(false); expect(r.settings.model).toBe(m);
    }
  });
  it('翻译模型留空时保持留空', () => {
    const r = migrateSettings(S({ model: 'deepseek-chat', translateModel: '' })); expect(r.settings.translateModel).toBe('');
  });
  it('其他服务商不动', () => {
    for (const o of [
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      { provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
      { provider: 'custom', baseUrl: 'https://proxy.example.com/v1', model: 'deepseek-chat' },
    ] as Partial<Settings>[]) { const s = S(o); const r = migrateSettings(s); expect(r.changed).toBe(false); expect(r.settings).toBe(s); }
  });
  it('服务商选 DeepSeek 但填了自定义代理地址：不动（代理可能仍使用旧名）', () => {
    const r = migrateSettings(S({ model: 'deepseek-chat', baseUrl: 'https://my-proxy.example.com' })); expect(r.changed).toBe(false);
  });
});

describe('Chat Completions 请求（模拟 fetch）', () => {
  afterEach(() => vi.unstubAllGlobals());
  const capture = () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    }));
    return calls;
  };
  it('DeepSeek 官方：模型 deepseek-flash，关闭思考模式，JSON 输出，不发送 max_tokens 等多余参数', async () => {
    const calls = capture();
    expect(await chat(S(), [{ role: 'user', content: 'hi' }], { json: true })).toBe('{"ok":true}');
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions');
    expect(calls[0].body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(Object.keys(calls[0].body).sort()).toEqual(['messages', 'model', 'response_format', 'temperature', 'thinking']);
  });
  it('深度选材可以显式使用 Pro 并开启思考模式', async () => {
    const calls = capture();
    await chatJson(S(), [{ role: 'user', content: '返回 JSON {"ok":true}' }],
      { model: 'deepseek-v4-pro', thinking: 'enabled', maxTokens: 12000 });
    expect(calls[0].body).toMatchObject({ model: 'deepseek-v4-pro', thinking: { type: 'enabled' },
      response_format: { type: 'json_object' }, max_tokens: 12000 });
  });
  it('其他服务商不发送 DeepSeek 专用的 thinking 参数', async () => {
    const calls = capture();
    await chat(S({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }), [{ role: 'user', content: 'hi' }]);
    expect(calls[0].body.thinking).toBeUndefined(); expect(calls[0].body.model).toBe('gpt-4o-mini');
  });
});

describe('v1.11 DeepSeek compatibility', () => {
  it('deepseek-reasoner is migrated too; custom providers untouched', () => {
    const s = { ...DEFAULT_SETTINGS, model: 'deepseek-reasoner', translateModel: 'deepseek-chat' };
    const m = migrateSettings(s);
    expect(m.changed).toBe(true); expect(m.settings.model).toBe(PROVIDERS.deepseek.model); expect(m.settings.translateModel).toBe(PROVIDERS.deepseek.model);
    expect(migrateSettings({ ...s, provider: 'custom', baseUrl: 'https://example.com/v1' }).changed).toBe(false);
  });
  it('finish_reason=length raises a clear error and usage is reported without the key', async () => {
    const seen: unknown[] = []; const off = onAiUsage((u) => seen.push(u));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ finish_reason: 'length', message: { content: '{"a":' } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 } }), { status: 200 })));
    const s = { ...DEFAULT_SETTINGS, apiKey: 'sk-test-fake' };
    await expect(chat(s, [{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(AiError);
    expect(seen).toHaveLength(1); expect(JSON.stringify(seen)).not.toContain('sk-test-fake'); expect((seen[0] as { cacheHitTokens: number }).cacheHitTokens).toBe(4);
    off(); vi.unstubAllGlobals();
  });
  it('invalid JSON is retried once instead of silently dropping the step; trailing prose is tolerated', async () => {
    expect(parseJson<{ a: number }>('{"a":1}\n以上为结果。')).toEqual({ a: 1 });
    const outs = ['{"a": 1, "b": ', '{"a":2}']; let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: outs[n++] } }] }), { status: 200 })));
    const s = { ...DEFAULT_SETTINGS, apiKey: 'sk-test-fake' };
    await expect(chatJson<{ a: number }>(s, [{ role: 'user', content: 'x' }])).resolves.toEqual({ a: 2 }); expect(n).toBe(2);
    n = 0; outs[1] = 'still not json';
    await expect(chatJson(s, [{ role: 'user', content: 'x' }])).rejects.toMatchObject({ kind: 'json' }); expect(n).toBe(2);
    vi.unstubAllGlobals();
  });
});
