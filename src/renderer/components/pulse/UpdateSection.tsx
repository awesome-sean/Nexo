import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { APP_VERSION } from '../../../common/app-info';
import { UPDATE_RELEASES_URL, UPDATE_REPOSITORY } from '../../../common/update-source';

type Phase = 'checking' | 'unpublished' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';

export function UpdateSection({ onUpdateAvailable }: { onUpdateAvailable?: (available: boolean) => void } = {}) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [latest, setLatest] = useState('');
  const [canDownload, setCanDownload] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState(UPDATE_RELEASES_URL);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const actionPending = useRef(false);

  async function check() {
    setPhase('checking');
    setError('');
    try {
      const result = await window.pulse?.checkUpdate();
      if (!alive.current) return;
      if (!result?.ok) throw new Error(result?.error || '检查更新失败');
      onUpdateAvailable?.(!!result.updateAvailable);
      setLatest(result.latestVersion || '');
      setCanDownload(!!result.canDownload);
      setReleaseUrl(result.releaseUrl || UPDATE_RELEASES_URL);
      if (result.downloading) setPhase('downloading');
      else if (result.downloadedVersion) setPhase('downloaded');
      else if (result.unpublished) setPhase('unpublished');
      else setPhase(result.updateAvailable ? 'available' : 'latest');
    } catch (failure) {
      if (!alive.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
      setPhase('error');
    }
  }

  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.pulse?.onUpdateProgress(progress => {
      if (progress.total) setPercent(Math.min(100, Math.floor((progress.received || 0) / progress.total * 100)));
      if (progress.status === 'downloaded') {
        setLatest(progress.version || '');
        setPhase('downloaded');
      }
      if (progress.status === 'error') {
        setError(progress.error || '下载失败，请重试');
        setPhase('error');
      }
    });
    void check();
    return () => { alive.current = false; unsubscribe?.(); };
  }, []);

  async function upgrade() {
    if (actionPending.current) return;
    actionPending.current = true;
    try {
      if (phase !== 'downloaded') {
        setPercent(0);
        setPhase('downloading');
        const result = await window.pulse?.downloadUpdate();
        if (!result?.ok) throw new Error(result?.error || '下载失败');
      }
      if (alive.current) setPhase('installing');
      const result = await window.pulse?.installUpdate();
      if (!result?.ok) throw new Error(result?.error || '无法启动更新');
    } catch (failure) {
      if (!alive.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
      setPhase('error');
    } finally { actionPending.current = false; }
  }

  const status: Record<Phase, string> = {
    checking: '正在检查更新…', unpublished: '尚未发布正式版本', latest: '当前已是最新版本',
    available: `发现新版本 ${latest}`, downloading: `正在下载 ${percent}%`,
    downloaded: `${latest} 已准备就绪`, installing: '正在重启并更新…', error,
  };
  const busy = ['checking', 'downloading', 'installing'].includes(phase);
  const upgradeReady = phase === 'downloaded' || (phase === 'available' && canDownload);
  return <section className="nexo-floating-settings-card nexo-update-card">
    <header><h3><Download size={22} />电脑端更新</h3><span className="nexo-update-version">{APP_VERSION}</span></header>
    <p className="nexo-update-source">GitHub / {UPDATE_REPOSITORY}</p>
    <div className="nexo-update-status"><strong role="status" className={phase === 'error' ? 'nexo-update-error' : ''}>{status[phase]}</strong>
      <button type="button" className="nexo-update-action" disabled={busy} onClick={() => upgradeReady ? void upgrade() : phase === 'available' ? void window.pulse?.openRelease(releaseUrl) : void check()}>
        {upgradeReady ? <Download size={18} /> : <RefreshCw size={18} />}
        {phase === 'downloaded' ? '重启更新' : upgradeReady ? '一键升级' : phase === 'available' ? '查看发布页' : '检查更新'}
      </button>
    </div>
    {phase === 'downloading' && <progress className="nexo-update-progress" value={percent} max={100} aria-label="更新下载进度" />}
    <footer><p>下载完成后自动重启，保留绑定与个人设置。</p><button type="button" onClick={() => void window.pulse?.openRelease(releaseUrl)}>发布记录<ExternalLink size={16} /></button></footer>
  </section>;
}
