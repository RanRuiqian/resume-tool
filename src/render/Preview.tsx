import type { LayoutModel, LSection } from './layout';

const PX = 3.7795; // px per mm
/** 网页预览：与 PDF 渲染器共用同一 Layout Model（近似 WYSIWYG） */
export function Preview({ m, scale = 0.75 }: { m: LayoutModel; scale?: number }) {
  const ty = m.typography;
  const font = m.lang === 'zh' || ty.fontFamily === 'Noto Sans SC' ? "'Noto Sans SC', sans-serif" : ty.fontFamily === 'Times-Roman' ? "'Times New Roman', Times, 'Noto Sans SC', serif" : "Helvetica, Arial, 'Noto Sans SC', sans-serif";
  const pt = (n: number) => `${n * 1.333}px`;
  const wMm = m.pageSize === 'A4' ? 210 : 215.9, hMm = m.pageSize === 'A4' ? 297 : 279.4;
  const sec = (s: LSection, narrow: boolean) => (
    <div key={s.key} style={{ marginBottom: m.spacing.sectionGapMm * PX }}>
      <div style={{ fontSize: pt(ty.bodySizePt + 2), fontWeight: 700, color: m.colors.primary, borderBottom: `1px solid ${m.colors.primary}`, marginBottom: 4 }}>{s.title}</div>
      {s.blocks.map((b, i) => (
        !narrow && s.key === 'skills' && b.text ? (
          <div key={i}>{b.title && <b>{b.title}{m.lang === 'zh' ? '：' : ': '}</b>}{b.text}</div>
        ) : (
          <div key={i} style={{ marginBottom: m.spacing.itemGapMm * PX }}>
            {(b.title || b.date) && (narrow ? (
              <><div style={{ fontWeight: 700 }}>{b.title}</div>{b.date && <div style={{ color: m.colors.muted, fontSize: pt(ty.bodySizePt - 1) }}>{b.date}</div>}{b.subtitle && <div style={{ color: m.colors.muted }}>{b.subtitle}</div>}</>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span><b>{b.title}</b>{b.subtitle && <span style={{ color: m.colors.muted }}>{'  '}{b.subtitle}</span>}</span>
                <span style={{ color: m.colors.muted, whiteSpace: 'nowrap' }}>{b.date}</span>
              </div>
            ))}
            {b.text && <div>{b.text}</div>}
            {b.bullets.length > 0 && <ul style={{ margin: 0, paddingLeft: 14 }}>{b.bullets.map((x, j) => <li key={j} style={{ ['--dot' as string]: m.colors.accent }}>{x}</li>)}</ul>}
            {b.tags && b.tags.length > 0 && <div style={{ color: m.colors.muted, fontSize: pt(ty.bodySizePt - 1) }}>{b.tags.join(' · ')}</div>}
          </div>
        )
      ))}
    </div>
  );
  const photo = m.photo && <img src={m.photo.dataUrl} style={{ width: m.photo.sizeMm * 0.8 * PX, height: m.photo.sizeMm * PX, objectFit: 'cover', [m.photo.position === 'left' ? 'marginRight' : 'marginLeft']: 12 }} />;
  const twoCol = m.columns === 2 && m.side.length > 0;
  return (
    <div className="preview-wrap" style={{ width: wMm * PX * scale, minHeight: hMm * PX * scale }}>
      <div className="preview-page" style={{ width: wMm * PX, minHeight: hMm * PX, transform: `scale(${scale})`, padding: `${m.marginMm.top * PX}px ${m.marginMm.right * PX}px ${m.marginMm.bottom * PX}px ${m.marginMm.left * PX}px`, fontFamily: font, fontSize: pt(ty.bodySizePt), lineHeight: ty.lineHeight, color: m.colors.text }}>
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: `${m.headerStyle === 'band' ? 3 : 1}px solid ${m.headerStyle === 'band' ? m.colors.accent : m.colors.primary}`, paddingBottom: 6, marginBottom: m.spacing.sectionGapMm * PX }}>
          {m.photo?.position === 'left' && photo}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: pt(ty.nameSizePt), fontWeight: 700, color: m.colors.primary, lineHeight: 1.2 }}>{m.header.name || '（姓名）'}</div>
            {m.header.headline && <div style={{ color: m.colors.accent, fontSize: pt(ty.bodySizePt + 1.5) }}>{m.header.headline}</div>}
            <div style={{ color: m.colors.muted, fontSize: pt(ty.bodySizePt - 0.5) }}>{[...m.header.contacts, ...m.header.personal].join('  |  ')}</div>
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
    </div>
  );
}
