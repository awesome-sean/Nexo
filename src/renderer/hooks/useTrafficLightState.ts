import { useEffect, useState } from 'react';
import { getTrafficLightState, hasMixedTraffic, MIXED_TRAFFIC_PHASE_MS, type TrafficSnapshot } from '../../common/codex-traffic';

export function useTrafficLightState(traffic?: TrafficSnapshot) {
  const [, redraw] = useState(0);
  const mixed = hasMixedTraffic(traffic);
  useEffect(() => {
    if (!mixed) return;
    const timer = setInterval(() => redraw(value => value + 1), MIXED_TRAFFIC_PHASE_MS);
    return () => clearInterval(timer);
  }, [mixed]);
  return getTrafficLightState(traffic);
}
