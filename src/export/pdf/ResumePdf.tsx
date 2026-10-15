import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import type { LayoutModel, LSection } from '../../render/layout';
import { MM } from '../../render/layout';
import { hasCJK } from './fonts';

function fontFor(m: LayoutModel, s: string) {
  const f = m.typography.fontFamily;
  if (m.lang === 'zh' || hasCJK(s) || f === 'Noto Sans SC') return 'NotoSansSC';
  return f;
}

export function ResumePdf({ m }: { m: LayoutModel }) {
  const ty = m.typography;
  const body = ty.bodySizePt;
  const F = (s: string) => ({ fontFamily: fontFor(m, s) });
  const st = StyleSheet.create({
    page: { paddingTop: m.marginMm.top * MM, paddingBottom: m.marginMm.bottom * MM, paddingLeft: m.marginMm.left * MM, paddingRight: m.marginMm.right * MM, fontSize: body, color: m.colors.text, lineHeight: ty.lineHeight },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: m.spacing.sectionGapMm * MM, paddingBottom: 4, borderBottomWidth: m.headerStyle === 'band' ? 2 : 0.8, borderBottomColor: m.headerStyle === 'band' ? m.colors.accent : m.colors.primary },
    name: { fontSize: ty.nameSizePt, fontWeight: 700, color: m.colors.primary, lineHeight: 1.2 },
    headline: { fontSize: body + 1.5, color: m.colors.accent, marginTop: 2 },
    contact: { fontSize: body - 0.5, color: m.colors.muted, marginTop: 3 },
    secTitle: { fontSize: body + 2, fontWeight: 700, color: m.colors.primary, borderBottomWidth: 0.6, borderBottomColor: m.colors.primary, paddingBottom: 1.5, marginBottom: 3 },
    section: { marginBottom: m.spacing.sectionGapMm * MM },
    block: { marginBottom: m.spacing.itemGapMm * MM },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    bTitle: { fontWeight: 700 },
    muted: { color: m.colors.muted },
    bullet: { flexDirection: 'row', marginTop: 1 },
    dot: { width: 9, color: m.colors.accent },
  });
  const photoPt = (m.photo?.sizeMm ?? 28) * MM;
  const photoEl = m.photo ? <Image src={m.photo.dataUrl} style={{ width: photoPt * 0.8, height: photoPt, objectFit: 'cover' }} /> : null;
  const contactLine = [...m.header.contacts, ...m.header.personal].join('  |  ');
  const twoCol = m.columns === 2 && m.side.length > 0;

  const renderSection = (s: LSection, narrow = false) => (
    <View key={s.key} style={st.section}>
      <Text style={[st.secTitle, F(s.title)]} minPresenceAhead={36}>{s.title}</Text>
      {s.blocks.map((b, i) => (!narrow && s.key === 'skills' && b.text ? (
        <Text key={i} style={[F((b.title ?? '') + b.text), { marginBottom: 2 }]}>{b.title ? <Text style={{ fontWeight: 700 }}>{b.title + (m.lang === 'zh' ? '：' : ': ')}</Text> : null}{b.text}</Text>
      ) : (
        <View key={i} style={st.block} wrap={b.bullets.length > 3}>
          {(b.title || b.date) && (narrow ? (
            <View>
              {b.title && <Text style={[st.bTitle, F(b.title)]}>{b.title}</Text>}
              {b.date && <Text style={[st.muted, F(b.date), { fontSize: body - 1 }]}>{b.date}</Text>}
            </View>
          ) : (
            <View style={st.row}>
              <Text style={[st.bTitle, F(b.title ?? ''), { flex: 1 }]}>{b.title}{b.subtitle ? <Text style={[{ fontWeight: 400, color: m.colors.muted }, F(b.subtitle)]}>{'  ' + b.subtitle}</Text> : null}</Text>
              {b.date && <Text style={[st.muted, F(b.date), { marginLeft: 8 }]}>{b.date}</Text>}
            </View>
          ))}
          {narrow && b.subtitle && <Text style={[st.muted, F(b.subtitle)]}>{b.subtitle}</Text>}
          {b.text && <Text style={F(b.text)}>{b.text}</Text>}
          {b.bullets.map((x, j) => (
            <View key={j} style={st.bullet}>
              <Text style={st.dot}>•</Text>
              <Text style={[F(x), { flex: 1 }]}>{x}</Text>
            </View>
          ))}
          {b.tags && b.tags.length > 0 && <Text style={[st.muted, F(b.tags.join(' ')), { fontSize: body - 1 }]}>{b.tags.join(' · ')}</Text>}
        </View>
      )))}
    </View>
  );

  const headerInfo = (
    <View style={{ flex: 1 }}>
      <Text style={[st.name, F(m.header.name)]}>{m.header.name}</Text>
      {m.header.headline ? <Text style={[st.headline, F(m.header.headline)]}>{m.header.headline}</Text> : null}
      {contactLine ? <Text style={[st.contact, F(contactLine)]}>{contactLine}</Text> : null}
    </View>
  );
  const photoInHeader = !!photoEl;
  return (
    <Document title={m.header.name} author={m.header.name} creator="resume-tool" producer="resume-tool">
      <Page size={m.pageSize} style={[st.page, F('')]} wrap>
        <View style={st.header}>
          {photoInHeader && m.photo?.position === 'left' && <View style={{ marginRight: 12 }}>{photoEl}</View>}
          {headerInfo}
          {photoInHeader && m.photo?.position === 'right' && <View style={{ marginLeft: 12 }}>{photoEl}</View>}
        </View>
        {twoCol ? (
          // 侧栏绝对定位于第一页；主栏用固定左边距，跨页时仍保持在右侧（修复第 2 页主栏左移）
          <View style={{ position: 'relative' }}>
            <View style={{ position: 'absolute', left: 0, top: 0, width: `${m.sidebarWidthPercent}%`, paddingRight: 10, borderRightWidth: 0.5, borderRightColor: '#d0d5dd' }}>
              {m.side.map((s) => renderSection(s, true))}
            </View>
            <View style={{ marginLeft: `${m.sidebarWidthPercent}%`, paddingLeft: 12 }}>{m.main.map((s) => renderSection(s))}</View>
          </View>
        ) : (
          m.main.map((s) => renderSection(s))
        )}
        <Text style={{ position: 'absolute', bottom: 12, right: m.marginMm.right * MM, fontSize: 7, color: '#aaaaaa' }} render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${pageNumber}/${totalPages}` : '')} fixed />
      </Page>
    </Document>
  );
}
