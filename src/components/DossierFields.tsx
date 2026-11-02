import type { EducationEntry, ProfileDoc, Proficiency, ProjectDossier, ProjectEntry, SkillEntry } from '../types';
import { uid } from '../locale/text';

/** 新字段的编辑器：全部收在可折叠卡片里，不填也不影响原有流程 */

const Txt = ({ label, value, onChange, rows = 2, hint }: { label: string; value?: string; onChange: (v: string) => void; rows?: number; hint?: string }) => (
  <label className="df-field">{label}{rows > 1 ? <textarea rows={rows} value={value ?? ''} placeholder={hint} onChange={(e) => onChange(e.target.value)} /> : <input value={value ?? ''} placeholder={hint} onChange={(e) => onChange(e.target.value)} />}</label>
);
const List = ({ label, value, onChange, hint }: { label: string; value?: string[]; onChange: (v: string[]) => void; hint?: string }) => (
  <label className="df-field">{label}<input value={(value ?? []).join('、')} placeholder={hint ?? '用顿号或逗号分隔'} onChange={(e) => onChange(e.target.value.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean))} /></label>
);
const lt = (t: { zh?: string; en?: string }) => t.zh || t.en || '';

const PROF_LABEL: Record<Proficiency, string> = { '': '未填写', aware: '了解', used: '用过', proficient: '熟练', expert: '精通' };

export function EducationExtra({ e, set }: { e: EducationEntry; set: (fn: (x: EducationEntry) => void) => void }) {
  const filled = [e.courseCompletionDate, e.expectedConferralDate, e.actualConferralDate, e.availableFullTimeDate].filter(Boolean).length;
  return (
    <details className="df">
      <summary>🎓 毕业相关日期与课程{filled ? `（已填 ${filled} 个日期）` : '（可选，应届生建议填写）'}</summary>
      <p className="muted small">这几个日期分开保存：很多校招要求“某日前取得学位证”，课程结束 ≠ 拿到学位。</p>
      <div className="grid2">
        <Txt rows={1} label="课程完成日期" hint="YYYY-MM" value={e.courseCompletionDate} onChange={(v) => set((x) => { x.courseCompletionDate = v; })} />
        <Txt rows={1} label="预计学位授予日期" hint="YYYY-MM" value={e.expectedConferralDate} onChange={(v) => set((x) => { x.expectedConferralDate = v; })} />
        <Txt rows={1} label="实际学位授予日期" hint="拿到后再填" value={e.actualConferralDate} onChange={(v) => set((x) => { x.actualConferralDate = v; })} />
        <Txt rows={1} label="最早可全职入职" hint="YYYY-MM" value={e.availableFullTimeDate} onChange={(v) => set((x) => { x.availableFullTimeDate = v; })} />
      </div>
      <List label="相关课程" value={e.courses} onChange={(v) => set((x) => { x.courses = v; })} hint="如：机器视觉、自动控制原理、嵌入式系统" />
      <Txt label="通过学习获得的专业能力" value={e.abilities} onChange={(v) => set((x) => { x.abilities = v; })} hint="写你实际做到过的，例如：能独立完成相机标定与手眼标定" />
    </details>
  );
}

const DOSSIER_TEXT: [keyof ProjectDossier, string, string][] = [
  ['background', '项目背景', '为什么要做这个项目'], ['need', '实际需求', '要解决的具体需求/指标'], ['responsibility', '本人职责', '你负责哪部分（不要写团队的）'],
  ['technicalWork', '具体技术工作', ''], ['problems', '遇到的问题', ''], ['solution', '解决方案', ''], ['methods', '实验 / 验证方法', ''],
  ['quantResults', '量化结果', '如：节拍从 8s 降到 5s；准确率 97.2%'], ['finalOutcome', '最终成果', '上线 / 交付 / 验收 / 论文…'], ['publications', '论文或公开成果', '题目、期刊/会议、链接'],
];

