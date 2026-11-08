import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { SessionManager } from './services/session-manager';
import type { StatusServer } from './services/status-server';
import type { MinibarState, SessionDetectionMode, AgentKind } from '../common/types';
import { resolveMiniBarSettings, getMiniBarRenderScale, type MiniBarSettings } from '../common/minibar-settings';
import {
  resolveMiniBarVisibility,
  resolveMiniBarDockPreference,
  type MiniBarDockPreference,
} from './services/minibar-preference';
import {
  COLLAPSED_WIDTH,
  COLLAPSED_HEIGHT,
  EXPANDED_WIDTH,
  EXPANDED_HEIGHT,
  EDGE_TAB_WIDTH,
  EDGE_TAB_HEIGHT,
  calculateCollapsedBounds,
  calculateWindowBoundsForState,
  calculateEdgeTabBounds,
  restoreAnchorFromEdgeTab,
  clampBoundsToWorkArea,
  resolveDockTarget,
  isHorizontalDock,
  calculateStartupPosition,
  getMiniBarCollapsedSize,
  configureMiniBarGeometry,
  type WorkAreaRect,
} from './services/minibar-geometry';
import type { DockSide } from './services/minibar-geometry';
import { MINIBAR_MENU_VERTICAL_HEIGHT, MINIBAR_MENU_HORIZONTAL_HEIGHT } from '../common/minibar-layout';

export {
  COLLAPSED_WIDTH,
  COLLAPSED_HEIGHT,
  EXPANDED_WIDTH,
  EXPANDED_HEIGHT,
  EDGE_TAB_WIDTH,
  EDGE_TAB_HEIGHT,
  calculateCollapsedBounds,
  calculateWindowBoundsForState,
  calculateEdgeTabBounds,
  restoreAnchorFromEdgeTab,
  calculateStartupPosition,
};

let minibarWin: BrowserWindow | null = null;
let isExpanded = false;
let expandedSurface: 'details' | 'menu' = 'details';
let currentDockSide: DockSide = 'right';
let currentDisplayMode: import('../common/types').MinibarDisplayMode = 'full';
let minibarSettings = resolveMiniBarSettings();
let edgePeekActive = false;
let dockAnchor: { x: number; y: number } | null = null;
let updateTimer: NodeJS.Timeout | null = null;
let sessionManagerRef: SessionManager | null = null;
/** Codex 会话检测方式判定器，由入口注入 */
let detectionProvider: (() => Partial<Record<AgentKind, SessionDetectionMode>>) | null = null;
let statusServerRef: StatusServer | null = null;
// 手动拖拽跟随（替代原生 -webkit-app-region: drag）状态
let dragFollowTimer: NodeJS.Timeout | null = null;
let dragGrabOffset = { dx: 0, dy: 0 };

export function getBoundsFile(): string {
  return path.join(app.getPath('userData'), 'minibar-bounds.json');
}

export function getPreferenceFile(): string {
  return path.join(app.getPath('userData'), 'minibar-preferences.json');
}

interface MiniBarPreferences extends Partial<MiniBarSettings> {
  manualApiSources?: string;
  visible?: boolean;
  dockPreference?: MiniBarDockPreference;
}

function loadPreferences(): MiniBarPreferences {
  try {
    const p = getPreferenceFile();
    if (fs.existsSync(p)) {
      const value = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }
  } catch {
    // ignore
  }
  return {};
}

