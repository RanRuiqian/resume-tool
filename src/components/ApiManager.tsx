import { useState } from 'react';
import { useApp } from '../store';
import { PROVIDERS } from '../storage/defaults';
import { aiMode, maskKey, presetFor, providerLabel, settingsForProfile, validateDraft, type ProfileDraft } from '../storage/apiProfiles';
import { testConnection } from '../ai/provider';
import type { ApiProfile, ApiProvider } from '../types';

const PROVS: ApiProvider[] = ['deepseek', 'qwen', 'openai', 'custom'];
type TestState = { state: 'testing' } | { state: 'ok'; ms: number } | { state: 'fail'; message: string };

/** 当前是否会真实调用 AI —— 一眼可见 */
export function AiModeBanner() {
  const { settings } = useApp();
  const m = aiMode(settings);
  if (m.kind === 'demo') return <div className="notice warn" data-testid="ai-mode">演示模式：<b>不会调用任何 AI</b>，也不会产生费用。要真实使用 AI，请在下方启用一套 API（启用后自动退出演示模式）。</div>;
  if (m.kind === 'none') return <div className="notice error" data-testid="ai-mode">尚未启用 API：AI 功能暂不可用。请在下方「添加新的 API」或从列表中选择一套点「启用」。</div>;
  return <div className="notice ok" data-testid="ai-mode">正式模式：AI 请求将<b>真实发送</b>到「{m.profile.name}」（{providerLabel(m.profile.provider)} · {m.profile.model}）。</div>;
}

/** 新增 / 编辑面板。编辑时 Key 留空 = 保留原 Key */
export function ApiForm({ editing, onDone, onCancel, firstUse }: { editing?: ApiProfile; onDone: (msg: string) => void; onCancel?: () => void; firstUse?: boolean }) {
  const { settings, saveApiProfile } = useApp();
  const count = (p: ApiProvider) => (settings.apiProfiles ?? []).filter((x) => x.provider === p).length;
  const autoName = (p: ApiProvider) => { const n = count(p); return n ? `${providerLabel(p)} ${n + 1}` : providerLabel(p); };
  const [d, setD] = useState<ProfileDraft>(() => editing
    ? { id: editing.id, name: editing.name, provider: editing.provider, baseUrl: editing.baseUrl, apiKey: '', model: editing.model, translateModel: editing.translateModel, visionModel: editing.visionModel }
    : { name: autoName('deepseek'), ...presetFor('deepseek'), apiKey: '' });
  const [nameTouched, setNameTouched] = useState(!!editing);
  const [errs, setErrs] = useState<string[]>([]);
  const isNew = !editing;
  const pick = (p: ApiProvider) => setD({ ...d, ...presetFor(p), name: nameTouched ? d.name : autoName(p) });
  const save = () => {
    const e = validateDraft(d, isNew); setErrs(e); if (e.length) return;
    saveApiProfile(d, isNew);
    onDone(isNew ? `已保存并启用「${d.name.trim()}」。（仅保存，尚未测试连接——可点「测试连接」确认能否调用）` : `已保存对「${d.name.trim()}」的修改${d.apiKey.trim() ? '（已更换 Key）' : '（Key 未改动）'}`);
  };
  const keyUrl = PROVIDERS[d.provider].keyUrl;
  const up = (k: keyof ProfileDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <div className="card form api-form" data-testid="api-form">
      <h4>{isNew ? (firstUse ? '连接一个 AI 服务' : '添加新的 API') : `编辑「${editing.name}」`}</h4>
      <div className="provider-list">
        {PROVS.map((p) => <button key={p} type="button" data-testid={`prov-${p}`} className={`provider ${d.provider === p ? 'active' : ''}`} onClick={() => pick(p)}>{providerLabel(p)}</button>)}
      </div>
      <label>配置名称<input data-testid="f-name" value={d.name} maxLength={40} placeholder="例如：DeepSeek 主力" onChange={(e) => { setNameTouched(true); setD({ ...d, name: e.target.value }); }} /></label>
      <label>API Key {keyUrl && <a href={keyUrl} target="_blank" rel="noreferrer">（还没有？去申请）</a>}
        <input data-testid="f-key" type="password" autoComplete="new-password" spellCheck={false} placeholder={isNew ? 'sk-...' : `留空则保留原 Key（${maskKey(editing.apiKey)}）`} value={d.apiKey} onChange={up('apiKey')} />
      </label>
      {d.provider === 'custom' && <div className="grid2">
        <label>Base URL<input data-testid="f-url" value={d.baseUrl} placeholder="https://.../v1" onChange={up('baseUrl')} /></label>
        <label>模型名称<input data-testid="f-model" value={d.model} onChange={up('model')} /></label>
      </div>}
      <details data-testid="f-adv"><summary>高级参数（一般不用改）</summary>
        {d.provider !== 'custom' && <div className="grid2">
          <label>Base URL<input data-testid="f-url" value={d.baseUrl} onChange={up('baseUrl')} /></label>
          <label>模型名称<input data-testid="f-model" value={d.model} onChange={up('model')} /></label>
        </div>}
        <div className="grid2">
          <label>翻译模型（留空同上）<input data-testid="f-tmodel" value={d.translateModel} onChange={up('translateModel')} /></label>
          <label>截图识别（多模态）模型<input data-testid="f-vmodel" value={d.visionModel} placeholder="可留空" onChange={up('visionModel')} /></label>
        </div>
      </details>
      {errs.length > 0 && <div className="notice error" data-testid="f-errors">{errs.join('\n')}</div>}
      <div className="row">
        <button className="primary big" data-testid="f-save" onClick={save}>{isNew ? '确定并启用' : '保存修改'}</button>
        {onCancel && <button data-testid="f-cancel" onClick={onCancel}>取消</button>}
      </div>
      <div className="muted small">Key 只保存在本浏览器，不会上传到 GitHub 或任何服务器（除了你选择的 AI 服务商本身）。</div>
    </div>
  );
}

