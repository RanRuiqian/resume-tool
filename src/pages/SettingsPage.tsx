import { useApp } from '../store';
import { useT } from '../i18n';
import type { Settings } from '../types';

export function SettingsPage() {
  const { settings, setSettings } = useApp();
  const t = useT();
  const f = (k: keyof Settings, label: string, type = 'text', ph = '') => (
    <label>{label}<input type={type} placeholder={ph} value={String(settings[k] ?? '')} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} /></label>
  );
  return (
    <div className="page narrow">
      <div className="toolbar"><h2>{t('navSettings')}</h2></div>
      <div className="card form">
        <label className="check"><input type="checkbox" checked={settings.demoMode} onChange={(e) => setSettings({ ...settings, demoMode: e.target.checked })} /> <b>演示模式</b>：不调用任何 AI，使用规则解析 / 关键词匹配 / 资料库原文与已有译文（缺失译文用「演示机翻」占位）</label>
        <h4>AI 服务（OpenAI 兼容接口，自带 Key）</h4>
        {f('baseUrl', 'Base URL', 'text', 'https://api.openai.com/v1 / https://api.deepseek.com/v1 / https://dashscope.aliyuncs.com/compatible-mode/v1')}
        {f('apiKey', 'API Key（仅保存在本浏览器）', 'password', 'sk-...')}
        <div className="grid2">
          {f('model', '生成模型', 'text', 'gpt-4o-mini / deepseek-chat / qwen-plus')}
          {f('visionModel', '截图识别（多模态）模型', 'text', 'gpt-4o-mini / qwen-vl-plus')}
          {f('translateModel', '翻译模型（留空同生成模型）')}
        </div>
        <label>界面语言<select value={settings.uiLang} onChange={(e) => setSettings({ ...settings, uiLang: e.target.value as 'zh' | 'en' })}><option value="zh">中文</option><option value="en">English（部分）</option></select></label>
        <div className="notice">{t('privacy')}</div>
      </div>
    </div>
  );
}
