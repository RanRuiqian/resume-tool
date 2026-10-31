import { useMemo, useState } from 'react';
import { findDuplicates } from '../../tracker/repo';
import { APP_STATUSES, PRIORITY_LABEL, RECRUIT_LABEL, STATUS_LABEL, type AppStatus, type JobPosting, type Priority, type RecruitType } from '../../tracker/types';
import type { PostingInput } from '../../tracker/repo';

const EMPTY: PostingInput = { company: '', title: '', city: '', priority: 2 };
const F: [keyof PostingInput, string, string?][] = [
  ['company', '公司名称 *'], ['title', '岗位名称 *'], ['city', '工作城市'], ['category', '岗位类别', '如：机器视觉 / 机器人 / 测试'],
  ['companyType', '企业类型（选填）', '外企 / 国企 / 民企…'], ['sourcePlatform', '来源平台', '官网 / 牛客 / Boss / LinkedIn…'],
  ['applyUrl', '原始投递网址', 'https://'], ['officialUrl', '官方招聘网址', 'https://'], ['programYear', '招聘项目年份', '如：2027 届'],
  ['salary', '薪资范围（选填）'],
];

export function PostingForm({ initial, all, onSave, onCancel }: { initial?: JobPosting; all: JobPosting[]; onSave: (p: PostingInput, status?: AppStatus) => void; onCancel: () => void }) {
  const [v, setV] = useState<PostingInput>(() => (initial ? { ...initial } : { ...EMPTY }));
  const [status, setStatus] = useState<AppStatus | ''>('');
  const set = <K extends keyof PostingInput>(k: K, x: PostingInput[K]) => setV((o) => ({ ...o, [k]: x }));
  const dups = useMemo(() => (v.company.trim() && v.title.trim() ? findDuplicates(all, v, initial?.id) : []), [all, v, initial?.id]);
  const ok = v.company.trim() && v.title.trim();
  return (
    <div className="card tracker-form" data-testid="posting-form">
      <h3>{initial ? '编辑岗位' : '新增岗位'}</h3>
      <div className="grid2">
        {F.map(([k, label, ph]) => <label key={k}>{label}<input data-testid={`pf-${k}`} value={(v[k] as string) ?? ''} placeholder={ph} onChange={(e) => set(k, e.target.value as never)} /></label>)}
        <label>招聘类型<select data-testid="pf-recruitType" value={v.recruitType ?? ''} onChange={(e) => set('recruitType', (e.target.value || undefined) as RecruitType | undefined)}><option value="">（未选择）</option>{Object.entries(RECRUIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>个人优先级<select data-testid="pf-priority" value={v.priority ?? 2} onChange={(e) => set('priority', Number(e.target.value) as Priority)}>{([1, 2, 3] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
        <label>发布日期<input type="date" value={v.publishedAt ?? ''} onChange={(e) => set('publishedAt', e.target.value || undefined)} /></label>
        <label>申请截止日期<input type="date" data-testid="pf-deadline" value={v.deadline ?? ''} onChange={(e) => set('deadline', e.target.value || undefined)} /></label>
      </div>
      <label>岗位说明<textarea rows={2} value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} /></label>
      <label>完整 JD 原文<textarea rows={6} data-testid="pf-jdText" value={v.jdText ?? ''} onChange={(e) => set('jdText', e.target.value)} placeholder="粘贴招聘页上的岗位职责与任职要求原文" /></label>
      <label>岗位要求（摘要）<textarea rows={2} value={v.requirements ?? ''} onChange={(e) => set('requirements', e.target.value)} /></label>
      <label>备注<textarea rows={2} data-testid="pf-notes" value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></label>
      {!initial && <label>同时建立申请记录（可不选：只把岗位放进岗位库）<select data-testid="pf-status" value={status} onChange={(e) => setStatus(e.target.value as AppStatus | '')}><option value="">不建立，仅放入岗位库</option>{APP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>}
      {dups.length > 0 && <div className="notice warn" data-testid="dup-warn">⚠ 可能与已有岗位重复，注意避免重复投递：{dups.map((d) => <div key={d.posting.id}>· {d.posting.company} · {d.posting.title} · {d.posting.city || '—'}（{d.reason === 'url' ? '投递链接相同' : d.reason === 'same-key' ? '公司 + 岗位 + 城市相同' : '同公司同岗位、城市不同'}）</div>)}</div>}
      <div className="row end"><button onClick={onCancel}>取消</button><button className="primary" data-testid="pf-save" disabled={!ok} onClick={() => onSave(v, status || undefined)}>保存</button></div>
    </div>
  );
}