/** 设置页「AI API 管理」：列表 + 切换 + 测试 + 编辑 + 删除 + 添加 */
export function ApiManager() {
  const { settings, switchApiProfile, removeApiProfile } = useApp();
  const list = settings.apiProfiles ?? [];
  const [mode, setMode] = useState<'list' | 'add' | { edit: string }>(list.length ? 'list' : 'add');
  const [msg, setMsg] = useState('');
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [confirmDel, setConfirmDel] = useState<ApiProfile | null>(null);
  const active = settings.activeProfileId;
  const run = async (p: ApiProfile) => {
    setTests((t) => ({ ...t, [p.id]: { state: 'testing' } }));
    const r = await testConnection(settingsForProfile(settings, p)); // 用这条配置测试；不改变当前启用
    setTests((t) => ({ ...t, [p.id]: r.ok ? { state: 'ok', ms: r.ms } : { state: 'fail', message: r.message } }));
  };
  const editing = typeof mode === 'object' ? list.find((p) => p.id === mode.edit) : undefined;
  return (
    <section className="api-manager" data-testid="api-manager">
      <h3>AI API 管理</h3>
      <AiModeBanner />
      {msg && <div className="notice ok" data-testid="api-msg">{msg}</div>}
      {!active && list.length > 0 && <div className="notice warn" data-testid="pick-hint">当前没有启用的 API。为避免产生意外费用，系统不会自动切换到其他配置，请在下面选择一套点「启用」。</div>}
      {list.length === 0 && mode === 'list' && <div className="muted" data-testid="api-empty">还没有保存任何 API。</div>}
      <ul className="api-list" data-testid="api-list">
        {list.map((p) => {
          const on = p.id === active; const t = tests[p.id];
          return (
            <li key={p.id} className={`api-item ${on ? 'on' : ''}`} data-testid="api-item" data-id={p.id}>
              <div className="api-main">
                <div className="api-title"><b data-testid="api-name">{p.name}</b>{on ? <span className="badge st-ok" data-testid="api-active">使用中</span> : null}</div>
                <div className="muted small api-meta"><span>{providerLabel(p.provider)}</span> · <span data-testid="api-model">{p.model}</span> · <code data-testid="api-key">{maskKey(p.apiKey)}</code></div>
                {t && <div className={`small api-test ${t.state}`} data-testid="api-test">{t.state === 'testing' ? '测试中…' : t.state === 'ok' ? `连接成功 ✓（${(t.ms / 1000).toFixed(1)} 秒）` : `连接失败：${t.message}`}</div>}
              </div>
              <div className="api-actions">
                {on ? <button disabled className="api-on">使用中</button> : <button className="primary" data-testid="api-switch" onClick={() => { switchApiProfile(p.id); setMsg(`已切换到「${p.name}」，后续 AI 请求将使用这套配置`); }}>{active ? '切换' : '启用'}</button>}
                <button data-testid="api-test-btn" disabled={t?.state === 'testing'} onClick={() => run(p)}>测试连接</button>
                <button data-testid="api-edit" onClick={() => { setMode({ edit: p.id }); setMsg(''); }}>编辑</button>
                <button className="api-del" aria-label={`删除 ${p.name}`} title="删除" data-testid="api-del" onClick={() => setConfirmDel(p)}>×</button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && <ApiForm key={editing.id} editing={editing} onDone={(m) => { setMsg(m); setMode('list'); }} onCancel={() => setMode('list')} />}
      {mode === 'add' && <ApiForm onDone={(m) => { setMsg(m); setMode('list'); }} onCancel={list.length ? () => setMode('list') : undefined} />}
      {mode === 'list' && <button className="api-add" data-testid="api-add" onClick={() => { setMode('add'); setMsg(''); }}>＋ 添加新的 API</button>}
      {confirmDel && (
        <div className="modal-bg" data-testid="del-dialog" role="dialog" aria-modal="true">
          <div className="modal">
            <h4>确定删除「{confirmDel.name}」吗？</h4>
            <p>删除后该 API Key（{maskKey(confirmDel.apiKey)}）将从本浏览器的配置中移除，<b>无法恢复</b>。个人资料、简历和投递记录不受影响。</p>
            {confirmDel.id === active && <p className="notice warn">这是当前正在使用的 API。删除后不会自动切换到其他配置，需要你自己选择新的 API。</p>}
            <div className="row">
              <button className="danger" data-testid="del-ok" onClick={() => { const p = confirmDel; removeApiProfile(p.id); setConfirmDel(null); setTests((t) => { const n = { ...t }; delete n[p.id]; return n; }); setMsg(`已删除「${p.name}」`); if (list.length === 1) setMode('add'); else if (typeof mode === 'object' && mode.edit === p.id) setMode('list'); }}>确定删除</button>
              <button data-testid="del-cancel" onClick={() => setConfirmDel(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
