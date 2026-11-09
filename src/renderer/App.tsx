import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, PanelsTopLeft, RefreshCw, Watch } from 'lucide-react';
import { TopBar } from './components/layout/TopBar';
import { ContentArea } from './components/layout/ContentArea';
import { QuotaSummary } from './components/pulse/QuotaSummary';
import { BandDeskPage } from './components/pulse/BandDeskPage';
import { HooksSetupDialog } from './components/pulse/HooksSetupDialog';
import { SettingsPage } from './components/pulse/SettingsPage';
import { SettingsHub, type SettingsSection } from './components/pulse/SettingsHub';
import { SetupWizard } from './components/setup';
import { DiagnosticsScreen } from './components/pulse/DiagnosticsScreen';
import { MiniBar } from './components/minibar/MiniBar';
import { FloatingWindowPage } from './components/minibar/FloatingWindowPage';
import { useBandConnection } from './hooks/useBandConnection';
import { useQuotaState } from './hooks/useQuotaState';
import { useQuotaDisplay } from './hooks/useQuotaDisplay';
import type { PulseCoreState } from '../main/services/pulse-core-bridge';
import type { PulseErrorEntry } from '../main/services/error-log';

type WorkspaceTab = 'floating' | 'band';
type Page = WorkspaceTab | SettingsSection;
type AppScreen = Page | 'minibar';

function getInitialScreen(): AppScreen {
  const screen = new URLSearchParams(window.location.search).get('screen');
  if (screen === 'floating' || screen === 'minibar' || screen === 'band' || screen === 'settings' || screen === 'diagnostics') return screen;
  if (screen === 'watchface') return 'band';
  try {
    const saved = localStorage.getItem('nexo-workspace-page');
    if (['floating', 'band', 'settings', 'diagnostics', 'support', 'about'].includes(saved || '')) return saved as Page;
  } catch { /* Fall back to the dashboard if storage is unavailable. */ }
  return 'floating';
}

