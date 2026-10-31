import type { ApiProfile, ApiProvider, Settings } from '../types';
import { isOfficialDeepSeek, PROVIDERS, RETIRED_DEEPSEEK_MODEL } from './defaults';

/**
 * 多 API 配置管理（纯函数，便于测试）。
 * 存储：apiProfiles / activeProfileId 写在原有 settings 表的同一条 'settings' 记录里 —— 不升级 Dexie、不改业务表。
 * 不变式：Settings 的平铺字段（provider/baseUrl/apiKey/model/translateModel/visionModel）永远等于当前启用配置；
 * 没有启用配置时 apiKey 为空，所有 AI 调用都会报「未配置 API」，绝不会悄悄使用已删除或其他配置的 Key。
 */

export const PROFILE_SNAPSHOT_ID = 'settings-premigrate-profiles-v1';

export function newProfileId(): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `api-${Date.now().toString(36)}-${r}`;
}

/** 脱敏显示：sk-••••••1234；过短的 Key 完全隐藏 */
export function maskKey(k: string): string {
  const v = (k ?? '').trim();
  if (!v) return '（未填写）';
  if (v.length < 10) return '••••••';
  const prefix = /^sk-/i.test(v) ? v.slice(0, 3) : '';
  return `${prefix}••••••${v.slice(-4)}`;
}

export const providerLabel = (p: ApiProvider) => ({ deepseek: 'DeepSeek', qwen: '通义千问', openai: 'OpenAI', custom: '自定义' })[p] ?? p;

/** 预设：选服务商后自动填写推荐 Base URL 与模型 */
export function presetFor(p: ApiProvider): Pick<ApiProfile, 'provider' | 'baseUrl' | 'model' | 'visionModel' | 'translateModel'> {
  const v = PROVIDERS[p];
  return { provider: p, baseUrl: v.baseUrl, model: v.model, visionModel: v.visionModel, translateModel: '' };
}

/** DeepSeek 旧默认模型名迁移（与 migrateSettings 同一规则），用于单条配置 */
function fixRetiredModel(p: ApiProfile): ApiProfile {
  if (!isOfficialDeepSeek(p)) return p;
  const n = { ...p };
  if (n.model.trim() === RETIRED_DEEPSEEK_MODEL) n.model = PROVIDERS.deepseek.model;
  if (n.translateModel.trim() === RETIRED_DEEPSEEK_MODEL) n.translateModel = PROVIDERS.deepseek.model;
  return n;
}

/** 根据启用配置刷新平铺字段（唯一入口，保证不变式） */
export function applyActive(s: Settings): Settings {
  const list = s.apiProfiles ?? [];
  const a = list.find((p) => p.id === s.activeProfileId);
  if (!a) return { ...s, activeProfileId: null, apiKey: '' };
  return { ...s, activeProfileId: a.id, provider: a.provider, baseUrl: a.baseUrl, apiKey: a.apiKey, model: a.model, translateModel: a.translateModel, visionModel: a.visionModel };
}

/**
 * 旧版单套配置 → 配置列表（幂等：已有 apiProfiles 数组则只做模型名修正与不变式刷新）。
 * 旧 Key / 模型 / Base URL / 翻译与视觉模型原样搬入，一条不丢。旧版没填 Key 时得到空列表。
 */
export function migrateToProfiles(s: Settings, now = new Date().toISOString()): { settings: Settings; migrated: boolean } {
  if (Array.isArray(s.apiProfiles)) {
    const fixed = s.apiProfiles.map(fixRetiredModel);
    return { settings: applyActive({ ...s, apiProfiles: fixed }), migrated: false };
  }
  const hasOld = !!(s.apiKey ?? '').trim();
  if (!hasOld) return { settings: applyActive({ ...s, apiProfiles: [], activeProfileId: null }), migrated: true };
  const prov: ApiProvider = (['deepseek', 'qwen', 'openai', 'custom'] as const).includes(s.provider) ? s.provider : 'custom';
  const p: ApiProfile = fixRetiredModel({
    id: newProfileId(), name: `${providerLabel(prov)}（原配置）`, provider: prov,
    baseUrl: s.baseUrl ?? '', apiKey: s.apiKey, model: s.model ?? '', translateModel: s.translateModel ?? '', visionModel: s.visionModel ?? '',
    createdAt: now, updatedAt: now,
  });
  return { settings: applyActive({ ...s, apiProfiles: [p], activeProfileId: p.id }), migrated: true };
}

