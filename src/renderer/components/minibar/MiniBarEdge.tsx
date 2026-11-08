import type { DockSide } from '../../../main/services/minibar-geometry';
import { EDGE_ARTWORK } from './edge-artwork';
import type { MiniBarSettings } from '../../../common/minibar-settings';
import { MINIBAR_PALETTES } from './minibar-palette';

export function MiniBarEdge({ side, opacity, appearance = 'dark' }: { side: DockSide; opacity: number; appearance?: MiniBarSettings['appearance'] }) {
  const horizontal = side === 'top' || side === 'bottom';
  const [body, arrow] = EDGE_ARTWORK[side];
  const alignment = { top: 'xMidYMin', bottom: 'xMidYMax', left: 'xMinYMid', right: 'xMaxYMid' }[side];
  return <svg className="nexo-traffic-edge-art" viewBox={horizontal ? '0 0 131.3334 33.3335' : '0 0 33.3334 131.3334'} preserveAspectRatio={`${alignment} meet`} fill="none" aria-hidden="true">
    <path d={body} fill={MINIBAR_PALETTES[appearance].body} fillOpacity={opacity} />
    <path d={arrow} stroke={MINIBAR_PALETTES[appearance].lettering} strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
