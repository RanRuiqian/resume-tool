import type { Settings } from '../types';
import type { ResumeDB } from './db';
import { DEFAULT_SETTINGS, migrateSettings } from './defaults';
import { migrateToProfiles, PROFILE_SNAPSHOT_ID } from './apiProfiles';

/**
 * 读取并迁移设置（幂等）：
 * 1) DeepSeek 旧默认模型 deepseek-chat → deepseek-flash（原规则不变）；
 * 2) 旧版单套 API 配置 → 配置列表的一条记录（Key / 模型 / Base URL 原样保留）；
 * 迁移前把原始记录快照到同表的 PROFILE_SNAPSHOT_ID（只写一次；仅本机；备份导出不含 settings 表）。
 */
export async function loadSettings(d: ResumeDB): Promise<Settings | null> {
  const s = await d.settings.get('settings');
  if (!s) return null;
  const m = migrateSettings({ ...DEFAULT_SETTINGS, ...s });
  const mp = migrateToProfiles(m.settings);
  if (mp.migrated && !(await d.settings.get(PROFILE_SNAPSHOT_ID))) {
    await d.settings.put({ ...structuredClone(s), id: PROFILE_SNAPSHOT_ID } as unknown as Settings);
  }
  if (m.changed || mp.migrated) await d.settings.put(mp.settings);
  return mp.settings;
}