export interface ProfileDraft { id?: string; name: string; provider: ApiProvider; baseUrl: string; apiKey: string; model: string; translateModel: string; visionModel: string }

/** 校验；返回错误文案数组（空 = 通过）。isNew 时 Key 必填；编辑时 Key 留空表示保留原 Key */
export function validateDraft(d: ProfileDraft, isNew: boolean): string[] {
  const e: string[] = [];
  if (!d.name.trim()) e.push('请填写配置名称');
  if (isNew && !d.apiKey.trim()) e.push('请粘贴 API Key');
  if (!d.model.trim()) e.push('请填写模型名称');
  let u: URL | null = null;
  try { u = new URL(d.baseUrl.trim()); } catch { /* */ }
  if (!u || !/^https?:$/.test(u.protocol)) e.push('Base URL 格式不正确，应以 https:// 开头');
  else if (u.search || u.username || u.password) e.push('Base URL 不能带参数或账号信息（API Key 请填在 Key 输入框，不要放进网址）');
  if (/\s/.test(d.apiKey.trim())) e.push('API Key 中不能有空格或换行');
  return e;
}

/** 新增或编辑。编辑时 Key 留空 → 保留原 Key；不影响其他配置。activate=true 时同时设为启用 */
export function upsertProfile(s: Settings, d: ProfileDraft, opts: { activate?: boolean; now?: string } = {}): { settings: Settings; id: string } {
  const now = opts.now ?? new Date().toISOString();
  const list = [...(s.apiProfiles ?? [])];
  const i = d.id ? list.findIndex((p) => p.id === d.id) : -1;
  const clean = { name: d.name.trim(), provider: d.provider, baseUrl: d.baseUrl.trim().replace(/\/+$/, ''), model: d.model.trim(), translateModel: d.translateModel.trim(), visionModel: d.visionModel.trim() };
  let id: string;
  if (i >= 0) {
    const old = list[i]; id = old.id;
    list[i] = { ...old, ...clean, apiKey: d.apiKey.trim() ? d.apiKey.trim() : old.apiKey, updatedAt: now };
  } else {
    id = newProfileId();
    list.push({ id, ...clean, apiKey: d.apiKey.trim(), createdAt: now, updatedAt: now });
  }
  const n: Settings = { ...s, apiProfiles: list, ...(opts.activate ? { activeProfileId: id, demoMode: false, setupDone: true } : {}) };
  return { settings: applyActive(n), id };
}

/** 一键切换：只改 activeProfileId，并退出演示模式（明确开始真实调用 AI） */
export function activateProfile(s: Settings, id: string): Settings {
  if (!(s.apiProfiles ?? []).some((p) => p.id === id)) return s;
  return applyActive({ ...s, activeProfileId: id, demoMode: false, setupDone: true });
}

/** 删除：Key 随配置一起移除；删除的是当前配置时不自动切换到别的（进入「未启用」状态，由用户选择） */
export function deleteProfile(s: Settings, id: string): Settings {
  const list = (s.apiProfiles ?? []).filter((p) => p.id !== id);
  const active = s.activeProfileId === id ? null : s.activeProfileId ?? null;
  return applyActive({ ...s, apiProfiles: list, activeProfileId: active });
}

/** 某条配置 → 一次请求用的 Settings（连接测试用，不改变启用状态） */
export function settingsForProfile(s: Settings, p: ApiProfile): Settings {
  return { ...s, demoMode: false, provider: p.provider, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, translateModel: p.translateModel, visionModel: p.visionModel };
}

export type AiMode = { kind: 'demo' } | { kind: 'none' } | { kind: 'real'; profile: ApiProfile };
/** 当前是否会真实调用 AI */
export function aiMode(s: Settings): AiMode {
  if (s.demoMode) return { kind: 'demo' };
  const a = (s.apiProfiles ?? []).find((p) => p.id === s.activeProfileId);
  return a && a.apiKey ? { kind: 'real', profile: a } : { kind: 'none' };
}
