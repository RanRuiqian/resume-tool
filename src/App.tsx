import { useState } from 'react';
import { AppProvider, useApp } from './store';
import { useT, type MsgKey } from './i18n';
import { ProfilePage } from './pages/ProfilePage';
import { JobPage } from './pages/JobPage';
import { GeneratePage } from './pages/GeneratePage';
import { LayoutPage } from './pages/LayoutPage';
import { SettingsPage } from './pages/SettingsPage';
import { WizardPage } from './pages/WizardPage';
import { FEATURES } from './features';
import { exitDemoUrl } from './storage/mode';

const NAV: [string, MsgKey][] = [['profile', 'navProfile'], ['layout', 'navLayout'], ['settings', 'navSettings']];
const ADV: [string, MsgKey][] = [['job', 'navJob'], ['generate', 'navGenerate']];

function Shell() {
  const { ready, settings, setSettings, isDemo } = useApp();
  const t = useT();
  const [page, setPageS] = useState(() => location.hash.slice(1) || 'wizard');
  const go = (p: string) => { setPageS(p); window.history.replaceState(null, '', `#${p}`); };
  if (!ready) return <div className="loading">加载中…</div>;
  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">📄 {t('appName')}</div>
        <button className={page === 'wizard' ? 'active main-nav' : 'main-nav'} onClick={() => go('wizard')}>{t('navWizard')}</button>
        {NAV.map(([k, m]) => <button key={k} className={page === k ? 'active' : ''} onClick={() => go(k)}>{t(m)}</button>)}
        <details className="adv-menu"><summary>{settings.uiLang === 'en' ? 'Advanced' : '高级'}</summary>{ADV.map(([k, m]) => <button key={k} className={page === k ? 'active' : ''} onClick={(e) => { go(k); (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>{t(m)}</button>)}</details>
        <span className="spacer" />
        {FEATURES.uiLangSwitch && <button className="lang-switch" title="中文 / English" onClick={() => setSettings({ ...settings, uiLang: settings.uiLang === 'en' ? 'zh' : 'en' })}>{settings.uiLang === 'en' ? '中文' : 'EN'}</button>}
        {settings.demoMode && <button className="badge st-machine" onClick={() => go('settings')}>{t('demoBadge')}</button>}
      </nav>
      {isDemo && <div className="notice warn demo-banner" data-testid="demo-banner">演示模式：这里的资料是示例，保存在独立的演示数据库里，<b>不会改动你的真实资料</b>。<a href={exitDemoUrl()}>退出演示 →</a></div>}
      <main>
        {page === 'wizard' && <WizardPage go={go} />}
        {page === 'profile' && <ProfilePage />}
        {page === 'job' && <JobPage go={go} />}
        {page === 'generate' && <GeneratePage go={go} />}
        {page === 'layout' && <LayoutPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

export default function App() { return <AppProvider><Shell /></AppProvider>; }
