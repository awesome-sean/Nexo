import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { APP_VERSION } from '../../../common/app-info';
import { UPDATE_RELEASES_URL, UPDATE_REPOSITORY } from '../../../common/update-source';

type Phase = 'checking' | 'unpublished' | 'latest' | 'available' | 'downloading' | 'verifying' | 'downloaded' | 'installing' | 'installer-open' | 'error';

export function UpdateSection({ onUpdateAvailable }: { onUpdateAvailable?: (available: boolean) => void } = {}) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [latest, setLatest] = useState('');
  const [canDownload, setCanDownload] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState(UPDATE_RELEASES_URL);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const [hasInstaller, setHasInstaller] = useState(false);
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
      setHasInstaller(!!result.downloadedVersion);
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
      if (progress.status === 'verifying') setPhase('verifying');
      if (progress.status === 'downloaded') {
        setLatest(progress.version || ''); setHasInstaller(true); setPhase('downloaded');
      }
      if (progress.status === 'installer-closed') setPhase('downloaded');
      if (progress.status === 'error') { setError(progress.error || '下载失败，请重试'); setPhase('error'); }
    });
    void check();
    return () => { alive.current = false; unsubscribe?.(); };
  }, []);

  async function upgrade() {
    if (actionPending.current) return;
    actionPending.current = true;
    setError('');
    try {
      if (!hasInstaller) {
        setPercent(0); setPhase('downloading');
        const result = await window.pulse?.downloadUpdate();
        if (!result?.ok) throw new Error(result?.error || '下载失败');
        if (alive.current) { setLatest(result.version || latest); setHasInstaller(true); }
      }
      if (alive.current) setPhase('installing');
      const result = await window.pulse?.installUpdate();
      if (result?.retryDownload && alive.current) setHasInstaller(false);
      if (!result?.ok) throw new Error(result?.error || '无法打开 Windows 安装向导');
      if (alive.current) setPhase(current => current === 'installing' ? 'installer-open' : current);
    } catch (failure) {
      if (alive.current) { setError(failure instanceof Error ? failure.message : String(failure)); setPhase('error'); }
    } finally { actionPending.current = false; }
  }

  async function browserDownload() {
    try {
      const result = await window.pulse?.openUpdateDownload();
      if (!result?.ok) throw new Error(result?.error || '无法打开下载地址');
    } catch (failure) {
      if (alive.current) { setError(failure instanceof Error ? failure.message : String(failure)); setPhase('error'); }
    }
  }

  const status: Record<Phase, string> = {
    checking: '正在检查更新…', unpublished: '尚未发布正式版本', latest: '当前已是最新版本',
    available: `发现新版本 ${latest}`, downloading: `正在下载 ${percent}%`, verifying: '正在校验安装包…',
    downloaded: `${latest} 已准备就绪`, installing: '正在打开 Windows 安装向导…', 'installer-open': 'Windows 安装向导已打开，请按提示完成安装', error,
  };
  const busy = ['checking', 'downloading', 'verifying', 'installing', 'installer-open'].includes(phase);
  const upgradeReady = hasInstaller || canDownload;
  const label: Record<Phase, string> = {
    checking: '检查中…', unpublished: '检查更新', latest: '检查更新',
    available: canDownload ? '下载并安装' : '查看发布页', downloading: `下载中 ${percent}%`, verifying: '校验中…',
    downloaded: '打开安装向导', installing: '正在打开…', 'installer-open': '安装向导已打开',
    error: hasInstaller ? '重试打开安装向导' : canDownload ? '重试下载' : '重新检查',
  };
  return <section className="nexo-floating-settings-card nexo-update-card">
    <header><h3><Download size={22} />电脑端更新</h3><span className="nexo-update-version">{APP_VERSION}</span></header>
    <p className="nexo-update-source">GitHub / {UPDATE_REPOSITORY}</p>
    <div className="nexo-update-status"><strong role="status" className={phase === 'error' ? 'nexo-update-error' : ''}>{status[phase]}</strong>
      <button type="button" className="nexo-update-action" disabled={busy} onClick={() => upgradeReady ? void upgrade() : phase === 'available' ? void window.pulse?.openRelease(releaseUrl) : void check()}>
        {upgradeReady ? <Download size={18} /> : <RefreshCw size={18} />}{label[phase]}
      </button>
    </div>
    {(phase === 'downloading' || phase === 'verifying') && <progress className="nexo-update-progress" value={percent} max={100} aria-label="更新下载进度" />}
    <footer><p>下载并校验后将打开 Windows 安装向导，按提示完成安装。</p><div className="nexo-update-links">{phase === 'error' && <button type="button" className="nexo-update-browser" onClick={() => void browserDownload()}>浏览器下载<ExternalLink size={16} /></button>}<button type="button" onClick={() => void window.pulse?.openRelease(releaseUrl)}>发布记录<ExternalLink size={16} /></button></div></footer>
  </section>;
}
