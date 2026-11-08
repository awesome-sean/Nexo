import type { ReactNode } from 'react';
import { Activity, Heart, Info, Settings2 } from 'lucide-react';
import { APP_NAME, APP_VERSION } from '../../../common/app-info';
import appIcon from '../../../../assets/desktop-mark.svg';
import { SupportPage } from './SupportPage';
import { UpdateSection } from './UpdateSection';
import { BandAppUpdateSection } from './BandAppUpdateSection';

export type SettingsSection = 'settings' | 'diagnostics' | 'support' | 'about';
const sections = [
  { id: 'settings', label: '偏好设置', icon: Settings2 },
  { id: 'diagnostics', label: '运行诊断', icon: Activity },
  { id: 'support', label: '打赏作者', icon: Heart },
  { id: 'about', label: '关于 Nexo', icon: Info },
] as const;

export function SettingsHub({ section, onNavigate, children, updateAvailable, onUpdateAvailable }: { section: SettingsSection; onNavigate: (section: SettingsSection) => void; children: ReactNode; updateAvailable?: boolean; onUpdateAvailable?: (available: boolean) => void }) {
  return <div className="settings-hub">
    <aside className="settings-navigation">
      <h1>设置</h1>
      <nav aria-label="设置功能">
        {sections.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={section === id ? 'page' : undefined} aria-label={id === 'about' && updateAvailable ? `${label}，有新版本` : label} onClick={() => onNavigate(id)}><Icon size={20} strokeWidth={1.7} />{label}{id === 'about' && updateAvailable && <span className="nexo-update-dot" aria-hidden="true" />}</button>)}
      </nav>
    </aside>
    <div className="settings-detail">
      {children}
      {section === 'support' && <SupportPage />}
      {section === 'about' && <div className="settings-information-page">
        <h2>关于 Nexo</h2>
        <section className="nexo-floating-settings-card settings-about-card">
          <div className="settings-about-brand"><img src={appIcon} alt="" /><div><h3>{APP_NAME}</h3><p>桌面与手环，连接你的 Codex 任务。</p></div></div>
          <dl><div><dt>应用版本</dt><dd>{APP_VERSION}</dd></div><div><dt>运行平台</dt><dd>Windows</dd></div></dl>
        </section>
        <UpdateSection onUpdateAvailable={onUpdateAvailable} />
        <BandAppUpdateSection />
      </div>}
    </div>
  </div>;
}
