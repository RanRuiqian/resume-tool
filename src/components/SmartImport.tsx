import { useState } from 'react';
import { useApp } from '../store';
import { useL } from '../i18n';
import { importProfileDetailed, mergeProfiles, type Uncertain } from '../ai/importProfile';
import { translateProfile } from '../ai/translate';
import { fileToText } from '../ai/fileText';
import { ProgressNote } from './ProgressNote';
import type { ProfileDoc } from '../types';

const PLACEHOLDER = `随便写，不用管顺序和格式，例如：
我叫李明，1998年5月出生，男，籍贯湖南长沙，党员。电话 138-0000-0000，邮箱 liming@example.com
2016-2020 中山大学 软件工程 本科，GPA 3.7，拿过两次一等奖学金
现在在腾讯做后端开发（2021.7 至今），负责支付对账服务，把对账耗时从 2 小时降到 15 分钟
之前在字节实习过半年，做推荐系统特征工程
会 Go、Java、MySQL、Redis、Kafka；英语六级 580；有 AWS 认证
大学参加 ACM 区域赛拿过银牌……`;

/** 「我的资料」顶部：自由文本一键识别并填入 → 复核 → 合并/替换 */
export function SmartImport() {
  const { settings, profile, setProfile } = useApp();
  const L = useL();
  const [text, setText] = useState('');
  const [prog, setProg] = useState<{ m: string; p?: number } | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const [res, setRes] = useState<{ p: ProfileDoc; u: Uncertain[] } | null>(null);
  const [done, setDone] = useState('');

  const loadFile = async (f: File) => {
    setErr(''); setProg({ m: L(`读取 ${f.name}`, `Reading ${f.name}`) });
    try { const t = await fileToText(f, (m, p) => setProg({ m, p })); setText((x) => (x ? x + '\n\n' : '') + t); }
    catch (e) { setErr((e as Error).message); } finally { setProg(null); }
  };
  const run = async () => {
    if (settings.demoMode) { setErr(L('演示模式不调用 AI。请先在「设置」连接 AI 服务。', 'Demo mode does not call AI. Connect an AI provider in Settings first.')); return; }
    setErr(''); setDone(''); setRes(null);
    try {
      const r = await importProfileDetailed(settings, text, (i, n) => setProg({ m: n > 1 ? L(`AI 识别中（第 ${i}/${n} 段）…`, `Recognizing (part ${i}/${n})…`) : L('AI 识别中（约 10–40 秒）…', 'Recognizing (10–40 s)…'), p: n > 1 ? (i - 1) / (n + 1) : undefined }));
      setProg({ m: L('生成另一种语言（机翻待校对）…', 'Translating (marked machine-translated)…') });
      let p = r.profile;
      try { p = (await translateProfile(settings, p, p.primaryLanguage === 'zh' ? 'en' : 'zh')).profile; } catch { /* 翻译失败不影响识别结果 */ }
      setRes({ p, u: r.uncertain });
    } catch (e) { setErr(L('识别失败：', 'Failed: ') + (e as Error).message); } finally { setProg(null); }
  };
  const apply = (mode: 'merge' | 'replace') => {
    if (!res) return;
    if (mode === 'replace' && !confirm(L('替换会清空现有资料（照片保留），确定吗？', 'Replace will discard your current profile (photo kept). Continue?'))) return;
    const n = mode === 'merge' ? mergeProfiles(profile, res.p) : { ...res.p, glossary: profile.glossary, profile: { ...res.p.profile, photo: profile.profile.photo, photoAspect: profile.profile.photoAspect } };
    setProfile(n); setRes(null); setText('');
    setDone(mode === 'merge' ? L('已合并到现有资料（重复的经历已合并要点）。请在下方各栏核对，英文为机翻待校对。', 'Merged (duplicates combined). Review below; English is machine-translated.') : L('已替换。请在下方各栏核对。', 'Replaced. Review below.'));
  };

  const p = res?.p;
  const pr = p?.profile;
  const uncertainOf = (sec: string) => res?.u.filter((x) => x.field.toLowerCase().startsWith(sec)) ?? [];
  const rows: [string, string, number, string][] = p ? [
    ['basic', L('基本信息', 'Basic info'), [pr!.name.zh || pr!.name.en, pr!.headline.zh || pr!.headline.en, pr!.contacts.phone, pr!.contacts.email, pr!.contacts.location?.zh || pr!.contacts.location?.en].filter(Boolean).length,
      [pr!.name.zh || pr!.name.en, pr!.headline.zh || pr!.headline.en, pr!.contacts.phone, pr!.contacts.email, pr!.contacts.location?.zh || pr!.contacts.location?.en].filter(Boolean).join(' · ')],
    ['personal', L('个人信息', 'Personal'), Object.values(pr!.personal ?? {}).filter(Boolean).length,
      [pr!.personal?.birth, pr!.personal?.gender, pr!.personal?.hometown, pr!.personal?.politics].filter(Boolean).join(' · ')],
    ['education', L('教育', 'Education'), p.education.length, p.education.map((e) => `${e.school.zh || e.school.en} ${e.major.zh || e.major.en || ''}`).join('；')],
    ['work', L('工作', 'Work'), p.work.length, p.work.map((e) => `${e.company.zh || e.company.en}·${e.title.zh || e.title.en}（${e.bullets.length}）`).join('；')],
    ['projects', L('项目', 'Projects'), p.projects.length, p.projects.map((e) => e.name.zh || e.name.en).join('；')],
    ['skills', L('技能', 'Skills'), p.skills.length, p.skills.map((e) => e.name.zh || e.name.en).join('、')],
    ['certificates', L('证书', 'Certificates'), p.certificates.length, p.certificates.map((e) => e.name.zh || e.name.en).join('；')],
    ['awards', L('获奖', 'Awards'), p.awards.length, p.awards.map((e) => e.name.zh || e.name.en).join('；')],
  ] : [];
  const missingDates = p ? [...p.work, ...p.education, ...p.projects].filter((e) => !e.start).length : 0;
  const hasExisting = !!(profile.profile.name.zh || profile.profile.name.en || profile.work.length || profile.education.length);

  return (
    <div className="card smart-import" data-testid="smart-import">
      <h3>{L('✍️ 一次写完所有经历，AI 帮你分类填好', '✍️ Write everything once — AI sorts it into the fields')}</h3>
      <p className="muted small">{L('把个人信息、教育、工作、项目、技能、证书、获奖一股脑写进来，顺序和格式都不重要，也可以把旧简历文件拖进框里。AI 只整理你写的内容，不会编造；没写的字段保持空白。', 'Paste or type all your background in any order. You can also drop an old resume file into the box. AI only organizes what you wrote — nothing is invented; unknown fields stay empty.')}</p>
      <textarea className={`big-input ${drag ? 'drag' : ''}`} rows={10} value={text} placeholder={PLACEHOLDER} onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); }} />
      <div className="row">
        <label className="filebtn">📎 {L('或选择文件（PDF / Word / 图片 / txt）', 'or choose a file (PDF / Word / image / txt)')}<input type="file" hidden accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} /></label>
        <span className="muted small">{text.length ? L(`${text.length} 字`, `${text.length} chars`) : ''}</span>
        <span className="spacer" />
        <button className="primary big" disabled={!text.trim() || !!prog} onClick={run}>✨ {L('智能识别并填入', 'Recognize & fill')}</button>
      </div>
      {prog && <ProgressNote msg={prog.m} pct={prog.p} />}
      {err && <div className="notice error">{err}</div>}
      {done && <div className="notice ok">✓ {done}</div>}
      {res && (
        <div className="review" data-testid="import-review">
          <h4>{L('识别结果，请确认', 'Recognized — please review')}</h4>
          <table><tbody>{rows.map(([k, label, n, sum]) => {
            const u = uncertainOf(k === 'basic' ? 'name' : k);
            return (
              <tr key={k} className={n === 0 ? 'empty-row' : ''}>
                <td><b>{label}</b></td><td className="num">{n}</td>
                <td className="small">{sum || <span className="muted">{L('未识别到（保持空白）', 'none found (left empty)')}</span>}
                  {u.map((x, i) => <div key={i} className="uncertain">⚠ {x.field}：{x.note}</div>)}</td>
              </tr>);
          })}</tbody></table>
          {res.u.filter((x) => !rows.some(([k]) => x.field.toLowerCase().startsWith(k === 'basic' ? 'name' : k))).map((x, i) => <div key={i} className="uncertain small">⚠ {x.field}：{x.note}</div>)}
          {missingDates > 0 && <div className="uncertain small">⚠ {L(`${missingDates} 段经历没有识别到开始时间，请在下方补上`, `${missingDates} entries have no start date — please fill in below`)}</div>}
          <div className="muted small">{L('另一种语言为机翻，已标记「机翻待校对」。', 'The other language is machine-translated and marked for review.')}</div>
          <div className="row end">
            <button onClick={() => setRes(null)}>{L('取消', 'Cancel')}</button>
            {hasExisting && <button className="danger" onClick={() => apply('replace')}>{L('替换现有资料', 'Replace profile')}</button>}
            <button className="primary" onClick={() => apply('merge')}>{hasExisting ? L('合并到现有资料', 'Merge into profile') : L('填入资料', 'Fill profile')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
