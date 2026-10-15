import { describe, it, expect } from 'vitest';
import { buildExportNames, sanitizeSegment, sanitizeCompany, sanitizeAbbr, shortCompanyName, guessRoleAbbr } from '../src/export/naming';

describe('naming', () => {
  it('builds zip + 4 file names without user name', () => {
    const n = buildExportNames('字节跳动', 'FE', '20261016', 0);
    expect(n.zipName).toBe('字节跳动_FE_20261016.zip');
    expect(Object.values(n.files)).toEqual(['字节跳动_FE_CN.pdf', '字节跳动_FE_CN.docx', '字节跳动_FE_EN.pdf', '字节跳动_FE_EN.docx']);
  });
  it('appends _seq for repeated exports same day, files unchanged', () => {
    expect(buildExportNames('字节跳动', 'FE', '20261016', 1).zipName).toBe('字节跳动_FE_20261016_2.zip');
    expect(buildExportNames('字节跳动', 'FE', '20261016', 2).zipName).toBe('字节跳动_FE_20261016_3.zip');
    expect(buildExportNames('字节跳动', 'FE', '20261016', 2).files.cnPdf).toBe('字节跳动_FE_CN.pdf');
  });
  it('formats date from Date object', () => {
    expect(buildExportNames('A', 'B', new Date(2026, 0, 5), 0).zipName).toBe('A_B_20260105.zip');
  });
  it('sanitizes illegal chars, spaces and underscores', () => {
    expect(sanitizeSegment('a\\b/c:d*e?f"g<h>i|j', 50)).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeSegment('  Foo   Bar__Baz\u0001 ', 50)).toBe('Foo-Bar_Baz');
    expect(sanitizeSegment('__x__', 50)).toBe('x');
  });
  it('truncates company to 20 chars and abbr to 12', () => {
    expect(Array.from(sanitizeCompany('一二三四五六七八九十一二三四五六七八九十多余'))).toHaveLength(20);
    expect(sanitizeAbbr('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJKL');
  });
  it('falls back to Company / Role when empty', () => {
    expect(buildExportNames('', '', '20261016', 0).zipName).toBe('Company_Role_20261016.zip');
    expect(buildExportNames('???', '', '20261016', 0).company).toBe('Company');
  });
  it('extracts short company name and role abbr', () => {
    expect(shortCompanyName('北京字节跳动科技有限公司')).toBe('字节跳动');
    expect(shortCompanyName('Acme Corp.')).toBe('Acme');
    expect(guessRoleAbbr('高级前端工程师')).toBe('FE');
    expect(guessRoleAbbr('Product Manager')).toBe('PM');
    expect(guessRoleAbbr('咖啡师')).toBe('');
  });
});
