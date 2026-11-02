import { liveQuery } from 'dexie';
import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { assertProfileEpoch, clearPersonalData as clearStoredPersonalData, epochValue, persistProfile, PROFILE_EPOCH_KEY, profileEpoch as readProfileEpoch, StaleProfileWriteError } from './storage/clearProfile';
import type { JobParse, ProfileDoc, ResumeDoc, Settings, TemplateConfig } from './types';
import { db, DEFAULT_SETTINGS } from './storage/db';
import { loadSettings } from './storage/settingsLoad';
import { applyActive, activateProfile as activateP, deleteProfile as deleteP, migrateToProfiles, upsertProfile, type ProfileDraft } from './storage/apiProfiles';
import { emptyProfile, normalizeProfile } from './storage/profileIO';
import { BUILTIN_TEMPLATES, ALL_TEMPLATES, ENG_DEFAULT_ID, initialTemplateId, normalizeTemplate } from './templates';
import { snapshotProfile, type BackupRow } from './storage/db';
import { seedDemo } from './storage/demo';
import { IS_DEMO, uiStorage } from './storage/mode';

interface AppState {
  ready: boolean;
  loadError: boolean;
  profileEpoch: string;
  clearingProfile: boolean;
  clearPersonalData: () => Promise<void>;
  profile: ProfileDoc; setProfile: (p: ProfileDoc) => void;
  settings: Settings; setSettings: (s: Settings) => void;
  /** 多 API 配置：新增/编辑（activate=true 同时启用）、一键切换、删除；均立即生效并保存，无需刷新 */
  saveApiProfile: (d: ProfileDraft, activate?: boolean) => string;
  switchApiProfile: (id: string) => void;
  removeApiProfile: (id: string) => void;
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
  const [loadError, setLoadError] = useState(false);
  const [profile, setProfileS] = useState<ProfileDoc>(emptyProfile());
  const [settings, setSettingsS] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const [custom, setCustom] = useState<TemplateConfig[]>([]);
  const [templateId, setTemplateIdS] = useState(ENG_DEFAULT_ID);
  const [job, setJobS] = useState<JobParse | null>(null);
  const [resume, setResumeS] = useState<ResumeDoc | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<ProfileDoc | null>(null);
  const [history, setHistory] = useState<ResumeDoc[]>([]);
  const [profileEpoch, setProfileEpoch] = useState('');
  const epochRef = useRef(''), clearing = useRef(false);
  const [clearingProfile, setClearingProfile] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, s, ts, st] = await db.transaction('r', [db.profile, db.settings, db.templates, db.state], () => Promise.all([db.profile.get('me'), db.settings.get('settings'), db.templates.toArray(), db.state.toArray()]));
      if (p) { const doc = normalizeProfile(p.doc); setProfileS(doc); latest.current = doc; }
      if (s) { const ls = await loadSettings(db); if (ls) { settingsRef.current = ls; setSettingsS(ls); } }
      setCustom(ts.map(normalizeTemplate));
      const get = (k: string) => st.find((x) => x.id === k)?.value;
      epochRef.current = epochValue(st.find((x) => x.id === PROFILE_EPOCH_KEY)); setProfileEpoch(epochRef.current);
      const savedTpl = get('templateId') as string | undefined;
      const tid = initialTemplateId(savedTpl, !!p);
      setTemplateIdS(tid);
      // 首次确定的默认模板写入本机，之后导入资料也不会再变（演示模式写入的是独立演示库）
      if (!savedTpl) db.state.put({ id: 'templateId', value: tid });
      const jid = get('jobId') as string | undefined, rid = get('resumeId') as string | undefined;
      if (jid) setJobS((await db.jobs.get(jid)) ?? null);
      if (rid) setResumeS((await db.resumes.get(rid)) ?? null);
      // ?demo：只读写独立的演示数据库（resume-tool-demo），真实资料库完全不碰
      if (IS_DEMO) {
        const d = await seedDemo(db);
        const ds = migrateToProfiles(d.settings).settings;
        setProfileS(d.profile); setJobS(d.job); setResumeS(d.resume); settingsRef.current = ds; setSettingsS(ds);
        if (!epochRef.current) uiStorage.setItem('wizardStep', '3');
      }
      setReady(true);
    })().catch(() => { setLoadError(true); });
  }, []);

  const reportWriteError = (error: unknown) => { if (!(error instanceof StaleProfileWriteError)) console.error('个人资料保存失败，请检查浏览器存储空间。'); };
  const setProfile = useCallback((p: ProfileDoc) => {
    if (clearing.current || profileEpoch !== epochRef.current) return;
    setProfileS(p); latest.current = p;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = undefined; persistProfile(db, p, profileEpoch).catch(reportWriteError); }, 400);
  }, [profileEpoch]);
  // 离开页面前的写入也检查代次，防止旧标签页恢复已清空资料。
  useEffect(() => {
    const flush = () => { if (!clearing.current && profileEpoch === epochRef.current && timer.current !== undefined && latest.current) { window.clearTimeout(timer.current); timer.current = undefined; persistProfile(db, latest.current, profileEpoch).catch(reportWriteError); } };
    window.addEventListener('pagehide', flush);
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); };
  }, [profileEpoch]);
  const resetMemory = useCallback((epoch: string, doc: ProfileDoc) => {
    window.clearTimeout(timer.current); timer.current = undefined;
    epochRef.current = epoch; latest.current = doc;
    setProfileS(doc); setResumeS(null); setHistory([]); setProfileEpoch(epoch);
    uiStorage.setItem('wizardStep', '1');
  }, []);
  useEffect(() => {
    if (!ready) return;
    const subscription = liveQuery(() => db.state.get(PROFILE_EPOCH_KEY)).subscribe({ next: (row) => {
      const epoch = epochValue(row);
      if (!clearing.current && epoch !== epochRef.current) resetMemory(epoch, emptyProfile());
    }, error: () => {} });
    return () => subscription.unsubscribe();
  }, [ready, resetMemory]);
  const clearPersonalData = useCallback(async () => {
    if (clearing.current) return;
    clearing.current = true; setClearingProfile(true);
    window.clearTimeout(timer.current); timer.current = undefined;
    try { const result = await clearStoredPersonalData(db); resetMemory(result.epoch, result.doc); }
    finally {
      clearing.current = false;
      const epoch = await readProfileEpoch(db).catch(() => null);
      if (epoch !== null && epoch !== epochRef.current) resetMemory(epoch, emptyProfile());
      setClearingProfile(false);
    }
  }, [resetMemory]);
  const replaceProfile = useCallback(async (p: ProfileDoc, reason: string) => {
    if (clearing.current || profileEpoch !== epochRef.current) throw new StaleProfileWriteError();
    const cur = latest.current ?? (await db.profile.get('me'))?.doc;
    window.clearTimeout(timer.current); timer.current = undefined;
    try {
      const id = await db.transaction('rw', db.profile, db.backups, db.state, async () => {
        await assertProfileEpoch(db, profileEpoch);
        const backup = cur ? await snapshotProfile(db, cur, reason) : null;
        if (latest.current && latest.current !== cur) throw new Error('资料已有新修改，请重新预览后再合并');
        await db.profile.put({ id: 'me', doc: p }); return backup;
      });
      if (clearing.current || profileEpoch !== epochRef.current) throw new StaleProfileWriteError();
      latest.current = p; setProfileS(p); return id;
    } catch (error) {
      if (!clearing.current && profileEpoch === epochRef.current && latest.current) setProfile(latest.current);
      throw error;
    }
  }, [setProfile, profileEpoch]);
  const listBackups = useCallback(() => db.backups.orderBy('createdAt').reverse().toArray(), []);
  const restoreBackup = useCallback(async (id: string) => {
    if (clearing.current || profileEpoch !== epochRef.current) throw new StaleProfileWriteError();
    const b = await db.backups.get(id); if (!b) return false;
    await replaceProfile(normalizeProfile(b.doc), '恢复快照前的资料'); // 快照可能是旧版格式（如升级前自动快照），恢复时统一升级
    return true;
  }, [replaceProfile, profileEpoch]);
  const setSettings = useCallback((s0: Settings) => { const s = Array.isArray(s0.apiProfiles) ? applyActive(s0) : s0; settingsRef.current = s; setSettingsS(s); db.settings.put(s); }, []);
  const saveApiProfile = useCallback((d: ProfileDraft, activate = false) => { const r = upsertProfile(settingsRef.current, d, { activate }); setSettings(r.settings); return r.id; }, [setSettings]);
  const switchApiProfile = useCallback((id: string) => setSettings(activateP(settingsRef.current, id)), [setSettings]);
  const removeApiProfile = useCallback((id: string) => setSettings(deleteP(settingsRef.current, id)), [setSettings]);
  const saveTemplate = (t: TemplateConfig) => { setCustom((c) => [...c.filter((x) => x.id !== t.id), t]); db.templates.put(t); };
  const deleteTemplate = (id: string) => { setCustom((c) => c.filter((x) => x.id !== id)); db.templates.delete(id); if (templateId === id) setTemplateId(BUILTIN_TEMPLATES[0].id); };
  const setTemplateId = (id: string) => { setTemplateIdS(id); db.state.put({ id: 'templateId', value: id }); };
  const setJob = (j: JobParse | null) => { setJobS(j); if (j) db.jobs.put(j); db.state.put({ id: 'jobId', value: j?.id ?? '' }); };
  const setResume = (r: ResumeDoc | null) => {
    if (clearing.current || profileEpoch !== epochRef.current) return;
    // 同一份简历的修改记入撤销栈（最多 50 步）；换岗位/重新生成则清空
    setHistory((h) => (resume && r && resume.id === r.id ? [...h.slice(-49), resume] : []));
    setResumeS(r); db.transaction('rw', db.resumes, db.state, async () => { await assertProfileEpoch(db, profileEpoch); if (r) await db.resumes.put(r); await db.state.put({ id: 'resumeId', value: r?.id ?? '' }); }).catch(reportWriteError);
  };
  const undo = () => { if (clearing.current || profileEpoch !== epochRef.current) return; const prev = history[history.length - 1]; if (!prev) return; setHistory((h) => h.slice(0, -1)); setResumeS(prev); db.transaction('rw', db.resumes, db.state, async () => { await assertProfileEpoch(db, profileEpoch); await db.resumes.put(prev); }).catch(reportWriteError); };
  const templates = [...ALL_TEMPLATES, ...custom];
  const template = templates.find((t) => t.id === templateId) ?? BUILTIN_TEMPLATES[0];

  return <Ctx.Provider value={{ ready, loadError, profileEpoch, clearingProfile, clearPersonalData, profile, setProfile, settings, setSettings, saveApiProfile, switchApiProfile, removeApiProfile, templates, saveTemplate, deleteTemplate, templateId, setTemplateId, job, setJob, resume, setResume, template, canUndo: history.length > 0, undo, replaceProfile, listBackups, restoreBackup, isDemo: IS_DEMO }}><Fragment key={profileEpoch}>{children}</Fragment></Ctx.Provider>;
}
