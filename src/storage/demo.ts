import type { JobParse, ProfileDoc, ResumeDoc, Settings } from '../types';
import { PROFILE_EPOCH_KEY } from './clearProfile';
import { emptyProfile } from './profileIO';
import type { ResumeDB } from './db';
import { DEFAULT_SETTINGS } from './defaults';
import { normalizeProfile } from './profileIO';
import sample from '../sample/sample-profile.json';
import { SAMPLE_JD } from '../sample/sampleJd';
import { parseJdRules } from '../ai/jd';
import { generateRules, runConsistency } from '../ai/generate';
import { BUILTIN_TEMPLATES } from '../templates';

/** 给演示数据库写入示例资料。调用方必须传入演示库；传入真实库会直接报错。 */
export async function seedDemo(d: ResumeDB): Promise<{ profile: ProfileDoc; job: JobParse | null; resume: ResumeDoc | null; settings: Settings }> {
  if (!d.name.endsWith('-demo')) throw new Error('seedDemo 只能写入演示数据库');
  // 明确清空后刷新演示页也不能重新注入示例或重置已保存的 API 设置。
  if (await d.state.get(PROFILE_EPOCH_KEY)) {
    const [p, settings, jid, rid] = await Promise.all([d.profile.get('me'), d.settings.get('settings'), d.state.get('jobId'), d.state.get('resumeId')]);
    return { profile: p?.doc ?? emptyProfile(), settings: settings ?? { ...DEFAULT_SETTINGS, demoMode: true, setupDone: true },
      job: typeof jid?.value === 'string' ? await d.jobs.get(jid.value) ?? null : null, resume: typeof rid?.value === 'string' ? await d.resumes.get(rid.value) ?? null : null };
  }
  const sp = normalizeProfile(structuredClone(sample));
  const j = parseJdRules(SAMPLE_JD);
  const r = { ...runConsistency(generateRules(sp, j, 'zh')), templateId: BUILTIN_TEMPLATES[0].id };
  const s = { ...DEFAULT_SETTINGS, demoMode: true, setupDone: true };
  let skipped = false;
  await d.transaction('rw', [d.profile, d.jobs, d.resumes, d.state, d.settings], async () => {
    if (await d.state.get(PROFILE_EPOCH_KEY)) { skipped = true; return; }
    await Promise.all([d.profile.clear(), d.jobs.clear(), d.resumes.clear(), d.state.clear()]);
    await Promise.all([d.profile.put({ id: 'me', doc: sp }), d.jobs.put(j), d.resumes.put(r), d.settings.put(s),
      d.state.bulkPut([{ id: 'jobId', value: j.id }, { id: 'resumeId', value: r.id }])]);
  });
  if (skipped) return seedDemo(d);
  return { profile: sp, job: j, resume: r, settings: s };
}
