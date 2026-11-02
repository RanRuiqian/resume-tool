import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyOrganize, OrganizeAiError, planOrganize } from '../src/quality/organize';
import { parseStructuredLibrary } from '../src/ai/structuredImport';
import { buildImportPlan, applyImportPlan } from '../src/ai/importPlan';
import { emptyProfile } from '../src/storage/profileIO';
import { DEFAULT_SETTINGS } from '../src/storage/defaults';
import { mockFactLibrary } from './fixtures/factLibrary';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
if (process.env.ORGANIZE_OUT) {
  mkdirSync(process.env.ORGANIZE_OUT, { recursive: true });
  const r = parseStructuredLibrary(mockFactLibrary().replace('工作内容：进行虚构流程观察', '工作内容：在模拟实验室使用 Python 完成设备测试。'))!;
  writeFileSync(resolve(process.env.ORGANIZE_OUT, 'fictional-reviewed.json'), JSON.stringify(applyImportPlan(emptyProfile(), r.profile, buildImportPlan(emptyProfile(), r.profile))));
}
const settings = { ...DEFAULT_SETTINGS, apiKey: 'FAKE-ORGANIZE-ONLY', model: 'deepseek-flash', demoMode: false };
type Item = { key: string; zh: string; en: string; mode: string; needEn: boolean };
function itemsOf(init?: RequestInit): Item[] { const body = JSON.parse(String(init?.body)); const s = body.messages.at(-1).content; return JSON.parse(s.slice(s.lastIndexOf('{"items"'))).items; }
function response(items: Item[], model: string | undefined = 'mock-reported-flash') { return new Response(JSON.stringify({ ...(model ? { model } : {}), choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items: items.map((x) => ({ ...x, category: 'resume' })) }) } }] }), { status: 200 }); }
function fixture(n = 1) {
  const p = emptyProfile(); p.education = [{ id: 'edu', enabled: true, school: { zh: '模拟学历机构' }, degree: { zh: '硕士' }, major: { zh: '示例专业' }, start: '2024-07', end: '', expectedConferralDate: '2027-01', highlights: [{ id: 'e-h', zh: '预计2027年授予硕士学位', status: { zh: 'confirmed' } }] }];
  p.work = [{ id: 'w', enabled: true, company: { zh: '模拟企业' }, title: { zh: '测试实习生' }, start: '2024-07', end: '2024-08', kind: 'internship', userConfirmedAt: '2026-01-02', importedFrom: { importTag: 'mock', incomingId: 'WRK-01', at: '2026-01-01' }, sourceRecord: { format: 'numbered-library', id: 'WRK-01', section: '工作', raw: '虚构已审核工作事实', reviewed: true }, bullets: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, zh: '在模拟实验室使用 Python 完成设备测试。', source: 'zh', status: { zh: 'confirmed' } })), tags: [] }];
  p.sourceFacts = [{ id: 'WRK-01', section: '工作', raw: '虚构已审核工作事实', reviewed: true, entityIds: ['w'] }]; return p;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('explicit AI wording request reaches the provider without weakening fact guards', () => {
  it('sends human-reviewed V7-format prose through real chatJson/fetch, reports actual model and keeps source immutable', async () => {
    const r = parseStructuredLibrary(mockFactLibrary())!; const p = applyImportPlan(emptyProfile(), r.profile, buildImportPlan(emptyProfile(), r.profile)); const before = structuredClone(p);
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => response(itemsOf(init))); vi.stubGlobal('fetch', fetch);
    const plan = await planOrganize(settings, p, { useAi: true });
    expect(fetch).toHaveBeenCalled(); expect(plan.ai?.requests).toBe(fetch.mock.calls.length); expect(plan.ai?.eligible).toBeGreaterThan(30); expect(plan.aiItems).toBe(plan.ai?.eligible);
    expect(plan.ai?.responseModels).toEqual(['mock-reported-flash']); expect(plan.ai?.requestedModel).toBe('deepseek-flash'); expect(plan.ai?.batches.every((b) => b.status === 'success')).toBe(true);
    for (const call of fetch.mock.calls) { expect(String(call[0])).toBe('https://api.deepseek.com/chat/completions'); const body = JSON.parse(String(call[1]?.body)); expect(body.model).toBe('deepseek-flash'); expect(body.thinking.type).toBe('disabled'); expect(itemsOf(call[1]).every((x) => x.mode === 'clean')).toBe(true); expect(String(call[1]?.body)).not.toContain('sourceFacts'); }
    expect(p).toEqual(before); const accepted = applyOrganize(p, plan, new Set(plan.proposals.map((p) => p.id)));
    expect(accepted.education).toEqual(before.education); expect(accepted.courses).toEqual(before.courses); expect(accepted.sourceFacts).toEqual(before.sourceFacts); expect(accepted.projects.map((p) => p.id)).toEqual(before.projects.map((p) => p.id));
  });
  it('offers an AI format edit to confirmed prose for explicit review, never writes before selection or mutates original IDs/facts', async () => {
    const p = fixture(); const before = structuredClone(p);
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => response(itemsOf(init).map((x) => ({ ...x, zh: x.zh.replace('在模拟实验室使用', '在模拟实验室，使用') })))));
    const plan = await planOrganize(settings, p, { useAi: true }), suggestion = plan.proposals.find((x) => x.source === 'ai')!;
    expect(suggestion.risk).toBe('high'); expect(applyOrganize(p, plan, new Set()).work[0].bullets[0].zh).toBe(before.work[0].bullets[0].zh);
    const out = applyOrganize(p, plan, new Set([suggestion.id])); expect(out.work[0].bullets[0].zh).toBe('在模拟实验室，使用 Python 完成设备测试。'); expect(out.work[0].bullets[0].id).toBe('b0'); expect(out.work[0].sourceRecord).toEqual(before.work[0].sourceRecord); expect(out.sourceFacts).toEqual(before.sourceFacts); expect(out.education).toEqual(before.education); expect(p).toEqual(before);
  });
  it('rejects confirmed-prose factual changes, feedback-retries, and never returns them as selectable AI edits', async () => {
    const p = fixture(); const before = structuredClone(p);
    const fetch = vi.fn(async (_u: unknown, init?: RequestInit) => response(itemsOf(init).map((x) => ({ ...x, zh: x.zh + '2027年已获得博士学位，成绩100分。' })))); vi.stubGlobal('fetch', fetch);
    const plan = await planOrganize(settings, p, { useAi: true }); expect(plan.ai?.requests).toBe(2); expect(plan.rejectedItems).toHaveLength(1); expect(plan.proposals.some((p) => p.source === 'ai')).toBe(false); expect(plan.proposals.some((p) => p.kind === 'field')).toBe(false); expect(p).toEqual(before);
  });
  it('skips local-only, demo, empty and protected-only input with explicit reasons and zero fetches', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await planOrganize(settings, fixture(), { useAi: false })).ai?.noCallReason).toContain('仅本地');
    expect((await planOrganize({ ...settings, demoMode: true }, fixture(), { useAi: true })).ai?.noCallReason).toContain('演示模式');
    expect((await planOrganize(settings, emptyProfile(), { useAi: true })).ai?.noCallReason).toContain('没有可处理');
    const p = fixture(); p.work = []; const report = (await planOrganize(settings, p, { useAi: true, force: true })).ai!;
    expect(report.noCallReason).toContain('教育事实受保护'); expect(report.eligible).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('explains fingerprint reuse, permits explicit recheck and does not use obsolete pre-fix fingerprints', async () => {
    const p = fixture(), fetch = vi.fn(async (_u: unknown, init?: RequestInit) => response(itemsOf(init))); vi.stubGlobal('fetch', fetch);
    const first = await planOrganize(settings, p, { useAi: true }), reviewed = applyOrganize(p, first, new Set()); fetch.mockClear();
    const cached = await planOrganize(settings, reviewed, { useAi: true }); expect(fetch).not.toHaveBeenCalled(); expect(cached.ai?.noCallReason).toContain('已审阅');
    await planOrganize(settings, reviewed, { useAi: true, force: true }); expect(fetch).toHaveBeenCalledOnce();
  });
  it('reports a failed request accurately, preserves the original and does not count it as a successful AI run', async () => {
    const p = fixture(), fetch = vi.fn(async () => new Response('mock unavailable', { status: 503 })); vi.stubGlobal('fetch', fetch);
    const error = await planOrganize(settings, p, { useAi: true }).catch((e: unknown) => e); expect(error).toBeInstanceOf(OrganizeAiError);
    const r = (error as OrganizeAiError).report; expect(r.requests).toBe(1); expect(r.batches[0].status).toBe('failed'); expect(r.batches[0].error).toContain('503'); expect(r.responseModels).toEqual([]); expect(JSON.stringify(error)).not.toContain(settings.apiKey);
  });
  it('stops after authentication failure rather than repeating every remaining batch', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 401 })); vi.stubGlobal('fetch', fetch);
    const error = await planOrganize(settings, fixture(25), { useAi: true }).catch((e: unknown) => e);
    expect((error as OrganizeAiError).report.requests).toBe(1); expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps partial batch failures distinct from successful responses and reports unreturned items without silently caching them', async () => {
    let n = 0; const fetch = vi.fn(async (_u: unknown, init?: RequestInit) => ++n === 1 ? response(itemsOf(init).slice(0, 18)) : new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch);
    const plan = await planOrganize(settings, fixture(25), { useAi: true }); expect(plan.ai?.requests).toBe(2); expect(plan.ai?.batches.map((b) => b.status)).toEqual(['partial', 'failed']); expect(plan.aiItems).toBe(18); expect(plan.fingerprints).toHaveLength(18); expect(plan.aiErrors).toHaveLength(2);
  });
  it('reports missing response model as unknown and counts HTTP retries rather than inventing a model or call count', async () => {
    let n = 0; const fetch = vi.fn(async (_u: unknown, init?: RequestInit) => ++n === 1 ? new Response(JSON.stringify({ choices: [{ message: { content: '{"items":' } }] })) : response(itemsOf(init), '')); vi.stubGlobal('fetch', fetch);
    const plan = await planOrganize(settings, fixture(), { useAi: true }); expect(plan.ai?.requests).toBe(2); expect(plan.aiCalls).toBe(1); expect(plan.ai?.responseModels).toEqual([]); expect(plan.ai?.batches[0].status).toBe('success');
  });
});