function savePreferences(patch: Partial<MiniBarPreferences>): void {
  const current = loadPreferences();
  const next: MiniBarPreferences = { ...current, ...patch };
  const filename = getPreferenceFile();
  const temporary = filename + '.tmp';
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(temporary, filename);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function loadVisibility(): boolean {
  return resolveMiniBarVisibility(loadPreferences().visible);
}

function saveVisibility(visible: boolean): void {
  try { savePreferences({ visible }); } catch { /* Runtime visibility remains available. */ }
}

export function loadDockPreference(): MiniBarDockPreference {
  return resolveMiniBarDockPreference(loadPreferences().dockPreference);
}

export function saveDockPreference(dockPreference: MiniBarDockPreference): void {
  savePreferences({ dockPreference });
}

function loadSavedBounds(): {
  x?: number;
  y?: number;
  dockSide?: DockSide;
  displayMode?: import('../common/types').MinibarDisplayMode;
} {
  try {
    const p = getBoundsFile();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        return data;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

function saveBounds() {
  if (!minibarWin || minibarWin.isDestroyed()) return;
  if (edgePeekActive) return;
  try {
    const b = minibarWin.getBounds();
    const anchor = dockAnchor ?? (currentDisplayMode === 'edge-tab'
      ? restoreAnchorFromEdgeTab(b, currentDockSide, getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount()).height, getViewportAgentCount())
      : calculateCollapsedBounds(b, isExpanded, currentDockSide, getViewportAgentCount()));
    fs.writeFileSync(
      getBoundsFile(),
      JSON.stringify({
        x: anchor.x,
        y: anchor.y,
        dockSide: currentDockSide,
        displayMode: currentDisplayMode,
      })
    );
  } catch {
    // ignore
  }
}

function getViewportAgentCount(side: DockSide = currentDockSide, count = minibarSettings.visibleAgents.length, workArea?: WorkAreaRect): number {
  try {
    const bounds = minibarWin?.getBounds();
    const area = workArea ?? (bounds ? screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea : screen.getPrimaryDisplay().workArea);
    const capacity = isHorizontalDock(side) ? Math.floor((area.width / getMiniBarRenderScale(minibarSettings.capsuleScale) - 72) / 100) : Math.floor((area.height / getMiniBarRenderScale(minibarSettings.capsuleScale) - 60) / 72);
    return Math.min(count, Math.max(1, capacity));
  } catch { return count; }
}

function getDockOffset(): { x: number; y: number } {
  if (!dockAnchor || !minibarWin || minibarWin.isDestroyed()) return { x: 0, y: 0 };
  const bounds = minibarWin.getBounds();
  return { x: dockAnchor.x - bounds.x, y: dockAnchor.y - bounds.y };
}

function getMiniBarWindowBounds(anchor: { x: number; y: number }, expanded: boolean) {
  const bounds = calculateWindowBoundsForState(anchor, expanded, currentDockSide, getViewportAgentCount());
  if (!expanded || expandedSurface !== 'menu') return bounds;
  const scale = getMiniBarRenderScale(minibarSettings.capsuleScale);
  const area = screen.getDisplayNearestPoint(anchor).workArea;
  bounds.height = Math.min(area.height, Math.ceil((isHorizontalDock(currentDockSide) ? MINIBAR_MENU_HORIZONTAL_HEIGHT : MINIBAR_MENU_VERTICAL_HEIGHT) * scale));
  if (currentDockSide === 'bottom') bounds.y = anchor.y + getMiniBarCollapsedSize(currentDockSide, 1).height - bounds.height;
  return bounds;
}

function notifySettings(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('minibar:settings-changed', minibarSettings);
  }
}

export function updateMiniBarSettings(patch: Partial<MiniBarSettings>): MiniBarSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('悬浮窗配置无效');
  const next = resolveMiniBarSettings({ ...minibarSettings, ...patch });
  const oldSize = getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount());
  const modeChanged = next.displayMode !== minibarSettings.displayMode;
  const closePeek = edgePeekActive && (!next.hoverReveal || modeChanged);
  const scaleChanged = next.capsuleScale !== minibarSettings.capsuleScale;
  const gapChanged = next.edgeGap !== minibarSettings.edgeGap;
  savePreferences({ ...next, manualApiSources: undefined });
  minibarSettings = next;
  configureMiniBarGeometry(getMiniBarRenderScale(next.capsuleScale), next.showStatusText, next.edgeGap);
  const newSize = getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount());
  const sizeChanged = scaleChanged || oldSize.width !== newSize.width || oldSize.height !== newSize.height;
  minibarWin?.webContents.setZoomFactor(getMiniBarRenderScale(next.capsuleScale));
  if (closePeek) edgePeekActive = false;
  if (minibarWin && !minibarWin.isDestroyed() && (sizeChanged || modeChanged || closePeek || gapChanged)) {
    const anchor = dockAnchor ?? { x: minibarWin.getBounds().x, y: minibarWin.getBounds().y };
    dockAnchor = {
      x: anchor.x + (oldSize.width - newSize.width) / 2,
      y: anchor.y + (oldSize.height - newSize.height) / 2,
    };
    currentDisplayMode = edgePeekActive ? 'full' : next.displayMode;
    if (currentDisplayMode === 'edge-tab') isExpanded = false;
    dockAnchor = clampToVisibleArea(dockAnchor.x, dockAnchor.y, newSize.width, newSize.height, false, 'full');
    const bounds = currentDisplayMode === 'edge-tab'
      ? calculateEdgeTabBounds(dockAnchor, currentDockSide, newSize.height, getViewportAgentCount(currentDockSide, next.visibleAgents.length))
      : getMiniBarWindowBounds(dockAnchor, isExpanded);
    const position = clampToVisibleArea(bounds.x, bounds.y, bounds.width, bounds.height, isExpanded);
    applyMiniBarBounds({ ...bounds, ...position });
    saveBounds();
  }
  notifySettings();
  pushState();
  return next;
}

