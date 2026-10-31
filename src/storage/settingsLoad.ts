import type { Settings } from '../types';
import type { ResumeDB } from './db';
import { DEFAULT_SETTINGS, migrateSettings } from './defaults';
import { migrateToProfiles, PROFILE_SNAPSHOT_ID, sanitizeSnapshot } from './apiProfiles';

/**
 * 读取并迁移设置（幂等）：
 * 1) DeepSeek 旧默认模型 deepseek-chat → deepseek-flash（原规则不变）；
 * 2) 旧版单套 API 配置 → 配置列表的一条记录（Key / 模型 / Base URL 原样保留）；
 * 迁移前把不敏感的迁移信息快照到同表的 PROFILE_SNAPSHOT_ID（只写一次；不含明文 Key）。
 * 每次加载还会清理 settings 表里除主记录外所有行的明文 Key（兼容旧版本写入的含 Key 快照），不碰主记录与业务表。
 */
export async function loadSettings(d: ResumeDB): Promise<Settings | null> {
  await scrubSettingsCopies(d);
  const s = await d.settings.get('settings');
  if (!s) return null;
  const m = migrateSettings({ ...DEFAULT_SETTINGS, ...s });
  const mp = migrateToProfiles(m.settings);
  if (mp.migrated && !(await d.settings.get(PROFILE_SNAPSHOT_ID))) {
    await d.settings.put(sanitizeSnapshot(s as unknown as Record<string, unknown>, PROFILE_SNAPSHOT_ID) as unknown as Settings);
  }
  if (m.changed || mp.migrated) await d.settings.put(mp.settings);
  return mp.settings;
}

/** 清理 settings 表中主记录以外的所有行里的 Key（apiKey / apiProfiles[].apiKey），改写为脱敏快照 */
export async function scrubSettingsCopies(d: ResumeDB): Promise<number> {
  const rows = (await d.settings.toArray()) as unknown as Record<string, unknown>[];
  let n = 0;
  for (const r of rows) {
    if (r.id === 'settings') continue;
    if (r.apiKey || r.apiProfiles) { await d.settings.put(sanitizeSnapshot(r, String(r.id)) as unknown as Settings); n++; }
  }
  return n;
}
