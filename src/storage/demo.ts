import type { ResumeDB } from './db';
import { DEFAULT_SETTINGS } from './defaults';
import { normalizeProfile } from './profileIO';
import sample from '../sample/sample-profile.json';
import { SAMPLE_JD } from '../sample/sampleJd';
import { parseJdRules } from '../ai/jd';
import { generateRules, runConsistency } from '../ai/generate';
import { BUILTIN_TEMPLATES } from '../templates';

/** 给演示数据库写入示例资料。调用方必须传入演示库；传入真实库会直接报错。 */
export async function seedDemo(d: ResumeDB) {
  if (!d.name.endsWith('-demo')) throw new Error('seedDemo 只能写入演示数据库');
  const sp = normalizeProfile(structuredClone(sample));
  const j = parseJdRules(SAMPLE_JD);
  const r = { ...runConsistency(generateRules(sp, j, 'zh')), templateId: BUILTIN_TEMPLATES[0].id };
  const s = { ...DEFAULT_SETTINGS, demoMode: true, setupDone: true };
  await d.transaction('rw', [d.profile, d.jobs, d.resumes, d.state, d.settings], async () => {
    await Promise.all([d.profile.clear(), d.jobs.clear(), d.resumes.clear(), d.state.clear()]);
    await Promise.all([d.profile.put({ id: 'me', doc: sp }), d.jobs.put(j), d.resumes.put(r), d.settings.put(s),
      d.state.bulkPut([{ id: 'jobId', value: j.id }, { id: 'resumeId', value: r.id }])]);
  });
  return { profile: sp, job: j, resume: r, settings: s };
}
