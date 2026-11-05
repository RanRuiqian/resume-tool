import { describe, it, expect } from 'vitest';
import { shortUrl, toHref } from '../src/render/layout';

describe('联系方式链接', () => {
  it('显示去掉协议和 www，点击地址补全 https', () => {
    expect(shortUrl('https://www.github.com/ran/')).toBe('github.com/ran');
    expect(toHref('github.com/ran')).toBe('https://github.com/ran');
    expect(toHref('https://x.io/a')).toBe('https://x.io/a');
  });
  it('不像网址的内容不生成链接', () => {
    expect(toHref('我的主页')).toBeUndefined();
    expect(toHref('')).toBeUndefined();
    expect(toHref('a b.com')).toBeUndefined();
  });
});
