import { useState } from 'react';
import { useApp } from '../store';
import { useEditTemplate } from '../render/useEditTemplate';
import { withLangOverrides } from '../render/langOverrides';
import type { Lang, TemplateConfig } from '../types';

/**
 * 2026-11：预览右侧的「快捷版式」栏（负责人要求）：页边距等用小步长的加 / 减按钮微调，改完右侧预览立即更新，不用导出就能看空白。
 * 步长刻意很小（页边距 0.5 mm、字号 0.25 pt、行距 0.02、间距 0.5 mm），点一下只动一点点。
 * 「中英文同步」勾选：勾上 = 中英文一起改；取消 = 只改当前查看的那一种语言（英文同样内容通常更占版面，可以单独调）。
 */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
type Side = 'top' | 'right' | 'bottom' | 'left';
type Mg = Record<Side, number>;
type Sp = { sectionGapMm: number; itemGapMm: number };
const LANGS: Lang[] = ['zh', 'en'];

function Stepper({ label, value, onMinus, onPlus, testid, hint }: { label: string; value: string; onMinus: () => void; onPlus: () => void; testid: string; hint?: string }) {
  return (
    <div className="fmt-row" title={hint}>
      <span className="fmt-label">{label}</span>
      <button type="button" aria-label={`${label}减小`} data-testid={`${testid}-minus`} onClick={onMinus}>−</button>
      <span className="fmt-value" data-testid={`${testid}-value`}>{value}</span>
      <button type="button" aria-label={`${label}增大`} data-testid={`${testid}-plus`} onClick={onPlus}>＋</button>
    </div>
  );
}

/** 改页边距 / 间距：不同步时只写 target 语言的覆盖；同步时两种语言一起加减（都没有覆盖就直接改模板本体）。 */
function bump<K extends 'marginMm' | 'spacing'>(x: TemplateConfig, key: K, targets: Lang[], change: (cur: K extends 'marginMm' ? Mg : Sp) => K extends 'marginMm' ? Mg : Sp) {
  const base = () => (key === 'marginMm' ? x.page.marginMm : x.spacing) as never;
  const eff = (l: Lang) => ((key === 'marginMm' ? withLangOverrides(x, l).page.marginMm : withLangOverrides(x, l).spacing) as never);
  const hasOverride = LANGS.some((l) => x.locales[l][key]);
  if (targets.length === 2 && !hasOverride) {
    const v = change(base());
    if (key === 'marginMm') x.page.marginMm = v as Mg; else x.spacing = v as Sp;
    return;
  }
  for (const l of targets) (x.locales[l] as unknown as Record<string, unknown>)[key] = change(eff(l));
  // 两种语言的值又相同了：收回成模板本体的值，保持模板整洁
  const [a, b] = LANGS.map((l) => (x.locales[l][key] ?? eff(l)) as object);
  if (JSON.stringify(a) === JSON.stringify(b)) {
    if (key === 'marginMm') x.page.marginMm = a as Mg; else x.spacing = a as Sp;
    for (const l of LANGS) delete x.locales[l][key];
  }
}