export function ProjectDossierEditor({ e, set }: { e: ProjectEntry; set: (fn: (x: ProjectEntry) => void) => void }) {
  const d = e.dossier ?? {};
  const upd = (fn: (d: ProjectDossier) => void) => set((x) => { x.dossier = x.dossier ?? {}; fn(x.dossier); });
  const filled = DOSSIER_TEXT.filter(([k]) => d[k]).length + (d.phases?.length ? 1 : 0);
  return (
    <details className="df">
      <summary>📂 项目详细档案{filled ? `（已填 ${filled} 项）` : '（可选：积累项目原始素材，只存本机）'}</summary>
      <p className="muted small">档案只存在本机，是给你自己和以后核对用的原始素材；简历上显示的仍是上面的「经历要点」。</p>
      {DOSSIER_TEXT.map(([k, label, hint]) => <Txt key={k} label={label} hint={hint} value={d[k] as string} onChange={(v) => upd((x) => { (x as Record<string, unknown>)[k] = v; })} />)}
      <List label="使用的软件 / 硬件 / 工具" value={d.tools} onChange={(v) => upd((x) => { x.tools = v; })} hint="如：Halcon、ABB IRB 1200、海康工业相机、ROS2" />
      <List label="技术关键词" value={d.keywords} onChange={(v) => upd((x) => { x.keywords = v; })} />
      <div className="df-sub">
        <b className="small">失败方案与原因</b>
        {(d.failedAttempts ?? []).map((f, i) => (
          <div key={f.id} className="row">
            <input className="grow" placeholder="试过的方案" value={f.approach} onChange={(ev) => upd((x) => { x.failedAttempts![i].approach = ev.target.value; })} />
            <input className="grow" placeholder="为什么不行" value={f.reason} onChange={(ev) => upd((x) => { x.failedAttempts![i].reason = ev.target.value; })} />
            <button className="danger small" onClick={() => upd((x) => { x.failedAttempts!.splice(i, 1); })}>×</button>
          </div>))}
        <button className="small" onClick={() => upd((x) => { x.failedAttempts = [...(x.failedAttempts ?? []), { id: uid('fa'), approach: '', reason: '' }]; })}>+ 失败方案</button>
      </div>
      <div className="df-sub">
        <b className="small">项目阶段</b>
        {(d.phases ?? []).map((ph, i) => (
          <div key={ph.id} className="df-phase">
            <div className="row">
              <input placeholder="阶段名，如：方案验证" value={ph.name} onChange={(ev) => upd((x) => { x.phases![i].name = ev.target.value; })} />
              <input placeholder="开始 YYYY-MM" value={ph.start ?? ''} onChange={(ev) => upd((x) => { x.phases![i].start = ev.target.value; })} />
              <input placeholder="结束 YYYY-MM" value={ph.end ?? ''} onChange={(ev) => upd((x) => { x.phases![i].end = ev.target.value; })} />
              <button className="danger small" onClick={() => upd((x) => { x.phases!.splice(i, 1); })}>×</button>
            </div>
            <div className="row">
              <input className="grow" placeholder="这一阶段做了什么" value={ph.work ?? ''} onChange={(ev) => upd((x) => { x.phases![i].work = ev.target.value; })} />
              <input className="grow" placeholder="阶段成果" value={ph.outcome ?? ''} onChange={(ev) => upd((x) => { x.phases![i].outcome = ev.target.value; })} />
            </div>
          </div>))}
        <button className="small" onClick={() => upd((x) => { x.phases = [...(x.phases ?? []), { id: uid('ph'), name: '' }]; })}>+ 阶段</button>
      </div>
    </details>
  );
}

export function SkillExtra({ e, profile, set }: { e: SkillEntry; profile: ProfileDoc; set: (fn: (x: SkillEntry) => void) => void }) {
  const entries = [...profile.projects.map((p) => ({ id: p.id, label: '项目·' + lt(p.name) })), ...profile.work.map((w) => ({ id: w.id, label: '工作·' + lt(w.company) }))];
  const used = new Set(e.usedIn ?? []);
  return (
    <details className="df">
      <summary>🧩 技能档案{e.proficiency ? `（${PROF_LABEL[e.proficiency]}${used.size ? ` · ${used.size} 段经历` : ''}）` : '（可选：掌握程度、在哪里用过）'}</summary>
      <p className="muted small">掌握程度只由你自己填写，系统不会根据专业或课程自动认定你会某项技能。</p>
      <div className="grid2">
        <label className="df-field">实际掌握程度
          <select value={e.proficiency ?? ''} onChange={(ev) => set((x) => { x.proficiency = ev.target.value as Proficiency; })}>
            {Object.entries(PROF_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <Txt rows={1} label="最近使用时间" hint="YYYY-MM" value={e.lastUsed} onChange={(v) => set((x) => { x.lastUsed = v; })} />
      </div>
      {entries.length > 0 && <div className="df-field">用过这项技能的经历<div className="chips">{entries.map((x) => (
        <label key={x.id} className={`chip ${used.has(x.id) ? 'on' : ''}`}><input type="checkbox" hidden checked={used.has(x.id)} onChange={(ev) => set((s) => { s.usedIn = ev.target.checked ? [...(s.usedIn ?? []), x.id] : (s.usedIn ?? []).filter((y) => y !== x.id); })} />{x.label || x.id}</label>))}</div></div>}
      <Txt label="使用场景" value={e.scenarios} onChange={(v) => set((x) => { x.scenarios = v; })} hint="如：用 OpenCV 做零件尺寸在线检测" />
    </details>
  );
}