function setEdgePeek(active: boolean): void {
  if (dragFollowTimer) return;
  if (active && minibarSettings.hoverReveal && currentDisplayMode === 'edge-tab') {
    edgePeekActive = true;
    setDisplayMode('full', true);
  } else if (!active && edgePeekActive) {
    edgePeekActive = false;
    setDisplayMode('edge-tab', true);
  }
}

function openMiniBarSettings(): void {
  const window = BrowserWindow.getAllWindows().find((candidate) => candidate !== minibarWin && !candidate.isDestroyed());
  window?.show();
  window?.focus();
  window?.webContents.send('nexo:open-minibar-settings');
}

/**
 * 把窗口位置夹回可见工作区。
 * 跨屏或拔屏时检测是否在任一显示器中；若脱落则夹回主显示器。
 */
export function clampToVisibleArea(
  x: number,
  y: number,
  w: number,
  h: number,
  expanded: boolean = false,
  displayMode = currentDisplayMode,
): { x: number; y: number } {
  try {
    const displays = screen.getAllDisplays();
    const currentDisplay =
      displays.find((d) => {
        const a = d.workArea;
        return x + w > a.x && x < a.x + a.width && y + h > a.y && y < a.y + a.height;
      }) || screen.getPrimaryDisplay();

    if (displayMode === 'edge-tab') {
      const area = currentDisplay.workArea;
      return {
        x: currentDockSide === 'left' ? area.x : currentDockSide === 'right' ? area.x + area.width - w : Math.max(area.x, Math.min(x, area.x + area.width - w)),
        y: currentDockSide === 'top' ? area.y : currentDockSide === 'bottom' ? area.y + area.height - h : Math.max(area.y, Math.min(y, area.y + area.height - h)),
      };
    }
    return clampBoundsToWorkArea(x, y, w, h, currentDisplay.workArea, expanded, currentDockSide, getViewportAgentCount());
  } catch {
    return { x, y };
  }
}

/** Windows can enlarge tiny native windows. Re-anchor using the accepted size. */
function applyMiniBarBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  if (!minibarWin || minibarWin.isDestroyed()) return;
  minibarWin.setBounds(bounds);
  if (currentDisplayMode !== 'edge-tab') return;
  const actual = minibarWin.getBounds();
  const position = clampToVisibleArea(actual.x, actual.y, actual.width, actual.height, false, 'edge-tab');
  minibarWin.setPosition(position.x, position.y);
}

/**
 * 拖拽结束判定：根据松手时鼠标最近的四条屏幕边缘吸附。
 * 左右边缘使用竖向侧栏，上下边缘切换为横向胶囊条。
 */
function handleDragSettle(): void {
  if (!minibarWin || minibarWin.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(cursor);
  const workArea = targetDisplay.workArea;
  const side = resolveDockTarget(cursor, workArea, undefined, undefined, 1).dockSide;
  const count = getViewportAgentCount(side, minibarSettings.visibleAgents.length, workArea);
  const dock = resolveDockTarget(cursor, workArea, undefined, undefined, count);

  currentDockSide = dock.dockSide;
  dockAnchor = { x: dock.x, y: dock.y };
  isExpanded = false;
  const size = getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount());
  const bounds = currentDisplayMode === 'edge-tab'
    ? calculateEdgeTabBounds(dockAnchor, currentDockSide, size.height, getViewportAgentCount())
    : {
    x: dock.x,
    y: dock.y,
    width: size.width,
    height: size.height,
  };
  applyMiniBarBounds(bounds);
  saveBounds();
  pushState();
}

