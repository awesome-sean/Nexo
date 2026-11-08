import React from 'react';
import type { MinibarState } from '../../../common/types';

export interface StatusBarProps {
  state: MinibarState | null;
  updatedAt: Date | null;
  lastError?: Error | string | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ updatedAt, lastError }) => {
  const text = lastError ? '数据服务异常' : updatedAt ? '本机服务已连接' : '正在连接数据服务';
  const time = updatedAt ? updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
  return (
    <footer className="h-8 shrink-0 flex items-center justify-between px-6 bg-[var(--bg-surface)] border-t border-[var(--border-default)] text-[10px] text-[var(--text-muted)] select-none">
      <div className="flex items-center gap-2" title={lastError ? String(lastError) : undefined}>
        <span className="nexo-dot w-1.5 h-1.5" style={{ background: lastError ? 'var(--status-error)' : updatedAt ? 'var(--status-success)' : 'var(--status-idle)' }} />
        <span>{text}</span>
        <span className="pl-2 border-l border-[var(--border-default)] tabular-nums">快照 {time}</span>
      </div>
    </footer>
  );
};
