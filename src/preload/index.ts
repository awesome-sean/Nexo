import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { userFacingError } from '../common/user-facing-error';
async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) { throw new Error(userFacingError(error)); }
}

import type { AgentSession } from '../common/types';
import type { MiniBarSettings } from '../common/minibar-settings';

// 旧悬浮岛残留 API（仅剩会话推送通道；hook/notifier 功能已删除）
contextBridge.exposeInMainWorld('codeisland', {
  onSessionsUpdate: (callback: (sessions: AgentSession[]) => void) => {
    const subscription = (_: any, sessions: AgentSession[]) => callback(sessions);
    ipcRenderer.on('sessions-update', subscription);
    return () => ipcRenderer.removeListener('sessions-update', subscription);
  },
  getInitialSessions: () => invoke('get-initial-sessions'),
  clearSessions: () => {
    ipcRenderer.send('clear-sessions');
  },
  closeWindow: () => ipcRenderer.send('window-close'),
  // 迷你悬浮窗（PC 实时监控条）
  onMinibarState: (callback: (state: unknown) => void) => {
    const subscription = (_: any, state: unknown) => callback(state);
    ipcRenderer.on('minibar-state', subscription);
    return () => ipcRenderer.removeListener('minibar-state', subscription);
  },
  getMinibarState: () => invoke('minibar:get-state'),
  toggleMinibarExpanded: () => ipcRenderer.send('minibar:toggle-expanded'),
  setMinibarExpanded: (expanded: boolean, surface: 'details' | 'menu' = 'details') => ipcRenderer.send('minibar:set-expanded', expanded, surface),
  setMinibarDisplayMode: (mode: 'full' | 'edge-tab') => ipcRenderer.send('minibar:set-display-mode', mode),
  setMinibarEdgePeek: (active: boolean) => ipcRenderer.send('minibar:edge-peek', active),
  notifyDragStart: () => ipcRenderer.send('minibar:drag-start'),
  notifyDragEnd: () => ipcRenderer.send('minibar:drag-end'),
  notifyMenuOpen: () => ipcRenderer.send('minibar:menu-open'),
  onWindowBlur: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('minibar:window-blur', subscription);
    return () => ipcRenderer.removeListener('minibar:window-blur', subscription);
  },
  closeMinibar: () => ipcRenderer.send('minibar:close'),
  resetMiniBarDock: () => invoke('minibar:reset-dock'),
});

