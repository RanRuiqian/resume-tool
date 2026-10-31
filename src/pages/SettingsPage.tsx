import { useApp } from '../store';
import { useT } from '../i18n';
import type { Settings } from '../types';
import { ApiManager } from '../components/ApiManager';

export function SettingsPage() {
  const { settings, setSettings } = useApp();
  const t = useT();
  return (
    <div className="page narrow">
      <div className="toolbar"><h2>{t('navSettings')}</h2></div>
      <div className="card form">
        <ApiManager />
      </div>
      <div className="card form">
        <label className="check"><input type="checkbox" data-testid="demo-toggle" checked={settings.demoMode} onChange={(e) => setSettings({ ...settings, demoMode: e.target.checked })} /> <b>演示模式</b>：不调用任何 AI，使用规则解析 / 关键词匹配 / 资料库原文与已有译文（缺失译文用「演示机翻」占位）</label>
        <label>岗位截图识别方式<select value={settings.ocrMode} onChange={(e) => setSettings({ ...settings, ocrMode: e.target.value as Settings['ocrMode'] })}><option value="local">浏览器本地识别（免费，默认；不把截图发给 AI）</option><option value="vision">AI 多模态模型识别（需在当前 API 的高级参数里填写多模态模型）</option></select></label>
        <label>界面语言<select value={settings.uiLang} onChange={(e) => setSettings({ ...settings, uiLang: e.target.value as 'zh' | 'en' })}><option value="zh">中文</option><option value="en">English（部分）</option></select></label>
        <div className="notice">{t('privacy')}</div>
      </div>
    </div>
  );
}
