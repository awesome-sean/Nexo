import React, { useRef } from 'react';
import type { MinibarState } from '../../../common/types';
import type { CustomAgentSummary } from '../../../common/custom-agents';
import { getTrafficLightState, TRAFFIC_LABELS } from '../../../common/codex-traffic';
import { quotaUsageColor } from '../../../common/quota-colors';
import { CAPSULE_GUTTER, CAPSULE_THICKNESS, getTrafficCapsuleLength } from '../../../common/minibar-layout';
import { isHorizontalDock, type DockSide } from '../../../main/services/minibar-geometry';
import gptFloatingIcon from '../../assets/gpt-floating.png';
import gptFloatingLightIcon from '../../assets/gpt-floating-light.png';
import type { MiniBarSettings } from '../../../common/minibar-settings';
import { MINIBAR_PALETTES } from './minibar-palette';
import { toRemainingPercent } from '../pulse/agent-quota-utils';
import { TRAFFIC_LETTERING, TRAFFIC_HIGHLIGHTS, TRAFFIC_LIGHT_LETTERING, TRAFFIC_LIGHT_HIGHLIGHTS } from './traffic-artwork';

interface Props {
  agents: string[];
  customAgents?: CustomAgentSummary[];
  customQuotas?: MinibarState['customQuotas'];
  viewportCount?: number;
  quotas?: MinibarState['quotas'];
  traffic?: MinibarState['traffic'];
  showStatusText?: boolean;
  interactive?: boolean;
  dockSide: DockSide;
  opacity: number;
  appearance?: MiniBarSettings['appearance'];
  offset?: { x: number; y: number };
  selectedAgent?: string | null;
  pinnedAgent?: string | null;
  onAgentClick?: (agent: string) => void;
  onAgentDoubleClick?: () => void;
  onAgentEnter?: (agent: string) => void;
  onAgentLeave?: () => void;
  onDragStart?: React.PointerEventHandler;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const LIGHTS = [
  { state: 'waiting', lit: '#E7383B', litRim: '#C50C1A', shine: '#FF898B' },
  { state: 'working', lit: '#FDCC03', litRim: '#CC9712', shine: '#FEE894' },
  { state: 'done', lit: '#2FB33F', litRim: '#398542', shine: '#45E459' },
] as const;

export function MiniBarDock({ quotas, traffic, showStatusText = true, interactive = true, dockSide, opacity, appearance = 'dark', offset = { x: 0, y: 0 }, selectedAgent, onAgentClick, onAgentDoubleClick, onAgentEnter, onAgentLeave, onDragStart, onMouseEnter, onMouseLeave }: Props) {
  const horizontal = isHorizontalDock(dockSide);
  const pointerStart = useRef({ x: 0, y: 0 });
  const length = getTrafficCapsuleLength(showStatusText);
  const state = getTrafficLightState(traffic);
  const taskLabel = TRAFFIC_LABELS[state];
  const remaining = toRemainingPercent(quotas?.codex?.pct5h);
  const ringColor = quotaUsageColor(quotas?.codex?.pct5h);
  const svgLength = showStatusText ? 537 : 485;
  const ringX = horizontal ? 66.33 : 65.67;
  const ringY = horizontal ? 65.67 : (showStatusText ? 470.34 : 418.34);
  const palette = MINIBAR_PALETTES[appearance];
  const lettering = (appearance === 'light' ? TRAFFIC_LIGHT_LETTERING : TRAFFIC_LETTERING)[horizontal ? 'horizontal' : 'vertical'][state];
  const highlights = (appearance === 'light' ? TRAFFIC_LIGHT_HIGHLIGHTS : TRAFFIC_HIGHLIGHTS)[horizontal ? showStatusText ? 'horizontalText' : 'horizontal' : showStatusText ? 'verticalText' : 'vertical'];
  const ratio = CAPSULE_THICKNESS / 132;
  const circumference = 2 * Math.PI * 43;
  const QuotaControl = interactive ? 'button' : 'span';

  return <div
    className="nexo-traffic-capsule drag-region"
    data-traffic-state={state}
    data-orientation={horizontal ? 'horizontal' : 'vertical'}
    data-appearance={appearance}
    style={{ position: 'absolute', left: offset.x + CAPSULE_GUTTER, top: offset.y + CAPSULE_GUTTER, width: horizontal ? length : CAPSULE_THICKNESS, height: horizontal ? CAPSULE_THICKNESS : length }}
    onPointerDown={event => { pointerStart.current = { x: event.screenX, y: event.screenY }; onDragStart?.(event); }}
    onClick={event => {
      if ((event.target as Element).closest('button')) return;
      if (Math.hypot(event.screenX - pointerStart.current.x, event.screenY - pointerStart.current.y) <= 4) onAgentClick?.('codex');
    }}
    onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
  >
    <svg className="nexo-traffic-art" viewBox={horizontal ? `0 0 ${svgLength} 132` : `0 0 132 ${svgLength}`} fill="none" aria-hidden="true">
      <rect width={horizontal ? svgLength : 132} height={horizontal ? 132 : svgLength} rx="65.6667" fill={palette.body} fillOpacity={opacity} />
      {LIGHTS.map((light, index) => {
        const cx = horizontal ? (showStatusText ? 471 : 419) - index * 117.333 : 65.667;
        const cy = horizontal ? 65.667 : 65.667 + index * 117.333;
        const active = state === light.state;
        return <g key={light.state} className="nexo-traffic-lamp" data-lamp={light.state} data-lit={active}>
          <circle cx={cx} cy={cy} r="43" strokeWidth="8" style={{ fill: light.lit, stroke: light.litRim, opacity: active ? 1 : 0.21 }} />
          <path d={highlights[light.state]} stroke={light.shine} strokeWidth="10" strokeLinecap="round" style={{ opacity: active ? 1 : 0 }} />
        </g>;
      })}
      {showStatusText && <path d={lettering} fill={palette.lettering} />}
      <circle cx={ringX} cy={ringY} r="47" fill={palette.ringBackground} />
      <circle cx={ringX} cy={ringY} r="43" stroke={palette.ringTrack} strokeWidth="7" />
      {remaining !== null && <circle className="nexo-traffic-quota-arc" cx={ringX} cy={ringY} r="43" stroke={ringColor} strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - remaining / 100)} transform={`rotate(-90 ${ringX} ${ringY})`} />}
    </svg>
    <QuotaControl type={interactive ? 'button' : undefined} className="nexo-floating-agent nexo-traffic-quota-button no-drag" aria-label={interactive ? `GPT ${taskLabel}，剩余额度 ${remaining === null ? '未知' : remaining + '%'}，悬停查看详情，双击打开 ChatGPT` : undefined} aria-expanded={interactive ? selectedAgent === 'codex' : undefined} onClick={interactive ? () => onAgentClick?.('codex') : undefined}
      onDoubleClick={interactive ? event => { event.stopPropagation(); if (Math.hypot(event.screenX - pointerStart.current.x, event.screenY - pointerStart.current.y) <= 4) onAgentDoubleClick?.(); } : undefined}
      onMouseEnter={interactive ? () => onAgentEnter?.('codex') : undefined} onMouseLeave={interactive ? onAgentLeave : undefined}
      onFocus={interactive ? () => onAgentEnter?.('codex') : undefined} onBlur={interactive ? onAgentLeave : undefined}
      style={{ left: (ringX - 47) * ratio, top: (ringY - 47) * ratio, width: 94 * ratio, height: 94 * ratio }}>
      <img src={appearance === 'light' ? gptFloatingLightIcon : gptFloatingIcon} alt="" aria-hidden="true" draggable={false} style={{ width: 29 * ratio * 1.5, height: 29 * ratio * 1.5, objectFit: 'contain', display: 'block' }} />
    </QuotaControl>
  </div>;
}
