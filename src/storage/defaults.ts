import type { Settings } from '../types';

export const PROVIDERS = {
  deepseek: { label: 'DeepSeek（推荐，国内直连、便宜）', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', visionModel: '', ocrMode: 'local' as const, keyUrl: 'https://platform.deepseek.com/api_keys' },
  qwen: { label: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus', ocrMode: 'vision' as const, keyUrl: 'https://bailian.console.aliyun.com/' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o-mini', ocrMode: 'vision' as const, keyUrl: 'https://platform.openai.com/api-keys' },
  custom: { label: '其他 OpenAI 兼容服务', baseUrl: '', model: '', visionModel: '', ocrMode: 'local' as const, keyUrl: '' },
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings', demoMode: false, baseUrl: PROVIDERS.deepseek.baseUrl, apiKey: '', model: PROVIDERS.deepseek.model, visionModel: '', translateModel: '', uiLang: 'zh',
  provider: 'deepseek', ocrMode: 'local', setupDone: false,
};


/** DeepSeek 官方已停用的旧默认模型名（2026-04-24 公告，2026-07-24 停用；见 https://api-docs.deepseek.com/updates ） */
export const RETIRED_DEEPSEEK_MODEL = 'deepseek-chat';
/**
 * API 地址安全检查：只允许 https://；http:// 仅限明确的本机回环地址（localhost / 127.0.0.1 / [::1]）供本地开发代理使用。
 * 返回 null 表示通过，否则返回中文提示。
 */
export function baseUrlProblem(raw: string): string | null {
  let u: URL;
  try { u = new URL((raw ?? '').trim()); } catch { return 'Base URL 格式不正确，应以 https:// 开头'; }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:') {
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname.toLowerCase())) return null;
    return '为保护 API Key，只能使用 https:// 开头的 API 地址（http:// 会明文传输 Key）。仅本机开发代理（localhost / 127.0.0.1）可以使用 http://';
  }
  return 'Base URL 格式不正确，应以 https:// 开头';
}

/** 是否为 DeepSeek 官方接口（自建代理 / 其他服务商不算） */
export function isOfficialDeepSeek(s: Pick<Settings, 'provider' | 'baseUrl'>): boolean {
  return s.provider === 'deepseek' && /^https:\/\/api\.deepseek\.com(\/v1)?\/?$/i.test((s.baseUrl ?? '').trim());
}
/**
 * 已保存设置的兼容迁移（只在内存与 settings 记录中改模型名，不改数据库结构）：
 * 仅当服务商为 DeepSeek 官方接口、且模型名正好是已停用的旧默认值 deepseek-chat 时，改为当前默认模型。
 * 其他服务商、自定义地址、用户自己填写的其他模型名一律不动。
 */
export function migrateSettings(s: Settings): { settings: Settings; changed: boolean } {
  if (!isOfficialDeepSeek(s)) return { settings: s, changed: false };
  const n = { ...s }; let changed = false;
  if (n.model?.trim() === RETIRED_DEEPSEEK_MODEL) { n.model = PROVIDERS.deepseek.model; changed = true; }
  if (n.translateModel?.trim() === RETIRED_DEEPSEEK_MODEL) { n.translateModel = PROVIDERS.deepseek.model; changed = true; }
  return { settings: changed ? n : s, changed };
}
