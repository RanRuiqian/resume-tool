import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ResumeDB } from '../src/storage/db';
import { exportArchiveZip, exportLightJson, readArchive, restoreArchive, SECTIONS } from '../src/tracker/backup';
import { decryptKeys, encryptKeys, mergeSettings, settingsArchive } from '../src/tracker/backupSettings';
import { DEFAULT_SETTINGS } from '../src/storage/defaults';
import { BUILTIN_TEMPLATES } from '../src/templates';
import type { ApiProfile, Settings } from '../src/types';

// 全部为虚构 Key / 配置
let n = 0; const fresh = () => new ResumeDB(`bks-${++n}-${Math.random().toString(36).slice(2)}`);
const KEY_A = 'sk-fake-AAAA-never-plain-1111', KEY_B = 'sk-fake-BBBB-never-plain-2222';
const prof = (id: string, apiKey: string, name = id): ApiProfile => ({ id, name, provider: 'deepseek', baseUrl: 'https://api.example.com', apiKey, model: 'deepseek-chat', translateModel: '', visionModel: '', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });
const withProfiles = (list: ApiProfile[], active: string | null): Settings => ({ ...DEFAULT_SETTINGS, apiProfiles: list, activeProfileId: active, apiKey: list.find((p) => p.id === active)?.apiKey ?? '', setupDone: true, uiLang: 'zh', ocrMode: 'vision' });
const seed = async (d: ResumeDB) => {
  await d.settings.put(withProfiles([prof('p-a', KEY_A, '模拟配置A'), prof('p-b', KEY_B, '模拟配置B')], 'p-a'));
  await d.templates.put({ ...structuredClone(BUILTIN_TEMPLATES[0]), id: 'my-tpl-1', name: '我的模拟版式' });
};
const zipText = async (u: Uint8Array) => { const z = await JSZip.loadAsync(u); return (await Promise.all(Object.values(z.files).filter((f) => !f.dir).map((f) => f.async('string')))).join('\n'); };

