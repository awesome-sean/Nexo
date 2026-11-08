import type { MinibarState } from '../../../common/types';
import { quotaUsageColor } from '../../../common/quota-colors';
import { parseResetTimeInfo, toRemainingPercent } from '../pulse/agent-quota-utils';
import type { MiniBarSettings } from '../../../common/minibar-settings';
import { MINIBAR_PALETTES } from './minibar-palette';

export function MiniBarDetails({ quotas, opacity = 1, textTheme = 'light', appearance = 'dark' }: { quotas?: MinibarState['quotas']; opacity?: number; textTheme?: MiniBarSettings['detailTextTheme']; appearance?: MiniBarSettings['appearance'] }) {
  const quota = quotas?.codex;
  return <div className="nexo-traffic-details" data-text-theme={textTheme} data-appearance={appearance} style={{ backgroundColor: `rgba(${MINIBAR_PALETTES[appearance].surfaceRgb},${opacity})` }}>
    {([
      { name: '5h', used: quota?.pct5h, reset: quota?.resetText, at: quota?.reset5hAt, weekly: false },
      { name: 'weekly', used: quota?.pct7d, reset: quota?.reset7dText, at: quota?.reset7dAt, weekly: true },
    ]).map(item => {
      const remaining = toRemainingPercent(item.used);
      const usedForColor = item.weekly && remaining !== null ? 100 - remaining : item.used;
      const resetInfo = parseResetTimeInfo(item.reset);
      const date = item.at ? new Date(item.at) : null;
      const reset = date && Number.isFinite(date.getTime())
        ? item.weekly ? `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        : resetInfo.absoluteTimeText?.replace(/^重置于\s*/, '') || '—';
      return <div key={item.name} className="nexo-traffic-detail-period" title={resetInfo.countdownText}>
        <div><span>{item.name}</span><strong style={{ color: quotaUsageColor(usedForColor) }}>{remaining === null ? '—' : remaining + '%'}</strong></div>
        <div className="nexo-traffic-detail-reset"><span>重置</span><time>{reset}</time></div>
      </div>;
    })}
  </div>;
}
