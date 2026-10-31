import { useCallback, useEffect, useState } from 'react';
import { db } from '../storage/db';
import type { Application, JobPosting } from './types';

/** 读取岗位库与申请记录；写操作后调用 reload 刷新 */
export function useTracker() {
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const [p, a] = await Promise.all([db.postings.toArray(), db.applications.toArray()]);
    setPostings(p.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))); setApps(a); setLoaded(true);
  }, []);
  // 从 IndexedDB 读取属于外部系统同步
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);
  return { postings, apps, loaded, reload };
}

/** 从岗位详情进入生成流程时记下来源，生成后可一键关联并返回（存在 uiStorage，演示模式不污染真实设置） */
export const TRACKER_RETURN_KEY = 'trackerReturn';
export const JD_PREFILL_KEY = 'jdPrefill';
export interface TrackerReturn { postingId: string; applicationId: string; label: string }
