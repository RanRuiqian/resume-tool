/**
 * 备份里的「设置」部分：API 配置（不含 Key）+ 可选的「用密码加密的 Key」。
 *
 * 规则（负责人 2026-11-03 决定，用于换设备）：
 * - Key 默认不导出；只有用户勾选并设置密码时才导出，且只以 AES-GCM 密文形式存在（PBKDF2-SHA256 派生密钥）。
 * - 明文 Key 永不写入备份文件；settings.json 本身仍经过 scrubSecrets。
 * - 恢复时先解密校验密码，密码错误不写入任何数据。
 */
import { applyActive } from '../storage/apiProfiles';
import type { ApiProfile, Settings } from '../types';

export type ApiProfileNoKey = Omit<ApiProfile, 'apiKey'>;
export interface SettingsArchive {
  uiLang: Settings['uiLang']; ocrMode: Settings['ocrMode'];
  activeProfileId: string | null;
  apiProfiles: ApiProfileNoKey[];
}
export interface EncryptedKeys {
  alg: 'AES-GCM-256'; kdf: 'PBKDF2-SHA256'; iterations: number;
  salt: string; iv: string; data: string; count: number;
}
export const KEY_ITERATIONS = 250_000;
export const MIN_KEY_PASSWORD = 6;

export function settingsArchive(s: Settings): SettingsArchive {
  return {
    uiLang: s.uiLang, ocrMode: s.ocrMode, activeProfileId: s.activeProfileId ?? null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    apiProfiles: (s.apiProfiles ?? []).map(({ apiKey, ...rest }) => rest),
  };
}

const b64 = (u: Uint8Array) => { let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** 把各配置的 Key（id → key）用密码加密；没有任何 Key 时返回 null */
export async function encryptKeys(s: Settings, password: string, iterations = KEY_ITERATIONS): Promise<EncryptedKeys | null> {
  if (password.length < MIN_KEY_PASSWORD) throw new Error(`加密密码至少 ${MIN_KEY_PASSWORD} 位`);
  const map = Object.fromEntries((s.apiProfiles ?? []).filter((p) => p.apiKey).map((p) => [p.id, p.apiKey]));
  const count = Object.keys(map).length; if (!count) return null;
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(map))));
  return { alg: 'AES-GCM-256', kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(ct), count };
}

/** 解密；密码错误或文件被改动时抛出「密码不正确」 */
export async function decryptKeys(e: EncryptedKeys, password: string): Promise<Record<string, string>> {
  try {
    const key = await deriveKey(password, unb64(e.salt), e.iterations);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) as BufferSource }, key, unb64(e.data) as BufferSource);
    const m = JSON.parse(new TextDecoder().decode(pt));
    if (!m || typeof m !== 'object') throw new Error('bad');
    return Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  } catch { throw new Error('API Key 解密失败：密码不正确，或备份文件已损坏。没有写入任何数据。'); }
}

export function isSettingsArchive(v: unknown): v is SettingsArchive {
  return !!v && typeof v === 'object' && Array.isArray((v as SettingsArchive).apiProfiles);
}
export function isEncryptedKeys(v: unknown): v is EncryptedKeys {
  const e = v as EncryptedKeys;
  return !!e && typeof e === 'object' && e.alg === 'AES-GCM-256' && typeof e.salt === 'string' && typeof e.iv === 'string' && typeof e.data === 'string' && typeof e.iterations === 'number';
}

export interface SettingsMerge { settings: Settings; added: number; replaced: number; skipped: number; keys: number }
/**
 * 合并到本机设置：同 id 的配置默认跳过（overwrite 时替换，替换时备份里没有 Key 则保留本机 Key）。
 * 本机没有启用配置时，启用备份里的启用配置（需有 Key），否则第一个有 Key 的导入配置。
 */
export function mergeSettings(cur: Settings, inc: SettingsArchive, keys: Record<string, string>, overwrite: boolean): SettingsMerge {
  const list = [...(cur.apiProfiles ?? [])];
  let added = 0, replaced = 0, skipped = 0, nkeys = 0; const imported: ApiProfile[] = [];
  for (const p of inc.apiProfiles) {
    if (!p || typeof p.id !== 'string') continue;
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0 && !overwrite) { skipped++; continue; }
    const apiKey = keys[p.id] ?? (i >= 0 ? list[i].apiKey : '');
    if (keys[p.id]) nkeys++;
    const row: ApiProfile = { ...p, apiKey };
    if (i >= 0) { list[i] = row; replaced++; } else { list.push(row); added++; }
    imported.push(row);
  }
  let active = cur.activeProfileId ?? null;
  if (!active || !list.some((p) => p.id === active && p.apiKey)) {
    const pick = imported.find((p) => p.id === inc.activeProfileId && p.apiKey) ?? imported.find((p) => p.apiKey);
    if (pick) active = pick.id;
  }
  const activated = active !== (cur.activeProfileId ?? null);
  const n: Settings = { ...cur, uiLang: inc.uiLang ?? cur.uiLang, ocrMode: inc.ocrMode ?? cur.ocrMode, apiProfiles: list, activeProfileId: active, ...(activated ? { demoMode: false, setupDone: true } : {}) };
  return { settings: applyActive(n), added, replaced, skipped, keys: nkeys };
}
