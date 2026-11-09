import { Tray, Menu, nativeImage, BrowserWindow, dialog, type MenuItemConstructorOptions } from 'electron';
import { getAutoLaunch, setAutoLaunch } from './services/auto-launch';
import path from 'node:path';
import fs from 'node:fs';

export function createTray(
  mainWindow: BrowserWindow | null,
  onFullExit: () => void,
  onToggleMiniBar?: () => void,
  isMiniBarVisible?: () => boolean,
  getMainWindow = () => mainWindow,
  showMainWindow = () => { mainWindow?.show(); mainWindow?.focus(); }
): Tray {
  const iconPath = path.resolve(import.meta.dirname, '../../assets/icon.png');
  let icon = nativeImage.createEmpty();

  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }

  const tray = new Tray(icon);
  tray.setToolTip('Nexo');

  // 退出过程中窗口先于托盘销毁，这时托盘回调仍可能触发
  const alive = () => { const window = getMainWindow(); return !!window && !window.isDestroyed(); };

  const buildMenu = () => {
    const isVisible = alive() && getMainWindow()!.isVisible();
    const miniBarVisible = isMiniBarVisible ? isMiniBarVisible() : false;

    const items: MenuItemConstructorOptions[] = [
      {
        label: '显示主界面',
        type: 'checkbox',
        checked: isVisible,
        click: () => {
          if (alive() && getMainWindow()!.isVisible()) {
            getMainWindow()!.hide();
          } else {
            showMainWindow();
          }
        },
      },
      ...(onToggleMiniBar ? [
        {
          label: '显示桌面悬浮窗',
          type: 'checkbox' as const,
          checked: miniBarVisible,
          click: () => {
            onToggleMiniBar();
          },
        }
      ] : []),
      {
        label: '开机自启动',
        type: 'checkbox',
        checked: getAutoLaunch(),
        click: item => {
          try { item.checked = setAutoLaunch(item.checked); }
          catch (error) {
            item.checked = getAutoLaunch();
            dialog.showErrorBox('开机自启动设置失败', error instanceof Error ? error.message : String(error));
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出 Nexo',
        click: onFullExit,
      },
    ];
    return Menu.buildFromTemplate(items);
  };

  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));

  tray.on('click', () => {
    if (alive() && getMainWindow()!.isVisible()) {
      getMainWindow()!.hide();
    } else {
      showMainWindow();
    }
  });

  return tray;
}
