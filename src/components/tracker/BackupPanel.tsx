import { useState } from 'react';
import { db } from '../../storage/db';
import { downloadBytes } from '../../utils/download';
import { MIN_KEY_PASSWORD } from '../../tracker/backupSettings';
import { exportArchiveZip, exportLightJson, readArchive, restoreArchive, SECTION_LABEL, SECTIONS, type ArchiveCheck, type RestoreResult, type Section } from '../../tracker/backup';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
/** 完整求职档案：ZIP 导出 / 轻量 JSON / 验证后恢复（支持部分导入，失败整体回滚） */
export function BackupPanel({ onDone, isDemo }: { onDone?: () => void; isDemo: boolean }) {
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);
  const [chk, setChk] = useState<ArchiveCheck | null>(null);
  const [secs, setSecs] = useState<Section[]>([...SECTIONS]);
  const [overwrite, setOverwrite] = useState(false), [replaceProfile, setReplaceProfile] = useState(false);
  const [res, setRes] = useState<RestoreResult | null>(null);
  // 导出选项：API 设置默认带上（不含 Key）；Key 只有勾选并设置密码才加密导出
  const [withSettings, setWithSettings] = useState(true), [withKey, setWithKey] = useState(false);
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  // 恢复选项
  const [restoreSettings, setRestoreSettings] = useState(true), [inPw, setInPw] = useState('');
  const pwProblem = !withSettings || !withKey ? '' : pw.length < MIN_KEY_PASSWORD ? `加密密码至少 ${MIN_KEY_PASSWORD} 位` : pw !== pw2 ? '两次输入的密码不一致' : '';
  const exportOpts = () => ({ settings: withSettings, keyPassword: withSettings && withKey ? pw : undefined });
  const keyNote = () => (withSettings && withKey ? '含 API 设置与加密后的 API Key（恢复时需要你刚设置的密码，请记住它）' : withSettings ? '含 API 设置，不含 API Key' : '不含 API 设置与 Key');
  const exportZip = async () => { if (pwProblem) { setMsg({ t: 'error', m: pwProblem }); return; } setMsg({ t: '', m: '正在打包…' }); try { downloadBytes(await exportArchiveZip(db, exportOpts()), `求职档案_${isDemo ? '演示_' : ''}${stamp()}.zip`, 'application/zip'); setMsg({ t: 'ok', m: `已导出完整求职档案（${keyNote()}）。文件包含个人资料，请妥善保存，不要上传到公开仓库。` }); } catch (e) { setMsg({ t: 'error', m: `导出失败：${(e as Error).message}` }); } };
  const exportJson = async () => { if (pwProblem) { setMsg({ t: 'error', m: pwProblem }); return; } try { downloadBytes(new TextEncoder().encode(await exportLightJson(db, exportOpts())), `求职档案_轻量_${stamp()}.json`, 'application/json'); setMsg({ t: 'ok', m: `已导出轻量 JSON（不含附件文件本体；${keyNote()}）` }); } catch (e) { setMsg({ t: 'error', m: `导出失败：${(e as Error).message}` }); } };
  const pick = async (f?: File) => {
    setMsg(null); setRes(null); setChk(null); if (!f) return;
    try { const c = await readArchive(db, new Uint8Array(await f.arrayBuffer())); setChk(c); setSecs(SECTIONS.filter((s) => c.incoming[s] > 0)); setRestoreSettings(!!c.settings); setInPw(''); }
    catch (e) { setMsg({ t: 'error', m: (e as Error).message }); }
  };
  const run = async () => {
    if (!chk) return;
    try {
      const r = await restoreArchive(db, chk, { sections: secs, overwrite, replaceProfile, restoreSettings, keyPassword: inPw || undefined });
      setRes(r); setChk(null); onDone?.();
      // 资料 / 设置 / 模板由全局 store 在启动时读入：写入后刷新页面才生效
      if (r.written.profile || r.written.templates || (r.settings && (r.settings.added || r.settings.replaced))) window.setTimeout(() => window.location.reload(), 2500);
    }
    catch (e) { setMsg({ t: 'error', m: /解密失败/.test((e as Error).message) ? (e as Error).message : `恢复失败，已回滚，本机数据未改变：${(e as Error).message}` }); }
  };
  return (
    <div className="card" data-testid="backup-panel">
      <h3>备份与恢复</h3>
      <p className="muted small">浏览器里的资料不会自动同步到 GitHub 或其他电脑。换电脑 / 换浏览器 / 换手机时，在这里导出一个备份文件，再到新设备的同一位置导入即可（资料库、生成的简历、投递记录、我的版式模板、API 设置都在里面）。</p>
      <div className="backup-opts">
        <label className="check"><input type="checkbox" data-testid="bk-settings" checked={withSettings} onChange={(e) => setWithSettings(e.target.checked)} /> 包含 API 设置（服务商、网址、模型；不含 Key）</label>
        <label className="check"><input type="checkbox" data-testid="bk-key" disabled={!withSettings} checked={withSettings && withKey} onChange={(e) => setWithKey(e.target.checked)} /> 同时备份 API Key（用你设置的密码加密，文件里没有明文 Key）</label>
        {withSettings && withKey && <div className="row">
          <input type="password" data-testid="bk-pw" autoComplete="new-password" placeholder={`加密密码（至少 ${MIN_KEY_PASSWORD} 位）`} value={pw} onChange={(e) => setPw(e.target.value)} />
          <input type="password" data-testid="bk-pw2" autoComplete="new-password" placeholder="再输一次" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>}
        {pwProblem && (pw || pw2) && <div className="muted small" data-testid="bk-pw-problem">{pwProblem}</div>}
        {withSettings && withKey && <div className="muted small">密码只用于加密，不会保存在任何地方；忘记密码就只能在新设备上重新填 Key。</div>}
      </div>
      <div className="row"><button className="primary" data-testid="export-archive" onClick={exportZip}>⬇ 导出完整求职档案（ZIP，含附件）</button><button data-testid="export-light" onClick={exportJson}>导出轻量 JSON（不含附件）</button></div>
      <label>从备份恢复（.zip 或轻量 .json）<input type="file" data-testid="archive-file" accept=".zip,.json,application/zip,application/json" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
      {msg && <div className={`notice ${msg.t}`} data-testid="backup-msg">{msg.m}</div>}
      {chk && (<div data-testid="archive-check">
        <div className="notice">备份生成于 {chk.manifest?.generatedAt.slice(0, 16).replace('T', ' ')} · 数据库版本 {chk.manifest?.dbVersion} · {chk.manifest?.light ? '轻量 JSON' : '完整 ZIP'}</div>
        {chk.errors.map((e) => <div key={e} className="notice error">✖ {e}</div>)}
        {chk.warnings.map((w) => <div key={w} className="notice warn" data-testid="archive-warning">⚠ {w}</div>)}
        <table className="items small"><thead><tr><th>导入</th><th>内容</th><th>备份中</th><th>本机已存在</th></tr></thead><tbody>
          {SECTIONS.map((s) => <tr key={s}><td><input type="checkbox" data-testid={`sec-${s}`} disabled={!chk.incoming[s]} checked={secs.includes(s)} onChange={(e) => setSecs(e.target.checked ? [...secs, s] : secs.filter((x) => x !== s))} /></td><td>{SECTION_LABEL[s]}</td><td>{chk.incoming[s]}</td><td>{chk.existing[s]}</td></tr>)}
        </tbody></table>
        {chk.settings && <div className="backup-opts" data-testid="restore-settings-box">
          <label className="check"><input type="checkbox" data-testid="restore-settings" checked={restoreSettings} onChange={(e) => setRestoreSettings(e.target.checked)} /> 恢复 API 设置（{chk.settings.apiProfiles.length} 套配置{chk.encryptedKeys ? `，含 ${chk.encryptedKeys.count} 个加密 Key` : '，不含 Key'}）</label>
          {restoreSettings && chk.encryptedKeys && <input type="password" data-testid="restore-pw" autoComplete="off" placeholder="导出时设置的加密密码（留空 = 不恢复 Key）" value={inPw} onChange={(e) => setInPw(e.target.value)} />}
        </div>}
        <label className="check"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> 本机已存在的同 ID 记录用备份覆盖（默认跳过）</label>
        <label className="check"><input type="checkbox" data-testid="replace-profile" checked={replaceProfile} onChange={(e) => setReplaceProfile(e.target.checked)} /> 用备份中的个人资料替换本机资料（替换前自动保存资料快照）</label>
        <div className="row end"><button onClick={() => setChk(null)}>取消</button><button className="primary" data-testid="restore-confirm" disabled={!!chk.errors.length || (!secs.length && !(restoreSettings && chk.settings))} onClick={run}>验证通过，开始恢复</button></div>
      </div>)}
      {res && <div className="notice ok" data-testid="restore-result">恢复完成：{SECTIONS.filter((s) => res.written[s] || res.skipped[s]).map((s) => `${SECTION_LABEL[s]} 写入 ${res.written[s]}${res.skipped[s] ? ` / 跳过 ${res.skipped[s]}` : ''}`).join('；')}{res.settings ? `；API 配置 新增 ${res.settings.added}${res.settings.replaced ? ` / 替换 ${res.settings.replaced}` : ''}${res.settings.skipped ? ` / 跳过 ${res.settings.skipped}` : ''}，恢复 Key ${res.settings.keys} 个` : ''}{res.profileSnapshotId ? '。原资料已存入资料快照。' : ''}{res.written.profile || res.written.templates || (res.settings && (res.settings.added || res.settings.replaced)) ? '。页面即将自动刷新以载入恢复的内容。' : ''}</div>}
    </div>
  );
}
