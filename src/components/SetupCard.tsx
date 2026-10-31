import { useApp } from '../store';
import { ApiForm } from './ApiManager';

/** 首次使用：选服务商 → 粘贴 Key → 确定并启用（会保存为「AI API 管理」中的第一条配置），或先用演示模式 */
export function SetupCard({ onDone }: { onDone?: () => void }) {
  const { settings, setSettings } = useApp();
  return (
    <div className="card setup hero">
      <h3>先连接一个 AI 服务（1 分钟）</h3>
      <p className="muted">AI 用来整理你的经历、读懂岗位要求、改写并翻译简历。Key 只保存在你自己的浏览器里；以后可在「设置 → AI API 管理」添加、切换或删除。</p>
      <ApiForm firstUse onDone={() => onDone?.()} />
      <button className="link" onClick={() => { setSettings({ ...settings, demoMode: true, setupDone: true }); onDone?.(); }}>暂时跳过，先用演示模式看看 →</button>
      <div className="muted small">岗位截图默认在你的浏览器里本地识别文字（首次需下载约 20 MB 识别模型），截图不会发给 AI。（DeepSeek 新模型已支持图片输入，本工具暂未使用。）</div>
    </div>
  );
}
