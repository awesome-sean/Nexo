import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import { Toggle } from './ui';

export function AutoLaunchSettings() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const bridge = window.pulse;
    if (!bridge) { setBusy(false); setError('桌面连接未就绪'); return; }
    const read = async () => {
      try { const value = await bridge.getAutoLaunch(); if (active) setEnabled(value); }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '读取失败'); }
      finally { if (active) setBusy(false); }
    };
    const unsubscribe = bridge.onAutoLaunchChange(value => { if (active) { setEnabled(value); setError(''); } });
    void read();
    window.addEventListener('focus', read);
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', read); };
  }, []);
  const change = async (value: boolean) => {
    if (!window.pulse) return;
    setBusy(true); setError('');
    try { setEnabled(await window.pulse.setAutoLaunch(value)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '设置失败'); }
    finally { setBusy(false); }
  };
  return <section className="nexo-floating-settings-card">
    <div className="auto-launch-row"><div><h3><Power size={20} />开机自启动</h3><p>登录 Windows 后自动启动 Nexo</p></div><Toggle label="开机自启动" checked={enabled} disabled={busy} onChange={value => void change(value)} /></div>
    {error && <p className="auto-launch-error" role="alert">{error}</p>}
  </section>;
}