export function FormatPanel({ view }: { view: 'zh' | 'en' | 'both' }) {
  const { template } = useApp();
  const editTpl = useEditTemplate();
  const [syncPref, setSyncPref] = useState(() => { try { return localStorage.getItem('fmtSync') !== '0'; } catch { return true; } });
  const both = view === 'both';
  const sync = both || syncPref;                       // 中英对照时无法只改一种，强制同步
  const lang: Lang = view === 'en' ? 'en' : 'zh';
  const targets: Lang[] = sync ? LANGS : [lang];
  const eff = withLangOverrides(template, lang);
  const mg = eff.page.marginMm, sp = eff.spacing, ty = template.locales[lang].typography;
  const allSame = mg.top === mg.right && mg.right === mg.bottom && mg.bottom === mg.left;
  const setSync = (v: boolean) => { setSyncPref(v); try { localStorage.setItem('fmtSync', v ? '1' : '0'); } catch { /* 无存储时只在本次生效 */ } };
  const shift = (sides: Side[], d: number) => editTpl((x) => bump(x, 'marginMm', targets, (cur) => { const n = { ...cur }; for (const s of sides) n[s] = clamp(n[s] + d, 6, 30); return n; }));
  const typo = (key: 'bodySizePt' | 'lineHeight', d: number, lo: number, hi: number) => editTpl((x) => { for (const l of targets) x.locales[l].typography[key] = clamp(x.locales[l].typography[key] + d, lo, hi); });
  const gap = (key: keyof Sp, d: number) => editTpl((x) => bump(x, 'spacing', targets, (cur) => ({ ...cur, [key]: clamp(cur[key] + d, 0, 10) })));
  const M = (label: string, sides: Side[], id: string) => (
    <Stepper label={label} testid={id} value={`${Math.round(mg[sides[0]] * 10) / 10} mm`} onMinus={() => shift(sides, -0.5)} onPlus={() => shift(sides, 0.5)} />
  );
  return (
    <aside className="fmt-panel card" data-testid="fmt-panel">
      <b>快捷版式</b>
      <label className="fmt-sync"><input type="checkbox" data-testid="fmt-sync" checked={sync} disabled={both} onChange={(e) => setSync(e.target.checked)} />中英文同步调整</label>
      <div className="muted small" data-testid="fmt-scope">
        {both ? '中英对照模式下两种语言一起调；切到「中文版」或「英文版」后可取消同步，单独调。'
          : sync ? '勾选中：调整会同时作用于中文版和英文版。' : `已取消同步：现在只调整${lang === 'zh' ? '中文版' : '英文版'}，另一种语言不变。`}
      </div>
      <div className="muted small">每次点一下只动一点点；右侧预览立即更新，虚线框 = 页边距。</div>
      <div className="fmt-group">
        <Stepper label="页边距（整体）" testid="mg-all" value={allSame ? `${mg.top} mm` : `${mg.top}/${mg.left}`} onMinus={() => shift(['top', 'right', 'bottom', 'left'], -0.5)} onPlus={() => shift(['top', 'right', 'bottom', 'left'], 0.5)} hint="四边一起调整，每次 0.5 mm；数字为 上下/左右" />
        {!allSame && <div className="muted small">当前：上下 {mg.top} mm，左右 {mg.left} mm（整体加减时四边同步变化）</div>}
        <details><summary>分别调整上下 / 左右</summary>
          {M('上', ['top'], 'mg-top')}{M('下', ['bottom'], 'mg-bottom')}{M('左', ['left'], 'mg-left')}{M('右', ['right'], 'mg-right')}
        </details>
      </div>
      <div className="fmt-group">
        <div className="muted small">其他格式</div>
        <Stepper label="正文字号" testid="fs" value={`${ty.bodySizePt} pt`} onMinus={() => typo('bodySizePt', -0.25, 8.5, 12)} onPlus={() => typo('bodySizePt', 0.25, 8.5, 12)} hint="每次 0.25 pt" />
        <Stepper label="行距" testid="lh" value={ty.lineHeight.toFixed(2)} onMinus={() => typo('lineHeight', -0.02, 1.1, 1.7)} onPlus={() => typo('lineHeight', 0.02, 1.1, 1.7)} hint="每次 0.02" />
        <Stepper label="板块间距" testid="sg" value={`${sp.sectionGapMm} mm`} onMinus={() => gap('sectionGapMm', -0.5)} onPlus={() => gap('sectionGapMm', 0.5)} hint="各板块（教育 / 项目 / 技能…）之间" />
        <Stepper label="条目间距" testid="ig" value={`${sp.itemGapMm} mm`} onMinus={() => gap('itemGapMm', -0.5)} onPlus={() => gap('itemGapMm', 0.5)} hint="同一板块内每段经历之间" />
      </div>
      <div className="muted small fmt-tip">小建议：下方空白多 → 先加行距 / 间距，比缩页边距更自然；正式投递页边距一般不小于 12 mm，正文字号不小于 9.5 pt。</div>
    </aside>
  );
}
