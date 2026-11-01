import { useApp } from '../store';
import type { GenItem, Lang } from '../types';
import { runConsistency, textIndex } from '../ai/generate';
import { compareFacts } from '../ai/consistency';
import { lt, other } from '../locale/text';
import { sourceIdsOf, sourceText } from '../ai/provenance';

const PARENT_LABEL = (id: string) => (id === 'profile' ? '个人简介' : id.startsWith('work') ? '工作' : id.startsWith('proj') ? '项目' : id.startsWith('edu') ? '教育' : id);

/** 生成结果逐条编辑：修改主版本会把副版本标为「待同步」 */
export function ItemsEditor() {
  const { profile, resume, setResume } = useApp();
  if (!resume) return null;
  const idx = textIndex(profile);
  const issueIds = new Set(resume.consistency.issues.map((i) => i.sourceId));
  const editItem = (i: number, l: Lang, v: string) => {
    const pri = resume.primaryLanguage;
    const items = resume.items.map((x, j): GenItem => {
      if (j !== i) return x;
      if (l === pri) return { ...x, [l]: v, syncStatus: 'pending', confirmedLangs: (x.confirmedLangs ?? []).filter((k) => k === pri) };
      // 手动修改副版本 = 人工确认该译文；仍需通过事实校验才算已同步（A2/B6）
      const f = compareFacts(x[pri], v);
      return { ...x, [l]: v, confirmedLangs: [...new Set([...(x.confirmedLangs ?? []), l])], syncStatus: f.length ? 'needs-review' : 'in-sync', translation: { source: x.translation?.source ?? 'ai', aiText: x.translation?.aiText, factIssues: f, checkedAt: new Date().toISOString() } };
    });
    setResume(runConsistency({ ...resume, items }));
  };
  return (
    <table className="items">
      <thead><tr><th>出处</th><th>中文</th><th>English</th></tr></thead>
      <tbody>
        {resume.items.map((it, i) => {
          const src = idx.get(it.sourceId);
          return (
            <tr key={it.sourceId} className={issueIds.has(it.sourceId) || it.syncStatus === 'needs-review' ? 'bad' : it.syncStatus === 'pending' ? 'pending' : ''}>
              <td className="small" title={src ? '原文：' + lt(sourceText(profile, it), resume.primaryLanguage) : ''}>{PARENT_LABEL(src?.parent ?? '')}<div className="muted">{sourceIdsOf(it).join(' + ')}</div>
                {it.syncStatus === 'needs-review' && <div className="uncertain" data-testid="needs-review">⚠ 需人工核对译文{it.translation?.factIssues.length ? '：' + it.translation.factIssues.join('；') : ''}{it.translation?.aiText && it.translation.aiText !== it[other(resume.primaryLanguage)] ? <div className="muted">AI 译文：{it.translation.aiText}</div> : null}</div>}</td>
              <td><textarea rows={2} value={it.zh} onChange={(e) => editItem(i, 'zh', e.target.value)} /></td>
              <td><textarea rows={2} value={it.en} onChange={(e) => editItem(i, 'en', e.target.value)} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