describe('备份 v3：API 设置 / 加密 Key / 我的版式模板', () => {
  it('默认导出：含 API 设置与模板，不含任何 Key（明文或密文）', async () => {
    const a = fresh(); await seed(a); const zip = await exportArchiveZip(a); const all = await zipText(zip);
    expect(all).not.toContain(KEY_A); expect(all).not.toContain(KEY_B); expect(all).not.toMatch(/apiKey/i);
    const z = await JSZip.loadAsync(zip);
    expect(z.file('data/keys.enc.json')).toBeNull();
    const st = JSON.parse(await z.file('data/settings.json')!.async('string'));
    expect(st.apiProfiles.map((p: ApiProfile) => p.name)).toEqual(['模拟配置A', '模拟配置B']);
    const m = JSON.parse(await z.file('manifest.json')!.async('string'));
    expect(m).toMatchObject({ archiveVersion: 3, settings: true, encryptedKeys: 0, counts: { templates: 1 } });
  });
  it('settings:false 时不导出设置', async () => {
    const a = fresh(); await seed(a); const z = await JSZip.loadAsync(await exportArchiveZip(a, { settings: false }));
    expect(z.file('data/settings.json')).toBeNull();
  });
  it('加密导出：文件中没有明文 Key；正确密码在新设备恢复配置、Key 与启用状态', async () => {
    const a = fresh(); await seed(a); const zip = await exportArchiveZip(a, { keyPassword: 'mock-pass-123' });
    const all = await zipText(zip); expect(all).not.toContain(KEY_A); expect(all).not.toContain(KEY_B);
    const b = fresh(); const chk = await readArchive(b, zip);
    expect(chk.errors).toEqual([]); expect(chk.warnings).toEqual([]); expect(chk.encryptedKeys?.count).toBe(2);
    const r = await restoreArchive(b, chk, { sections: [...SECTIONS], overwrite: false, replaceProfile: false, restoreSettings: true, keyPassword: 'mock-pass-123' });
    expect(r.settings).toEqual({ added: 2, replaced: 0, skipped: 0, keys: 2 }); expect(r.written.templates).toBe(1);
    const s = (await b.settings.get('settings'))!;
    expect(s.activeProfileId).toBe('p-a'); expect(s.apiKey).toBe(KEY_A); expect(s.ocrMode).toBe('vision');
    expect(s.apiProfiles!.find((p) => p.id === 'p-b')!.apiKey).toBe(KEY_B);
    expect((await b.templates.get('my-tpl-1'))!.name).toBe('我的模拟版式');
  });
  it('密码错误：报错且不写入任何数据', async () => {
    const a = fresh(); await seed(a); const zip = await exportArchiveZip(a, { keyPassword: 'mock-pass-123' });
    const b = fresh(); const chk = await readArchive(b, zip);
    await expect(restoreArchive(b, chk, { sections: [...SECTIONS], overwrite: false, replaceProfile: false, restoreSettings: true, keyPassword: 'wrong-pass' })).rejects.toThrow(/密码不正确/);
    expect(await b.settings.count()).toBe(0); expect(await b.templates.count()).toBe(0);
  });
  it('有加密 Key 但不填密码：只恢复不含 Key 的配置，不启用', async () => {
    const a = fresh(); await seed(a); const zip = await exportArchiveZip(a, { keyPassword: 'mock-pass-123' });
    const b = fresh(); const r = await restoreArchive(b, await readArchive(b, zip), { sections: [], overwrite: false, replaceProfile: false, restoreSettings: true });
    expect(r.settings).toMatchObject({ added: 2, keys: 0 });
    const s = (await b.settings.get('settings'))!; expect(s.activeProfileId).toBeNull(); expect(s.apiKey).toBe('');
  });
  it('轻量 JSON 同样带设置与加密 Key，可恢复', async () => {
    const a = fresh(); await seed(a); const json = await exportLightJson(a, { keyPassword: 'mock-pass-123' });
    expect(json).not.toContain(KEY_A);
    const b = fresh(); const r = await restoreArchive(b, await readArchive(b, json), { sections: [], overwrite: false, replaceProfile: false, restoreSettings: true, keyPassword: 'mock-pass-123' });
    expect(r.settings?.keys).toBe(2); expect((await b.settings.get('settings'))!.apiKey).toBe(KEY_A);
  });
  it('旧版（v2）备份没有模板文件也不报警告', async () => {
    const a = fresh(); await seed(a); const z = await JSZip.loadAsync(await exportArchiveZip(a, { settings: false }));
    const m = JSON.parse(await z.file('manifest.json')!.async('string')); m.archiveVersion = 2; delete m.files.templates;
    z.file('manifest.json', JSON.stringify(m)); z.remove('data/templates.json');
    const chk = await readArchive(fresh(), await z.generateAsync({ type: 'uint8array' }));
    expect(chk.errors).toEqual([]); expect(chk.warnings).toEqual([]); expect(chk.settings).toBeNull();
  });
  it('合并：本机已有同 id 配置默认跳过；已有启用配置不被改动', () => {
    const cur = withProfiles([prof('p-a', 'sk-fake-local')], 'p-a');
    const inc = settingsArchive(withProfiles([prof('p-a', KEY_A), prof('p-c', 'x')], 'p-c'));
    const m = mergeSettings(cur, inc, { 'p-a': KEY_A, 'p-c': 'sk-fake-c' }, false);
    expect(m).toMatchObject({ added: 1, skipped: 1, keys: 1 });
    expect(m.settings.activeProfileId).toBe('p-a'); expect(m.settings.apiKey).toBe('sk-fake-local');
    const o = mergeSettings(cur, inc, {}, true); // 覆盖但备份无 Key → 保留本机 Key
    expect(o.settings.apiProfiles!.find((p) => p.id === 'p-a')!.apiKey).toBe('sk-fake-local');
  });
  it('加解密往返；密码过短拒绝', async () => {
    const s = withProfiles([prof('p-a', KEY_A)], 'p-a');
    const e = (await encryptKeys(s, 'abcdef', 1000))!;
    expect(JSON.stringify(e)).not.toContain(KEY_A);
    expect(await decryptKeys(e, 'abcdef')).toEqual({ 'p-a': KEY_A });
    await expect(encryptKeys(s, '123')).rejects.toThrow(/至少/);
  });
});
