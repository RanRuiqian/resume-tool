import { useState } from 'react';
import { useApp } from '../store';
import { useT } from '../i18n';
import type { Lang, ModuleKey, TemplateConfig, PhotoPosition, PersonalInfo } from '../types';
import { MODULE_KEYS } from '../types';
import { FONT_OPTIONS, FORMAL_PRESETS, engineeringBaseOf } from '../templates';
import type { FormalPreset } from '../templates';
import { buildLayout } from '../render/layout';
import { Preview } from '../render/Preview';
import { uid } from '../locale/text';

const MOD_LABEL: Record<ModuleKey, string> = { summary: '简介', work: '工作', projects: '项目', education: '教育', skills: '技能', campus: '校园', certificates: '证书', awards: '获奖' };

export function LayoutPage() {
  const { templates, template, setTemplateId, saveTemplate, deleteTemplate, profile, resume } = useApp();
  const t = useT();
  const [lang, setLang] = useState<Lang>('zh');
  const [view, setView] = useState<'zh' | 'en' | 'both'>('zh');
  const [json, setJson] = useState<string | null>(null);
  const tpl = template;
  const engBase = engineeringBaseOf(tpl);
  const activePreset = FORMAL_PRESETS.find((p) => p.templateId === engBase && p.lang === lang) ?? null;
  const pick = (p: FormalPreset) => { setTemplateId(p.templateId); setLang(p.lang); setView(p.lang); };
  const togglePhoto = () => { if (!activePreset) return; const t = FORMAL_PRESETS.find((p) => p.lang === activePreset.lang && p.photo !== activePreset.photo)!; pick(t); };
  const photoWanted = tpl.locales[lang].photo.enabled;
  const noPhoto = photoWanted && !profile.profile.photo;
  const editable = !tpl.builtin;
  /** 内置模板修改时自动另存为自定义模板（F4.3） */
  const upd = (fn: (x: TemplateConfig) => void) => {
    const n = structuredClone(tpl);
    if (n.builtin) { n.builtin = false; n.id = uid('tpl-custom'); n.name = { zh: `${tpl.name.zh}（自定义）`, en: `${tpl.name.en} (custom)` }; }
    fn(n); saveTemplate(n); setTemplateId(n.id);
  };
  const loc = tpl.locales[lang];
  const order = loc.moduleOrderOverride ?? tpl.moduleOrder;
  const move = (i: number, d: number) => upd((x) => {
    const arr = [...(x.locales[lang].moduleOrderOverride ?? x.moduleOrder)];
    const j = i + d; if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    if (x.locales[lang].moduleOrderOverride) x.locales[lang].moduleOrderOverride = arr; else x.moduleOrder = arr;
  });

  return (
    <div className="page">
      <div className="toolbar"><h2>{t('navLayout')}</h2></div>
      <div className="card preset-chooser" data-testid="preset-chooser">
        <div className="row"><h4>正式版预设（工科）</h4><span className="muted small">四套共用同一份资料库与同一套渲染，切换预设不会修改母库；选中后仍可在下方自定义。</span></div>
        <div className="preset-cards">
          {FORMAL_PRESETS.map((p) => {
            const t = templates.find((x) => x.id === p.templateId)!;
            const on = activePreset?.id === p.id;
            return (
              <button key={p.id} className={`preset-card${on ? ' active' : ''}`} onClick={() => pick(p)} data-preset={p.id} aria-pressed={on}>
                <div className="preset-thumb"><Preview m={buildLayout(profile, t, p.lang, resume)} scale={0.2} /></div>
                <div className="preset-meta">
                  <b>{p.label}</b>
                  <span className="small">{p.lang === 'zh' ? '中文' : 'English'} · {p.photo ? '有照片' : '无照片'}</span>
                  <span className={`small tag${p.recommended ? ' ok' : ''}`}>{p.recommended ? (p.lang === 'zh' ? '网申推荐' : '网申推荐 · Recommended') : '用于要求照片的单位'}</span>
                  {on && <span className="small tag cur">当前预览</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="row small" data-testid="preset-status">
          {activePreset ? <>当前预览：<b>{activePreset.label}</b>（{activePreset.note}）{tpl.builtin ? '' : ' · 已自定义'}
            <button onClick={togglePhoto} data-testid="preset-photo-toggle">{activePreset.photo ? '关闭照片（切到无照片版）' : '开启照片（切到有照片版）'}</button></>
            : <>当前模板「{tpl.name.zh}」不是工科正式版预设（你的选择已保留）；点击上方卡片即可切换。</>}
          <span className="muted">无照片版结构简单、便于网申系统解析，但不保证所有 ATS 都能正确识别。</span>
        </div>
        {noPhoto && <div className="notice warn" data-testid="photo-missing">当前样式需要证件照，但资料库还没有上传照片：导出的文件不含照片，页眉会自动收拢。请在资料库上传本人真实证件照；本工具不会生成或替换人像，照片也不会发送给 AI。</div>}
      </div>
      <div className="layout-grid">
        <div className="card form">
          <label>模板<select value={tpl.id} onChange={(e) => setTemplateId(e.target.value)}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name.zh}{x.builtin ? '（内置）' : ''}</option>)}</select></label>
          {!editable && <div className="muted small">内置模板：修改任意设置会自动另存为自定义模板。</div>}
          {editable && (
            <div className="row">
              <input value={tpl.name.zh} onChange={(e) => upd((x) => { x.name.zh = e.target.value; })} />
              <button className="danger" onClick={() => confirm('删除该自定义模板？') && deleteTemplate(tpl.id)}>删除模板</button>
            </div>
          )}
          <h4>共享版式</h4>
          <div className="grid2">
            <label>栏数<select value={tpl.layout.columns} onChange={(e) => upd((x) => { x.layout.columns = Number(e.target.value) as 1 | 2; if (x.layout.columns === 2 && !x.layout.sidebarModules.length) x.layout.sidebarModules = ['education', 'skills', 'certificates', 'awards']; })}><option value={1}>单栏</option><option value={2}>双栏</option></select></label>
            <label>标题样式<select value={tpl.layout.titleStyle ?? 'underline'} onChange={(e) => upd((x) => { x.layout.titleStyle = e.target.value as 'underline' | 'bar' | 'band' | 'rule'; })}><option value="rule">细灰线（工科）</option><option value="underline">下划线</option><option value="bar">左侧色条</option><option value="band">色块</option></select></label>
            <label>页眉对齐<select value={tpl.layout.headerAlign ?? 'left'} onChange={(e) => upd((x) => { x.layout.headerAlign = e.target.value as 'left' | 'center'; })}><option value="left">左对齐</option><option value="center">居中</option></select></label>
            {tpl.layout.columns === 2 && <label>侧栏宽度 %<input type="number" min={20} max={45} value={tpl.layout.sidebarWidthPercent} onChange={(e) => upd((x) => { x.layout.sidebarWidthPercent = Number(e.target.value); })} /></label>}
            <label>页眉样式<select value={tpl.layout.headerStyle} onChange={(e) => upd((x) => { x.layout.headerStyle = e.target.value as 'band' | 'plain'; })}><option value="plain">细线</option><option value="band">强调色粗线</option></select></label>
            <label>纸张<select value={tpl.page.size} onChange={(e) => upd((x) => { x.page.size = e.target.value as 'A4' | 'LETTER'; })}><option>A4</option><option value="LETTER">Letter</option></select></label>
            <label>目标页数<input type="number" min={1} max={2} value={tpl.page.targetPages} onChange={(e) => upd((x) => { x.page.targetPages = Number(e.target.value); })} /></label>
            <label>页边距 mm<input type="number" value={tpl.page.marginMm.left} onChange={(e) => upd((x) => { const v = Number(e.target.value); x.page.marginMm = { top: v, right: v, bottom: v, left: v }; })} /></label>
            {(['primary', 'accent', 'text', 'muted'] as const).map((c) => <label key={c}>颜色·{c}<input type="color" value={tpl.colors[c]} onChange={(e) => upd((x) => { x.colors[c] = e.target.value; })} /></label>)}
            <label>模块间距 mm<input type="number" step={0.5} value={tpl.spacing.sectionGapMm} onChange={(e) => upd((x) => { x.spacing.sectionGapMm = Number(e.target.value); })} /></label>
            <label>条目间距 mm<input type="number" step={0.5} value={tpl.spacing.itemGapMm} onChange={(e) => upd((x) => { x.spacing.itemGapMm = Number(e.target.value); })} /></label>
          </div>
          <h4>语言变体 <span className="seg">{(['zh', 'en'] as Lang[]).map((l) => <button key={l} className={lang === l ? 'active' : ''} onClick={() => { setLang(l); setView(l); }}>{l === 'zh' ? '中文版' : 'English'}</button>)}</span></h4>
          <div className="grid2">
            <label className="check"><input type="checkbox" checked={loc.photo.enabled} onChange={(e) => upd((x) => { x.locales[lang].photo.enabled = e.target.checked; if (e.target.checked && x.locales[lang].photo.position === 'none') x.locales[lang].photo.position = 'right'; })} /> 显示照片</label>
            <label>照片位置<select value={loc.photo.enabled ? loc.photo.position : 'none'} onChange={(e) => upd((x) => { const v = e.target.value as PhotoPosition; x.locales[lang].photo.position = v; x.locales[lang].photo.enabled = v !== 'none'; })}><option value="left">左</option><option value="right">右</option><option value="none">不显示</option></select></label>
            <label>照片高度 mm<input type="number" value={loc.photo.sizeMm} onChange={(e) => upd((x) => { x.locales[lang].photo.sizeMm = Number(e.target.value); })} /></label>
            <label>字体<select value={loc.typography.fontFamily} onChange={(e) => upd((x) => { x.locales[lang].typography.fontFamily = e.target.value; })}>{FONT_OPTIONS.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>正文字号 pt<input type="number" step={0.5} value={loc.typography.bodySizePt} onChange={(e) => upd((x) => { x.locales[lang].typography.bodySizePt = Number(e.target.value); })} /></label>
            <label>姓名字号 pt<input type="number" value={loc.typography.nameSizePt} onChange={(e) => upd((x) => { x.locales[lang].typography.nameSizePt = Number(e.target.value); })} /></label>
            <label>行高<input type="number" step={0.05} value={loc.typography.lineHeight} onChange={(e) => upd((x) => { x.locales[lang].typography.lineHeight = Number(e.target.value); })} /></label>
            <label>日期格式<select value={loc.dateFormat} onChange={(e) => upd((x) => { x.locales[lang].dateFormat = e.target.value as typeof loc.dateFormat; })}>{['YYYY.MM', 'MMM YYYY', 'YYYY-MM', 'MM/YYYY'].map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>“至今”文案<input value={loc.presentLabel} onChange={(e) => upd((x) => { x.locales[lang].presentLabel = e.target.value; })} /></label>
          </div>
          {lang === 'zh' && (
            <div className="row">个人信息：{([['birth', '出生年月'], ['gender', '性别'], ['hometown', '籍贯'], ['politics', '政治面貌']] as [keyof PersonalInfo, string][]).map(([f, l]) => (
              <label key={f} className="check"><input type="checkbox" checked={loc.personalFields.includes(f)} onChange={(e) => upd((x) => { const a = x.locales.zh.personalFields.filter((y) => y !== f); x.locales.zh.personalFields = e.target.checked ? [...a, f] : a; })} />{l}</label>
            ))}</div>
          )}
          <h4>模块顺序与标题（{lang === 'zh' ? '中文版' : 'English'}）
            <label className="check small"><input type="checkbox" checked={!!loc.moduleOrderOverride} onChange={(e) => upd((x) => { x.locales[lang].moduleOrderOverride = e.target.checked ? [...x.moduleOrder] : null; })} />此语言单独排序</label>
          </h4>
          {order.map((k, i) => (
            <div key={k} className="row mod-row">
              <span className="mod-key">{MOD_LABEL[k]}</span>
              <input value={loc.sectionTitles[k]} onChange={(e) => upd((x) => { x.locales[lang].sectionTitles[k] = e.target.value; })} />
              {tpl.layout.columns === 2 && <label className="check small"><input type="checkbox" checked={tpl.layout.sidebarModules.includes(k)} onChange={(e) => upd((x) => { const a = x.layout.sidebarModules.filter((y) => y !== k); x.layout.sidebarModules = e.target.checked ? [...a, k] : a; })} />侧栏</label>}
              <button onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button onClick={() => move(i, 1)} disabled={i === order.length - 1}>↓</button>
            </div>
          ))}
          {MODULE_KEYS.filter((k) => !order.includes(k)).length > 0 && <div className="muted small">隐藏的模块：{MODULE_KEYS.filter((k) => !order.includes(k)).join(', ')}</div>}
          <h4>模板 JSON</h4>
          {json === null ? <button onClick={() => setJson(JSON.stringify(tpl, null, 2))}>查看 / 编辑 JSON</button> : (
            <>
              <textarea rows={14} className="mono" value={json} onChange={(e) => setJson(e.target.value)} />
              <div className="row"><button onClick={() => setJson(null)}>关闭</button><button className="primary" onClick={() => { try { const v = JSON.parse(json) as TemplateConfig; upd((x) => Object.assign(x, v, { id: x.id, builtin: false })); setJson(null); } catch (e) { alert('JSON 错误：' + (e as Error).message); } }}>应用</button></div>
            </>
          )}
        </div>
        <div className="card">
          <div className="row"><h4>实时预览</h4>{(['zh', 'en', 'both'] as const).map((v) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v === 'zh' ? 'CN' : v === 'en' ? 'EN' : '并排'}</button>)}</div>
          <div className="previews">{(view === 'both' ? (['zh', 'en'] as Lang[]) : [view]).map((l) => <Preview key={l} m={buildLayout(profile, tpl, l, resume)} scale={view === 'both' ? 0.42 : 0.7} />)}</div>
        </div>
      </div>
    </div>
  );
}
