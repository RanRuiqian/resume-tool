import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProfileDoc } from '../src/types';
import { parseJdRules } from '../src/ai/jd';
import { generateRules } from '../src/ai/generate';
import { toggleEntry, toggleBullet } from '../src/ai/selection';
import { buildLayout } from '../src/render/layout';
import { BUILTIN_TEMPLATES } from '../src/templates';
import { SAMPLE_JD } from '../src/sample/sampleJd';

const p = JSON.parse(readFileSync(resolve(__dirname, '../src/sample/sample-profile.json'), 'utf8')) as ProfileDoc;
const r0 = generateRules(p, parseJdRules(SAMPLE_JD), 'zh');
const workTitles = (r: typeof r0) => buildLayout(p, BUILTIN_TEMPLATES[0], 'zh', r).main.find((s) => s.key === 'work')?.blocks.map((b) => b.title) ?? [];

describe('material pool selection', () => {
  it('unchecking an entry removes it and its bullets from the layout', () => {
    const r = toggleEntry(p, r0, 'work', 'work-2', false);
    expect(workTitles(r)).toEqual(['星河科技']);
    expect(r.items.some((i) => i.sourceId.startsWith('work-2-'))).toBe(false);
  });
  it('re-checking inserts it back in date order with both languages', () => {
    const r = toggleEntry(p, toggleEntry(p, r0, 'work', 'work-1', false), 'work', 'work-1', true);
    expect(workTitles(r)).toEqual(['星河科技', '云帆数据']);
    const it = r.items.find((i) => i.sourceId === 'work-1-b1')!;
    expect(it.zh).toContain('编辑器'); expect(it.en).toContain('editor');
    expect(buildLayout(p, BUILTIN_TEMPLATES[0], 'en', r).main.find((s) => s.key === 'work')!.blocks[0].title).toBe('Galaxy Tech');
  });
  it('bullet toggles change only that bullet; checking a bullet selects its entry', () => {
    let r = toggleBullet(p, r0, 'work', 'work-1', p.work[0].bullets[0], false);
    expect(buildLayout(p, BUILTIN_TEMPLATES[0], 'zh', r).main.find((s) => s.key === 'work')!.blocks[0].bullets).toHaveLength(p.work[0].bullets.length - 1);
    r = toggleEntry(p, r, 'projects', 'proj-2', false);
    r = toggleBullet(p, r, 'projects', 'proj-2', p.projects[1].bullets[0], true);
    expect(r.selection.projects).toContain('proj-2');
  });
});
