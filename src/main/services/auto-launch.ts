import { app, BrowserWindow } from 'electron';

const STARTUP_ITEM_NAME = 'Nexo';
export const AUTO_START_ARGUMENT = '--autostart';

export function isAutoStartLaunch(args: readonly string[] = process.argv): boolean {
  return args.includes(AUTO_START_ARGUMENT);
}

function startupEntry() {
  // Electron 44.2 parses this lookup as a command line, so quote paths with spaces.
  const state = app.getLoginItemSettings({ path: `"${process.execPath}"`, args: [AUTO_START_ARGUMENT] });
  return state.launchItems.find(item => item.name === STARTUP_ITEM_NAME && item.scope === 'user'
    && (item.args.length === 0 || (item.args.length === 1 && item.args[0] === AUTO_START_ARGUMENT)));
}

export function getAutoLaunch(): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  // openAtLogin reads the default AppUserModelID entry, not our named Nexo entry.
  return startupEntry()?.enabled === true;
}

export function migrateAutoLaunchEntry(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const entry = startupEntry();
  if (!entry || entry.args.length !== 0) return;
  app.setLoginItemSettings({ openAtLogin: true, enabled: entry.enabled, path: process.execPath, args: [AUTO_START_ARGUMENT], name: STARTUP_ITEM_NAME });
}

export function setAutoLaunch(enabled: boolean): boolean {
  if (typeof enabled !== 'boolean') throw new Error('开机自启动设置无效');
  if (process.platform !== 'win32' || !app.isPackaged) throw new Error('请在安装后的 Windows 版 Nexo 中设置开机自启动');
  app.setLoginItemSettings({ openAtLogin: enabled, enabled, path: process.execPath, args: [AUTO_START_ARGUMENT], name: STARTUP_ITEM_NAME });
  const actual = getAutoLaunch();
  if (actual !== enabled) throw new Error('开机自启动设置未生效，请检查 Windows 启动应用设置');
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('nexo:auto-launch-changed', actual);
  }
  return actual;
}
