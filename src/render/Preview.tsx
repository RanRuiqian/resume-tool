import { cloneElement, Fragment, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { LayoutModel, LSection } from './layout';

const PX = 3.7795; // px per mm
/** 网页预览：与 PDF 渲染器共用同一 Layout Model（近似 WYSIWYG） */
export function Preview({ m, scale = 0.75 }: { m: LayoutModel; scale?: number }) {
  // transform: scale 不改变布局尺寸，外框要按缩放后的真实高度收口，否则页面下方会留一大片空白（手机上尤其明显）
  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scaledH, setScaledH] = useState<number | null>(null);
  const [contentH, setContentH] = useState(0);
  // 2026-11：A4 边界 / 页边距 / 空白量（负责人要求：不导出也能在预览里判断还空多少）。缩略图（scale<0.4）不显示。
  const canGuide = scale >= 0.4;
  const [guides, setGuides] = useState(() => { try { return localStorage.getItem('previewGuides') !== '0'; } catch { return true; } });
  // 2026-11：真分页预览。把「标题+第一段 / 每个条目」当作不可拆分的单元，放不下当前页就推到下一张 A4 的页边距内（用空白占位 div 实现），
  // 两张 A4 之间画灰色间隙，这样一页装不下时能直观看到第二页。双栏模板仍是连续排版（只提示页数）。
  const [spacers, setSpacers] = useState<number[]>([]);
  const spacersRef = useRef<number[]>([]); spacersRef.current = spacers;
  const geo = useRef({ mt: 0, U: 0, H: 0, G: 0, paginate: false }); const updateRef = useRef<() => void>(() => {});
  updateRef.current = () => {
    const el = pageRef.current, c = contentRef.current; if (!el || !c) return;
    setScaledH(Math.ceil(el.offsetHeight * scale)); setContentH(c.offsetHeight);
    const g = geo.current; let next: number[] = [];
    if (g.paginate) {
      const units = [...c.querySelectorAll<HTMLElement>('[data-unit]')], sp = spacersRef.current; let cum = 0;
      const nat = units.map((u, i) => { cum += sp[i] || 0; return { top: u.offsetTop - g.mt - cum, h: u.offsetHeight, keep: u.dataset.keep === '1' }; });
      let shift = 0; const step = g.H + g.G;
      next = nat.map((u, i) => {
        const t = u.top + shift, b = u.keep && nat[i + 1] ? nat[i + 1].top + nat[i + 1].h + shift : t + u.h, k = Math.floor((t + 0.5) / step);
        if (b > k * step + g.U + 0.5 && b - t <= g.U) { const add = (k + 1) * step - t; shift += add; return add; }
        return 0;
      });
    }
    const cur = spacersRef.current, n = Math.max(next.length, cur.length);
    const same = Array.from({ length: n }).every((_, i) => Math.abs((next[i] || 0) - (cur[i] || 0)) < 0.5);
    if (!same) setSpacers(next);
  };
  useLayoutEffect(() => { updateRef.current(); });
  useLayoutEffect(() => {
    const el = pageRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateRef.current()); ro.observe(el); if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [scale]);
  const ty = m.typography;
  const font = m.lang === 'zh' || ty.fontFamily === 'Noto Sans SC' ? "'Noto Sans SC', sans-serif" : ty.fontFamily === 'Arimo' ? "Arimo, Arial, 'Liberation Sans', 'Noto Sans SC', sans-serif" : ty.fontFamily === 'Times-Roman' ? "'Times New Roman', Times, 'Noto Sans SC', serif" : "Helvetica, Arial, 'Noto Sans SC', sans-serif";
  const pt = (n: number) => `${n * 1.333}px`;
  const eng = m.style === 'engineering';
  const wMm = m.pageSize === 'A4' ? 210 : 215.9, hMm = m.pageSize === 'A4' ? 297 : 279.4;
  let ui = 0;
  const spacer = (i: number) => (spacers[i] ? <div aria-hidden key={`sp${i}`} style={{ height: spacers[i] }} /> : null);
  const W = (i: number, node: ReactElement, keep = false) => <Fragment key={`u${i}`}>{spacer(i)}{cloneElement(node, { 'data-unit': i, ...(keep ? { 'data-keep': '1' } : {}) } as object)}</Fragment>;
  const sec = (s: LSection, narrow: boolean) => (
    <div key={s.key} style={{ marginBottom: m.spacing.sectionGapMm * PX }}>
      {W(ui++, <div style={m.titleStyle === 'band' ? { fontSize: pt(ty.bodySizePt + 1.5), fontWeight: 700, color: '#fff', background: m.colors.primary, padding: '2px 8px', marginBottom: 5 }
        : m.titleStyle === 'bar' ? { fontSize: pt(ty.bodySizePt + 2), fontWeight: 700, color: m.colors.primary, borderLeft: `4px solid ${m.colors.accent}`, paddingLeft: 8, marginBottom: 5 }
        : m.titleStyle === 'rule' ? { fontSize: pt(ty.bodySizePt + 1.5), fontWeight: 700, color: m.colors.primary, borderBottom: `0.75px solid ${m.colors.muted}`, paddingBottom: 1, marginBottom: 4, letterSpacing: m.lang === 'en' ? 0.4 : 0 }
        : { fontSize: pt(ty.bodySizePt + 2), fontWeight: 700, color: m.colors.primary, borderBottom: `1px solid ${m.colors.primary}`, marginBottom: 4 }}>{s.title}</div>, true)}
      {s.blocks.map((b, i) => W(ui++, (
        !narrow && s.key === 'skills' && b.text ? (
          <div key={i}>{b.title && <b>{b.title}{m.lang === 'zh' ? '：' : ': '}</b>}{b.text}</div>
        ) : (
          <div key={i} style={{ marginBottom: m.spacing.itemGapMm * PX }}>
            {(b.title || b.date) && (narrow ? (
              <><div style={{ fontWeight: 700 }}>{b.title}</div>{b.date && <div style={{ color: m.colors.muted, fontSize: pt(ty.bodySizePt - 1) }}>{b.date}</div>}{b.subtitle && <div style={{ color: m.colors.muted }}>{b.subtitle}</div>}</>
            ) : (
              eng ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <b style={{ flex: 1, minWidth: 0 }}>{b.title}</b>
                    <span style={{ color: m.colors.muted, whiteSpace: 'nowrap' }}>{b.date}</span>
                  </div>
                  {b.subtitle && <div style={{ color: m.colors.muted }}>{b.subtitle}</div>}
                </>
              ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span><b>{b.title}</b>{b.subtitle && <span style={{ color: m.colors.muted }}>{'  '}{b.subtitle}</span>}</span>
                <span style={{ color: m.colors.muted, whiteSpace: 'nowrap' }}>{b.date}</span>
              </div>
              )
            ))}
            {b.text && <div>{b.text}</div>}
            {b.bullets.length > 0 && <ul style={{ margin: 0, paddingLeft: 14 }}>{b.bullets.map((x, j) => <li key={j} style={{ ['--dot' as string]: m.colors.accent }}>{x}</li>)}</ul>}
            {b.tags && b.tags.length > 0 && <div style={{ color: m.colors.muted, fontSize: pt(ty.bodySizePt - 1) }}>{b.tags.join(' · ')}</div>}
          </div>
        )
      )))}
    </div>
  );
  const photo = m.photo && <img src={m.photo.dataUrl} style={{ width: m.photo.sizeMm * m.photo.aspect * PX, height: m.photo.sizeMm * PX, objectFit: 'cover', [m.photo.position === 'left' ? 'marginRight' : 'marginLeft']: 12 }} />;
  const twoCol = m.columns === 2 && m.side.length > 0;
  const showG = canGuide && guides;
  const H = hMm * PX, mt = m.marginMm.top * PX, mb = m.marginMm.bottom * PX, ml = m.marginMm.left * PX, mr = m.marginMm.right * PX;
  const U = H - mt - mb;                                           // 每页可打印区高度
  const paginate = canGuide && !twoCol, G = paginate ? 16 : 0, step = H + G;
  geo.current = { mt, U, H, G, paginate };
  // 页数：分页预览按「第几张 A4」算；双栏连续排版按可打印区高度估算。A4 纸本身始终是 N × 297 mm，不会跟着内容变长。
  const pages = contentH <= 0 ? 1 : paginate ? Math.max(1, Math.floor((contentH - 0.5) / step) + 1) : Math.max(1, Math.ceil((contentH - 0.5) / U));
  const lastUsed = paginate ? contentH - (pages - 1) * step : contentH - (pages - 1) * U;   // 末页已用的可打印高度
  const blankMm = (U - lastUsed) / PX, usedPct = Math.round((lastUsed / U) * 100);
  const totalH = pages * H + (pages - 1) * G;
  const bottomY = mt + contentH;                                   // 内容底部（px，自页面顶部）
  const printEnd = paginate ? (pages - 1) * step + H - mb : pages * H - mb;
  const toggle = (v: boolean) => { setGuides(v); try { localStorage.setItem('previewGuides', v ? '1' : '0'); } catch { /* 无存储时只在本次生效 */ } };
  const lab: React.CSSProperties = { position: 'absolute', fontSize: 11, color: '#3b6fd4', background: 'rgba(255,255,255,.85)', padding: '0 3px', lineHeight: '14px', whiteSpace: 'nowrap' };
  const overlay = showG && contentH > 0 && (
    <div aria-hidden data-testid="a4-guides" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {Array.from({ length: pages }, (_, i) => (
        <div key={i} style={{ position: 'absolute', left: ml, right: mr, top: i * step + mt, height: U, border: '1px dashed rgba(59,111,212,.55)' }} />
      ))}
      {(paginate || pages === 1) && blankMm > 1 && <div data-testid="a4-blank" style={{ position: 'absolute', left: ml, right: mr, top: bottomY, height: printEnd - bottomY,
        background: 'repeating-linear-gradient(135deg, rgba(245,166,35,.16) 0 6px, rgba(245,166,35,.04) 6px 12px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ ...lab, position: 'static', color: '#a35f00' }}>空白约 {Math.round(blankMm)} mm</span></div>}
      {!paginate && Array.from({ length: pages - 1 }, (_, i) => (
        <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (i + 1) * H, borderTop: '2px dashed #d64545' }}>
          <span style={{ ...lab, color: '#d64545', right: 6, top: 2 }}>第 {i + 1} 页结束 ↑ ／ 第 {i + 2} 页开始 ↓</span></div>
      ))}
      {pages > 1 && Array.from({ length: pages }, (_, i) => <span key={`n${i}`} style={{ ...lab, right: 2, top: i * step + 2, color: '#667085' }}>第 {i + 1} 页</span>)}
      <span style={{ ...lab, left: 2, top: mt / 2 - 7 }}>上 {m.marginMm.top} mm</span>
      <span style={{ ...lab, left: 2, top: mt + 20 }}>左 {m.marginMm.left} mm</span>
      <span style={{ ...lab, right: 2, top: mt + 20 }}>右 {m.marginMm.right} mm</span>
      <span style={{ ...lab, left: 2, top: (pages - 1) * step + H - mb / 2 - 7 }}>下 {m.marginMm.bottom} mm</span>
    </div>
  );
  const bands = paginate && pages > 1 && contentH > 0 && Array.from({ length: pages - 1 }, (_, i) => (
    <div key={`b${i}`} aria-hidden data-testid="a4-gap" style={{ position: 'absolute', left: 0, right: 0, top: i * step + H, height: G, background: '#cfd5df', borderTop: '1px solid #8a94a6', borderBottom: '1px solid #8a94a6', pointerEvents: 'none' }} />
  ));
  return (
    <div style={{ flex: 'none' }}>
    {canGuide && (
      <div className="preview-guide-bar muted small" data-testid="a4-bar" style={{ width: wMm * PX * scale, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', margin: '0 0 4px' }}>
        <label style={{ display: 'flex', flexDirection: 'row', gap: 4, alignItems: 'center', whiteSpace: 'nowrap', margin: 0 }}><input style={{ width: 'auto' }} type="checkbox" checked={guides} onChange={(e) => toggle(e.target.checked)} />显示 A4 边界</label>
        {contentH > 0 && <span data-testid="a4-info">{m.pageSize} {wMm}×{hMm} mm · {pages} 页 · {pages === 1 ? '' : '末页'}已用 {usedPct}%{pages > 1 ? `（已超出 1 页，内容延伸到第 ${pages} 页）` : ''}{blankMm >= 0 ? `，${pages > 1 ? `第 ${pages} 页` : ''}底部空白约 ${Math.round(blankMm)} mm` : ''}</span>}
      </div>
    )}
    <div className="preview-wrap" style={{ width: wMm * PX * scale, minHeight: hMm * PX * scale, ...(scaledH ? { height: scaledH } : {}) }}>
      <div className="preview-page" ref={pageRef} style={{ width: wMm * PX, minHeight: hMm * PX, ...(canGuide && contentH > 0 ? { height: totalH } : {}), position: 'relative', transform: `scale(${scale})`, padding: `${m.marginMm.top * PX}px ${m.marginMm.right * PX}px ${m.marginMm.bottom * PX}px ${m.marginMm.left * PX}px`, fontFamily: font, fontSize: pt(ty.bodySizePt), lineHeight: ty.lineHeight, color: m.colors.text }}>
        <div ref={contentRef}>
        <div style={eng ? { display: 'flex', alignItems: 'flex-start', paddingBottom: 2, marginBottom: m.spacing.sectionGapMm * PX * 0.8 } : { display: 'flex', alignItems: 'center', borderBottom: `${m.headerStyle === 'band' ? 3 : 1}px solid ${m.headerStyle === 'band' ? m.colors.accent : m.colors.primary}`, paddingBottom: 6, marginBottom: m.spacing.sectionGapMm * PX }}>
          {m.photo?.position === 'left' && photo}
          <div style={{ flex: 1, textAlign: m.headerAlign }}>
            <div style={{ fontSize: pt(ty.nameSizePt), fontWeight: 700, color: m.colors.primary, lineHeight: 1.2 }}>{m.header.name || '（姓名）'}</div>
            {m.header.headline && <div style={{ color: m.colors.accent, fontSize: pt(ty.bodySizePt + (eng ? 0.5 : 1.5)), marginTop: eng ? 2 : 0 }}>{m.header.headline}</div>}
            <div style={{ color: m.colors.muted, fontSize: pt(ty.bodySizePt - 0.5), marginTop: eng ? 2 : 0 }}>{[...m.header.contacts.map((t, i) => ({ t, h: m.header.hrefs?.[i] })), ...m.header.personal.map((t) => ({ t, h: undefined as string | undefined }))].map((x, i) => <span key={i}>{i > 0 ? (eng ? '  ·  ' : '  |  ') : ''}{x.h ? <a href={x.h} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{x.t}</a> : x.t}</span>)}</div>
          </div>
          {m.photo?.position === 'right' && photo}
        </div>
        {twoCol ? (
          <div style={{ display: 'flex' }}>
            <div style={{ width: `${m.sidebarWidthPercent}%`, paddingRight: 12, borderRight: '1px solid #d0d5dd' }}>{m.side.map((s) => sec(s, true))}</div>
            <div style={{ flex: 1, paddingLeft: 12 }}>{m.main.map((s) => sec(s, false))}</div>
          </div>
        ) : m.main.map((s) => sec(s, false))}
        </div>
        {bands}
        {overlay}
      </div>
    </div>
    </div>
  );
}
