import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { JobParse, ProfileDoc, ResumeDoc, Settings, TemplateConfig } from './types';
import { db, DEFAULT_SETTINGS } from './storage/db';
import { migrateSettings } from './storage/defaults';
import { emptyProfile, normalizeProfile } from './storage/profileIO';
import { BUILTIN_TEMPLATES, ALL_TEMPLATES } from './templates';
import { snapshotProfile, type BackupRow } from './storage/db';
import { seedDemo } from './storage/demo';
import { IS_DEMO, uiStorage } from './storage/mode';

interface AppState {
  ready: boolean;
  profile: ProfileDoc; setProfile: (p: ProfileDoc) => void;
  settings: Settings; setSettings: (s: Settings) => void;
  templates: TemplateConfig[]; saveTemplate: (t: TemplateConfig) => void; deleteTemplate: (id: string) => void;
  templateId: string; setTemplateId: (id: string) => void;
  job: JobParse | null; setJob: (j: JobParse | null) => void;
  resume: ResumeDoc | null; setResume: (r: ResumeDoc | null) => void;
  canUndo: boolean; undo: () => void;
  /** 危险操作（整体替换/合并资料）前调用：先存快照，再写入；返回快照 id */
  replaceProfile: (p: ProfileDoc, reason: string) => Promise<string | null>;
  listBackups: () => Promise<BackupRow[]>;
  restoreBackup: (id: string) => Promise<boolean>;
  isDemo: boolean;
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
  const latest = useRef<ProfileDoc | null>(null);
  const [history, setHistory] = useState<ResumeDoc[]>([]);

  useEffect(() => {
    (async () => {
      const [p, s, ts, st] = await Promise.all([db.profile.get('me'), db.settings.get('settings'), db.templates.toArray(), db.state.toArray()]);
      if (p) { const doc = normalizeProfile(p.doc); setProfileS(doc); latest.current = doc; }
      if (s) {
        const m = migrateSettings({ ...DEFAULT_SETTINGS, ...s });
        setSettingsS(m.settings);
        if (m.changed) await db.settings.put(m.settings); // 旧默认模型名 deepseek-chat → deepseek-flash
      }
      setCustom(ts);
      const get = (k: string) => st.find((x) => x.id === k)?.value;
      if (get('templateId')) setTemplateIdS(get('templateId') as string);
      const jid = get('jobId') as string | undefined, rid = get('resumeId') as string | undefined;
      if (jid) setJobS((await db.jobs.get(jid)) ?? null);
      if (rid) setResumeS((await db.resumes.get(rid)) ?? null);
      // ?demo：只读写独立的演示数据库（resume-tool-demo），真实资料库完全不碰
      if (IS_DEMO) {
        const d = await seedDemo(db);
        setProfileS(d.profile); setJobS(d.job); setResumeS(d.resume); setSettingsS(d.settings);
        uiStorage.setItem('wizardStep', '3');
      }
      setReady(true);
    })();
  }, []);

  const setProfile = useCallback((p: ProfileDoc) => {
    setProfileS(p); latest.current = p;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = undefined; db.profile.put({ id: 'me', doc: p }); }, 400);
  }, []);
  // 关闭/切走页面时立刻落盘，避免 400ms 防抖窗口内的修改丢失
  useEffect(() => {
    const flush = () => { if (timer.current !== undefined && latest.current) { window.clearTimeout(timer.current); timer.current = undefined; db.profile.put({ id: 'me', doc: latest.current }); } };
    window.addEventListener('pagehide', flush);
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); };
  }, []);
  const replaceProfile = useCallback(async (p: ProfileDoc, reason: string) => {
    const cur = latest.current ?? (await db.profile.get('me'))?.doc;
    const id = cur ? await snapshotProfile(db, cur, reason) : null;
    window.clearTimeout(timer.current); timer.current = undefined;
    latest.current = p; setProfileS(p);
    await db.profile.put({ id: 'me', doc: p });
    return id;
  }, []);
  const listBackups = useCallback(() => db.backups.orderBy('createdAt').reverse().toArray(), []);
  const restoreBackup = useCallback(async (id: string) => {
    const b = await db.backups.get(id); if (!b) return false;
    await replaceProfile(normalizeProfile(b.doc), '恢复快照前的资料'); // 快照可能是旧版格式（如升级前自动快照），恢复时统一升级
    return true;
  }, [replaceProfile]);
  const setSettings = (s: Settings) => { setSettingsS(s); db.settings.put(s); };
  const saveTemplate = (t: TemplateConfig) => { setCustom((c) => [...c.filter((x) => x.id !== t.id), t]); db.templates.put(t); };
  const deleteTemplate = (id: string) => { setCustom((c) => c.filter((x) => x.id !== id)); db.templates.delete(id); if (templateId === id) setTemplateId(BUILTIN_TEMPLATES[0].id); };
  const setTemplateId = (id: string) => { setTemplateIdS(id); db.state.put({ id: 'templateId', value: id }); };
  const setJob = (j: JobParse | null) => { setJobS(j); if (j) db.jobs.put(j); db.state.put({ id: 'jobId', value: j?.id ?? '' }); };
  const setResume = (r: ResumeDoc | null) => {
    // 同一份简历的修改记入撤销栈（最多 50 步）；换岗位/重新生成则清空
    setHistory((h) => (resume && r && resume.id === r.id ? [...h.slice(-49), resume] : []));
    setResumeS(r); if (r) db.resumes.put(r); db.state.put({ id: 'resumeId', value: r?.id ?? '' });
  };
  const undo = () => { const prev = history[history.length - 1]; if (!prev) return; setHistory((h) => h.slice(0, -1)); setResumeS(prev); db.resumes.put(prev); };
  const templates = [...ALL_TEMPLATES, ...custom];
  const template = templates.find((t) => t.id === templateId) ?? BUILTIN_TEMPLATES[0];

  return <Ctx.Provider value={{ ready, profile, setProfile, settings, setSettings, templates, saveTemplate, deleteTemplate, templateId, setTemplateId, job, setJob, resume, setResume, template, canUndo: history.length > 0, undo, replaceProfile, listBackups, restoreBackup, isDemo: IS_DEMO }}>{children}</Ctx.Provider>;
}