function startDragFollow(): void {
  if (!minibarWin || minibarWin.isDestroyed()) return;
  if (dragFollowTimer) return;

  const cursor = screen.getCursorScreenPoint();
  const bounds = minibarWin.getBounds();
  const dragSize = currentDisplayMode === 'edge-tab'
    ? { width: bounds.width, height: bounds.height }
    : getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount());
  dragGrabOffset = {
    dx: cursor.x - bounds.x,
    dy: cursor.y - bounds.y,
  };

  dragFollowTimer = setInterval(() => {
    if (!minibarWin || minibarWin.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    minibarWin.setBounds({
      x: Math.round(point.x - dragGrabOffset.dx),
      y: Math.round(point.y - dragGrabOffset.dy),
      width: dragSize.width,
      height: dragSize.height,
    });
  }, 16);
}

function stopDragFollowAndSettle(): void {
  if (dragFollowTimer) {
    clearInterval(dragFollowTimer);
    dragFollowTimer = null;
  }
  if (!minibarWin || minibarWin.isDestroyed()) return;
  handleDragSettle();
}

/**
 * 设置悬浮窗显示形态：完整侧栏模式 vs 边缘小型胶囊标签模式。
 * 切换时保持纵向居中与所属屏幕边缘吸附，零跳动。
 */
export function setDisplayMode(mode: import('../common/types').MinibarDisplayMode, temporary = false): void {
  if (!minibarWin || minibarWin.isDestroyed()) return;
  if (mode !== 'full' && mode !== 'edge-tab') return;
  if (!temporary) {
    savePreferences({ displayMode: mode });
    minibarSettings = { ...minibarSettings, displayMode: mode };
    edgePeekActive = false;
    notifySettings();
  }
  if (currentDisplayMode === mode) { pushState(); return; }

  const currentBounds = minibarWin.getBounds();
  if (mode === 'edge-tab') {
    const anchor = dockAnchor ?? calculateCollapsedBounds(currentBounds, isExpanded, currentDockSide, getViewportAgentCount());
    dockAnchor = anchor;
    isExpanded = false;
    const size = getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount());
    const tabBounds = calculateEdgeTabBounds(anchor, currentDockSide, size.height, getViewportAgentCount());
    currentDisplayMode = 'edge-tab';
    applyMiniBarBounds(tabBounds);
    saveBounds();
    pushState();
  } else {
    const size = getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount());
    const anchor = dockAnchor ?? restoreAnchorFromEdgeTab(currentBounds, currentDockSide, size.height, getViewportAgentCount());
    const fixed = clampToVisibleArea(
      anchor.x,
      anchor.y,
      size.width,
      size.height,
      false,
      'full',
    );
    currentDisplayMode = 'full';
    isExpanded = false;
    dockAnchor = fixed;
    minibarWin.setBounds({
      x: fixed.x,
      y: fixed.y,
      width: size.width,
      height: size.height,
    });
    saveBounds();
    pushState();
  }
}

/** 显示前确保窗口在当前可见区域内（运行期拔插显示器也自适应）。 */
function ensureOnScreen(): void {
  if (!minibarWin || minibarWin.isDestroyed()) return;
  const b = minibarWin.getBounds();
  const fixed = clampToVisibleArea(b.x, b.y, b.width, b.height, isExpanded);
  if (fixed.x !== b.x || fixed.y !== b.y) {
    if (dockAnchor) {
      dockAnchor.x += fixed.x - b.x;
      dockAnchor.y += fixed.y - b.y;
    }
    minibarWin.setPosition(fixed.x, fixed.y);
    saveBounds();
  }
}

