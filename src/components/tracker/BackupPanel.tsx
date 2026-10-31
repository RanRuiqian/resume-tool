import { useState } from 'react';
import { db } from '../../storage/db';
import { downloadBytes } from '../../utils/download';
import { exportArchiveZip, exportLightJson, readArchive, restoreArchive, SECTION_LABEL, SECTIONS, type ArchiveCheck, type RestoreResult, type Section } from '../../tracker/backup';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
/** 完整求职档案：ZIP 导出 / 轻量 JSON / 验证后恢复（支持部分导入，失败整体回滚） */
export function BackupPanel({ onDone, isDemo }: { onDone: () => void; isDemo: boolean }) {
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);
  const [chk, setChk] = useState<ArchiveCheck | null>(null);
  const [secs, setSecs] = useState<Section[]>([...SECTIONS]);
  const [overwrite, setOverwrite] = useState(false), [replaceProfile, setReplaceProfile] = useState(false);
  const [res, setRes] = useState<RestoreResult | null>(null);
  const exportZip = async () => { setMsg({ t: '', m: '正在打包…' }); try { downloadBytes(await exportArchiveZip(db), `求职档案_${isDemo ? '演示_' : ''}${stamp()}.zip`, 'application/zip'); setMsg({ t: 'ok', m: '已导出完整求职档案（不含 API Key）。文件包含个人资料，请妥善保存，不要上传到公开仓库。' }); } catch (e) { setMsg({ t: 'error', m: `导出失败：${(e as Error).message}` }); } };
  const exportJson = async () => { downloadBytes(new TextEncoder().encode(await exportLightJson(db)), `求职档案_轻量_${stamp()}.json`, 'application/json'); setMsg({ t: 'ok', m: '已导出轻量 JSON（不含附件文件本体，不含 API Key）' }); };
  const pick = async (f?: File) => {
    setMsg(null); setRes(null); setChk(null); if (!f) return;
    try { const c = await readArchive(db, new Uint8Array(await f.arrayBuffer())); setChk(c); setSecs(SECTIONS.filter((s) => c.incoming[s] > 0)); }
    catch (e) { setMsg({ t: 'error', m: (e as Error).message }); }
  };
  const run = async () => {
    if (!chk) return;
    try { const r = await restoreArchive(db, chk, { sections: secs, overwrite, replaceProfile }); setRes(r); setChk(null); onDone(); }
    catch (e) { setMsg({ t: 'error', m: `恢复失败，已回滚，本机数据未改变：${(e as Error).message}` }); }
  };
  return (
    <div className="card" data-testid="backup-panel">
      <h3>备份与恢复</h3>
      <p className="muted small">浏览器里的资料不会自动同步到 GitHub 或其他电脑。换电脑 / 换浏览器时，请在这里导出完整档案，再到新环境导入。</p>
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
        <label className="check"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> 本机已存在的同 ID 记录用备份覆盖（默认跳过）</label>
        <label className="check"><input type="checkbox" data-testid="replace-profile" checked={replaceProfile} onChange={(e) => setReplaceProfile(e.target.checked)} /> 用备份中的个人资料替换本机资料（替换前自动保存资料快照）</label>
        <div className="row end"><button onClick={() => setChk(null)}>取消</button><button className="primary" data-testid="restore-confirm" disabled={!!chk.errors.length || !secs.length} onClick={run}>验证通过，开始恢复</button></div>
      </div>)}
      {res && <div className="notice ok" data-testid="restore-result">恢复完成：{SECTIONS.filter((s) => res.written[s] || res.skipped[s]).map((s) => `${SECTION_LABEL[s]} 写入 ${res.written[s]}${res.skipped[s] ? ` / 跳过 ${res.skipped[s]}` : ''}`).join('；')}{res.profileSnapshotId ? '。原资料已存入资料快照。' : ''}</div>}
    </div>
  );
}
