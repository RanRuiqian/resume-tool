import { useRef, useState } from 'react';
import { SmartImport } from '../components/SmartImport';
import { useApp } from '../store';
import { useT } from '../i18n';
import { LTField } from '../components/LTField';
import type { LocalizedText, ProfileDoc, Lang } from '../types';
import { uid, needsTranslation, forEachText } from '../locale/text';
import { normalizeProfile, exportProfileJson } from '../storage/profileIO';
import { translateProfile } from '../ai/translate';
import sample from '../sample/sample-profile.json';
import { downloadBytes, fileToDataUrl } from '../utils/download';

type ListKey = 'education' | 'work' | 'projects' | 'skills' | 'certificates' | 'awards';
const TABS: { key: 'basic' | ListKey | 'glossary'; label: string }[] = [
  { key: 'basic', label: '基本信息' }, { key: 'education', label: '教育' }, { key: 'work', label: '工作' }, { key: 'projects', label: '项目' },
  { key: 'skills', label: '技能' }, { key: 'certificates', label: '证书' }, { key: 'awards', label: '获奖' }, { key: 'glossary', label: '专有名词表' },
];
const LT_FIELDS: Record<ListKey, [string, string, boolean?][]> = {
  education: [['school', '学校'], ['degree', '学位'], ['major', '专业']],
  work: [['company', '公司'], ['title', '职位']],
  projects: [['name', '项目名称'], ['role', '角色']],
  skills: [['name', '技能'], ['category', '分类']],
  certificates: [['name', '证书名称'], ['issuer', '颁发机构']],
  awards: [['name', '奖项'], ['issuer', '颁发机构']],
};
const BULLETS: Partial<Record<ListKey, string>> = { work: 'bullets', projects: 'bullets', education: 'highlights' };

function newEntry(k: ListKey): Record<string, unknown> {
  const id = uid(k);
  const base: Record<string, unknown> = { id, enabled: true };
  LT_FIELDS[k].forEach(([f]) => (base[f] = {}));
  if (BULLETS[k]) base[BULLETS[k]!] = [];
  if (k === 'work' || k === 'projects') { base.tags = []; base.start = ''; base.end = ''; }
  if (k === 'education') { base.start = ''; base.end = ''; }
  if (k === 'certificates' || k === 'awards') base.date = '';
  return base;
}

