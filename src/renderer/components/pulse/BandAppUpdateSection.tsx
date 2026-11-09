import { useEffect, useRef, useState } from 'react';
import { PackageCheck, RefreshCw } from 'lucide-react';
import type { AppInstallBridge } from '../../env';

type BundledInfo = Awaited<ReturnType<AppInstallBridge['getBundledInfo']>>;

export function BandAppUpdateSection() {
  const [connected, setConnected] = useState(false);
  const [bundled, setBundled] = useState<BundledInfo | null>(null);
  const [installed, setInstalled] = useState<number | null>();
  const [busy, setBusy] = useState(false);
  const [percentage, setPercentage] = useState(0);
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const installing = useRef(false);
  const alive = useRef(true);
  const bridge = window.pulse;
  const installer = bridge?.appInstall;

  useEffect(() => {
    alive.current = true;
    if (!bridge || !installer) return;
    void bridge.getCoreState().then(state => { if (alive.current) setConnected(state.connection.state === 'connected'); }).catch(() => {});
    void installer.getBundledInfo().then(info => { if (alive.current) setBundled(info); }).catch(() => { if (alive.current) setNotice('无法读取内置快应用'); });
    const offCore = bridge.onCoreState(state => setConnected(state.connection.state === 'connected'));
    const offProgress = installer.onProgress(event => {
      if (installing.current && event.percentage != null) setPercentage(Math.min(100, Math.max(0, event.percentage)));
    });
    return () => { alive.current = false; offCore(); offProgress(); };
  }, []);

  useEffect(() => {
    let active = true;
    setInstalled(undefined);
    setNotice('');
    if (connected && bundled?.packageId && bridge) {
      void bridge.quickApps.list().then(result => {
        if (active) setInstalled(result.apps.find(app => app.package_name === bundled.packageId)?.version_code ?? null);
      }).catch(() => { if (active) setNotice('读取手环版本失败，请刷新重试'); });
    }
    return () => { active = false; };
  }, [connected, bundled?.packageId, refreshKey]);

  async function upgrade() {
    if (installing.current || !bridge || !installer) return;
    installing.current = true;
    setBusy(true); setPercentage(0); setNotice('');
    try {
      const result = await installer.installBundled();
      if (result.coreStatus !== 'completed') throw new Error('手环尚未确认安装完成，请刷新版本后重试');
      const list = await bridge.quickApps.list();
      const actual = list.apps.find(app => app.package_name === result.packageId)?.version_code;
      if (actual !== result.versionCode) throw new Error('手环版本尚未更新，请重新读取');
      if (alive.current) { setInstalled(actual); setNotice('手环已确认升级完成'); }
    } catch (failure) {
      if (alive.current) setNotice(failure instanceof Error ? failure.message : String(failure));
    } finally {
      installing.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const valid = !!(bundled?.exists && bundled.manifestValid && typeof bundled.versionCode === 'number');
  const needsUpdate = valid && installed !== undefined && (installed === null || installed < bundled!.versionCode!);
  let status = '连接手环后检查已安装版本';
  if (!valid && bundled) status = '内置快应用暂不可用';
  else if (busy) status = `正在安装 ${percentage}%`;
  else if (connected && installed === undefined) status = '正在读取手环版本…';
  else if (connected && installed === null) status = '手环尚未安装 Nexo';
  else if (connected) status = needsUpdate ? '有可用的快应用更新' : '已安装 Nexo，连接后自动打开';
  return <section className="nexo-floating-settings-card nexo-update-card">
    <header><h3><PackageCheck size={22} />手环快应用</h3><span className="nexo-update-version">{bundled?.versionName ? 'v' + bundled.versionName : '读取中'}</span></header>
    <p className="nexo-update-source">{installed != null ? (installed === bundled?.versionCode ? `已安装 v${bundled.versionName}` : installed === 2 ? '已安装 v1.0.1' : installed === 1 ? '已安装 v1.0.0' : '已读取手环版本') : '使用新版 Nexo 随附的快应用'}</p>
    <div className="nexo-update-status"><strong role="status">{status}</strong>{connected && (needsUpdate || busy) && <button type="button" className="nexo-update-action" disabled={!connected || !needsUpdate || busy} onClick={() => void upgrade()}><PackageCheck size={18} />{installed === null ? '安装快应用' : '升级快应用'}</button>}</div>
    {busy && <progress className="nexo-update-progress" max={100} value={percentage} aria-label="快应用安装进度" />}
    {notice && <p role="status" className="nexo-update-notice">{notice}</p>}
    <footer><p>{!connected ? '连接后自动检查安装状态，日常使用无需重复配置。' : installed === null ? '安装完成后立即打开快应用。' : needsUpdate ? '现有版本可继续使用，升级完成后自动打开。' : '每次重连后自动打开，已有版本无需重复安装。'}</p><button type="button" disabled={!connected || busy} onClick={() => { setNotice(''); setRefreshKey(key => key + 1); }}><RefreshCw size={16} />刷新版本</button></footer>
  </section>;
}
