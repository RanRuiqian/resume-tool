import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ResumeDB } from '../src/storage/db';
import { addFromAnalysis, addPosting, analysisDuplicates, findAnalysisLink, linkAnalysis, postingFromAnalysis } from '../src/tracker/repo';
import { computeStats } from '../src/tracker/stats';
import { jobs111 } from './helpers/v111Fixture';
import type { JobParse } from '../src/types';

let n = 0; const fresh = () => new ResumeDB(`v111-${++n}-${Math.random().toString(36).slice(2)}`);
const J = jobs111() as Record<'A' | 'B' | 'C', JobParse>;

describe('v1.11 analysis history → job management', () => {
  it('autofills from the analysis, leaves unknown fields empty, defaults to 待投递', async () => {
    const d = fresh(); await d.jobs.add(J.A);
    const r = await addFromAnalysis(d, J.A);
    expect(r.existed).toBe(false);
    expect(r.posting.company).toBe(J.A.company.full || J.A.company.short);
    expect(r.posting.jobParseId).toBe(J.A.id);
    expect(r.posting.city).toBe('');
    expect(r.posting.deadline).toBeUndefined();
    expect(r.posting.source.kind).toBe('analysis');
    expect(r.application?.status).toBe('pending');
    const events = await d.appEvents.toArray(); expect(events).toHaveLength(1); expect(events[0].to).toBe('pending');
  });
  it('待投递 is not counted as applied / waiting', async () => {
    const d = fresh();
    await addFromAnalysis(d, J.A); await addFromAnalysis(d, J.B);
    const s = computeStats(await d.postings.toArray(), await d.applications.toArray());
    expect(s.pending).toBe(2); expect(s.applied).toBe(0); expect(s.waiting).toBe(0); expect(s.postings).toBe(2);
  });
  it('same analysis is linked once (idempotent), back-link resolvable', async () => {
    const d = fresh();
    const a = await addFromAnalysis(d, J.C); const b = await addFromAnalysis(d, J.C);
    expect(b.existed).toBe(true); expect(b.posting.id).toBe(a.posting.id);
    expect(await d.postings.count()).toBe(1);
    expect((await findAnalysisLink(d, J.C.id))?.id).toBe(a.posting.id);
  });
  it('company + title duplicate is reported, linking keeps the existing record unchanged', async () => {
    const d = fresh();
    const c = postingFromAnalysis(J.A);
    const { posting } = await addPosting(d, { company: c.company, title: c.title, city: '上海', notes: '手动记录' }, 'applied');
    const dups = await analysisDuplicates(d, J.A);
    expect(dups.map((x) => x.posting.id)).toEqual([posting.id]);
    const linked = await linkAnalysis(d, posting.id, J.A.id);
    expect(linked.city).toBe('上海'); expect(linked.notes).toBe('手动记录'); expect(linked.jobParseId).toBe(J.A.id);
    expect(await d.applications.count()).toBe(1);
    expect((await d.applications.toArray())[0].status).toBe('applied');
  });
  it('history (db.jobs) and tracker (postings) are separate stores: 6 analyses ≠ 6 applications', async () => {
    const d = fresh();
    for (const k of ['A', 'B', 'C'] as const) await d.jobs.add({ ...J[k] });
    expect(await d.jobs.count()).toBe(3);
    expect(computeStats(await d.postings.toArray(), await d.applications.toArray()).postings).toBe(0);
  });
});
