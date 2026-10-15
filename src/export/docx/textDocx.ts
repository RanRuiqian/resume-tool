import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import type { Lang } from '../../types';

/** 求职信 / 自我介绍 / 面试准备等纯文字文档（Word 可编辑） */
export async function textDocxBytes(lang: Lang, sections: { title: string; body: string }[]): Promise<Uint8Array> {
  const font = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: lang === 'zh' ? 'Microsoft YaHei' : 'SimSun', cs: 'Calibri' };
  const doc = new Document({
    styles: { default: { document: { run: { font, size: 22 }, paragraph: { spacing: { after: 120, line: 300 } } } } },
    sections: [{ children: sections.flatMap((s) => [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(s.title)] }), ...s.body.split(/\n+/).filter(Boolean).map((t) => new Paragraph({ children: [new TextRun(t)] }))]) }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
