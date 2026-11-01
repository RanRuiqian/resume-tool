import { describe, expect, it, vi } from 'vitest';
import { rawToProfile } from '../src/ai/importProfile';
import type { JobParse, Settings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/storage/defaults';

// A4：生成时发送给外部模型的内容不含证据文件 / 本地路径 / 联系方式 / 项目档案（模拟数据，不联网）
const sent: string[] = [];
vi.mock('../src/ai/provider', () => ({
  chatJson: vi.fn(async (_s: unknown, msgs: { content: string }[]) => { sent.push(msgs.map((m) => m.content).join('\n')); return { items: [], selection: {} }; }),
}));

describe('A4 AI 发送内容边界', () => {
  it('不发送证据、本地路径、联系方式、项目档案', async () => {
    const { generateResume } = await import('../src/ai/generate');
    const p = rawToProfile({ name: '测试用户己', phone: '13800000000', email: 'mock@example.com',
      projects: [{ name: '仓储 AGV 调度', bullets: ['实现 A* 路径规划'] }],
      evidence: [{ fileName: '答辩.mp4', type: 'video', location: 'E:/私密/答辩.mp4', proves: '演示', project: '仓储 AGV 调度' }] });
    p.projects[0].dossier = { background: '档案里的机密背景XYZ', tools: ['SecretTool'] };
    const job = { id: 'j', title: { zh: '算法', en: 'Algo' }, company: { short: 'M' }, mustHave: [], niceToHave: [], keywords: [], yearsRequired: 0, summary: '' } as unknown as JobParse;
    const s: Settings = { ...DEFAULT_SETTINGS, apiKey: 'test-not-a-real-key', setupDone: true };
    // 仅验证隐私边界；Mock 返回无效方案时真实模式现在明确报错，不再静默生成规则简历。
    await generateResume(s, p, job, 'zh', 1).catch(() => {});
    const all = sent.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const bad of ['E:/私密', '答辩.mp4', '13800000000', 'mock@example.com', '测试用户己', '档案里的机密背景XYZ', 'SecretTool', 'test-not-a-real-key']) expect(all).not.toContain(bad);
  });
});
