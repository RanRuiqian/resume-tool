import type { ResumeDB } from './db';
import type { ProfileDoc } from '../types';
import { emptyProfile } from './profileIO';

/** 仅在明确清空时换代；旧页面/异步任务不能跨代写回资料或生成缓存。 */
export const PROFILE_EPOCH_KEY = 'profileClearEpoch';
export class StaleProfileWriteError extends Error {
  constructor() { super('个人资料已清空，旧操作已取消；请使用新资料重新操作。'); this.name = 'StaleProfileWriteError'; }
}
export const epochValue = (row: { value: unknown } | undefined) => typeof row?.value === 'string' ? row.value : '';
export async function profileEpoch(d: ResumeDB): Promise<string> { return epochValue(await d.state.get(PROFILE_EPOCH_KEY)); }
/** 必须在包含 state 的同一写事务内检查，避免先检查后清空再写入的竞态。 */
export async function assertProfileEpoch(d: ResumeDB, expected: string) {
  if (await profileEpoch(d) !== expected) throw new StaleProfileWriteError();
}
export async function persistProfile(d: ResumeDB, doc: ProfileDoc, expected: string) {
  await d.transaction('rw', d.profile, d.state, async () => { await assertProfileEpoch(d, expected); await d.profile.put({ id: 'me', doc }); });
}
/** 不建立回滚快照，不清库。求职记录及其只读投递版本、设置、模板和 JD 原样保留。 */
export async function clearPersonalData(d: ResumeDB): Promise<{ doc: ProfileDoc; epoch: string }> {
  const doc = emptyProfile(), epoch = globalThis.crypto?.randomUUID?.() ?? `clear-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await d.transaction('rw', [d.profile, d.backups, d.resumes, d.exports, d.state], async () => {
    await d.profile.clear(); await d.profile.put({ id: 'me', doc });
    await d.backups.clear(); await d.resumes.clear(); await d.exports.clear();
    await d.state.put({ id: 'resumeId', value: '' });
    await d.state.put({ id: PROFILE_EPOCH_KEY, value: epoch });
  });
  return { doc, epoch };
}