export function ProfilePage() {
  const { profile, setProfile, settings } = useApp();
  const t = useT();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('basic');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const upd = (fn: (p: ProfileDoc) => void) => { const n = structuredClone(profile); fn(n); setProfile(n); };

  let pending: Record<Lang, number> = { zh: 0, en: 0 }, machine = 0;
  forEachText(profile, (x) => { (['zh', 'en'] as Lang[]).forEach((l) => { if (needsTranslation(x, l)) pending = { ...pending, [l]: pending[l] + 1 }; if (x.status?.[l] === 'machine') machine++; }); });

  const doTranslate = async (to: Lang) => {
    setBusy('翻译中…'); setMsg('');
    try { const r = await translateProfile(settings, profile, to); setProfile(r.profile); setMsg(`已补译 ${r.count} 个字段，标记为「机翻待校对」，请逐条确认。`); }
    catch (e) { setMsg('翻译失败：' + (e as Error).message); }
    finally { setBusy(''); }
  };
  const doImport = async (f: File) => {
    try { setProfile(normalizeProfile(JSON.parse(await f.text()))); setMsg('导入成功'); } catch (e) { setMsg('导入失败：' + (e as Error).message); }
  };

  const list = (k: ListKey) => {
    const arr = profile[k] as unknown as Record<string, unknown>[];
    return (
      <div>
        {arr.map((e, i) => (
          <div key={e.id as string} className={`card entry ${e.enabled ? '' : 'disabled'}`}>
            <div className="entry-head">
              <label className="check"><input type="checkbox" checked={!!e.enabled} onChange={(ev) => upd((p) => { (p[k][i] as { enabled: boolean }).enabled = ev.target.checked; })} /> 启用（生成时入池）</label>
              <span className="muted small">{e.id as string}</span>
              <span className="spacer" />
              <button disabled={i === 0} onClick={() => upd((p) => { const a = p[k] as unknown[]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })}>↑</button>
              <button disabled={i === arr.length - 1} onClick={() => upd((p) => { const a = p[k] as unknown[]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; })}>↓</button>
              <button className="danger" onClick={() => confirm('删除此条目？') && upd((p) => { (p[k] as unknown[]).splice(i, 1); })}>{t('remove')}</button>
            </div>
            {LT_FIELDS[k].map(([f, label]) => (
              <LTField key={f} label={label} value={e[f] as LocalizedText} onChange={(v) => upd((p) => { (p[k][i] as unknown as Record<string, unknown>)[f] = v; })} />
            ))}
            <div className="row">
              {'start' in e && <label>开始 <input placeholder="YYYY-MM" value={e.start as string} onChange={(ev) => upd((p) => { (p[k][i] as unknown as Record<string, unknown>).start = ev.target.value; })} /></label>}
              {'end' in e && <label>结束 <input placeholder="YYYY-MM 或 present" value={e.end as string} onChange={(ev) => upd((p) => { (p[k][i] as unknown as Record<string, unknown>).end = ev.target.value; })} /></label>}
              {'date' in e && <label>日期 <input placeholder="YYYY-MM" value={e.date as string} onChange={(ev) => upd((p) => { (p[k][i] as unknown as Record<string, unknown>).date = ev.target.value; })} /></label>}
              {'tags' in e && <label className="grow">标签（逗号分隔，不翻译） <input value={(e.tags as string[]).join(', ')} onChange={(ev) => upd((p) => { (p[k][i] as unknown as Record<string, unknown>).tags = ev.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean); })} /></label>}
              {k === 'skills' && <label>熟练度 <input value={(e.level as string) ?? ''} onChange={(ev) => upd((p) => { p.skills[i].level = ev.target.value; })} /></label>}
            </div>
            {BULLETS[k] && (
              <div className="bullets">
                <div className="muted small">{k === 'education' ? '亮点' : '经历要点 / 量化成果'}（每条有独立 id，生成时可追溯）</div>
                {(e[BULLETS[k]!] as LocalizedText[]).map((b, j) => (
                  <div key={b.id ?? j} className="bullet-row">
                    <LTField value={b} multiline onChange={(v) => upd((p) => { ((p[k][i] as unknown as Record<string, LocalizedText[]>)[BULLETS[k]!])[j] = v; })} />
                    <button className="danger small" onClick={() => upd((p) => { ((p[k][i] as unknown as Record<string, LocalizedText[]>)[BULLETS[k]!]).splice(j, 1); })}>×</button>
                  </div>
                ))}
                <button onClick={() => upd((p) => { ((p[k][i] as unknown as Record<string, LocalizedText[]>)[BULLETS[k]!]).push({ id: uid(`${e.id}-b`) }); })}>+ 添加要点</button>
              </div>
            )}
          </div>
        ))}
        <button className="primary" onClick={() => upd((p) => { (p[k] as unknown[]).push(newEntry(k)); })}>+ {t('add')}</button>
      </div>
    );
  };

  const pr = profile.profile;
  return (
    <div className="page">
      <div className="toolbar">
        <h2>{t('navProfile')}</h2>
        <span className="spacer" />
        <button onClick={() => { setProfile(normalizeProfile(sample)); setMsg('已载入示例资料（李明）'); }}>{t('loadSample')}</button>
        <button onClick={() => fileRef.current?.click()}>{t('importJson')}</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        <button onClick={() => downloadBytes(new TextEncoder().encode(exportProfileJson(profile)), 'resume-profile-backup.json', 'application/json')}>{t('exportJson')}</button>
        <button disabled={!!busy} onClick={() => doTranslate('en')}>{t('translateToEn')}（{pending.en}）</button>
        <button disabled={!!busy} onClick={() => doTranslate('zh')}>{t('translateToZh')}（{pending.zh}）</button>
      </div>
      <SmartImport />
      {(busy || msg) && <div className="notice">{busy || msg}</div>}
      {machine > 0 && <div className="notice warn">有 {machine} 个字段为「机翻待校对」，导出前建议逐条确认。</div>}
      <div className="tabs">{TABS.map((x) => <button key={x.key} className={tab === x.key ? 'active' : ''} onClick={() => setTab(x.key)}>{x.label}{x.key !== 'basic' && x.key !== 'glossary' ? `（${profile[x.key].length}）` : ''}</button>)}</div>
      {tab === 'basic' && (
        <div className="card">
          <div className="photo-row">
            <div>
              {pr.photo ? <img src={pr.photo} className="photo-thumb" /> : <div className="photo-thumb empty">无照片</div>}
            </div>
            <div>
              <label>照片（仅本地保存，不发送给 AI）<input type="file" accept="image/png,image/jpeg" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const d = await fileToDataUrl(f); upd((p) => { p.profile.photo = d; }); } }} /></label>
              {pr.photo && <button className="danger" onClick={() => upd((p) => { delete p.profile.photo; })}>移除照片</button>}
            </div>
          </div>
          <LTField label="姓名" value={pr.name} onChange={(v) => upd((p) => { p.profile.name = v; })} />
          <LTField label="职业头衔" value={pr.headline} onChange={(v) => upd((p) => { p.profile.headline = v; })} />
          <LTField label="个人简介" multiline value={pr.summary} onChange={(v) => upd((p) => { p.profile.summary = v; })} />
          <LTField label="所在城市" value={pr.contacts.location} onChange={(v) => upd((p) => { p.profile.contacts.location = v; })} />
          <div className="grid2">
            {(['email', 'phone', 'github', 'linkedin', 'website'] as const).map((f) => (
              <label key={f}>{f}<input value={pr.contacts[f] ?? ''} onChange={(e) => upd((p) => { p.profile.contacts[f] = e.target.value; })} /></label>
            ))}
          </div>
          <h4>个人信息（仅中文版可选显示，默认关闭；在「版式设置」中勾选）</h4>
          <div className="grid2">
            {([['birth', '出生年月'], ['gender', '性别'], ['hometown', '籍贯'], ['politics', '政治面貌']] as const).map(([f, l]) => (
              <label key={f}>{l}<input value={pr.personal[f] ?? ''} onChange={(e) => upd((p) => { p.profile.personal[f] = e.target.value; })} /></label>
            ))}
          </div>
        </div>
      )}
      {tab !== 'basic' && tab !== 'glossary' && list(tab)}
      {tab === 'glossary' && (
        <div className="card">
          <p className="muted">公司名、产品名、学校官方英文名等固定译法。翻译与生成时强制遵循。</p>
          {profile.glossary.map((g, i) => (
            <div key={i} className="row">
              <input placeholder="中文" value={g.zh} onChange={(e) => upd((p) => { p.glossary[i].zh = e.target.value; })} />
              <span>⇄</span>
              <input placeholder="English" value={g.en} onChange={(e) => upd((p) => { p.glossary[i].en = e.target.value; })} />
              <button className="danger" onClick={() => upd((p) => { p.glossary.splice(i, 1); })}>×</button>
            </div>
          ))}
          <button className="primary" onClick={() => upd((p) => { p.glossary.push({ zh: '', en: '' }); })}>+ {t('add')}</button>
        </div>
      )}
    </div>
  );
}

