import { TRAFFIC_COLORS, TRAFFIC_LABELS, type TrafficSnapshot } from '../../../common/codex-traffic';
export function TrafficStatus({traffic}:{traffic?:TrafficSnapshot}) {
  const state=traffic?.state || 'idle';
  return <span className="nexo-traffic-status" data-state={state} role="status"><span aria-hidden="true" className="nexo-traffic-dot" style={{backgroundColor:TRAFFIC_COLORS[state]}} />{TRAFFIC_LABELS[state]}</span>;
}
