import { useApp } from '../store';
import type { GenItem, Lang } from '../types';
import { runConsistency, textIndex } from '../ai/generate';
import { lt } from '../locale/text';

const PARENT_LABEL = (id: string) => (id === 'profile' ? '个人简介' : id.startsWith('work') ? '工作' : id.startsWith('proj') ? '项目' : id.startsWith('edu') ? '教育' : id);

/** 生成结果逐条编辑：修改主版本会把副版本标为「待同步」 */
export function ItemsEditor() {
  const { profile, resume, setResume } = useApp();
  if (!resume) return null;
  const idx = textIndex(profile);
  const issueIds = new Set(resume.consistency.issues.map((i) => i.sourceId));
  const editItem = (i: number, l: Lang, v: string) => {
    const items = resume.items.map((x, j): GenItem => (j === i ? { ...x, [l]: v, syncStatus: l === resume.primaryLanguage ? 'pending' : x.syncStatus } : x));
    setResume(runConsistency({ ...resume, items }));
  };
  return (
    <table className="items">
      <thead><tr><th>出处</th><th>中文</th><th>English</th></tr></thead>
      <tbody>
        {resume.items.map((it, i) => {
          const src = idx.get(it.sourceId);
          return (
            <tr key={it.sourceId} className={issueIds.has(it.sourceId) ? 'bad' : it.syncStatus === 'pending' ? 'pending' : ''}>
              <td className="small" title={src ? '原文：' + lt(src.t, resume.primaryLanguage) : ''}>{PARENT_LABEL(src?.parent ?? '')}<div className="muted">{it.sourceId}</div></td>
              <td><textarea rows={2} value={it.zh} onChange={(e) => editItem(i, 'zh', e.target.value)} /></td>
              <td><textarea rows={2} value={it.en} onChange={(e) => editItem(i, 'en', e.target.value)} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