function pushState() {
  if (!minibarWin || minibarWin.isDestroyed() || !sessionManagerRef || !statusServerRef) return;
  const state: MinibarState = {
    sessions: sessionManagerRef.getAllSessions(),
    quotas: statusServerRef.getQuotas(),
    traffic: statusServerRef.getTrafficLight(),
    isExpanded,
    dockSide: currentDockSide,
    displayMode: currentDisplayMode,
    edgePeekActive,
    minibarSettings,
    dockOffset: { x: getDockOffset().x / getMiniBarRenderScale(minibarSettings.capsuleScale), y: getDockOffset().y / getMiniBarRenderScale(minibarSettings.capsuleScale) },
    dockViewportCount: getViewportAgentCount(),
    sessionDetection: detectionProvider ? detectionProvider() : undefined,
  };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('minibar-state', state);
  }
}

// 会话状态推送节流：hook 事件常在几百毫秒内连发数条（提交/工具前后/结束），
// 1s 心跳 tick 也走同一个 update 事件。120ms 节流压平突发 IPC，
// 延迟上限 120ms，远小于任何轮询周期，不拖慢状态呈现。
const SESSION_PUSH_THROTTLE_MS = 120;
let sessionPushTimer: NodeJS.Timeout | null = null;
let lastSessionPushAt = 0;

function pushSessionStateThrottled(): void {
  const elapsed = Date.now() - lastSessionPushAt;
  if (elapsed >= SESSION_PUSH_THROTTLE_MS) {
    lastSessionPushAt = Date.now();
    pushState();
    return;
  }
  if (sessionPushTimer) return;
  sessionPushTimer = setTimeout(() => {
    sessionPushTimer = null;
    lastSessionPushAt = Date.now();
    pushState();
  }, SESSION_PUSH_THROTTLE_MS - elapsed);
}

function notifyVisibility() {
  const visible = isMiniBarVisible();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w !== minibarWin) {
      w.webContents.send('minibar:visibility-changed', visible);
    }
  }
}

export function isMiniBarVisible(): boolean {
  return !!(minibarWin && !minibarWin.isDestroyed() && minibarWin.isVisible());
}

export function toggleMiniBar(): void {
  if (!minibarWin || minibarWin.isDestroyed()) return;
  if (minibarWin.isVisible()) {
    minibarWin.hide();
    saveVisibility(false);
  } else {
    ensureOnScreen();
    minibarWin.show();
    saveVisibility(true);
    pushState();
  }
  notifyVisibility();
}

/**
 * 设置悬浮窗展开/收起状态。
 * 支持右吸附向左展开与左吸附向右展开，屏幕吸附边缘绝对不动。
 */
export function setWindowExpanded(expand: boolean, surface: 'details' | 'menu' = 'details'): void {
  if (!minibarWin || minibarWin.isDestroyed()) return;
  if (isExpanded === expand && (!expand || expandedSurface === surface)) return;
  if (currentDisplayMode === 'edge-tab') return; // 边缘标签态下不直接展开卡片
  if (dragFollowTimer && expand) return;

  const currentBounds = minibarWin.getBounds();
  const anchor = dockAnchor ?? calculateCollapsedBounds(currentBounds, isExpanded, currentDockSide, getViewportAgentCount());
  dockAnchor = anchor;
  isExpanded = expand;
  expandedSurface = surface;
  const newBounds = getMiniBarWindowBounds(anchor, isExpanded);

  const position = clampToVisibleArea(newBounds.x, newBounds.y, newBounds.width, newBounds.height, isExpanded);
  minibarWin.setBounds({ ...newBounds, ...position });
  pushState();
}

/**
 * 重置 MiniBar 悬浮窗至主显示器右侧停靠位置（默认位置）。
 */
export function resetMiniBarDock(): void {
  if (!minibarWin || minibarWin.isDestroyed()) return;

  try {
    const primary = screen.getPrimaryDisplay();
    currentDockSide = 'right';
    currentDisplayMode = 'full';
    isExpanded = false;

    const width = COLLAPSED_WIDTH;
    const height = getMiniBarCollapsedSize('right', getViewportAgentCount()).height;
    dockAnchor = clampBoundsToWorkArea(primary.workArea.x, Math.round(primary.workArea.y + Math.max(24, (primary.workArea.height - height) / 2)), width, height, primary.workArea, false, 'right', 1);
    minibarWin.setBounds({ ...dockAnchor, width, height });
    saveBounds();
    pushState();
  } catch {
    // ignore
  }
}