it('allows an English grammar proposal only after the original fact guards pass, with manual review required', async () => {
  const p = fixture(); p.work[0].bullets[0] = { id: 'b0', en: 'Assisted at testing the prototype in the lab.', source: 'en', status: { en: 'confirmed' } };
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => response(itemsOf(init).map((x) => ({ ...x, en: x.en.replace('Assisted at testing', 'Assisted in testing') })))));
  const plan = await planOrganize(settings, p, { useAi: true }); expect(plan.proposals.some((p) => p.source === 'ai' && p.risk === 'high')).toBe(true); expect(plan.stats?.rejected).toBe(0); expect(p.work[0].bullets[0].en).toContain('Assisted at');
});

it('explains a rejected configuration before fetch instead of reporting a successful or attempted API call', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const error = await planOrganize({ ...settings, apiKey: '' }, fixture(), { useAi: true }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OrganizeAiError); expect((error as OrganizeAiError).report.requests).toBe(0); expect((error as OrganizeAiError).report.batches[0].error).toContain('尚未启用 API'); expect(fetch).not.toHaveBeenCalled();
});
it('retains an accurate timeout cause and never labels empty model output as success', async () => {
  vi.stubGlobal('fetch', vi.fn((_u: unknown, init?: RequestInit) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('mock timeout', 'AbortError'))); })));
  const timeout = await planOrganize(settings, fixture(), { useAi: true, timeoutMs: 5 }).catch((e: unknown) => e);
  expect((timeout as OrganizeAiError).report.requests).toBe(1); expect((timeout as OrganizeAiError).report.batches[0].error).toContain('超时');
  vi.stubGlobal('fetch', vi.fn(async () => response([])));
  const empty = await planOrganize(settings, fixture(), { useAi: true }).catch((e: unknown) => e);
  expect((empty as OrganizeAiError).report.batches[0].status).toBe('failed'); expect((empty as OrganizeAiError).report.batches[0].error).toContain('没有返回可用');
});
it('does not attribute a parallel connection test or other task model to this organization run', async () => {
  const { chat } = await import('../src/ai/provider');
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return body.model === 'other-task' ? new Response(JSON.stringify({ model: 'reported-other-task', choices: [{ message: { content: 'OK' } }] })) : response(itemsOf(init));
  }));
  const [plan] = await Promise.all([planOrganize(settings, fixture(), { useAi: true }), chat({ ...settings, model: 'other-task' }, [{ role: 'user', content: 'OK' }])]);
  expect(plan.ai?.requests).toBe(1); expect(plan.ai?.responseModels).toEqual(['mock-reported-flash']);
});

