import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
  TabStopType, LevelFormat, LineRuleType, ShadingType, AlignmentType, HeadingLevel, VerticalAlign, TableLayoutType,
} from 'docx';
import type { LayoutModel, LSection } from '../../render/layout';

const TW = 56.6929; // twips per mm
const hex = (c: string) => c.replace('#', '').toUpperCase();
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

function dataUrlToBytes(d: string): { data: Uint8Array; type: 'png' | 'jpg' } {
  const [head, b64] = d.split(',');
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { data, type: /png/.test(head) ? 'png' : 'jpg' };
}

/** 粗略估算文字宽度（twip）：中日韩字符按 1em，拉丁字母按 Arial 平均字宽 */
function estTw(t: string, pt: number, bold = false): number {
  let em = 0;
  for (const ch of t) em += /[\u2E80-\uFFEF]/.test(ch) ? 1 : /[A-Z]/.test(ch) ? 0.67 : /[ .,:;'|il!()-]/.test(ch) ? 0.3 : 0.53;
  return Math.round(em * pt * 20 * (bold ? 1.06 : 1));
}

/** Word 渲染器：真实段落 + 内置标题样式 + 无边框表格（双栏/照片），不使用文本框（F6.4） */
export function buildDocx(m: LayoutModel): Document {
  const ff = m.typography.fontFamily;
  // Arimo 与 Arial 度量一致：Word 用 Arial，LibreOffice 自动用 Liberation Sans / Arimo
  const latin = ff === 'Times-Roman' ? 'Times New Roman' : ff === 'Helvetica' || ff === 'Arimo' || m.style === 'engineering' ? 'Arial' : 'Calibri';
  const font = { ascii: latin, hAnsi: latin, eastAsia: m.lang === 'zh' ? 'Microsoft YaHei' : 'SimSun', cs: latin };
  const sz = Math.round(m.typography.bodySizePt * 2);
  const pageW = m.pageSize === 'A4' ? 11906 : 12240, pageH = m.pageSize === 'A4' ? 16838 : 15840;
  const mL = Math.round(m.marginMm.left * TW), mR = Math.round(m.marginMm.right * TW);
  const contentW = pageW - mL - mR;
  const twoCol = m.columns === 2 && m.side.length > 0;
  const sideW = twoCol ? Math.round((contentW * m.sidebarWidthPercent) / 100) : 0;
  const mainW = contentW - sideW;
  const itemAfter = Math.round(m.spacing.itemGapMm * TW);
  const line = Math.round(240 * m.typography.lineHeight * 0.85);
  const eng = m.style === 'engineering';
  /** 工科正式版用固定行距：不同机器的中文回退字体（微软雅黑 / 思源黑体等）行高差异很大，固定行距让 Word 排版与 PDF 接近 */
  const exactLine = Math.round(m.typography.bodySizePt * m.typography.lineHeight * 20);

  const sectionParas = (s: LSection, width: number, narrow: boolean): (Paragraph | Table)[] => {
    const out: (Paragraph | Table)[] = [new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_1 })];
    s.blocks.forEach((b, bi) => {
      if (!narrow && s.key === 'skills' && b.text) {
        out.push(new Paragraph({ spacing: { after: 40 }, children: [...(b.title ? [new TextRun({ text: b.title + (m.lang === 'zh' ? '：' : ': '), bold: true })] : []), new TextRun(b.text)] }));
        return;
      }
      const last = bi === s.blocks.length - 1;
      if (b.title || b.date) {
        if (narrow) {
          if (b.title) out.push(new Paragraph({ keepNext: true, children: [new TextRun({ text: b.title, bold: true })] }));
          if (b.date) out.push(new Paragraph({ keepNext: true, children: [new TextRun({ text: b.date, color: hex(m.colors.muted), size: sz - 2 })] }));
          if (b.subtitle) out.push(new Paragraph({ children: [new TextRun({ text: b.subtitle, color: hex(m.colors.muted) })] }));
        } else if (eng) {
          // 工科正式版：标题与右对齐日期同行，副标题另起一行（长名称自动换行，日期不重叠）
          const dateW = b.date ? estTw(b.date, m.typography.bodySizePt) + 240 : 0;
          if (b.date && estTw(b.title ?? '', m.typography.bodySizePt, true) > width - dateW - 120) {
            // 长标题：无边框两列表格，标题在左列内换行，日期固定在首行右侧（仍是可编辑文字）
            const dW = Math.min(dateW, Math.round(width * 0.35));
            out.push(new Table({ layout: TableLayoutType.FIXED, width: { size: width, type: WidthType.DXA }, columnWidths: [width - dW, dW], borders: NO_BORDERS,
              rows: [new TableRow({ cantSplit: true, children: [
                new TableCell({ width: { size: width - dW, type: WidthType.DXA }, borders: NO_BORDERS, margins: { left: 0, right: 120, top: 0, bottom: 0 }, children: [new Paragraph({ keepNext: true, children: [new TextRun({ text: b.title ?? '', bold: true })] })] }),
                new TableCell({ width: { size: dW, type: WidthType.DXA }, borders: NO_BORDERS, margins: { left: 0, right: 0, top: 0, bottom: 0 }, children: [new Paragraph({ keepNext: true, alignment: AlignmentType.RIGHT, children: [new TextRun({ text: b.date, color: hex(m.colors.muted) })] })] }),
              ] })] }));
          } else {
            const runs = [new TextRun({ text: b.title ?? '', bold: true })];
            if (b.date) runs.push(new TextRun({ text: '\t' + b.date, color: hex(m.colors.muted) }));
            out.push(new Paragraph({ keepNext: true, tabStops: [{ type: TabStopType.RIGHT, position: width - 20 }], children: runs }));
          }
          if (b.subtitle) out.push(new Paragraph({ keepNext: true, children: [new TextRun({ text: b.subtitle, color: hex(m.colors.muted) })] }));
        } else {
          const runs = [new TextRun({ text: b.title ?? '', bold: true })];
          if (b.subtitle) runs.push(new TextRun({ text: '  ' + b.subtitle, color: hex(m.colors.muted) }));
          if (b.date) runs.push(new TextRun({ text: '\t' + b.date, color: hex(m.colors.muted) }));
          out.push(new Paragraph({ keepNext: true, tabStops: [{ type: TabStopType.RIGHT, position: width - 100 }], children: runs }));
        }
      }
      if (b.text) out.push(new Paragraph({ children: [new TextRun(b.text)], spacing: { after: b.bullets.length ? 0 : itemAfter } }));
      b.bullets.forEach((x, i) => out.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun(x)], spacing: { after: i === b.bullets.length - 1 && !b.tags?.length ? (last ? 0 : itemAfter) : 0 } })));
      if (b.tags?.length) out.push(new Paragraph({ spacing: { after: itemAfter }, children: [new TextRun({ text: b.tags.join(' · '), color: hex(m.colors.muted), size: sz - 2 })] }));
    });
    return out;
  };

  const al = m.headerAlign === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
  const headerParas: Paragraph[] = [new Paragraph({ alignment: al, heading: HeadingLevel.TITLE, children: [new TextRun(m.header.name)] })];
  if (m.header.headline) headerParas.push(new Paragraph({ alignment: al, children: [new TextRun({ text: m.header.headline, color: hex(m.colors.accent), size: sz + 3 })] }));
  const contact = [...m.header.contacts, ...m.header.personal].join(eng ? '  ·  ' : '  |  ');
  if (contact) headerParas.push(new Paragraph({ alignment: al, children: [new TextRun({ text: contact, color: hex(m.colors.muted), size: sz - 1 })] }));
  headerParas.push(eng ? new Paragraph({ spacing: { after: 40 }, children: [] }) : new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: hex(m.headerStyle === 'band' ? m.colors.accent : m.colors.primary), space: 2 } }, spacing: { after: 120 }, children: [] }));

  const children: (Paragraph | Table)[] = [];
  if (m.photo) {
    const img = dataUrlToBytes(m.photo.dataUrl);
    const hPx = Math.round(m.photo.sizeMm * 3.78), wPx = Math.round(hPx * m.photo.aspect);
    const photoW = Math.round(m.photo.sizeMm * m.photo.aspect * TW) + 300;
    const photoCell = new TableCell({ width: { size: photoW, type: WidthType.DXA }, borders: NO_BORDERS, verticalAlign: eng ? VerticalAlign.TOP : VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: LineRuleType.AUTO }, children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: wPx, height: hPx } })] })] });
    const infoCell = new TableCell({ width: { size: contentW - photoW, type: WidthType.DXA }, borders: NO_BORDERS, verticalAlign: eng ? VerticalAlign.TOP : VerticalAlign.CENTER, children: headerParas.slice(0, -1) });
    children.push(new Table({ layout: TableLayoutType.FIXED, width: { size: contentW, type: WidthType.DXA }, columnWidths: m.photo.position === 'left' ? [photoW, contentW - photoW] : [contentW - photoW, photoW], borders: NO_BORDERS, rows: [new TableRow({ children: m.photo.position === 'left' ? [photoCell, infoCell] : [infoCell, photoCell] })] }));
    children.push(headerParas[headerParas.length - 1]);
  } else children.push(...headerParas);

  if (twoCol) {
    const cell = (w: number, kids: (Paragraph | Table)[], side: boolean) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders: NO_BORDERS, margins: side ? { right: 200 } : { left: 200 }, children: kids.length ? kids : [new Paragraph('')] });
    children.push(new Table({
      layout: TableLayoutType.FIXED, width: { size: contentW, type: WidthType.DXA }, columnWidths: [sideW, mainW], borders: NO_BORDERS,
      rows: [new TableRow({ children: [cell(sideW, m.side.flatMap((s) => sectionParas(s, sideW, true)), true), cell(mainW, m.main.flatMap((s) => sectionParas(s, mainW - 200, false)), false)] })],
    }));
  } else m.main.forEach((s) => children.push(...sectionParas(s, contentW, false)));

  return new Document({
    creator: 'resume-tool', title: m.header.name,
    styles: {
      default: { document: { run: { font, size: sz, color: hex(m.colors.text) }, paragraph: { spacing: eng ? { line: exactLine, lineRule: LineRuleType.EXACT, after: 0 } : { line, after: 0 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font, size: Math.round(m.typography.nameSizePt * 2), bold: true, color: hex(m.colors.primary) }, paragraph: { spacing: eng ? { line: Math.round(m.typography.nameSizePt * 24), lineRule: LineRuleType.EXACT, after: 40 } : { after: 40 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font, size: m.titleStyle === 'rule' ? sz + 3 : sz + 4, bold: true, color: m.titleStyle === 'band' ? 'FFFFFF' : hex(m.colors.primary) },
          paragraph: {
            keepNext: true, spacing: { before: Math.round(m.spacing.sectionGapMm * TW * 0.8), after: 60, ...(eng ? { line: Math.round((m.typography.bodySizePt + 1.5) * 24), lineRule: LineRuleType.EXACT } : {}) },
            ...(m.titleStyle === 'band' ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: hex(m.colors.primary) } }
              : m.titleStyle === 'bar' ? { border: { left: { style: BorderStyle.SINGLE, size: 24, color: hex(m.colors.accent), space: 6 } } }
              : m.titleStyle === 'rule' ? { border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(m.colors.muted), space: 1 } } }
              : { border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(m.colors.primary), space: 1 } } }),
          } },
      ],
    },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 220 } } } }] }] },
    sections: [{ properties: { page: { size: { width: pageW, height: pageH }, margin: { top: Math.round(m.marginMm.top * TW), bottom: Math.round(m.marginMm.bottom * TW), left: mL, right: mR } } }, children }],
  });
}

export async function docxBytes(m: LayoutModel): Promise<Uint8Array> {
  return new Uint8Array(await Packer.toArrayBuffer(buildDocx(m)));
}
