import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../store';
import { db } from '../../storage/db';
import { uiStorage } from '../../storage/mode';
import { ocrLocal } from '../../ai/ocr';
import { findDuplicates, nowIso } from '../../tracker/repo';
import { RECRUIT_LABEL, type JobPosting, type RecruitType } from '../../tracker/types';
import {
  defaultPdfLangs, defaultVisionProfileId, draftPosting, EMPTY_FIELDS, extractApplyFields, listGeneratedResumes, matchResume, recordApplication,
  visionApplyFields, visionProfiles, visionSettingsFor, type ApplyFields, type FileBytes, type GeneratedResumeOption,
} from '../../tracker/quickRecord';
import { makeResumePdfs } from '../../tracker/resumePdf';
import type { Lang } from '../../types';

/** 一条待确认的投递记录（一张或几张截图，或只有简历） */
interface Draft {
  id: string; shots: (FileBytes & { url: string })[];
  state: 'reading' | 'ready' | 'saving' | 'saved' | 'error';
  progress?: string; via?: string; error?: string;
  fields: ApplyFields; resumeId: string; langs: Lang[];
  /** '' = 新建岗位；否则合并到该岗位 */
  merge: string; mergeTouched?: boolean;
  savedPostingId?: string; warnings?: string[];
}
const OCR_PROFILE_KEY = 'applyOcrProfile';
let seq = 0;
const newId = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;
const readFile = async (f: File): Promise<FileBytes & { url: string }> => {
  const data = new Uint8Array(await f.arrayBuffer());
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
  return { name: f.name || `截图_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, type: f.type || 'image/png', data, url };
};
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const key = (f: ApplyFields) => `${f.company.replace(/\s/g, '').toLowerCase()}|${f.title.replace(/\s/g, '').toLowerCase()}`;

/** 默认合并目标：同链接 / 同公司同岗位同城市 / 同一岗位分析 → 合并；同公司同岗位且有一边没写城市 → 也合并 */
function autoMerge(postings: JobPosting[], d: Draft, opt: GeneratedResumeOption | null): string {
  const p = draftPosting(d.fields, opt);
  if (p.jobParseId) { const linked = postings.find((x) => x.jobParseId === p.jobParseId); if (linked) return linked.id; }
  if (!p.company.trim() || !p.title.trim()) return '';
  const hits = findDuplicates(postings, p);
  const h = hits.find((x) => x.reason !== 'similar') ?? hits.find((x) => !x.posting.city || !p.city);
  return h?.posting.id ?? '';
}

export function QuickRecord({ postings, onDone, go }: { postings: JobPosting[]; onDone: () => Promise<void> | void; go: (p: string) => void }) {
  const { settings, profile, template } = useApp();
  const [options, setOptions] = useState<GeneratedResumeOption[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [ocrProfile, setOcrProfileS] = useState(() => defaultVisionProfileId(settings, uiStorage.getItem(OCR_PROFILE_KEY)));
  const [pickOnly, setPickOnly] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const optsRef = useRef<GeneratedResumeOption[]>([]);
  const vps = visionProfiles(settings);
  const setOcrProfile = (v: string) => { setOcrProfileS(v); uiStorage.setItem(OCR_PROFILE_KEY, v); };

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { listGeneratedResumes(db).then((o) => { optsRef.current = o; setOptions(o); }); }, []);
  const optOf = (id: string) => options.find((o) => o.resume.id === id) ?? null;
  const patch = (id: string, fn: (d: Draft) => Draft) => setDrafts((ds) => ds.map((d) => (d.id === id ? fn(d) : d)));

  /** 识别一张截图：看图模型一次出字段；失败或没配置 → 本机识别文字 + 文字模型 / 规则 */
  const recognize = useCallback(async (id: string, shot: { url: string }) => {
    const vs = ocrProfile === 'local' ? null : visionSettingsFor(settings, ocrProfile);
    let fields: ApplyFields | null = null, via = '';
    if (vs) {
      try { patch(id, (d) => ({ ...d, progress: `AI 看图识别中（${vs.visionModel}）…` })); fields = await visionApplyFields(vs, shot.url); via = `AI 看图（${vs.visionModel}）`; }
      catch (e) { patch(id, (d) => ({ ...d, progress: `AI 看图失败（${(e as Error).message.slice(0, 60)}），改用本机识别…` })); }
    }
    if (!fields || (!fields.company && !fields.title)) {
      const text = await ocrLocal(shot.url, (p, st) => patch(id, (d) => ({ ...d, progress: `本机识别文字：${/recogniz/.test(st) ? `${Math.round(p * 100)}%` : '加载识别模型（首次约 8 MB）'}` })));
      const r = await extractApplyFields(settings, text);
      fields = fields ? { ...r.fields, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) } as ApplyFields : r.fields;
      via = r.via === 'ai' ? `本机识别 + AI 整理（${settings.model}）` : '本机识别 + 规则提取（未用 AI）';
    }
    return { fields, via };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrProfile, settings]);

  const addShots = useCallback((files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    imgs.forEach((f) => {
      const id = newId();
      setDrafts((ds) => [...ds, { id, shots: [], state: 'reading', progress: '读取图片…', fields: { ...EMPTY_FIELDS }, resumeId: '', langs: ['zh'], merge: '' }]);
      queue.current = queue.current.then(async () => {
        try {
          const shot = await readFile(f);
          patch(id, (d) => ({ ...d, shots: [shot] }));
          const { fields, via } = await recognize(id, shot);
          const opt = matchResume(optsRef.current, fields);
          setDrafts((ds) => {
            const me = ds.find((d) => d.id === id); if (!me) return ds;
            const filled: ApplyFields = { ...fields, company: fields.company || opt?.company || '', title: fields.title || opt?.title || '', appliedAt: fields.appliedAt || nowLocal() };
            const twin = ds.find((d) => d.id !== id && d.state === 'ready' && filled.company && filled.title && key(d.fields) === key(filled));
            if (twin) return ds.filter((d) => d.id !== id).map((d) => (d.id === twin.id ? { ...d, shots: [...d.shots, ...me.shots], via: `${d.via}；已合并同一岗位的另一张截图` } : d));
            return ds.map((d) => (d.id === id ? { ...me, state: 'ready', progress: undefined, via, fields: filled, resumeId: opt?.resume.id ?? '', langs: defaultPdfLangs(opt?.job) } : d));
          });
        } catch (e) {
          patch(id, (d) => ({ ...d, state: 'error', progress: undefined, error: `识别失败：${(e as Error).message}。截图仍会保存，请手动补全字段。`, fields: { ...d.fields, appliedAt: nowLocal() } }));
        }
      });
    });
  }, [recognize]);

  // 粘贴截图（Ctrl+V / ⌘V）
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const fs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (fs.length) { e.preventDefault(); addShots(fs); }
    };
    window.addEventListener('paste', h); return () => window.removeEventListener('paste', h);
  }, [addShots]);

  // 每条草稿的默认合并目标（用户手动选过就不再改）
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setDrafts((ds) => { let ch = false; const n = ds.map((d) => { if (d.mergeTouched || d.state === 'saved' || d.state === 'saving') return d; const m = autoMerge(postings, d, optOf(d.resumeId)); if (m === d.merge) return d; ch = true; return { ...d, merge: m }; }); return ch ? n : ds; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, postings, options]);

  const addResumeOnly = (rid: string) => {
    const opt = optOf(rid); if (!opt) return;
    setDrafts((ds) => [...ds, { id: newId(), shots: [], state: 'ready', via: '来自所选简历（没有截图）', fields: { ...EMPTY_FIELDS, company: opt.company, title: opt.title, appliedAt: nowLocal() }, resumeId: rid, langs: defaultPdfLangs(opt.job), merge: '' }]);
    setPickOnly('');
  };
  const pickResume = (d: Draft, rid: string) => {
    const opt = optOf(rid);
    patch(d.id, (x) => ({ ...x, resumeId: rid, langs: rid ? defaultPdfLangs(opt?.job) : x.langs, fields: { ...x.fields, company: x.fields.company || opt?.company || '', title: x.fields.title || opt?.title || '' } }));
  };

  const save = async (d: Draft) => {
    const opt = optOf(d.resumeId);
    const posting = draftPosting(d.fields, opt);
    if (!posting.company.trim() || !posting.title.trim()) { patch(d.id, (x) => ({ ...x, error: '公司和岗位名称不能为空' })); return; }
    patch(d.id, (x) => ({ ...x, state: 'saving', error: undefined, progress: opt && d.langs.length ? '正在生成并存放简历 PDF…' : '正在保存…' }));
    try {
      let pdfs: (FileBytes & { lang: Lang })[] = []; const warn: string[] = [];
      if (opt && d.langs.length) {
        try { const r = await makeResumePdfs(profile, template, opt.resume, opt.job, { company: posting.company, title: posting.title }, d.langs); pdfs = r.files; warn.push(...r.errors.map((e) => `PDF 生成：${e}`)); }
        catch (e) { warn.push(`简历 PDF 没有生成（${(e as Error).message}），可稍后在岗位详情里点「生成工具版 PDF」`); }
      }
      const r = await recordApplication(db, {
        posting, mergeInto: d.merge || undefined,
        appliedAt: d.fields.appliedAt ? new Date(d.fields.appliedAt).toISOString() : nowIso(),
        screenshots: d.shots.map(({ name, type, data }) => ({ name, type, data })),
        snapshot: opt ? { resume: opt.resume, profile, job: opt.job, label: opt.label, languages: d.langs.length ? d.langs : ['zh', 'en'] } : undefined,
        pdfs, note: d.fields.statusText ? `记录投递（截图：${d.fields.statusText}）` : '记录投递',
      });
      patch(d.id, (x) => ({ ...x, state: 'saved', progress: undefined, savedPostingId: r.postingId, warnings: [...warn, ...r.warnings], via: r.merged ? '已合并到已有岗位' : '已新建岗位' }));
      await onDone();
    } catch (e) { patch(d.id, (x) => ({ ...x, state: 'ready', progress: undefined, error: `保存失败：${(e as Error).message}` })); }
  };
  const pending = drafts.filter((d) => d.state === 'ready' || d.state === 'error');
  const saveAll = async () => { for (const d of pending) await save(d); };

  return (
    <div className="card quick-record" data-testid="quick-record">
      <h3>记录投递</h3>
      <p className="muted small">拖入投递成功的截图（可多张），或选一份之前生成的简历，公司、岗位、时间、平台会自动填好，你只需检查后保存。截图和简历只存在本机浏览器。</p>
      <div className={`dropzone${drag ? ' drag' : ''}`} data-testid="qr-drop" onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); addShots([...e.dataTransfer.files]); }}>
        <div className="dz-icon">📸</div>
        <b>点击选择、拖入，或直接 Ctrl+V 粘贴投递成功截图</b>
        <div className="muted small">一张截图 = 一条投递；同一岗位的多张截图会自动合在一起</div>
        <input ref={fileRef} data-testid="qr-input" type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addShots([...e.target.files]); e.target.value = ''; }} />
      </div>
      <div className="row small">
        <span>截图识别用：</span>
        <select data-testid="qr-ocr" value={ocrProfile} onChange={(e) => setOcrProfile(e.target.value)}>
          {vps.map((p) => <option key={p.id} value={p.id}>{p.name}（看图模型 {p.visionModel}）</option>)}
          <option value="local">本机文字识别（不联网，较慢、准确度一般）</option>
        </select>
        {!vps.length && <span className="muted">还没有带「截图识别（多模态）模型」的 API 配置，可在「设置 → AI API 管理」添加通义千问。</span>}
      </div>
      <div className="row small">
        <span>没有截图？直接选一份生成过的简历：</span>
        <select data-testid="qr-resume-only" value={pickOnly} onChange={(e) => setPickOnly(e.target.value)} style={{ maxWidth: 420 }}>
          <option value="">（选择简历）</option>{options.map((o) => <option key={o.resume.id} value={o.resume.id}>{o.label}</option>)}
        </select>
        <button data-testid="qr-resume-only-add" disabled={!pickOnly} onClick={() => addResumeOnly(pickOnly)}>新建一条</button>
        {!options.length && <span className="muted">（还没有生成过简历）</span>}
      </div>

      {drafts.map((d) => {
        const opt = optOf(d.resumeId);
        const posting = draftPosting(d.fields, opt);
        const hits = posting.company.trim() && posting.title.trim() ? findDuplicates(postings, posting) : [];
        const mergeTarget = d.merge ? postings.find((p) => p.id === d.merge) : undefined;
        const mergeChoices = [...new Map([...(mergeTarget ? [mergeTarget] : []), ...hits.map((h) => h.posting)].map((p) => [p.id, p])).values()];
        const busy = d.state === 'reading' || d.state === 'saving';
        const set = <K extends keyof ApplyFields>(k: K, v: ApplyFields[K]) => patch(d.id, (x) => ({ ...x, fields: { ...x.fields, [k]: v } }));
        return (
          <div key={d.id} className={`card qr-draft${d.state === 'saved' ? ' done' : ''}`} data-testid="qr-draft">
            <div className="row">
              {d.shots.map((s, i) => <img key={i} src={s.url} alt="投递截图" style={{ maxHeight: 110, maxWidth: 160, border: '1px solid var(--line)' }} />)}
              <div style={{ flex: 1 }}>
                {d.progress && <div className="muted small" data-testid="qr-progress">⏳ {d.progress}</div>}
                {d.via && !d.progress && <div className="muted small" data-testid="qr-via">{d.state === 'saved' ? '✅ ' : '识别方式：'}{d.via}</div>}
                {d.error && <div className="notice error small">{d.error}</div>}
                {d.state === 'saved' && <div className="row small"><b data-testid="qr-saved">已保存：{posting.company} · {posting.title}</b><button className="link" data-testid="qr-open" onClick={() => go(`applications/${d.savedPostingId}`)}>打开岗位 →</button></div>}
                {d.warnings?.map((w, i) => <div key={i} className="notice warn small">{w}</div>)}
              </div>
              {d.state !== 'saving' && <button className="link" data-testid="qr-remove" onClick={() => setDrafts((ds) => ds.filter((x) => x.id !== d.id))}>{d.state === 'saved' ? '收起' : '移除'}</button>}
            </div>
            {d.state !== 'saved' && <>
              <div className="grid2">
                <label>公司 *<input data-testid="qr-company" disabled={busy} value={d.fields.company} onChange={(e) => set('company', e.target.value)} /></label>
                <label>岗位 *<input data-testid="qr-title" disabled={busy} value={d.fields.title} onChange={(e) => set('title', e.target.value)} /></label>
                <label>城市<input data-testid="qr-city" disabled={busy} value={d.fields.city} onChange={(e) => set('city', e.target.value)} /></label>
                <label>投递时间<input data-testid="qr-at" type="datetime-local" disabled={busy} value={d.fields.appliedAt} onChange={(e) => set('appliedAt', e.target.value)} /></label>
                <label>投递平台<input data-testid="qr-platform" disabled={busy} value={d.fields.sourcePlatform} placeholder="官网 / 牛客 / Boss…" onChange={(e) => set('sourcePlatform', e.target.value)} /></label>
                <label>招聘类型<select data-testid="qr-type" disabled={busy} value={d.fields.recruitType ?? ''} onChange={(e) => set('recruitType', (e.target.value || undefined) as RecruitType | undefined)}><option value="">（未选择）</option>{Object.entries(RECRUIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              </div>
              <div className="row small">
                <span>投递用的简历：</span>
                <select data-testid="qr-resume" disabled={busy} value={d.resumeId} onChange={(e) => pickResume(d, e.target.value)} style={{ maxWidth: 420 }}>
                  <option value="">（不关联简历）</option>{options.map((o) => <option key={o.resume.id} value={o.resume.id}>{o.label}</option>)}
                </select>
                {opt && <>
                  <span>同时存放工具生成的 PDF：</span>
                  {(['zh', 'en'] as Lang[]).map((l) => <label key={l} className="check"><input type="checkbox" data-testid={`qr-pdf-${l}`} disabled={busy} checked={d.langs.includes(l)} onChange={(e) => patch(d.id, (x) => ({ ...x, langs: e.target.checked ? [...x.langs, l] : x.langs.filter((y) => y !== l) }))} />{l === 'zh' ? '中文' : '英文'}</label>)}
                </>}
              </div>
              {mergeChoices.length > 0 && <div className="notice warn small" data-testid="qr-dup">
                岗位库里已有相同岗位：
                <select data-testid="qr-merge" value={d.merge} onChange={(e) => patch(d.id, (x) => ({ ...x, merge: e.target.value, mergeTouched: true }))}>
                  {mergeChoices.map((p) => <option key={p.id} value={p.id}>合并到「{p.company} · {p.title}{p.city ? ` · ${p.city}` : ''}」（推荐，不会重复）</option>)}
                  <option value="">另建一个新岗位</option>
                </select>
              </div>}
              <div className="row end"><button className="primary" data-testid="qr-save" disabled={busy || !d.fields.company.trim() || !d.fields.title.trim()} onClick={() => save(d)}>{d.state === 'saving' ? '保存中…' : d.merge ? '保存（合并）' : '保存'}</button></div>
            </>}
          </div>);
      })}
      {pending.length > 1 && <div className="row end"><button className="primary" data-testid="qr-save-all" disabled={pending.some((d) => !d.fields.company.trim() || !d.fields.title.trim())} onClick={saveAll}>全部保存（{pending.length} 条）</button></div>}
    </div>
  );
}
