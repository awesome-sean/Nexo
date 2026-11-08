import { Minus, Moon, Settings2, Square, Sun, X } from 'lucide-react';
import { APP_NAME } from '../../../common/app-info';
import appIcon from '../../../../assets/desktop-mark.svg';

export interface TopBarProps {
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  onNavigate: (page: 'settings') => void;
  settingsActive?: boolean;
  updateAvailable?: boolean;
}

export function TopBar({ theme, onThemeChange, onNavigate, settingsActive, updateAvailable }: TopBarProps) {
  return <header className="workspace-titlebar titlebar-drag">
    <div className="workspace-brand">
      <img src={appIcon} className="nexo-mark" alt="" aria-hidden="true" />
      <span className="nexo-brand-name">{APP_NAME}</span>
    </div>
    <div className="workspace-header-actions no-drag">
      <button type="button" className="workspace-icon-button"
        aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
        title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
        onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}>
        {theme === 'light' ? <Sun size={20} strokeWidth={1.6} /> : <Moon size={20} strokeWidth={1.6} />}
      </button>
      <button type="button" className="workspace-icon-button workspace-settings-button" aria-label={updateAvailable ? '打开设置，有新版本' : '打开设置'} data-active={settingsActive} title={updateAvailable ? '设置 · 有新版本' : '设置'}
        onClick={() => onNavigate('settings')}><Settings2 size={20} strokeWidth={1.6} />{updateAvailable && <span className="nexo-update-dot" aria-hidden="true" />}</button>
      <div className="workspace-window-controls">
        <button type="button" className="nexo-window-button" aria-label="最小化" title="最小化" onClick={() => window.pulse?.minimizeWindow()}><Minus size={16} /></button>
        <button type="button" className="nexo-window-button" aria-label="最大化" title="最大化" onClick={() => window.pulse?.maximizeWindow()}><Square size={14} /></button>
        <button type="button" className="nexo-window-button nexo-window-close" aria-label="关闭" title="关闭" onClick={() => window.pulse?.closeWindow()}><X size={18} /></button>
      </div>
    </div>
  </header>;
}
