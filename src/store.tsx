import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { JobParse, ProfileDoc, ResumeDoc, Settings, TemplateConfig } from './types';
import { db, DEFAULT_SETTINGS } from './storage/db';
import { emptyProfile } from './storage/profileIO';
import { BUILTIN_TEMPLATES } from './templates';
import { normalizeProfile } from './storage/profileIO';
import sample from './sample/sample-profile.json';
import { SAMPLE_JD } from './sample/sampleJd';
import { parseJdRules } from './ai/jd';
import { generateRules, runConsistency } from './ai/generate';

interface AppState {
  ready: boolean;
  profile: ProfileDoc; setProfile: (p: ProfileDoc) => void;
  settings: Settings; setSettings: (s: Settings) => void;
  templates: TemplateConfig[]; saveTemplate: (t: TemplateConfig) => void; deleteTemplate: (id: string) => void;
  templateId: string; setTemplateId: (id: string) => void;
  job: JobParse | null; setJob: (j: JobParse | null) => void;
  resume: ResumeDoc | null; setResume: (r: ResumeDoc | null) => void;
  template: TemplateConfig;
}
const Ctx = createContext<AppState | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => { const c = useContext(Ctx); if (!c) throw new Error('no ctx'); return c; };

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfileS] = useState<ProfileDoc>(emptyProfile());
  const [settings, setSettingsS] = useState<Settings>(DEFAULT_SETTINGS);
  const [custom, setCustom] = useState<TemplateConfig[]>([]);
  const [templateId, setTemplateIdS] = useState(BUILTIN_TEMPLATES[0].id);
  const [job, setJobS] = useState<JobParse | null>(null);
  const [resume, setResumeS] = useState<ResumeDoc | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const [p, s, ts, st] = await Promise.all([db.profile.get('me'), db.settings.get('settings'), db.templates.toArray(), db.state.toArray()]);
      if (p) setProfileS(p.doc);
      if (s) setSettingsS({ ...DEFAULT_SETTINGS, ...s });
      setCustom(ts);
      const get = (k: string) => st.find((x) => x.id === k)?.value;
      if (get('templateId')) setTemplateIdS(get('templateId') as string);
      const jid = get('jobId') as string | undefined, rid = get('resumeId') as string | undefined;
      if (jid) setJobS((await db.jobs.get(jid)) ?? null);
      if (rid) setResumeS((await db.resumes.get(rid)) ?? null);
      // ?demo：载入示例资料 + 示例 JD + 规则生成结果，便于无 Key 体验
      if (new URLSearchParams(location.search).has('demo')) {
        const sp = normalizeProfile(sample);
        const j = parseJdRules(SAMPLE_JD);
        const r = { ...runConsistency(generateRules(sp, j, 'zh')), templateId: BUILTIN_TEMPLATES[0].id };
        setProfileS(sp); setJobS(j); setResumeS(r);
        localStorage.setItem('wizardStep', '3');
        if (!s?.setupDone) { const ns = { ...DEFAULT_SETTINGS, ...(s ?? {}), demoMode: true, setupDone: true }; setSettingsS(ns); await db.settings.put(ns); }
        await Promise.all([db.profile.put({ id: 'me', doc: sp }), db.jobs.put(j), db.resumes.put(r), db.state.bulkPut([{ id: 'jobId', value: j.id }, { id: 'resumeId', value: r.id }])]);
        history.replaceState(null, '', location.pathname + location.hash);
      }
      setReady(true);
    })();
  }, []);

  const setProfile = useCallback((p: ProfileDoc) => {
    setProfileS(p);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => db.profile.put({ id: 'me', doc: p }), 400);
  }, []);
  const setSettings = (s: Settings) => { setSettingsS(s); db.settings.put(s); };
  const saveTemplate = (t: TemplateConfig) => { setCustom((c) => [...c.filter((x) => x.id !== t.id), t]); db.templates.put(t); };
  const deleteTemplate = (id: string) => { setCustom((c) => c.filter((x) => x.id !== id)); db.templates.delete(id); if (templateId === id) setTemplateId(BUILTIN_TEMPLATES[0].id); };
  const setTemplateId = (id: string) => { setTemplateIdS(id); db.state.put({ id: 'templateId', value: id }); };
  const setJob = (j: JobParse | null) => { setJobS(j); if (j) db.jobs.put(j); db.state.put({ id: 'jobId', value: j?.id ?? '' }); };
  const setResume = (r: ResumeDoc | null) => { setResumeS(r); if (r) db.resumes.put(r); db.state.put({ id: 'resumeId', value: r?.id ?? '' }); };
  const templates = [...BUILTIN_TEMPLATES, ...custom];
  const template = templates.find((t) => t.id === templateId) ?? BUILTIN_TEMPLATES[0];

  return <Ctx.Provider value={{ ready, profile, setProfile, settings, setSettings, templates, saveTemplate, deleteTemplate, templateId, setTemplateId, job, setJob, resume, setResume, template }}>{children}</Ctx.Provider>;
}
