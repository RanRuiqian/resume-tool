import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import type { LayoutModel, LSection } from '../../render/layout';
import { MM } from '../../render/layout';
import { fontFor } from './fonts';

export function ResumePdf({ m }: { m: LayoutModel }) {
  const ty = m.typography;
  const body = ty.bodySizePt;
  const F = (s: string) => ({ fontFamily: fontFor(m, s) });
  const eng = m.style === 'engineering';
  const st = StyleSheet.create({
    page: { paddingTop: m.marginMm.top * MM, paddingBottom: m.marginMm.bottom * MM, paddingLeft: m.marginMm.left * MM, paddingRight: m.marginMm.right * MM, fontSize: body, color: m.colors.text, lineHeight: ty.lineHeight },
    header: eng ? { flexDirection: 'row', alignItems: 'flex-start', marginBottom: m.spacing.sectionGapMm * MM * 0.8, paddingBottom: 1 } : { flexDirection: 'row', alignItems: 'center', marginBottom: m.spacing.sectionGapMm * MM, paddingBottom: 4, borderBottomWidth: m.headerStyle === 'band' ? 2 : 0.8, borderBottomColor: m.headerStyle === 'band' ? m.colors.accent : m.colors.primary },
    name: { fontSize: ty.nameSizePt, fontWeight: 700, color: m.colors.primary, lineHeight: 1.2 },
    headline: { fontSize: body + (eng ? 0.5 : 1.5), color: m.colors.accent, marginTop: 2 },
    contact: { fontSize: body - 0.5, color: m.colors.muted, marginTop: 3 },
    secTitle: m.titleStyle === 'band'
      ? { fontSize: body + 1.5, fontWeight: 700, color: '#ffffff', backgroundColor: m.colors.primary, paddingTop: 2, paddingBottom: 2, paddingLeft: 6, marginBottom: 4 }
      : m.titleStyle === 'bar'
        ? { fontSize: body + 2, fontWeight: 700, color: m.colors.primary, borderLeftWidth: 3, borderLeftColor: m.colors.accent, paddingLeft: 6, marginBottom: 4 }
        : m.titleStyle === 'rule'
          ? { fontSize: body + 1.5, fontWeight: 700, color: m.colors.primary, borderBottomWidth: 0.5, borderBottomColor: m.colors.muted, paddingBottom: 1, marginBottom: 3, letterSpacing: m.lang === 'en' ? 0.3 : 0 }
        : { fontSize: body + 2, fontWeight: 700, color: m.colors.primary, borderBottomWidth: 0.6, borderBottomColor: m.colors.primary, paddingBottom: 1.5, marginBottom: 3 },
    section: { marginBottom: m.spacing.sectionGapMm * MM },
    block: { marginBottom: m.spacing.itemGapMm * MM },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    bTitle: { fontWeight: 700 },
    muted: { color: m.colors.muted },
    bullet: { flexDirection: 'row', marginTop: 1 },
    dot: { width: 9, color: m.colors.accent },
  });
  const photoPt = (m.photo?.sizeMm ?? 28) * MM;
  const photoEl = m.photo ? <Image src={m.photo.dataUrl} style={{ width: photoPt * (m.photo?.aspect ?? 0.8), height: photoPt, objectFit: 'cover' }} /> : null;
  const contactLine = [...m.header.contacts, ...m.header.personal].join(eng ? '  ·  ' : '  |  ');
  const twoCol = m.columns === 2 && m.side.length > 0;

  const renderBlock = (s: LSection, b: LSection['blocks'][number], i: number, narrow: boolean) => (!narrow && s.key === 'skills' && b.text ? (
        <Text key={i} style={[F((b.title ?? '') + b.text), { marginBottom: 2 }]}>{b.title ? <Text style={{ fontWeight: 700 }}>{b.title + (m.lang === 'zh' ? '：' : ': ')}</Text> : null}{b.text}</Text>
      ) : (
        <View key={i} style={st.block} wrap={b.bullets.length > 3}>
          {(b.title || b.date) && (narrow ? (
            <View>
              {b.title && <Text style={[st.bTitle, F(b.title)]}>{b.title}</Text>}
              {b.date && <Text style={[st.muted, F(b.date), { fontSize: body - 1 }]}>{b.date}</Text>}
            </View>
          ) : eng ? (
            <View>
              <View style={st.row}>
                <Text style={[st.bTitle, F(b.title ?? ''), { flex: 1 }]}>{b.title}</Text>
                {b.date && <Text style={[st.muted, F(b.date), { marginLeft: 10, flexShrink: 0 }]}>{b.date}</Text>}
              </View>
              {b.subtitle ? <Text style={[st.muted, F(b.subtitle)]}>{b.subtitle}</Text> : null}
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
      ));
  /** 标题与第一个条目放在同一个不可分割的 View 中：模块标题不会单独留在页底 */
  const renderSection = (s: LSection, narrow = false) => (
    <View key={s.key} style={st.section}>
      <View wrap={false}>
        <Text style={[st.secTitle, F(s.title)]}>{s.title}</Text>
        {s.blocks.length > 0 && renderBlock(s, s.blocks[0], 0, narrow)}
      </View>
      {s.blocks.slice(1).map((b, i) => renderBlock(s, b, i + 1, narrow))}
    </View>
  );

  const headerInfo = (
    <View style={{ flex: 1, alignItems: m.headerAlign === 'center' ? 'center' : 'flex-start' }}>
      <Text style={[st.name, F(m.header.name)]}>{m.header.name}</Text>
      {m.header.headline ? <Text style={[st.headline, F(m.header.headline)]}>{m.header.headline}</Text> : null}
      {contactLine ? <Text style={[st.contact, F(contactLine), { textAlign: m.headerAlign === 'center' ? 'center' : 'left' }]}>{contactLine}</Text> : null}
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
