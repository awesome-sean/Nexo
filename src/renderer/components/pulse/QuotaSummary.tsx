import { CalendarDays, ChevronDown, Coins, Zap } from 'lucide-react';
import type { QuotaDisplay } from '../../hooks/useQuotaDisplay';

export function QuotaSummary({ display }: { display: QuotaDisplay }) {
  const windows = [
    { label: '5 小时额度', value: display.five, countdown: display.fiveCountdown, reset: display.resetClock, icon: Zap, tone: 'five', code: '5H' },
    { label: '每周额度', value: display.week, countdown: display.weekCountdown, reset: display.resetDate, icon: CalendarDays, tone: 'week', code: '7D' },
  ];

  return <div className="nexo-stat-grid workspace-quota-grid">
    {windows.map(({ label, value, countdown, reset, icon: Icon, tone, code }) => (
      <section key={tone} className={`nexo-stat-card nexo-stat-card--${tone}`}>
        <div className="workspace-stat-heading">
          <div className="nexo-stat-caption"><span className="nexo-stat-icon"><Icon size={20} strokeWidth={1.7} /></span><h2 className="nexo-card-label">{label}</h2></div>
          <span className="nexo-card-code">{code}</span>
        </div>
        <p className="nexo-stat-number"><span className="nexo-numeric-value">{value ?? '--'}</span><small>%<span>剩余额度</span></small></p>
        <div className="nexo-stat-track" aria-hidden="true"><div className="nexo-stat-fill" style={{ width: value === null ? '100%' : value + '%', background: value === null ? 'var(--hatch)' : undefined }} /></div>
        <div className="nexo-reset-footer"><span>{display.fresh && value !== null ? countdown || '等待重置' : '等待额度数据'}</span><strong>重置 {reset}</strong></div>
      </section>
    ))}
    <section className="nexo-stat-card nexo-cost-card">
      <div className="workspace-stat-heading">
        <div className="nexo-stat-caption"><span className="nexo-stat-icon"><Coins size={20} strokeWidth={1.7} /></span><h2 className="nexo-card-label">今日花费</h2></div>
        <span className="nexo-card-code">CNY</span>
      </div>
      <p className="nexo-stat-number nexo-cost-number"><span className="nexo-numeric-value">{display.cny === null ? '--' : '¥' + display.cny.toFixed(2)}</span></p>
      <div className="nexo-cost-footnote"><span className="nexo-pill">{display.partial ? '部分估算' : 'API 价格估算'}</span><span>1 USD ≈ {display.daily?.exchangeRate ?? '--'} CNY</span></div>
      <details className="workspace-token-details">
        <summary>Token 明细<ChevronDown size={13} /></summary>
        <div>{[['输入', display.daily?.inputTokens], ['缓存命中', display.daily?.cachedInputTokens], ['输出', display.daily?.outputTokens]].map(([label, value]) => (
          <dl key={String(label)}><dt>{label}</dt><dd className="nexo-numeric-value">{display.dailyFresh && typeof value === 'number' ? value.toLocaleString() : '--'}</dd></dl>
        ))}</div>
      </details>
    </section>
  </div>;
}
