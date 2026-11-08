import { useEffect, useState } from 'react';
import type { MinibarState } from '../../common/types';
import { toRemainingPercent } from '../components/pulse/agent-quota-utils';

export function useQuotaDisplay(quota: MinibarState | null) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const codex = quota?.quotas.codex;
  const age = now.getTime() - (codex?.sampledAt ?? 0);
  const fresh = codex?.authoritative === true && age >= -60000 && age < 300000;
  const five = fresh ? toRemainingPercent(codex?.pct5h) : null;
  const week = fresh ? toRemainingPercent(codex?.pct7d) : null;
  const daily = quota?.quotas.dailyUsage;
  const dayKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const dailyAge = now.getTime() - (daily?.updatedAt ?? 0);
  const dailyFresh = daily?.date === dayKey && dailyAge >= -60000 && dailyAge < 90000;
  const resetClock = fresh && five !== null && codex?.reset5hAt
    ? new Date(codex.reset5hAt).toTimeString().slice(0, 5) : '--:--';
  const resetDate = fresh && week !== null && codex?.reset7dAt
    ? String(new Date(codex.reset7dAt).getMonth() + 1).padStart(2, '0') + '/' + String(new Date(codex.reset7dAt).getDate()).padStart(2, '0')
    : '--/--';

  return {
    fresh, five, week, daily, dailyFresh, resetClock, resetDate,
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0'),
    cny: dailyFresh ? daily?.cny ?? null : null,
    partial: dailyFresh && daily?.incomplete === true,
    fiveCountdown: codex?.resetText?.replace(/\s*[·•]\s*\d{1,2}:\d{2}\s*$/, ''),
    weekCountdown: codex?.reset7dText,
  };
}

export type QuotaDisplay = ReturnType<typeof useQuotaDisplay>;
