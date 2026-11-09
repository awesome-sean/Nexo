import { app, BrowserWindow, ipcMain, Tray, screen, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { AgentKind, SessionDetectionMode } from '../common/types';
import { SessionManager } from './services/session-manager';
import { CodexSessionTailer } from './services/codex-tailer';
import { CodexHookInstaller, codexHookDirectory } from './services/codex-hook-install';
import { CodexTrafficService } from './services/codex-traffic-store';
import { registerBandKeyExtract } from './services/band-key-extract';
import { StatusServer } from './services/status-server';
import { PulseCoreClient } from './services/pulse-core-client';
import { PulseCoreBridge } from './services/pulse-core-bridge';
import { createTray } from './tray';
import { getAutoLaunch, setAutoLaunch, isAutoStartLaunch, migrateAutoLaunchEntry } from './services/auto-launch';
import { openCodexWindow } from './services/open-codex';
import { DesktopUpdateService } from './services/update-service';
import { launchUpdate } from './services/launch-update';
import { UPDATE_RELEASES_URL } from '../common/update-source';
import { createMiniBarWindow, disposeMiniBar, toggleMiniBar, isMiniBarVisible, publishMiniBarState } from './minibar-window';
import { AppInstallService, registerAppInstallIpc } from './services/app-install-service';
import { CoreAppInstallBridge } from './services/core-app-install-bridge';
import { WatchfaceService, registerWatchfaceIpc } from './services/watchface-service';
import { WatchfacePreviewStore, WATCHFACE_PREVIEW_DIR_NAME } from './services/watchface-preview-store';
import {
  WatchfacePreviewService,
  registerWatchfacePreviewIpc,
} from './services/watchface-preview-service';
import { deviceConfigService, type PairedBandDevice } from './services/device-config-service';
import { AstroBoxImportService } from './services/astrobox-import';
import { getCoreLocalAppData } from './services/pulse-core-client';
import { BandSettingsStore } from './services/band-settings-store';

// Ensure single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let showMainOnReady = !isAutoStartLaunch();

app.on('second-instance', (_event, commandLine) => {
  if (isAutoStartLaunch(commandLine)) return;
  showMainOnReady = true;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
// 托盘常驻：窗口在真正退出前不许被销毁，否则托盘回调会打在已销毁对象上
let isQuitting = false;

const sessionManager = new SessionManager();
const codexTailer = new CodexSessionTailer(sessionManager);
const traffic = new CodexTrafficService();
const bandSettings = new BandSettingsStore(path.join(app.getPath('userData'), 'band-settings.json'));
const statusServer = new StatusServer(sessionManager,18765,traffic,()=>bandSettings.get());
const hookInstaller = new CodexHookInstaller(path.resolve(import.meta.dirname,'../../assets/nexo-cli.cjs'),codexHookDirectory(),process.execPath);
const resolveSessionDetection = (): Partial<Record<AgentKind, SessionDetectionMode>> => ({codex:codexTailer.isEventDriven ? 'event' : 'polling'});
sessionManager.on('update', sessions => traffic.trackSessions(sessions));
statusServer.start();

// 有效手环配置在启动后自动恢复连接，首次导入仍由设置向导完成。
const coreClient = new PulseCoreClient();
const astroBoxImport = new AstroBoxImportService(path.join(getCoreLocalAppData(), 'astrobox-identity.json'), deviceConfigService);
const coreBridge = new PulseCoreBridge(coreClient,()=>bandSettings.get());
traffic.on('update', snapshot => { publishMiniBarState(); coreBridge.pushTraffic(snapshot); });
traffic.on('quit',()=>quitPulse());
const coreAppInstallBridge = new CoreAppInstallBridge(coreClient);
const appInstallService = new AppInstallService(coreAppInstallBridge);
// 用户自己关联的表盘预览图缓存：只落本机 userData，不进仓库、不上传、不碰协议
const watchfacePreviewService = new WatchfacePreviewService(
  new WatchfacePreviewStore(path.join(app.getPath('userData'), WATCHFACE_PREVIEW_DIR_NAME)),
);
const watchfaceService = new WatchfaceService(coreClient, watchfacePreviewService);
coreClient.on('daemon-spawned', (pid) => console.log('[NexoBridge] daemon 已拉起 pid=' + pid));
coreClient.on('degraded', (info) =>
  console.warn('[NexoBridge] protocolVersion 不匹配，进入降级（继续用旧链路）:', JSON.stringify(info))
);
coreClient.on('connected', () => console.log('[NexoBridge] RPC 已连接'));
coreClient.on('disconnected', () => console.warn('[NexoBridge] RPC 断开，等待重连'));

// 初始屏（截图/调试用）：PULSE_SCREEN=diagnostics 时直接打开次屏
const INITIAL_SCREEN =
  process.env.PULSE_SCREEN === 'diagnostics' ||
  process.env.PULSE_SCREEN === 'settings' ||
  process.env.PULSE_SCREEN === 'watchface'
    ? process.env.PULSE_SCREEN
    : 'main';

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const cjsPreload = path.join(import.meta.dirname, '../preload/index.cjs');
  const jsPreload = path.join(import.meta.dirname, '../preload/index.js');
  const mjsPreload = path.join(import.meta.dirname, '../preload/index.mjs');
  const preloadPath = fs.existsSync(cjsPreload)
    ? cjsPreload
    : fs.existsSync(jsPreload)
    ? jsPreload
    : mjsPreload;

  // 阶段 4：从「透明悬浮胶囊」改为 900×620 标准窗口（自绘标题栏，深色不透明）
  win = new BrowserWindow({
    width: Math.min(1120, workArea.width),
    height: Math.min(760, workArea.height),
    minWidth: Math.min(860, workArea.width),
    minHeight: Math.min(620, workArea.height),
    center: true,
    frame: false,
    icon: path.resolve(import.meta.dirname, '../../assets/icon.png'),
    // 必须和 index.css 的 --bg-canvas 浅色值保持一致（#F4F6FB），避免冷启动先刷一帧旧深色残留
    backgroundColor: '#F4F6FB',
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 关闭 = 隐藏到托盘。Alt+F4 和任何原生关闭都走这里，只有真正退出才放行。
  // 不拦的话窗口会被销毁而进程仍在（window-all-closed 是空的），
  // 之后点托盘就是 "Object has been destroyed"。
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win?.hide();
    }
  });

  win.once('ready-to-show', () => {
    if (!win || !showMainOnReady) return;
    win.show();
    win.focus();
    console.log('[Nexo] Window ready-to-show fired, visible at', win.getBounds());
    if (process.env.PULSE_SCREEN) {
      // 供界面调试截图（等 React 首帧完成再抓）；正式版不写 app.asar。
      setTimeout(async () => {
        try {
          if (!win) return;
          const image = await win.capturePage();
          const savePath = path.resolve(import.meta.dirname, `../../debug-window-${INITIAL_SCREEN}.png`);
          fs.writeFileSync(savePath, image.toPNG());
          console.log('[Nexo] Saved window screenshot to', savePath, 'size:', image.getSize());
        } catch (err) {
          console.error('[Nexo] Screenshot capture error:', err);
        }
      }, 1200);
    }
  });

  win.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    console.error(`[Renderer] Load failed: ${errorCode} - ${errorDescription}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}?screen=${INITIAL_SCREEN}`);
  } else {
    win.loadFile(path.join(import.meta.dirname, '../../dist/index.html'), {
      query: { screen: INITIAL_SCREEN },
    });
  }

  // Relay session updates to renderer
  sessionManager.on('update', (sessions) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('sessions-update', sessions);
    }
  });

  coreBridge.attach(win);
  appInstallService.attach(win);

  tray = createTray(
    win,
    quitPulse,
    toggleMiniBar,
    isMiniBarVisible
  );
}

