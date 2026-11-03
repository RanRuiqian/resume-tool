import { useApp } from '../store';
import { useEditTemplate } from '../render/useEditTemplate';
import type { TemplateConfig } from '../types';

/**
 * 2026-11：预览右侧的「快捷版式」栏（负责人要求）：页边距等用小步长的加 / 减按钮微调，改完右侧预览立即更新，不用导出就能看空白。
 * 步长刻意很小（页边距 0.5 mm、字号 0.25 pt、行距 0.02、间距 0.5 mm），点一下只动一点点。
 */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
type Side = 'top' | 'right' | 'bottom' | 'left';

function Stepper({ label, value, unit, onMinus, onPlus, testid, hint }: { label: string; value: string; unit: string; onMinus: () => void; onPlus: () => void; testid: string; hint?: string }) {
  return (
    <div className="fmt-row" title={hint}>
      <span className="fmt-label">{label}</span>
      <button type="button" aria-label={`${label}减小`} data-testid={`${testid}-minus`} onClick={onMinus}>−</button>
      <span className="fmt-value" data-testid={`${testid}-value`}>{value}{unit}</span>
      <button type="button" aria-label={`${label}增大`} data-testid={`${testid}-plus`} onClick={onPlus}>＋</button>
    </div>
  );
}

export function FormatPanel() {
  const { template } = useApp();
  const editTpl = useEditTemplate();
  const mg = template.page.marginMm;
  const allSame = mg.top === mg.right && mg.right === mg.bottom && mg.bottom === mg.left;
  const shift = (sides: Side[], d: number) => editTpl((x: TemplateConfig) => { for (const s of sides) x.page.marginMm[s] = clamp(x.page.marginMm[s] + d, 6, 30); });
  const ty = template.locales.zh.typography;
  const typo = (key: 'bodySizePt' | 'lineHeight', d: number, lo: number, hi: number) => editTpl((x) => { for (const l of ['zh', 'en'] as const) x.locales[l].typography[key] = clamp(x.locales[l].typography[key] + d, lo, hi); });
  const gap = (key: 'sectionGapMm' | 'itemGapMm', d: number) => editTpl((x) => { x.spacing[key] = clamp(x.spacing[key] + d, 0, 10); });
  const M = (label: string, sides: Side[], id: string) => (
    <Stepper label={label} testid={id} unit=" mm" value={String(Math.round(mg[sides[0]] * 10) / 10)} onMinus={() => shift(sides, -0.5)} onPlus={() => shift(sides, 0.5)} />
  );
  return (
    <aside className="fmt-panel card" data-testid="fmt-panel">
      <b>快捷版式</b>
      <div className="muted small">每次点一下只动一点点；右侧预览立即更新，虚线框 = 页边距。</div>
      <div className="fmt-group">
        <Stepper label="页边距（整体）" testid="mg-all" unit="" value={allSame ? `${mg.top} mm` : `${mg.top}/${mg.left}`} onMinus={() => shift(['top', 'right', 'bottom', 'left'], -0.5)} onPlus={() => shift(['top', 'right', 'bottom', 'left'], 0.5)} hint="四边一起调整，每次 0.5 mm；数字为 上下/左右" />
        {!allSame && <div className="muted small">当前：上下 {mg.top} mm，左右 {mg.left} mm（整体加减时四边同步变化）</div>}
        <details><summary>分别调整上下 / 左右</summary>
          {M('上', ['top'], 'mg-top')}{M('下', ['bottom'], 'mg-bottom')}{M('左', ['left'], 'mg-left')}{M('右', ['right'], 'mg-right')}
        </details>
      </div>
      <div className="fmt-group">
        <div className="muted small">其他格式（中英文同步）</div>
        <Stepper label="正文字号" testid="fs" unit=" pt" value={String(ty.bodySizePt)} onMinus={() => typo('bodySizePt', -0.25, 8.5, 12)} onPlus={() => typo('bodySizePt', 0.25, 8.5, 12)} hint="每次 0.25 pt" />
        <Stepper label="行距" testid="lh" unit="" value={ty.lineHeight.toFixed(2)} onMinus={() => typo('lineHeight', -0.02, 1.1, 1.7)} onPlus={() => typo('lineHeight', 0.02, 1.1, 1.7)} hint="每次 0.02" />
        <Stepper label="板块间距" testid="sg" unit=" mm" value={String(template.spacing.sectionGapMm)} onMinus={() => gap('sectionGapMm', -0.5)} onPlus={() => gap('sectionGapMm', 0.5)} hint="各板块（教育 / 项目 / 技能…）之间" />
        <Stepper label="条目间距" testid="ig" unit=" mm" value={String(template.spacing.itemGapMm)} onMinus={() => gap('itemGapMm', -0.5)} onPlus={() => gap('itemGapMm', 0.5)} hint="同一板块内每段经历之间" />
      </div>
      <div className="muted small fmt-tip">小建议：下方空白多 → 先加行距 / 间距，比缩页边距更自然；正式投递页边距一般不小于 12 mm，正文字号不小于 9.5 pt。</div>
    </aside>
  );
}