it('rejects key-only responses instead of calling local unchanged text a successful AI review', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => new Response(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: JSON.stringify({ items: itemsOf(init).map((x) => ({ key: x.key })) }) } }] }))));
  const e = await planOrganize(settings, fixture(), { useAi: true }).catch((e: unknown) => e);
  expect(e).toBeInstanceOf(OrganizeAiError); expect((e as OrganizeAiError).report.batches[0].status).toBe('failed'); expect((e as OrganizeAiError).report.batches[0].error).toContain('没有返回可用');
});
it('does not let an AI archive payload bypass the project fact checks', async () => {
  const r = parseStructuredLibrary(mockFactLibrary())!, p = r.profile, before = structuredClone(p);
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
    const items = itemsOf(init); return new Response(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: JSON.stringify({ items: items.map((x) => ({ ...x, category: 'resume', archive: x.section === 'projects' ? ['2029年完成商业量产，产量10000件。'] : [] })) }) } }] }));
  }));
  const plan = await planOrganize(settings, p, { useAi: true }); expect(plan.rejectedItems!.some((r) => r.reasons.some((r) => r.includes('archive')))).toBe(true);
  const result = applyOrganize(p, plan, new Set(plan.proposals.map((p) => p.id))); expect(JSON.stringify(result)).not.toContain('2029年完成商业量产'); expect(p).toEqual(before); expect(result.sourceFacts).toEqual(before.sourceFacts); expect(result.education).toEqual(before.education); expect(result.courses).toEqual(before.courses);
});
