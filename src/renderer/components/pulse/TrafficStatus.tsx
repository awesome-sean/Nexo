import { hasMixedTraffic, TRAFFIC_COLORS, TRAFFIC_LABELS, type TrafficSnapshot } from '../../../common/codex-traffic';
import { useTrafficLightState } from '../../hooks/useTrafficLightState';
export function TrafficStatus({traffic}:{traffic?:TrafficSnapshot}) {
  const state=useTrafficLightState(traffic);
  return <span className="nexo-traffic-status" data-state={state} role="status"><span aria-hidden="true" className="nexo-traffic-dot" style={{backgroundColor:TRAFFIC_COLORS[state]}} />{hasMixedTraffic(traffic) ? '执行中 · 部分已完成' : TRAFFIC_LABELS[traffic?.state || 'idle']}</span>;
}
