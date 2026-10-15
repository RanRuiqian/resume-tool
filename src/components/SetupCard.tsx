import { useState } from 'react';
import { useApp } from '../store';
import { PROVIDERS } from '../storage/defaults';
import { chat } from '../ai/provider';
import type { Settings } from '../types';

/** 首次使用：三步完成 AI 配置（选服务 → 粘贴 Key → 测试），或先用演示模式 */
export function SetupCard({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const { settings, setSettings } = useApp();
  const [s, setS] = useState<Settings>(settings);
  const [state, setState] = useState<'' | 'testing' | 'ok' | string>('');
  const pv = PROVIDERS[s.provider];
  const pick = (k: Settings['provider']) => { const p = PROVIDERS[k]; setS({ ...s, provider: k, baseUrl: p.baseUrl || s.baseUrl, model: p.model || s.model, visionModel: p.visionModel, ocrMode: p.ocrMode }); setState(''); };
  const test = async () => {
    setState('testing');
    try { await chat(s, [{ role: 'user', content: '只回复 OK' }], { timeoutMs: 20000 }); setState('ok'); const n = { ...s, demoMode: false, setupDone: true }; setSettings(n); onDone?.(); }
    catch (e) { setState((e as Error).message); }
  };
  return (
    <div className={`card setup ${compact ? '' : 'hero'}`}>
      {!compact && <><h3>先连接一个 AI 服务（1 分钟）</h3><p className="muted">AI 用来整理你的经历、读懂岗位要求、改写并翻译简历。Key 只保存在你自己的浏览器里。</p></>}
      <div className="provider-list">
        {(Object.keys(PROVIDERS) as Settings['provider'][]).map((k) => (
          <button key={k} className={`provider ${s.provider === k ? 'active' : ''}`} onClick={() => pick(k)}>{PROVIDERS[k].label}</button>
        ))}
      </div>
      {s.provider === 'custom' && (
        <div className="grid2">
          <label>接口地址 Base URL<input value={s.baseUrl} placeholder="https://.../v1" onChange={(e) => setS({ ...s, baseUrl: e.target.value })} /></label>
          <label>模型名称<input value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} /></label>
        </div>
      )}
      <label>粘贴你的 API Key {pv.keyUrl && <a href={pv.keyUrl} target="_blank" rel="noreferrer">（还没有？点这里去申请）</a>}
        <input type="password" autoComplete="off" placeholder="sk-..." value={s.apiKey} onChange={(e) => { setS({ ...s, apiKey: e.target.value.trim() }); setState(''); }} />
      </label>
      <div className="row">
        <button className="primary big" disabled={!s.apiKey || !s.baseUrl || state === 'testing'} onClick={test}>{state === 'testing' ? '连接中…' : '保存并测试连接'}</button>
        {!compact && <button className="link" onClick={() => { setSettings({ ...settings, demoMode: true, setupDone: true }); onDone?.(); }}>暂时跳过，先用演示模式看看 →</button>}
      </div>
      {state === 'ok' && <div className="notice ok">连接成功 ✓</div>}
      {state && state !== 'ok' && state !== 'testing' && <div className="notice error">连接失败：{state}。请检查 Key 是否正确、账户是否有余额。</div>}
      {s.provider === 'deepseek' && <div className="muted small">DeepSeek 不能直接看图片：岗位截图会在你的浏览器里本地识别文字（首次需下载约 20 MB 识别模型），无需额外设置。</div>}
    </div>
  );
}
