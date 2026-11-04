import type { LayoutModel, LBlock, LSection } from './layout';

/** 英文简历里不该出现的汉字（只看汉字，全角标点不算） */
const CJK = /[㐀-鿿豈-﫿]/;
export const hasCjk = (s: string | undefined): boolean => !!s && CJK.test(s);

const blockStrings = (b: LBlock) => [b.title, b.subtitle, b.text, ...(b.tags ?? []), ...b.bullets];
const sections = (m: LayoutModel): LSection[] => [...m.main, ...m.side];

/** 英文版面里仍含中文的整句（去重、保持出现顺序）。姓名不算：没有英文名时由用户在资料里补。 */
export function englishResidue(m: LayoutModel): string[] {
  const all = [m.header.headline, ...m.header.contacts, ...m.header.personal, ...sections(m).flatMap((s) => [s.title, ...s.blocks.flatMap(blockStrings)])];
  return [...new Set(all.filter((x): x is string => hasCjk(x)))];
}

/** 把补译表套到版面上（整句精确匹配）。 */
export function applyEnFill(m: LayoutModel, fill: Record<string, string>): LayoutModel {
  const f = (x: string): string => fill[x] ?? x;
  const fo = (x: string | undefined) => x === undefined ? x : f(x);
  const block = (b: LBlock): LBlock => ({ ...b, title: fo(b.title), subtitle: fo(b.subtitle), text: fo(b.text), ...(b.tags ? { tags: b.tags.map(f) } : {}), bullets: b.bullets.map(f) });
  const sec = (s: LSection): LSection => ({ ...s, title: f(s.title), blocks: s.blocks.map(block) });
  return { ...m, header: { ...m.header, headline: f(m.header.headline), contacts: m.header.contacts.map(f), personal: m.header.personal.map(f) }, main: m.main.map(sec), side: m.side.map(sec) };
}
