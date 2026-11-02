import { useApp } from '../store';
import { textIndex } from '../ai/generate';
import { editResumeItem } from '../ai/editResume';
import { lt } from '../locale/text';
import { sourceIdsOf, sourceText } from '../ai/provenance';

const PARENT_LABEL = (id: string) => (id === 'profile' ? '个人简介' : id.startsWith('work') ? '工作' : id.startsWith('proj') ? '项目' : id.startsWith('edu') ? '教育' : id);

/** 生成结果逐条编辑：修改主版本会把副版本标为「待同步」 */
export function ItemsEditor() {
  const { profile, resume, setResume } = useApp();
  if (!resume) return null;
  const idx = textIndex(profile);
  const issueIds = new Set(resume.consistency.issues.map((i) => i.sourceId));
  return (
    <table className="items">
      <thead><tr><th>出处</th><th>中文</th><th>English</th></tr></thead>
      <tbody>
        {resume.items.map((it) => {
          const src = idx.get(it.sourceId);
          return (
            <tr key={it.sourceId} className={issueIds.has(it.sourceId) || it.syncStatus === 'needs-review' ? 'bad' : it.syncStatus === 'pending' ? 'pending' : ''}>
              <td className="small" title={src ? '原文：' + lt(sourceText(profile, it), resume.primaryLanguage) : ''}>{PARENT_LABEL(src?.parent ?? '')}<div className="muted">{sourceIdsOf(it).join(' + ')}</div>
                {it.syncStatus === 'needs-review' && <div className="muted small" data-testid="needs-review">中英文可能不一致，可继续编辑和导出。</div>}</td>
              <td><textarea rows={2} value={it.zh} onChange={(e) => setResume(editResumeItem(resume, it.sourceId, 'zh', e.target.value))} /></td>
              <td><textarea rows={2} value={it.en} onChange={(e) => setResume(editResumeItem(resume, it.sourceId, 'en', e.target.value))} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
