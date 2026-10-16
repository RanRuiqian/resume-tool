import { describe, expect, it } from 'vitest';
import { chunkText, mergeProfiles, rawToProfile } from '../src/ai/importProfile';

describe('smart import', () => {
  it('chunks long text on paragraph boundaries', () => {
    const t = Array.from({ length: 40 }, (_, i) => `第${i}段 ` + 'x'.repeat(300)).join('\n\n');
    const c = chunkText(t, 2000);
    expect(c.length).toBeGreaterThan(5);
    expect(c.every((x) => x.length <= 2000)).toBe(true);
    expect(c.join('\n').replace(/\s/g, '')).toBe(t.replace(/\s/g, ''));
  });
  it('maps personal info and merges duplicates without repeating bullets', () => {
    const a = rawToProfile({ name: '李明', birth: '1998-05', work: [{ company: '腾讯', title: '后端', bullets: ['对账耗时降到 15 分钟'] }], skills: [{ name: 'Go' }] });
    expect(a.profile.personal.birth).toBe('1998-05');
    const b = rawToProfile({ gender: '男', work: [{ company: '腾讯 ', title: '后端', start: '2021-07', bullets: ['对账耗时降到 15 分钟', '负责支付对账'] }, { company: '字节', title: '实习' }], skills: [{ name: 'go' }, { name: 'Redis' }] });
    const m = mergeProfiles(a, b);
    expect(m.work.length).toBe(2);
    expect(m.work[0].bullets.length).toBe(2);
    expect(m.work[0].start).toBe('2021-07');
    expect(m.skills.length).toBe(2);
    expect(m.profile.personal.gender).toBe('男');
    expect(new Set(m.work.flatMap((w) => w.bullets.map((x) => x.id))).size).toBe(2);
  });
});
