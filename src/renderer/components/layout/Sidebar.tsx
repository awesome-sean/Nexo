import React from 'react';
import { LayoutDashboard, Watch, Settings2, Activity, Palette, PanelsTopLeft } from 'lucide-react';
import { APP_NAME } from '../../../common/app-info';
import appIcon from '../../../../assets/desktop-mark.svg';

export type PulsePage = 'overview' | 'floating' | 'band' | 'watchface' | 'settings' | 'diagnostics';

export interface SidebarProps {
  currentPage: PulsePage;
  onNavigate: (page: PulsePage) => void;
}

const MENU_ITEMS = [
  { id: 'overview' as const, label: '额度概览', icon: LayoutDashboard },
  { id: 'floating' as const, label: '桌面悬浮窗', icon: PanelsTopLeft },
  { id: 'band' as const, label: '我的手环', icon: Watch },
  { id: 'watchface' as const, label: '快应用管理', icon: Palette },
];
const TOOLS = [
  { id: 'settings' as const, label: '偏好设置', icon: Settings2 },
  { id: 'diagnostics' as const, label: '运行诊断', icon: Activity },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate }) => {
  return (
    <aside className="nexo-sidebar shrink-0 flex flex-col select-none">
      <div className="nexo-brand">
        <img className="nexo-mark" src={appIcon} alt="" aria-hidden="true" />
        <span className="nexo-brand-name">{APP_NAME}</span>
      </div>
      <div className="nexo-sidebar-body flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {[{ title: '工作台', items: MENU_ITEMS }, { title: '应用', items: TOOLS }].map((group) => (
          <div key={group.title} className="mb-8">
            <p className="nexo-nav-label">{group.title}</p>
            <nav className="nexo-nav" aria-label={group.title}>
              {group.items.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" className="nexo-nav-button"
                  aria-current={currentPage === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </div>
        ))}
      </div>
    </aside>
  );
};
