import { useApp } from '../store';

/** AI 调用前说明哪些资料会发给外部模型（A4）。内容需与 generate.ts 中 generatePrimaryAi / localizeAi 实际发送的字段保持一致 */
export const GENERATE_SENDS = '岗位要点（职位、要求、关键词）；已启用条目的公司 / 职位 / 起止时间 / 要点 / 标签；教育的学校 / 专业 / 学位 / 亮点；技能、证书、获奖名称；个人简介与职业头衔；术语表；确认过的课程名称、内容概述、知识域、证据等级与项目关联；联合模式下每个岗位的独立 JD 与要求。';
export const GENERATE_NEVER = '姓名、联系方式、照片、出生年月 / 性别 / 籍贯 / 政治面貌、课程成绩、原始成绩单全文、课程来源文件位置、项目详细档案、证据文件及其本地路径。';

export function AiDisclosure({ what = 'generate' }: { what?: 'generate' }) {
  const { settings } = useApp();
  if (settings.demoMode || what !== 'generate') return null;
  let host = 'DeepSeek';
  try { host = new URL(settings.baseUrl).host || host; } catch { /* 保持默认 */ }
  return (
    <details className="muted small ai-disclosure" data-testid="ai-disclosure">
      <summary>🔒 生成时会把部分资料发送给外部 AI 模型（{host}）</summary>
      <div>会发送：{GENERATE_SENDS}</div>
      <div>不会发送：{GENERATE_NEVER}</div>
    </details>
  );
}
