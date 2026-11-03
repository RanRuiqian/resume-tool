import { useApp } from '../store';
import { compareFacts } from '../ai/consistency';
import { sourceText } from '../ai/provenance';

/** 编辑提示只提供帮助，不要求证明材料或阻止导出。AI 生成端仍校验事实。 */
export function ResumeNotice() {
  const { profile, resume } = useApp();
  if (!resume) return null;
  const count = resume.consistency.issues.length || resume.items.some((i) => compareFacts(sourceText(profile, i)[resume.primaryLanguage] ?? '', i[resume.primaryLanguage]).length > 0)
    || Object.values(resume.entryEdits ?? {}).some((e) => e.start !== undefined || e.end !== undefined || e.date !== undefined || e.texts?.degree !== undefined);
  return count ? <p className="small muted" data-testid="resume-edit-notice">文字可能与原资料或另一语言存在差异，请留意数字、日期和学位表述。可直接编辑、预览和下载。</p> : null;
}
