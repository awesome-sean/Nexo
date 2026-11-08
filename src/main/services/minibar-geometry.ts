/**
 * 悬浮窗几何与尺寸计算纯函数。
 * 纯粹数学与几何逻辑，完全不依赖 Electron 原生对象，确保可单元测试与跨环境复用。
 */

import { CAPSULE_GUTTER, CAPSULE_THICKNESS, EDGE_TAB_LENGTH, EDGE_TAB_THICKNESS, getTrafficCapsuleLength, getMiniBarEdgeInset } from '../../common/minibar-layout.ts';
import { resolveInitialDockSide, type MiniBarDockPreference } from './minibar-preference.ts';

let geometryScale = 1;
let geometryStatusText = true;
let geometryEdgeInset = 0;
export let COLLAPSED_WIDTH = 112;
export let COLLAPSED_HEIGHT = Math.ceil(getTrafficCapsuleLength(true) + 32);
export let EXPANDED_WIDTH = 456;
export let EXPANDED_HEIGHT = 420;
export let H_COLLAPSED_WIDTH = COLLAPSED_HEIGHT;
export let H_COLLAPSED_HEIGHT = 112;
export let H_EXPANDED_WIDTH = 456;
export let H_EXPANDED_HEIGHT = 480;
export let EDGE_TAB_WIDTH = Math.ceil(EDGE_TAB_THICKNESS);
export let EDGE_TAB_HEIGHT = EDGE_TAB_LENGTH;
export let H_EDGE_TAB_WIDTH = EDGE_TAB_LENGTH;
export let H_EDGE_TAB_HEIGHT = Math.ceil(EDGE_TAB_THICKNESS);

/** Physical DIP bounds and renderer geometry share the same SVG proportions. */
export function configureMiniBarGeometry(scale: number, showStatusText = true, edgeGap = Math.round(CAPSULE_GUTTER * scale)): void {
  geometryScale = scale;
  geometryStatusText = showStatusText;
  geometryEdgeInset = getMiniBarEdgeInset(edgeGap, scale);
  COLLAPSED_WIDTH = Math.ceil((CAPSULE_THICKNESS + CAPSULE_GUTTER * 2) * scale);
  COLLAPSED_HEIGHT = Math.ceil((getTrafficCapsuleLength(showStatusText) + CAPSULE_GUTTER * 2) * scale);
  H_COLLAPSED_WIDTH = COLLAPSED_HEIGHT;
  H_COLLAPSED_HEIGHT = COLLAPSED_WIDTH;
  EXPANDED_WIDTH = Math.ceil(456 * scale);
  EXPANDED_HEIGHT = Math.ceil(420 * scale);
  H_EXPANDED_WIDTH = Math.ceil(456 * scale);
  H_EXPANDED_HEIGHT = Math.ceil(480 * scale);
  EDGE_TAB_WIDTH = Math.ceil(EDGE_TAB_THICKNESS * scale);
  EDGE_TAB_HEIGHT = Math.ceil(EDGE_TAB_LENGTH * scale);
  H_EDGE_TAB_WIDTH = EDGE_TAB_HEIGHT;
  H_EDGE_TAB_HEIGHT = EDGE_TAB_WIDTH;
}

export type DockSide = 'left' | 'right' | 'top' | 'bottom';

export interface DockTarget {
  dockSide: DockSide;
  x: number;
  y: number;
}

export function isHorizontalDock(dockSide: DockSide): boolean {
  return dockSide === 'top' || dockSide === 'bottom';
}

