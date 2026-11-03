import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/ai/provider', async (orig) => ({ ...(await orig<typeof import('../src/ai/provider')>()), chatJson: vi.fn() }));
import { chatJson } from '../src/ai/provider';
import { explainJob, unexplained } from '../src/ai/jobExplain';
import type { JobParse, Settings } from '../src/types';

const s = { demoMode: false, model: 'mock', provider: 'custom', apiKey: 'FAKE-ONLY' } as Settings;
const api = vi.mocked(chatJson); beforeEach(() => api.mockReset());
const job = (): JobParse => ({ id: 'j1', createdAt: '', rawText: '', jdLanguage: 'zh', company: { full: '模拟公司', short: '模拟' }, roleAbbr: 'ME', title: { zh: '机械设计工程师', en: '' },
  mustHave: [{ zh: '熟练使用 CAD', en: '' }], niceToHave: [], yearsRequired: null, keywords: [], summary: '', responsibilities: [{ zh: '澄清订单技术相关的事宜', en: '' }, { zh: '处理工程变更', en: '' }] });

describe('岗位要求解读', () => {
  it('按 id 对应、丢弃无效 id 和重复项、截断过长文字，不发送个人资料', async () => {
    api.mockResolvedValue({ items: [
      { id: 'j1:responsibility:0', meaning: '核对客户订单里的技术参数', abilities: '读规格书、制图', experience: '课程项目' },
      { id: 'j1:responsibility:0', meaning: '重复', abilities: '', experience: '' },
      { id: 'bad', meaning: 'x', abilities: '', experience: '' },
      { id: 'j1:must:0', meaning: 'a'.repeat(999), abilities: '', experience: '' }] });
    const out = await explainJob(s, job());
    expect(out.items.map((x) => x.id)).toEqual(['j1:must:0', 'j1:responsibility:0']);
    expect(out.items.find((x) => x.id === 'j1:must:0')!.meaning.length).toBe(260);
    expect(out.items.find((x) => x.id === 'j1:responsibility:0')!.meaning).toBe('核对客户订单里的技术参数');
    const sent = JSON.stringify(api.mock.calls[0][1]);
    expect(sent).toContain('澄清订单技术相关的事宜');
    expect(api.mock.calls[0][2]).toMatchObject({ thinking: 'disabled' });
  });
  it('补充解读只请求缺失的条目，保留已有解读；全部已解读时不再调用 AI', async () => {
    const j = job();
    j.explain = { createdAt: '', items: [{ id: 'j1:must:0', text: '熟练使用 CAD', meaning: '已有', abilities: '', experience: '' }] };
    expect(unexplained(j).map((x) => x.id)).toEqual(['j1:responsibility:0', 'j1:responsibility:1']);
    api.mockResolvedValue({ items: [{ id: 'j1:responsibility:1', meaning: '新增', abilities: '', experience: '' }] });
    const out = await explainJob(s, j);
    expect(out.items.map((x) => x.id)).toEqual(['j1:must:0', 'j1:responsibility:1']);
    expect(JSON.stringify(api.mock.calls[0][1])).not.toContain('熟练使用 CAD');
    api.mockClear();
    j.explain = { createdAt: '', items: unexplained(j).map((r) => ({ ...r, meaning: 'm', abilities: '', experience: '' })).concat(j.explain.items) };
    await explainJob(s, j); expect(api).not.toHaveBeenCalled();
  });
  it('原文变化的解读视为过期；AI 没返回可用内容时报错而不是写入空解读', async () => {
    const j = job(); j.explain = { createdAt: '', items: [{ id: 'j1:must:0', text: '旧原文', meaning: 'm', abilities: '', experience: '' }] };
    expect(unexplained(j).map((x) => x.id)).toContain('j1:must:0');
    api.mockResolvedValue({ items: [] });
    await expect(explainJob(s, j)).rejects.toThrow('没有返回可用的解读');
  });
});
