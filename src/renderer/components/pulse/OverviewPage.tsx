import { TrafficStatus } from './TrafficStatus';
import { identifyBandModel } from '../../../common/band-models';
import React, { useEffect, useState } from 'react';
import { RefreshCw, Bluetooth, Zap, CalendarDays, Coins, Watch, ArrowUpRight, CircleDot } from 'lucide-react';
import type { MinibarState } from '../../../common/types';
import { Band9Preview } from './Band9Preview';
import { toRemainingPercent } from './agent-quota-utils';

export interface OverviewPageProps {
  quota: MinibarState | null;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
  bandDeviceName: string | null;
  bandConnected: boolean;
  bandBusy: boolean;
  bandCanConnect: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  quota, loading, refreshing, onRefresh, bandDeviceName, bandConnected,
  bandBusy, bandCanConnect, onConnect, onDisconnect,
}) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const model = identifyBandModel(bandDeviceName);
  const codex = quota?.quotas.codex;
  const age = now.getTime() - (codex?.sampledAt ?? 0);
  const fresh = codex?.authoritative === true && age >= -60000 && age < 300000;
  const five = fresh ? toRemainingPercent(codex?.pct5h) : null;
  const week = fresh ? toRemainingPercent(codex?.pct7d) : null;
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0');
  const resetClock = fresh && five !== null && codex?.reset5hAt ? new Date(codex.reset5hAt).toTimeString().slice(0, 5) : '--:--';
  const resetDate = fresh && week !== null && codex?.reset7dAt ? String(new Date(codex.reset7dAt).getMonth() + 1).padStart(2, '0') + '/' + String(new Date(codex.reset7dAt).getDate()).padStart(2, '0') : '--/--';
  const daily = quota?.quotas.dailyUsage;
  const dayKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const dailyFresh = daily?.date === dayKey && now.getTime() - daily.updatedAt >= -60000 && now.getTime() - daily.updatedAt < 90000;
  const cny = dailyFresh ? daily?.cny ?? null : null;
  const fiveResetCountdown = codex?.resetText?.replace(/\s*[·•]\s*\d{1,2}:\d{2}\s*$/, '');
  const windowCards = [
    { label: '5 小时额度', value: five, reset: fiveResetCountdown, resetAt: resetClock, icon: Zap, tone: 'five' },
    { label: '每周额度', value: week, reset: codex?.reset7dText, resetAt: resetDate, icon: CalendarDays, tone: 'week' },
  ];
  return (
    <div className="nexo-page">
      <div className="nexo-page-header">
        <div>
          <h1 className="nexo-page-title">额度概览</h1>
          <div className="nexo-overview-traffic"><strong>GPT</strong><TrafficStatus traffic={quota?.traffic}/></div>
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing || loading} className="nexo-action btn-primary">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '刷新中' : '刷新数据'}
        </button>
      </div>

      <div className="nexo-stat-grid">
        {windowCards.map(({ label, value, reset, resetAt, icon: Icon, tone }) => (
          <section key={label} className={`nexo-stat-card nexo-stat-card--${tone}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="nexo-stat-caption"><span className="nexo-stat-icon"><Icon size={16} strokeWidth={1.8} /></span><h2 className="nexo-card-label">{label}</h2></div>
              <span className="nexo-card-code">{tone === 'five' ? '5H' : '7D'}</span>
            </div>
            <p className="nexo-stat-number"><span className="nexo-numeric-value">{value ?? '--'}</span><small>%<span>剩余额度</span></small></p>
            <div className="nexo-stat-track" aria-hidden="true">
              <div className="nexo-stat-fill" style={{ width: value === null ? '100%' : value + '%', background: value === null ? 'var(--hatch)' : undefined }} />
            </div>
            <div className="nexo-reset-footer"><span>{fresh && value !== null ? (reset || '等待重置') : '等待额度数据'}</span><strong>重置 {resetAt}</strong></div>
          </section>
        ))}
        <section className="nexo-stat-card nexo-cost-card">
          <div className="flex items-center justify-between gap-2">
            <div className="nexo-stat-caption"><span className="nexo-stat-icon"><Coins size={16} strokeWidth={1.8} /></span><h2 className="nexo-card-label">今日花费</h2></div>
            <span className="nexo-card-code">CNY</span>
          </div>
          <p className="nexo-stat-number nexo-cost-number">
            <span className="nexo-numeric-value">{cny === null ? '--' : '¥' + cny.toFixed(2)}</span>
          </p>
          <div className="nexo-cost-footnote"><span className="nexo-pill">{dailyFresh && daily?.incomplete ? '部分估算' : 'API 价格估算'}</span><span>1 USD ≈ {daily?.exchangeRate ?? '--'} CNY</span></div>
        </section>
      </div>

      <div className="nexo-overview-bottom">
        <section className="nexo-preview-card">
          <div className="nexo-card-heading">
            <div className="nexo-section-heading"><Watch size={17} /><h3>手环画面</h3></div>
            <span className="nexo-live-badge nexo-pill"><CircleDot size={11} />
              {fresh ? '额度已更新' : loading ? '读取中' : '等待数据'}
            </span>
          </div>
          <div className="nexo-device-stage">
            <div className="nexo-device-screen">
              <Band9Preview screenWidth={model?.width} screenHeight={model?.height} traffic={quota?.traffic?.state} trafficSnapshot={quota?.traffic} time={time} date={date} five={five} week={week} fiveReset={resetClock} weekReset={resetDate} cny={cny} partial={dailyFresh && daily?.incomplete === true} />
            </div>
          </div>
          <div className="nexo-preview-caption"><span>{bandDeviceName || '小米手环'} · 横屏</span><span>15 秒同步周期</span></div>
        </section>

        <section className="nexo-device-card">
          <div className="nexo-card-heading w-full"><h3>我的设备</h3><Bluetooth size={16} /></div>
          <div className="nexo-device-summary"><div className="nexo-device-icon"><Watch size={36} strokeWidth={1.5} /></div>
          <div>
            <h4 className="nexo-connection-label">{bandDeviceName || '小米手环'}</h4>
            <span className="nexo-device-status"><span className="nexo-dot" style={{ background: bandConnected ? 'var(--status-success)' : 'var(--status-idle)' }} />{bandConnected ? '已连接' : '未连接'}</span>
          </div></div>
          {!bandConnected && <p className="nexo-device-note">前往「我的手环」完成配置</p>}
          <button type="button" onClick={bandConnected ? onDisconnect : onConnect} disabled={bandBusy || (!bandConnected && !bandCanConnect)} className="nexo-action nexo-action-secondary">
            {bandBusy ? '处理中' : bandConnected ? '断开连接' : '连接手环'}<ArrowUpRight size={15} />
          </button>
        </section>
      </div>

      <section className="nexo-token-card">
        <div className="nexo-card-heading"><h3>今日 Token 用量</h3><span className="nexo-token-hint">按电脑本地日期统计</span></div>
        <div className="nexo-data-details">
          {[['输入 token', daily?.inputTokens], ['缓存命中', daily?.cachedInputTokens], ['输出 token', daily?.outputTokens]].map(([label, value]) => (
            <dl key={String(label)}><dt>{label}</dt><dd className="nexo-numeric-value">{dailyFresh && typeof value === 'number' ? value.toLocaleString() : '--'}</dd></dl>
          ))}
        </div>
        {daily?.incomplete && <p className="nexo-token-note">部分估算 · 日志缺口或未定价记录 {daily.unpricedRequests} 条</p>}
      </section>
    </div>
  );
};