export function getMiniBarCollapsedSize(dockSide: DockSide, _agentCount = 1, showStatusText = geometryStatusText): { width: number; height: number } {
  const thickness = Math.ceil((CAPSULE_THICKNESS + CAPSULE_GUTTER * 2) * geometryScale);
  const length = Math.ceil((getTrafficCapsuleLength(showStatusText) + CAPSULE_GUTTER * 2) * geometryScale);
  return isHorizontalDock(dockSide) ? { width: length, height: thickness } : { width: thickness, height: length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 判定鼠标最近的四条屏幕边缘，并返回对应收起态窗口的坐标。
 * 左右吸附时 Y 跟随鼠标，上下吸附时 X 跟随鼠标。
 */
export function resolveDockTarget(
  cursorPoint: { x: number; y: number },
  workArea: { x: number; y: number; width: number; height: number },
  _currentX?: number,
  _currentY?: number,
  agentCount = 3,
): DockTarget {
  const rightEdge = workArea.x + workArea.width;
  const bottomEdge = workArea.y + workArea.height;
  const horizontalSize = getMiniBarCollapsedSize('top', agentCount);
  const verticalSize = getMiniBarCollapsedSize('right', agentCount);
  const distances = {
    left: Math.abs(cursorPoint.x - workArea.x),
    right: Math.abs(rightEdge - cursorPoint.x),
    top: Math.abs(cursorPoint.y - workArea.y),
    bottom: Math.abs(bottomEdge - cursorPoint.y),
  };
  const nearest = (Object.keys(distances) as DockSide[]).reduce((best, side) =>
    distances[side] < distances[best] ? side : best
  , 'right');

  if (nearest === 'top') {
    return {
      dockSide: 'top',
      x: Math.round(clamp(
        cursorPoint.x - horizontalSize.width / 2,
        workArea.x,
        rightEdge - horizontalSize.width,
      )),
      y: workArea.y + geometryEdgeInset,
    };
  }
  if (nearest === 'bottom') {
    return {
      dockSide: 'bottom',
      x: Math.round(clamp(
        cursorPoint.x - horizontalSize.width / 2,
        workArea.x,
        rightEdge - horizontalSize.width,
      )),
      y: bottomEdge - H_COLLAPSED_HEIGHT - geometryEdgeInset,
    };
  }
  if (nearest === 'left') {
    return {
      dockSide: 'left',
      x: workArea.x + geometryEdgeInset,
      y: Math.round(clamp(
        cursorPoint.y - verticalSize.height / 2,
        workArea.y,
        bottomEdge - verticalSize.height,
      )),
    };
  }
  return {
    dockSide: 'right',
    x: rightEdge - COLLAPSED_WIDTH - geometryEdgeInset,
    y: Math.round(clamp(
      cursorPoint.y - verticalSize.height / 2,
      workArea.y,
      bottomEdge - verticalSize.height,
    )),
  };
}

/**
 * 计算收起态稳定锚点。
 */
export function calculateCollapsedBounds(
  bounds: { x: number; y: number; width: number; height: number },
  expanded: boolean,
  dockSide: DockSide = 'right',
  agentCount = 3,
): { x: number; y: number } {
  if (!expanded) {
    return { x: bounds.x, y: bounds.y };
  }

  if (dockSide === 'left') {
    return { x: bounds.x, y: bounds.y };
  }
  if (dockSide === 'right') {
    return { x: bounds.x + bounds.width - COLLAPSED_WIDTH, y: bounds.y };
  }
  const x = bounds.x + (bounds.width - getMiniBarCollapsedSize(dockSide, agentCount).width) / 2;
  if (dockSide === 'top') return { x, y: bounds.y };
  return {
    x,
    y: bounds.y + bounds.height - H_COLLAPSED_HEIGHT,
  };
}

/**
 * 根据收起态锚点计算目标状态的物理 bounds。
 */
export function calculateWindowBoundsForState(
  anchor: { x: number; y: number },
  targetExpanded: boolean,
  dockSide: DockSide = 'right',
  agentCount = 3,
): { x: number; y: number; width: number; height: number } {
  const collapsedSize = getMiniBarCollapsedSize(dockSide, agentCount);
  if (isHorizontalDock(dockSide)) {
    if (!targetExpanded) {
      return {
        x: anchor.x,
        y: anchor.y,
        width: collapsedSize.width,
        height: H_COLLAPSED_HEIGHT,
      };
    }
    if (dockSide === 'top') {
      return {
        x: anchor.x + (collapsedSize.width - Math.max(H_EXPANDED_WIDTH, collapsedSize.width)) / 2,
        y: anchor.y,
        width: Math.max(H_EXPANDED_WIDTH, collapsedSize.width),
        height: H_EXPANDED_HEIGHT,
      };
    }
    return {
      x: anchor.x + (collapsedSize.width - Math.max(H_EXPANDED_WIDTH, collapsedSize.width)) / 2,
      y: anchor.y - (H_EXPANDED_HEIGHT - H_COLLAPSED_HEIGHT),
      width: Math.max(H_EXPANDED_WIDTH, collapsedSize.width),
      height: H_EXPANDED_HEIGHT,
    };
  }

  if (!targetExpanded) {
    return {
      x: anchor.x,
      y: anchor.y,
      width: COLLAPSED_WIDTH,
      height: collapsedSize.height,
    };
  }

  if (dockSide === 'left') {
    return {
      x: anchor.x,
      y: anchor.y,
      width: EXPANDED_WIDTH,
      height: Math.max(EXPANDED_HEIGHT, collapsedSize.height),
    };
  }

  const rightEdge = anchor.x + COLLAPSED_WIDTH;
  return {
    x: rightEdge - EXPANDED_WIDTH,
    y: anchor.y,
    width: EXPANDED_WIDTH,
    height: Math.max(EXPANDED_HEIGHT, collapsedSize.height),
  };
}

/**
 * 将窗口 bounds 夹回工作区，保持当前吸附边缘。
 */
export function clampBoundsToWorkArea(
  x: number,
  y: number,
  w: number,
  h: number,
  workArea: { x: number; y: number; width: number; height: number },
  expanded: boolean = false,
  dockSide: DockSide = 'right',
  agentCount = 3,
): { x: number; y: number } {
  const rightEdge = workArea.x + workArea.width;
  const bottomEdge = workArea.y + workArea.height;
  const horizontal = isHorizontalDock(dockSide);
  const collapsedSize = getMiniBarCollapsedSize(dockSide, agentCount);
  const width = w > 0 ? w : horizontal
    ? (expanded ? Math.max(H_EXPANDED_WIDTH, collapsedSize.width) : collapsedSize.width)
    : (expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH);
  const height = h > 0 ? h : horizontal
    ? (expanded ? H_EXPANDED_HEIGHT : H_COLLAPSED_HEIGHT)
    : (expanded ? Math.max(EXPANDED_HEIGHT, collapsedSize.height) : collapsedSize.height);

  let clampedX = clamp(x, workArea.x, rightEdge - width);
  let clampedY = clamp(y, workArea.y, bottomEdge - height);

  if (dockSide === 'left') clampedX = workArea.x + geometryEdgeInset;
  if (dockSide === 'right') clampedX = rightEdge - width - geometryEdgeInset;
  if (dockSide === 'top') clampedY = workArea.y + geometryEdgeInset;
  if (dockSide === 'bottom') clampedY = bottomEdge - height - geometryEdgeInset;

  return { x: clampedX, y: clampedY };
}

/**
 * 计算进入边缘标签态的 bounds。
 */
export function calculateEdgeTabBounds(
  anchor: { x: number; y: number },
  dockSide: DockSide = 'right',
  fullHeight: number = COLLAPSED_HEIGHT,
  agentCount = 3,
): { x: number; y: number; width: number; height: number } {
  if (dockSide === 'top') {
    return {
      x: anchor.x + Math.round((getMiniBarCollapsedSize(dockSide, agentCount).width - H_EDGE_TAB_WIDTH) / 2),
      y: anchor.y - geometryEdgeInset,
      width: H_EDGE_TAB_WIDTH,
      height: H_EDGE_TAB_HEIGHT,
    };
  }
  if (dockSide === 'bottom') {
    return {
      x: anchor.x + Math.round((getMiniBarCollapsedSize(dockSide, agentCount).width - H_EDGE_TAB_WIDTH) / 2),
      y: anchor.y + H_COLLAPSED_HEIGHT - H_EDGE_TAB_HEIGHT + geometryEdgeInset,
      width: H_EDGE_TAB_WIDTH,
      height: H_EDGE_TAB_HEIGHT,
    };
  }

  const centerY = anchor.y + Math.round((fullHeight - EDGE_TAB_HEIGHT) / 2);
  const x = dockSide === 'left'
    ? anchor.x - geometryEdgeInset
    : anchor.x + COLLAPSED_WIDTH - EDGE_TAB_WIDTH + geometryEdgeInset;
  return {
    x,
    y: centerY,
    width: EDGE_TAB_WIDTH,
    height: EDGE_TAB_HEIGHT,
  };
}

/**
 * 从边缘标签恢复为完整侧栏锚点。
 */
export function restoreAnchorFromEdgeTab(
  tabBounds: { x: number; y: number },
  dockSide: DockSide = 'right',
  fullHeight: number = COLLAPSED_HEIGHT,
  agentCount = 3,
): { x: number; y: number } {
  if (dockSide === 'top') {
    return {
      x: tabBounds.x - Math.round((getMiniBarCollapsedSize(dockSide, agentCount).width - H_EDGE_TAB_WIDTH) / 2),
      y: tabBounds.y + geometryEdgeInset,
    };
  }
  if (dockSide === 'bottom') {
    return {
      x: tabBounds.x - Math.round((getMiniBarCollapsedSize(dockSide, agentCount).width - H_EDGE_TAB_WIDTH) / 2),
      y: tabBounds.y + H_EDGE_TAB_HEIGHT - H_COLLAPSED_HEIGHT - geometryEdgeInset,
    };
  }

  const y = tabBounds.y - Math.round((fullHeight - EDGE_TAB_HEIGHT) / 2);
  const x = dockSide === 'left'
    ? tabBounds.x + geometryEdgeInset
    : tabBounds.x + EDGE_TAB_WIDTH - COLLAPSED_WIDTH - geometryEdgeInset;
  return { x, y };
}

export interface WorkAreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StartupPositionParams {
  agentCount?: number;
  preference: MiniBarDockPreference;
  saved?: {
    x?: number;
    y?: number;
    dockSide?: DockSide;
    displayMode?: 'full' | 'edge-tab';
  };
  primaryWorkArea: WorkAreaRect;
  allWorkAreas: WorkAreaRect[];
  displayMode?: 'full' | 'edge-tab';
}

export interface StartupPositionResult {
  x: number;
  y: number;
  width: number;
  height: number;
  dockSide: DockSide;
}

/** Fixed edges use the primary display. Remember restores the saved edge and along-edge position. */
export function calculateStartupPosition(params: StartupPositionParams): StartupPositionResult {
  const { preference, saved, primaryWorkArea, allWorkAreas } = params;
  const effectiveMode = params.displayMode ?? saved?.displayMode ?? 'full';
  const dockSide = resolveInitialDockSide(preference, saved?.dockSide);
  const size = getMiniBarCollapsedSize(dockSide, params.agentCount);

  // 1. 确定目标显示器工作区
  let targetWorkArea = primaryWorkArea;
  if (preference === 'remember' && saved?.x !== undefined && saved?.y !== undefined) {
    const matched = allWorkAreas.find((a) => (
      saved.x! + size.width > a.x &&
      saved.x! < a.x + a.width &&
      saved.y! + size.height > a.y &&
      saved.y! < a.y + a.height
    ));
    if (matched) {
      targetWorkArea = matched;
    }
  }

  const centerX = Math.round(targetWorkArea.x + (targetWorkArea.width - size.width) / 2);
  const centerY = Math.round(targetWorkArea.y + (targetWorkArea.height - size.height) / 2);
  const anchor = clampBoundsToWorkArea(saved?.x ?? centerX, saved?.y ?? centerY, size.width, size.height, targetWorkArea, false, dockSide, params.agentCount);

  // 4. 根据显示形态计算最终窗口尺寸与坐标
  if (effectiveMode === 'edge-tab') {
    const tabBounds = calculateEdgeTabBounds(anchor, dockSide, size.height, params.agentCount);
    return {
      x: tabBounds.x,
      y: tabBounds.y,
      width: tabBounds.width,
      height: tabBounds.height,
      dockSide,
    };
  }

  return {
    x: anchor.x,
    y: anchor.y,
    width: size.width,
    height: size.height,
    dockSide,
  };
}