// IPC Handlers
ipcMain.on('clear-sessions', () => {
  sessionManager.clearAll();
});

ipcMain.handle('get-initial-sessions', () => {
  return sessionManager.getAllSessions();
});

ipcMain.handle('pulse:get-app-version', () => app.getVersion());
ipcMain.handle('nexo:get-auto-launch', () => getAutoLaunch());
ipcMain.handle('nexo:set-auto-launch', (_, enabled: boolean) => setAutoLaunch(enabled));
ipcMain.handle('nexo:get-band-settings', () => bandSettings.get());
ipcMain.handle('nexo:set-band-vibration', (_event, enabled: unknown) => {
  const settings = bandSettings.setVibration(enabled);
  coreBridge.pushBandSettings();
  return settings;
});
ipcMain.handle('nexo:open-codex', async () => {
  const result = await openCodexWindow();
  if (!result.ok) void dialog.showMessageBox({ type: 'warning', title: '打开 Codex', message: result.error });
  return result;
});
ipcMain.handle('nexo:get-exchange-rate', () => statusServer.getExchangeRate());
ipcMain.handle('nexo:set-exchange-rate', (_event, rate: unknown) => statusServer.setExchangeRate(rate));
const desktopUpdate = new DesktopUpdateService(app.getVersion(), path.join(app.getPath('userData'), 'updates'));
ipcMain.handle('pulse:check-update', async () => {
  try {
    const info = await desktopUpdate.check();
    return { ok: true, ...info, installer: undefined, canDownload: !!info.installer, downloadedVersion: desktopUpdate.downloadedVersion, downloading: desktopUpdate.downloading };
  } catch (error) { return { ok: false, currentVersion: app.getVersion(), error: String(error instanceof Error ? error.message : error) }; }
});
ipcMain.handle('pulse:download-update', async () => {
  try {
    const version = await desktopUpdate.download(progress => win?.webContents.send('pulse:update-progress', { ...progress, status: progress.stage || 'downloading' }));
    win?.webContents.send('pulse:update-progress', { status: 'downloaded', version });
    return { ok: true, version };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    win?.webContents.send('pulse:update-progress', { status: 'error', error: message });
    return { ok: false, error: message };
  }
});
let startingUpdate = false;
ipcMain.handle('pulse:install-update', async () => {
  if (startingUpdate) return { ok: true };
  try {
    if (!app.isPackaged || process.platform !== 'win32') throw new Error('请在已安装的 Windows 版 Nexo 中使用覆盖更新');
    if (appInstallService.hasActiveInstallation()) throw new Error('请等待手环应用安装完成后再更新 Nexo');
    startingUpdate = true;
    await launchUpdate(desktopUpdate.verifiedInstaller(), () => {
      startingUpdate = false;
      if (win && !win.isDestroyed()) win.webContents.send('pulse:update-progress', { status: 'installer-closed' });
    });
    return { ok: true };
  } catch (error) {
    startingUpdate = false;
    return { ok: false, error: String(error instanceof Error ? error.message : error), retryDownload: !desktopUpdate.downloadedVersion };
  }
});
ipcMain.handle('pulse:open-update-download', async () => {
  try {
    const info = await desktopUpdate.check();
    if (!info.installer) throw new Error('发布页暂时没有可下载的安装包');
    await shell.openExternal(info.installer.url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
});
ipcMain.handle('pulse:open-release', async (_event, url: unknown) => {
  if (typeof url !== 'string' || (url !== UPDATE_RELEASES_URL && !url.startsWith(`${UPDATE_RELEASES_URL}/tag/`))) return { ok: false, error: '更新页面地址无效' };
  try { await shell.openExternal(url); return { ok: true }; }
  catch (error) { return { ok: false, error: String(error) }; }
});

// 自绘标题栏的窗口控制（window-close = 隐藏到托盘，阶段 2 约定）
ipcMain.on('window-close', () => {
  if (win) win.hide();
});

ipcMain.on('window-minimize', () => {
  win?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

app.whenReady().then(async () => {
  try { migrateAutoLaunchEntry(); }
  catch (error) { console.warn('[Nexo] 开机启动参数迁移失败', error); }
  createWindow();
  createMiniBarWindow(sessionManager, statusServer, resolveSessionDetection);
  ipcMain.handle('hook:status',()=>hookInstaller.status());
  ipcMain.handle('hook:install',()=>({ok:true,...hookInstaller.install()}));
  ipcMain.handle('hook:uninstall',()=>({ok:true,...hookInstaller.remove()}));
  registerBandKeyExtract(ipcMain);
  registerAppInstallIpc(appInstallService, ipcMain, () => win);
  ipcMain.handle('nexo:apps:list', () => coreClient.call('device.app.list', {}, 30_000));
  ipcMain.handle('nexo:apps:remove', (_event, packageName: unknown) => {
    if (typeof packageName !== 'string' || !/^[a-zA-Z0-9_.-]{1,255}$/.test(packageName)) throw new Error('无效应用包名');
    return coreClient.call('device.app.remove', { package: packageName }, 90_000);
  });
  registerWatchfaceIpc(watchfaceService, ipcMain);
  registerWatchfacePreviewIpc(watchfacePreviewService, ipcMain);
  watchfacePreviewService.startBackgroundPreparation([
    path.resolve(import.meta.dirname, '../../watch-face'),
  ]);

  // 设备配置与已配对手环管理 IPC
  ipcMain.handle('pulse:device-config:status', () => {
    return deviceConfigService.getDeviceConfigStatus();
  });
  // rawMac 只在主进程内部用（saveDeviceConfig 从 scannedDevices 缓存里取），
  // 跨进程一律剥掉，渲染层拿到的只有脱敏地址。
  const toRendererDevice = ({ id, name, maskedMac, isXiaomiBand }: PairedBandDevice) => ({
    id,
    name,
    maskedMac,
    isXiaomiBand,
  });
  ipcMain.handle('pulse:device-config:paired-devices', async () => {
    return (await deviceConfigService.getPairedBandDevices()).map(toRendererDevice);
  });
  ipcMain.handle('pulse:device-config:scan-devices', async () => {
    return (await deviceConfigService.scanBandDevices()).map(toRendererDevice);
  });
  ipcMain.handle('pulse:device-config:save', async (_e, payload) => {
    return deviceConfigService.saveDeviceConfig(payload);
  });
  ipcMain.handle('nexo:astrobox:list', () => astroBoxImport.listDevices());
  ipcMain.handle('nexo:astrobox:import', (_e, id: unknown) => astroBoxImport.importDevice(id));
  ipcMain.handle('nexo:setup:help', async (_e, topic: string) => {
    const links: Record<string, string> = {
      download: 'https://astrobox.online/downloads/',
      connection: 'https://abox.run/docs/usage/connection',
      logs: 'https://wiki.bandbbs.cn/Guides/oronbox/oronbox-install.html#如何迁移',
    };
    if (!Object.hasOwn(links, topic)) return { ok: false };
    await shell.openExternal(links[topic]);
    return { ok: true };
  });

  // Start background monitoring services
  traffic.start();
  codexTailer.start();
  traffic.trackSessions(sessionManager.getAllSessions());
});

/**
 * 彻底退出：视觉反馈要快——窗口和托盘图标立刻消失；
 * 礼让序列（断开手环归还给手机 → 停 daemon）放后台走完，
 * 总预算 5s，到点强制退出。手环断开最坏 3s（等真蓝牙断链），
 * daemon 是按设计常驻的，停不掉就留给下次启动复用，不拿它卡用户。
 * 托盘「彻底退出」和「安装更新」共用。
 */
function quitPulse(): void {
  isQuitting = true;
  coreBridge.detach();
  win?.hide();
  const budget = setTimeout(() => {
    runAppCleanup();
    app.exit(0);
  }, 5_000);
  coreClient
    .stopDaemonIfRunning()
    .catch(() => {})
    .finally(() => {
      clearTimeout(budget);
      runAppCleanup();
      app.exit(0);
    });
}

app.on('window-all-closed', () => {
  // Keep app running in tray
});

// 退出清理（幂等）：托盘「彻底退出」的预算强制路径走 app.exit（不触发
// before-quit），所以两边的收尾都汇到这里，谁先到谁执行。
let appCleanupDone = false;
function runAppCleanup(): void {
  if (appCleanupDone) return;
  appCleanupDone = true;
  disposeMiniBar();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  codexTailer.stop();
  traffic.stop();
  statusServer.stop();
  sessionManager.dispose();
  coreBridge.detach();
  coreClient.dispose();
}

app.on('before-quit', () => {
  isQuitting = true;
  runAppCleanup();
});
