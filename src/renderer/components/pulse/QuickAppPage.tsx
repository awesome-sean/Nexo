import React, { useCallback, useEffect, useState } from 'react';
import { Package, RefreshCw, Trash2 } from 'lucide-react';
import { useBandConnection } from '../../hooks/useBandConnection';
import { OtherAppInstall } from './OtherAppInstall';

type QuickApp = { package_name: string; app_name?: string; version_code: number; can_remove: boolean };
export const QuickAppPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const connection = useBandConnection();
  const connected = connection.state === 'connected';
  const [apps, setApps] = useState<QuickApp[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<QuickApp | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try { setApps((await window.pulse!.quickApps.list()).apps); }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (connected) void refresh(); else setApps([]); }, [connected, refresh]);
  const uninstall = async () => {
    if (!removing || busy) return;
    setBusy(true); setError('');
    try { await window.pulse!.quickApps.remove(removing.package_name); setRemoving(null); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '卸载失败'); }
    finally { setBusy(false); }
  };
  return <div className={embedded ? 'workspace-app-manager' : 'nexo-page'}>
    {!embedded && <header className="nexo-page-header"><h2 className="nexo-page-title">快应用管理</h2>
      <button className="nexo-action" disabled={!connected || busy} onClick={() => void refresh()}><RefreshCw size={17} />{busy ? '处理中…' : '刷新列表'}</button></header>
    }
    {error && <p role="alert" className="text-red-500">{error}</p>}
    <section className="rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-default)] p-6">
      <div className="workspace-card-header mb-5"><div className="nexo-section-heading"><Package size={20} /><h3 className="font-semibold text-lg">已安装快应用</h3></div>
        {embedded && <button type="button" className="nexo-action workspace-subtle-action" disabled={!connected || busy} onClick={() => void refresh()}><RefreshCw size={16} />{busy ? '读取中…' : '刷新列表'}</button>}
      </div>
      {!connected ? <p>连接手环后查看应用</p> : !busy && apps.length === 0 ? <p>暂无快应用</p> : null}
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">{connected && apps.map(app => <div key={app.package_name} className="flex items-center gap-4 rounded-[20px] p-5 bg-[var(--bg-subtle)]">
        <Package size={28} className="shrink-0" /><div className="min-w-0 flex-1"><h4 className="font-semibold truncate">{app.app_name || app.package_name}</h4><p className="text-sm text-[var(--text-muted)] break-all">{app.package_name}</p><p className="text-sm mt-1">版本 {app.version_code}</p></div>
        <button className="nexo-action shrink-0" disabled={busy || !connected || !app.can_remove} onClick={() => setRemoving(app)} title={app.can_remove ? '卸载' : '设备不允许卸载'}><Trash2 size={16} />卸载</button>
      </div>)}</div>
    </section>
    <section className="rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-default)] p-6"><h3 className="font-semibold text-lg mb-5">安装快应用</h3><OtherAppInstall connected={connected && !busy} onInstalled={() => void refresh()} /></section>
    {removing && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"><section role="dialog" aria-modal="true" aria-label="卸载快应用" className="bg-[var(--bg-surface)] p-8 rounded-[24px] max-w-md w-full"><h3 className="text-xl font-semibold">卸载 {removing.app_name || removing.package_name}？</h3><p className="my-5">手环上的应用及其数据可能被删除。</p>{error && <p role="alert" className="text-red-500 mb-4">{error}</p>}<div className="flex justify-end gap-3"><button className="nexo-action" disabled={busy} onClick={() => setRemoving(null)}>取消</button><button className="nexo-action btn-primary" disabled={busy || !connected} onClick={() => void uninstall()}>{busy ? '卸载中…' : '确认卸载'}</button></div></section></div>}
  </div>;
};