export function createMiniBarWindow(
  sessionManager: SessionManager,
  statusServer: StatusServer,
  detection?: () => Partial<Record<AgentKind, SessionDetectionMode>>
): BrowserWindow {
  sessionManagerRef = sessionManager;
  statusServerRef = statusServer;
  detectionProvider = detection ?? null;

  const cjsPreload = path.join(import.meta.dirname, '../preload/index.cjs');
  const jsPreload = path.join(import.meta.dirname, '../preload/index.js');
  const mjsPreload = path.join(import.meta.dirname, '../preload/index.mjs');
  const preloadPath = fs.existsSync(cjsPreload)
    ? cjsPreload
    : fs.existsSync(jsPreload)
    ? jsPreload
    : mjsPreload;

  const saved = loadSavedBounds();
  const savedPreferences = loadPreferences();
  minibarSettings = resolveMiniBarSettings({ ...savedPreferences, displayMode: savedPreferences.displayMode ?? saved.displayMode });
  savePreferences({...minibarSettings,manualApiSources:undefined});
  const dockPref = loadDockPreference();

  configureMiniBarGeometry(getMiniBarRenderScale(minibarSettings.capsuleScale), minibarSettings.showStatusText, minibarSettings.edgeGap);
  currentDisplayMode = minibarSettings.displayMode;
  edgePeekActive = false;

  let primaryWorkArea: WorkAreaRect = { x: 0, y: 0, width: 1920, height: 1080 };
  let allWorkAreas: WorkAreaRect[] = [primaryWorkArea];
  try {
    primaryWorkArea = screen.getPrimaryDisplay().workArea;
    allWorkAreas = screen.getAllDisplays().map((d) => d.workArea);
  } catch {
    // 单元测试或无原生显示环境兜底
  }

  const startup = calculateStartupPosition({
    preference: dockPref,
    saved,
    primaryWorkArea,
    allWorkAreas,
    displayMode: currentDisplayMode,
    agentCount: getViewportAgentCount('right'),
  });

  currentDockSide = startup.dockSide;
  const initW = startup.width;
  const initH = startup.height;
  const defaultX = startup.x;
  const defaultY = startup.y;
  const size = getMiniBarCollapsedSize(startup.dockSide, getViewportAgentCount());
  dockAnchor = currentDisplayMode === 'edge-tab'
    ? restoreAnchorFromEdgeTab(startup, startup.dockSide, size.height, getViewportAgentCount())
    : { x: startup.x, y: startup.y };

  minibarWin = new BrowserWindow({
    width: initW,
    height: initH,
    x: defaultX,
    y: defaultY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // 彻底消除 Windows DWM 透明窗口外围矩形投影框
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'nexo-minibar',
      zoomFactor: getMiniBarRenderScale(minibarSettings.capsuleScale),
    },
  });

  applyMiniBarBounds({ x: defaultX, y: defaultY, width: initW, height: initH });

  minibarWin.on('close', (e) => {
    e.preventDefault();
    minibarWin?.hide();
    notifyVisibility();
  });

  // Navigation can replace a pre-load zoom with the origin's stored value.
  minibarWin.webContents.on('did-finish-load', () => {
    if (!minibarWin || minibarWin.isDestroyed()) return;
    minibarWin.webContents.setZoomFactor(getMiniBarRenderScale(minibarSettings.capsuleScale));
    const size = getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount());
    const anchor = dockAnchor ?? { x: defaultX, y: defaultY };
    const bounds = currentDisplayMode === 'edge-tab'
      ? calculateEdgeTabBounds(anchor, currentDockSide, size.height, getViewportAgentCount())
      : getMiniBarWindowBounds(anchor, isExpanded);
    const position = clampToVisibleArea(bounds.x, bounds.y, bounds.width, bounds.height, isExpanded);
    applyMiniBarBounds({ ...bounds, ...position });
    pushState();
  });
  minibarWin.on('blur', () => {
    if (minibarWin && !minibarWin.isDestroyed()) {
      minibarWin.webContents.send('minibar:window-blur');
    }
  });

  minibarWin.on('show', () => notifyVisibility());
  minibarWin.on('hide', () => notifyVisibility());

  minibarWin.once('ready-to-show', () => {
    pushState();
    if (loadVisibility()) minibarWin?.show();
    notifyVisibility();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    minibarWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}?screen=minibar`);
  } else {
    minibarWin.loadFile(path.join(import.meta.dirname, '../../dist/index.html'), {
      query: { screen: 'minibar' },
    });
  }

  // 监听会话变更与心跳轮询
  sessionManager.on('update', pushSessionStateThrottled);
  if (!updateTimer) {
    updateTimer = setInterval(pushState, 3000);
  }

  // 注册独立 IPC 事件（幂等单次绑定）
  ipcMain.removeHandler('minibar:get-state');
    ipcMain.handle('minibar:get-state', () => {
      return {
        sessions: sessionManager.getAllSessions(),
        quotas: statusServer.getQuotas(),
        traffic: statusServer.getTrafficLight(),
        isExpanded,
        dockSide: currentDockSide,
        displayMode: currentDisplayMode,
        minibarSettings,
        edgePeekActive,
        dockOffset: {
          x: getDockOffset().x / getMiniBarRenderScale(minibarSettings.capsuleScale),
          y: getDockOffset().y / getMiniBarRenderScale(minibarSettings.capsuleScale),
        },
        dockViewportCount: getViewportAgentCount(),
        sessionDetection: detectionProvider ? detectionProvider() : undefined,
      };
    });

  ipcMain.removeAllListeners('minibar:set-display-mode');
  ipcMain.on('minibar:set-display-mode', (_, mode: import('../common/types').MinibarDisplayMode) => {
    setDisplayMode(mode);
  });

  ipcMain.removeAllListeners('minibar:edge-peek');
  ipcMain.on('minibar:edge-peek', (_, active: boolean) => setEdgePeek(active === true));

  ipcMain.removeHandler('minibar:get-settings');
  ipcMain.handle('minibar:get-settings', (_, legacyOpacity?: number) => {
    if (loadPreferences().backgroundOpacity === undefined && typeof legacyOpacity === 'number' && Number.isFinite(legacyOpacity) && legacyOpacity >= 0 && legacyOpacity <= 1) {
      updateMiniBarSettings({ backgroundOpacity: legacyOpacity });
    }
    return minibarSettings;
  });
  ipcMain.removeHandler('minibar:set-settings');
  ipcMain.handle('minibar:set-settings', (_, patch: Partial<MiniBarSettings>) => updateMiniBarSettings(patch));
  ipcMain.removeHandler('minibar:open-settings');
  ipcMain.handle('minibar:open-settings', openMiniBarSettings);

  ipcMain.removeAllListeners('minibar:set-expanded');
  ipcMain.on('minibar:set-expanded', (_, expand: boolean, surface: unknown) => {
    setWindowExpanded(!!expand, surface === 'menu' ? 'menu' : 'details');
  });

  ipcMain.removeAllListeners('minibar:drag-start');
  ipcMain.on('minibar:drag-start', () => {
    if (!minibarWin || minibarWin.isDestroyed()) return;
    if (isExpanded) {
      isExpanded = false;
      const currentBounds = minibarWin.getBounds();
      const anchor = dockAnchor ?? calculateCollapsedBounds(currentBounds, true, currentDockSide, getViewportAgentCount());
      const size = getMiniBarCollapsedSize(currentDockSide, getViewportAgentCount());
      minibarWin.setBounds({
        x: anchor.x,
        y: anchor.y,
        width: size.width,
        height: size.height,
      });
      pushState();
    }
    // 手动拖拽：窗口跟随鼠标连续移动，松手由 drag-end 吸附
    startDragFollow();
  });

  ipcMain.removeAllListeners('minibar:drag-end');
  ipcMain.on('minibar:drag-end', () => {
    stopDragFollowAndSettle();
  });

  ipcMain.removeAllListeners('minibar:toggle-expanded');
  ipcMain.on('minibar:toggle-expanded', () => {
    setWindowExpanded(!isExpanded);
  });

  ipcMain.removeAllListeners('minibar:menu-open');
  ipcMain.on('minibar:menu-open', () => {
    if (!minibarWin || minibarWin.isDestroyed()) return;
    // 仅在显式右键打开菜单时给予窗口前台焦点，确保点击外部产生原生 blur 自动关闭菜单
    minibarWin.focus();

    if (currentDisplayMode === 'edge-tab') {
      const isHorizontal = isHorizontalDock(currentDockSide);
      const menu = Menu.buildFromTemplate([
        {
          label: isHorizontal ? '恢复完整胶囊条' : '恢复完整侧栏',
          click: () => {
            setDisplayMode('full');
          },
        },
        {
          label: '背景透明度',
          submenu: [0, 25, 50, 75, 100].map((transparency) => ({
            label: `${transparency}%`, type: 'radio' as const,
            checked: Math.round((1 - minibarSettings.backgroundOpacity) * 100) === transparency,
            click: () => { updateMiniBarSettings({ backgroundOpacity: 1 - transparency / 100 }); },
          })),
        },
        {
          label: '边缘标签悬停展开', type: 'checkbox', checked: minibarSettings.hoverReveal,
          click: () => { updateMiniBarSettings({ hoverReveal: !minibarSettings.hoverReveal }); },
        },
        { label: '显示任务文字', type: 'checkbox', checked: minibarSettings.showStatusText,
          click: () => { updateMiniBarSettings({ showStatusText: !minibarSettings.showStatusText }); } },
        { label: '完整胶囊边缘距离', submenu: [0, 8, 12, 16, 24, 32, 64].map(edgeGap => ({
          label: edgeGap === 0 ? '紧贴边缘' : `${edgeGap}px`, type: 'radio' as const,
          checked: minibarSettings.edgeGap === edgeGap,
          click: () => { updateMiniBarSettings({ edgeGap }); },
        })) },
        { label: '打开个性化设置', click: openMiniBarSettings },
        { type: 'separator' },
        {
          label: '完全隐藏悬浮窗',
          click: () => {
            minibarWin?.hide();
            saveVisibility(false);
            notifyVisibility();
          },
        },
      ]);
      menu.popup({ window: minibarWin });
    }
  });

  ipcMain.removeAllListeners('minibar:close');
  ipcMain.on('minibar:close', () => {
    minibarWin?.hide();
    saveVisibility(false);
    notifyVisibility();
  });

  ipcMain.removeHandler('minibar:toggle');
  ipcMain.handle('minibar:toggle', () => {
    toggleMiniBar();
    return isMiniBarVisible();
  });

  ipcMain.removeHandler('minibar:is-visible');
  ipcMain.handle('minibar:is-visible', () => {
    return isMiniBarVisible();
  });

  ipcMain.removeHandler('minibar:set-visible');
  ipcMain.handle('minibar:set-visible', (_, show: boolean) => {
    if (!minibarWin || minibarWin.isDestroyed()) return false;
    if (show) {
      ensureOnScreen();
      minibarWin.show();
      pushState();
    } else {
      minibarWin.hide();
    }
    saveVisibility(show);
    notifyVisibility();
    return isMiniBarVisible();
  });

  ipcMain.removeHandler('minibar:reset-dock');
  ipcMain.handle('minibar:reset-dock', () => {
    resetMiniBarDock();
    return true;
  });

  ipcMain.removeHandler('minibar:get-dock-preference');
  ipcMain.handle('minibar:get-dock-preference', () => {
    return loadDockPreference();
  });

  ipcMain.removeHandler('minibar:set-dock-preference');
  ipcMain.handle('minibar:set-dock-preference', (_, pref: unknown) => {
    const valid = resolveMiniBarDockPreference(pref);
    updateMiniBarSettings({ dockPreference: valid });
    return valid;
  });

  return minibarWin;
}

export function disposeMiniBar(): void {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  if (sessionPushTimer) {
    clearTimeout(sessionPushTimer);
    sessionPushTimer = null;
  }
  if (dragFollowTimer) {
    clearInterval(dragFollowTimer);
    dragFollowTimer = null;
  }
  if (minibarWin && !minibarWin.isDestroyed()) {
    minibarWin.destroy();
    minibarWin = null;
  }
}

export function publishMiniBarState():void { pushState(); }