// Nexo 新界面 API（阶段 4）。Nexo 设备服务 状态由主进程消毒后推送，authkey 永不出主进程。
contextBridge.exposeInMainWorld('pulse', {
  getMiniBarSettings: (legacyOpacity?: number) => invoke('minibar:get-settings', legacyOpacity),
  setMiniBarSettings: (patch: Partial<MiniBarSettings>) => invoke('minibar:set-settings', patch),
  onMiniBarSettingsChanged: (callback: (settings: MiniBarSettings) => void) => {
    const subscription = (_: unknown, settings: MiniBarSettings) => callback(settings);
    ipcRenderer.on('minibar:settings-changed', subscription);
    return () => ipcRenderer.removeListener('minibar:settings-changed', subscription);
  },
  openMiniBarSettings: () => invoke('minibar:open-settings'),
  onOpenMiniBarSettings: (callback: () => void) => {
    ipcRenderer.on('nexo:open-minibar-settings', callback);
    return () => ipcRenderer.removeListener('nexo:open-minibar-settings', callback);
  },
  getAppVersion: () => invoke('pulse:get-app-version'),
  openCodexWindow: () => invoke('nexo:open-codex'),
  getAutoLaunch: () => invoke('nexo:get-auto-launch'),
  setAutoLaunch: (enabled: boolean) => invoke('nexo:set-auto-launch', enabled),
  onAutoLaunchChange: (callback: (enabled: boolean) => void) => {
    const subscription = (_: unknown, enabled: boolean) => callback(enabled);
    ipcRenderer.on('nexo:auto-launch-changed', subscription);
    return () => ipcRenderer.removeListener('nexo:auto-launch-changed', subscription);
  },
  getExchangeRate: () => invoke('nexo:get-exchange-rate'),
  setExchangeRate: (rate: number) => invoke('nexo:set-exchange-rate', rate),
  getBandSettings: () => invoke('nexo:get-band-settings'),
  setBandVibration: (enabled: boolean) => invoke('nexo:set-band-vibration', enabled),
  checkUpdate: () => invoke('pulse:check-update'),
  openRelease: (url: string) => invoke('pulse:open-release', url),
  downloadUpdate: () => invoke('pulse:download-update'),
  installUpdate: () => invoke('pulse:install-update'),
  onUpdateProgress: (callback: (p: { received?: number; total?: number; status?: 'downloading' | 'downloaded' | 'error'; version?: string; error?: string }) => void) => {
    const subscription = (_: unknown, p: Parameters<typeof callback>[0]) => callback(p);
    ipcRenderer.on('pulse:update-progress', subscription);
    return () => ipcRenderer.removeListener('pulse:update-progress', subscription);
  },
  getCoreState: () => invoke('pulse:core:get-state'),
  onCoreState: (callback: (state: unknown) => void) => {
    const subscription = (_: any, state: unknown) => callback(state);
    ipcRenderer.on('pulse:core:state', subscription);
    return () => ipcRenderer.removeListener('pulse:core:state', subscription);
  },
  connectBand: () => invoke('pulse:band:connect'),
  disconnectBand: () => invoke('pulse:band:disconnect'),
  getDiagnostics: () => invoke('pulse:get-diagnostics'),
  runDiagnostics: () => invoke('pulse:run-diagnostics'),
  getErrorLog: () => invoke('pulse:get-error-log'),
  clearErrorLog: () => invoke('pulse:clear-error-log'),
  formatErrorLog: () => invoke('pulse:format-error-log'),
  formatDiagnosticReport: (report: unknown) => invoke('pulse:format-diagnostic-report', report),
  onErrorLog: (callback: (entries: unknown[]) => void) => {
    const subscription = (_: any, entries: unknown[]) => callback(entries);
    ipcRenderer.on('pulse-error-log', subscription);
    return () => ipcRenderer.removeListener('pulse-error-log', subscription);
  },
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  // 桌面迷你悬浮窗（MiniBar）开关与状态
  toggleMiniBar: () => invoke('minibar:toggle'),
  isMiniBarVisible: () => invoke('minibar:is-visible'),
  setMiniBarVisible: (show: boolean) => invoke('minibar:set-visible', show),
  onMiniBarVisibilityChange: (callback: (visible: boolean) => void) => {
    const subscription = (_: any, visible: boolean) => callback(visible);
    ipcRenderer.on('minibar:visibility-changed', subscription);
    return () => ipcRenderer.removeListener('minibar:visibility-changed', subscription);
  },
  // MiniBar 启动停靠偏好（主进程 minibar-preference 持久化，非法值主进程归一为 remember）
  getMiniBarDockPreference: () => invoke('minibar:get-dock-preference'),
  setMiniBarDockPreference: (pref: 'remember' | 'left' | 'right' | 'top' | 'bottom') =>
    invoke('minibar:set-dock-preference', pref),
  // 拖入 Mi Fitness / 小米健康研究的日志，解析出 authkey
  extractBandKey: (filePath: string) => invoke('band:extract-key', { path: filePath }),
  // 设备配置与已配对手环管理
  getDeviceConfigStatus: () => invoke('pulse:device-config:status'),
  getPairedBandDevices: () => invoke('pulse:device-config:paired-devices'),
  scanBandDevices: () => invoke('pulse:device-config:scan-devices'),
  saveDeviceConfig: (payload: any) => invoke('pulse:device-config:save', payload),
  listAstroBoxDevices: () => invoke('nexo:astrobox:list'),
  importAstroBoxDevice: (id: string) => invoke('nexo:astrobox:import', id),
  openSetupHelp: (topic: 'download' | 'connection' | 'logs') => invoke('nexo:setup:help', topic),
  // Codex Hooks 一键安装（合并 ~/.codex/hooks.json）
  getHookStatus: () => invoke('hook:status'),
  installHook: () => invoke('hook:install'),
  uninstallHook: () => invoke('hook:uninstall'),
  // Electron ≥32 移除了 File.path，拖拽文件的本地绝对路径只能在 preload 用 webUtils 取
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // device.app.install 真实 IPC 桥接（阶段契约闭环）
  appInstall: {
    prepare: (req: any) => invoke('pulse:app-install:prepare', req),
    prepareFile: (filePath: string) =>
      invoke('pulse:app-install:prepare-file', { filePath }),
    sendChunk: (req: any) => invoke('pulse:app-install:chunk', req),
    sendChunks: (installId?: string) =>
      invoke('pulse:app-install:send-chunks', { installId }),
    commit: (req: any) => invoke('pulse:app-install:commit', req),
    cancel: (req: any) => invoke('pulse:app-install:cancel', req),
    cancelTransfer: (installId: string) =>
      invoke('pulse:app-install:cancel-transfer', { installId }),
    // 内置手环端快应用：一键安装（无需用户选择文件）
    getBundledInfo: () => invoke('pulse:app-install:bundled-info'),
    installBundled: () => invoke('pulse:app-install:install-bundled'),
    onProgress: (callback: (event: any) => void) => {
      const subscription = (_: any, ev: any) => callback(ev);
      ipcRenderer.on('pulse:app-install-progress', subscription);
      return () => ipcRenderer.removeListener('pulse:app-install-progress', subscription);
    },
  },
  // 表盘管理（device.watchface.*，已真机验证的本地表盘列表 / 切换 / 安装）
  quickApps: { list: () => invoke('nexo:apps:list'), remove: (packageName: string) => invoke('nexo:apps:remove', packageName) },
  watchface: {
    list: () => invoke('pulse:watchface:list'),
    set: (id: string) => invoke('pulse:watchface:set', { id }),
    install: (filePath: string) => invoke('pulse:watchface:install', { filePath }),
    // 本地预览图缓存（用户自己关联的图片，只存在本机 userData）
    preview: {
      list: () => invoke('pulse:watchface:preview:list'),
      set: (id: string, filePath: string) =>
        invoke('pulse:watchface:preview:set', { id, filePath }),
      clear: (id: string) => invoke('pulse:watchface:preview:clear', { id }),
    },
  },
});