export function App() {
  const [screen] = useState(getInitialScreen);
  const [page, setPage] = useState<Page>(screen === 'minibar' ? 'floating' : screen);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(screen === 'band' ? 'band' : 'floating');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('pulse-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  useEffect(() => {
    if (screen === 'minibar') return;
    try { localStorage.setItem('nexo-workspace-page', page); } catch { /* Preferences remain usable in memory. */ }
  }, [page, screen]);
  const [showSetup, setShowSetup] = useState(false);
  const [showHooks, setShowHooks] = useState(false);
  const [hooksConfigured, setHooksConfigured] = useState(false);
  const hooksPromptChecked = useRef(false);
  useEffect(() => {
    if (screen === 'minibar') return;
    let active = true;
    const readHooks = () => {
      void window.pulse?.getHookStatus().then(status => {
        if (!active) return;
        setHooksConfigured(status.installed === true);
        if (!hooksPromptChecked.current) {
          hooksPromptChecked.current = true;
          if (!status.installed) setShowHooks(true);
        }
      }).catch(() => {});
    };
    readHooks();
    window.addEventListener('focus', readHooks);
    return () => { active = false; window.removeEventListener('focus', readHooks); };
  }, [screen]);
  const [setupStartIndex, setSetupStartIndex] = useState(0);
  const [errors, setErrors] = useState<PulseErrorEntry[]>([]);
  const [core, setCore] = useState<PulseCoreState | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const band = useBandConnection();
  const { state: quota, updatedAt, loading, refreshing, refresh } = useQuotaState();
  const display = useQuotaDisplay(quota);

  useEffect(() => {
    if (screen === 'minibar') return;
    let active = true;
    const check = async () => {
      try {
        const result = await window.pulse?.checkUpdate();
        if (active && result?.ok) setUpdateAvailable(!!result.updateAvailable);
      } catch { /* Retain the last successful update result while offline. */ }
    };
    void check();
    const timer = setInterval(() => void check(), 30 * 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [screen]);

  useEffect(() => window.pulse?.onOpenMiniBarSettings?.(() => {
    setPage('floating');
    setWorkspaceTab('floating');
  }), []);

  const changeTheme = (value: 'light' | 'dark') => {
    setTheme(value);
    try { localStorage.setItem('pulse-theme', value); } catch {}
  };

  useEffect(() => {
    const syncTheme = (event: StorageEvent) => {
      if (event.key === 'pulse-theme' && (event.newValue === 'light' || event.newValue === 'dark')) setTheme(event.newValue);
    };
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  useEffect(() => {
    if (screen !== 'minibar') return;
    document.documentElement.classList.add('screen-minibar');
    return () => document.documentElement.classList.remove('screen-minibar');
  }, [screen]);

  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(() => {
    if (screen === 'minibar' || !window.pulse) return;
    let active = true;
    window.pulse.getCoreState().then(value => { if (active) setCore(value); });
    const unsubscribe = window.pulse.onCoreState(value => setCore(value));
    return () => { active = false; unsubscribe(); };
  }, [screen]);

  useEffect(() => {
    if (page !== 'diagnostics') return;
    let active = true;
    window.pulse?.getErrorLog?.().then(value => { if (active) setErrors(value || []); });
    return () => { active = false; };
  }, [page, showSetup]);

  if (screen === 'minibar') return <MiniBar theme={theme} />;

  const navigate = (value: Page) => {
    setPage(value);
    if (value === 'floating' || value === 'band') setWorkspaceTab(value);
  };
  const startSetup = (step = 0) => { setSetupStartIndex(step); setShowSetup(true); };
  const mainPage = page === 'floating' || page === 'band';
  const clearErrors = () => { void window.pulse?.clearErrorLog?.().then(() => setErrors([])); };

  return <div className="nexo-app nexo-app--workspace w-full h-full flex flex-col text-[var(--text-primary)] overflow-hidden transition-colors duration-200">
    <div className="workspace-fixed-header">
      <TopBar theme={theme} onThemeChange={changeTheme} onNavigate={navigate} settingsActive={!mainPage} updateAvailable={updateAvailable} hooksConfigured={hooksConfigured} hooksActive={showHooks} onOpenHooks={() => setShowHooks(true)} />
      <div className="workspace-fixed-toolbar">
        <div className="workspace-toolbar">
          {mainPage ? <nav className="workspace-tabs" aria-label="工作台">
            <button type="button" aria-pressed={workspaceTab === 'floating'} onClick={() => navigate('floating')}><PanelsTopLeft size={19} />Windows 悬浮窗</button>
            <button type="button" aria-pressed={workspaceTab === 'band'} onClick={() => navigate('band')}><Watch size={19} />手环桌搭</button>
          </nav> : <button type="button" className="settings-back-button" aria-label={`返回${workspaceTab === 'band' ? '手环桌搭' : 'Windows 悬浮窗'}`} onClick={() => navigate(workspaceTab)}><ChevronLeft size={25} /></button>}
          {mainPage && <button type="button" className="nexo-action btn-primary workspace-refresh" disabled={refreshing || loading} onClick={() => void refresh()}><RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />{refreshing ? '刷新中' : '刷新数据'}</button>}
        </div>
      </div>
    </div>
    <ContentArea key={page}>
      <div className="workspace-shell">
        {mainPage && <QuotaSummary display={display} />}
        {page === 'floating' && <FloatingWindowPage quota={quota} embedded />}
        {page === 'band' && <BandDeskPage quota={quota} display={display} connection={band} setupOpen={showSetup} onStartSetup={startSetup} />}
        {!mainPage && <SettingsHub section={page as SettingsSection} onNavigate={navigate} updateAvailable={updateAvailable} onUpdateAvailable={setUpdateAvailable}>
          {page === 'settings' && <SettingsPage />}
          {page === 'diagnostics' && <DiagnosticsScreen daemon={core?.daemon ?? null} connection={core?.connection ?? {state:'disconnected'}} errors={errors} onClearErrors={clearErrors} updatedAt={updatedAt} onRefresh={refresh} />}
        </SettingsHub>}
      </div>
    </ContentArea>
    {showHooks && <HooksSetupDialog onClose={() => setShowHooks(false)} onConfiguredChange={setHooksConfigured} />}
    {showSetup && <SetupWizard initialStepIndex={setupStartIndex} onClose={() => setShowSetup(false)} onFinish={() => setShowSetup(false)} />}
  </div>;
}

export default App;
