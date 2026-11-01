import { APP_STATUSES, type Application, type AppStatus, type JobPosting } from './types';

export const WAITING: AppStatus[] = ['applied'];
export const ACTIVE_STAGE: AppStatus[] = ['assessment', 'interviewing'];

/** 统计面板：只基于真实记录计算，不填充任何演示数字。v1.11：「待投递」（从岗位分析加入）单独计数，不计入已投递 / 等待回复 */
export function computeStats(postings: JobPosting[], apps: Application[], today = new Date()) {
  const latest = latestByPosting(apps);
  const byStatus = Object.fromEntries(APP_STATUSES.map((s) => [s, 0])) as Record<AppStatus, number>;
  for (const a of latest.values()) byStatus[a.status]++;
  const everApplied = [...latest.values()].filter((a) => !!a.appliedAt || ['applied', 'assessment', 'interviewing', 'offer', 'rejected'].includes(a.status)).length;
  const byCity: Record<string, number> = {}, byCompany: Record<string, number> = {};
  for (const p of postings) {
    if (!latest.has(p.id)) continue;
    byCity[p.city || '（未填城市）'] = (byCity[p.city || '（未填城市）'] ?? 0) + 1;
    byCompany[p.company || '（未填公司）'] = (byCompany[p.company || '（未填公司）'] ?? 0) + 1;
  }
  const t0 = today.toISOString().slice(0, 10), t14 = new Date(today.getTime() + 14 * 864e5).toISOString().slice(0, 10);
  const closed: AppStatus[] = ['offer', 'rejected', 'withdrawn', 'closed'];
  const upcoming: { date: string; label: string; postingId: string }[] = [];
  for (const p of postings) {
    const st = latest.get(p.id)?.status;
    if (p.deadline && p.deadline >= t0 && p.deadline <= t14 && !(st && closed.includes(st)) && st !== 'applied') upcoming.push({ date: p.deadline, label: `截止：${p.company} · ${p.title}`, postingId: p.id });
  }
  for (const a of apps) {
    for (const t of a.todos) if (!t.done && t.due && t.due <= t14) upcoming.push({ date: t.due, label: `待办：${t.text}${t.due < t0 ? '（已逾期）' : ''}`, postingId: a.postingId });
    for (const iv of a.interviews) if (iv.at.slice(0, 10) >= t0 && iv.at.slice(0, 10) <= t14) upcoming.push({ date: iv.at.slice(0, 16).replace('T', ' '), label: `面试：${iv.round}`, postingId: a.postingId });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  const recent = [...postings].sort((a, b) => (latest.get(b.id)?.updatedAt ?? b.updatedAt).localeCompare(latest.get(a.id)?.updatedAt ?? a.updatedAt)).slice(0, 5);
  return {
    postings: postings.length, tracked: latest.size, untracked: postings.length - latest.size,
    saved: byStatus.saved, pending: byStatus.pending, applied: everApplied, waiting: byStatus.applied, testOrInterview: byStatus.assessment + byStatus.interviewing,
    offer: byStatus.offer, rejected: byStatus.rejected, byStatus, byCity, byCompany, upcoming, recent,
  };
}
/** 每个岗位取最近更新的那条申请 */
export function latestByPosting(apps: Application[]): Map<string, Application> {
  const m = new Map<string, Application>();
  for (const a of apps) { const c = m.get(a.postingId); if (!c || a.updatedAt > c.updatedAt) m.set(a.postingId, a); }
  return m;
}
