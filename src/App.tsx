import { useState } from 'react';
import { AppProvider, useApp } from './store';
import { useT, type MsgKey } from './i18n';
import { ProfilePage } from './pages/ProfilePage';
import { JobPage } from './pages/JobPage';
import { GeneratePage } from './pages/GeneratePage';
import { LayoutPage } from './pages/LayoutPage';
import { SettingsPage } from './pages/SettingsPage';

const NAV: [string, MsgKey][] = [['profile', 'navProfile'], ['job', 'navJob'], ['generate', 'navGenerate'], ['layout', 'navLayout'], ['settings', 'navSettings']];

function Shell() {
  const { ready, settings } = useApp();
  const t = useT();
  const [page, setPageS] = useState(() => location.hash.slice(1) || 'profile');
  const go = (p: string) => { setPageS(p); window.history.replaceState(null, '', `#${p}`); };
  if (!ready) return <div className="loading">加载中…</div>;
  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">📄 {t('appName')}</div>
        {NAV.map(([k, m]) => <button key={k} className={page === k ? 'active' : ''} onClick={() => go(k)}>{t(m)}</button>)}
        <span className="spacer" />
        {settings.demoMode && <button className="badge st-machine" onClick={() => go('settings')}>{t('demoBadge')}</button>}
      </nav>
      <main>
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
