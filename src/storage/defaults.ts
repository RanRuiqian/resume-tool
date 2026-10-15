import type { Settings } from '../types';

export const PROVIDERS = {
  deepseek: { label: 'DeepSeek（推荐，国内直连、便宜）', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', visionModel: '', ocrMode: 'local' as const, keyUrl: 'https://platform.deepseek.com/api_keys' },
  qwen: { label: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus', ocrMode: 'vision' as const, keyUrl: 'https://bailian.console.aliyun.com/' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o-mini', ocrMode: 'vision' as const, keyUrl: 'https://platform.openai.com/api-keys' },
  custom: { label: '其他 OpenAI 兼容服务', baseUrl: '', model: '', visionModel: '', ocrMode: 'local' as const, keyUrl: '' },
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings', demoMode: false, baseUrl: PROVIDERS.deepseek.baseUrl, apiKey: '', model: PROVIDERS.deepseek.model, visionModel: '', translateModel: '', uiLang: 'zh',
  provider: 'deepseek', ocrMode: 'local', setupDone: false,
};

