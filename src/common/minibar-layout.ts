export const CAPSULE_GUTTER = 16;
export const CAPSULE_THICKNESS = 80;
export const DETAIL_WIDTH = 300;
export const DETAIL_HEIGHT = 88;
export const DETAIL_GAP = 8;
export const MINIBAR_MENU_WIDTH = DETAIL_WIDTH;
export const MINIBAR_MENU_VERTICAL_HEIGHT = 660;
export const MINIBAR_MENU_HORIZONTAL_HEIGHT = 780;

// Distance is measured from the visible capsule, in Windows logical pixels.
export function getMiniBarEdgeInset(edgeGap: number, renderScale: number): number {
  return edgeGap - Math.round(CAPSULE_GUTTER * renderScale);
}

// Keep the supplied 132-unit SVG proportions at an 80 DIP capsule width.
export function getTrafficCapsuleLength(showStatusText: boolean): number {
  return (showStatusText ? 537 : 485) * CAPSULE_THICKNESS / 132;
}

export const EDGE_TAB_THICKNESS = 34;
export const EDGE_TAB_LENGTH = 132;
