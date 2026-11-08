import { app, BrowserWindow } from 'electron';

const STARTUP_ITEM_NAME = 'Nexo';

export function getAutoLaunch(): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  // Electron 44.2 parses this lookup as a command line, so quote paths with spaces.
  const state = app.getLoginItemSettings({ path: `"${process.execPath}"`, args: [] });
  // openAtLogin reads the default AppUserModelID entry, not our named Nexo entry.
  return state.launchItems.some(item => item.name === STARTUP_ITEM_NAME && item.scope === 'user' && item.args.length === 0 && item.enabled);
}

export function setAutoLaunch(enabled: boolean): boolean {
  if (typeof enabled !== 'boolean') throw new Error('开机自启动设置无效');
  if (process.platform !== 'win32' || !app.isPackaged) throw new Error('请在安装后的 Windows 版 Nexo 中设置开机自启动');
  app.setLoginItemSettings({ openAtLogin: enabled, enabled, path: process.execPath, args: [], name: STARTUP_ITEM_NAME });
  const actual = getAutoLaunch();
  if (actual !== enabled) throw new Error('开机自启动设置未生效，请检查 Windows 启动应用设置');
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('nexo:auto-launch-changed', actual);
  }
  return actual;
}
