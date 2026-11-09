import { useEffect, useState } from 'react';
import { Vibrate } from 'lucide-react';
import type { BandSettings } from '../../../common/band-settings';
import { Toggle } from './ui';

export function BandVibrationSettings() {
  const [settings, setSettings] = useState<BandSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.pulse?.getBandSettings().then(value => {
      if (active) setSettings(value);
    }).catch(() => { if (active) setError('读取手环振动设置失败'); });
    return () => { active = false; };
  }, []);

  const change = async (enabled: boolean) => {
    if (!window.pulse) return;
    setBusy(true);
    setError('');
    try { setSettings(await window.pulse.setBandVibration(enabled)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };

  return <div className="workspace-vibration-setting">
    <div className="workspace-vibration-row">
      <div><h4><Vibrate size={20} />手环振动</h4><p>通过蓝牙同步，断连后在下次连接时应用。</p></div>
      <div className="workspace-vibration-control">
        <span>{settings ? settings.vibrationEnabled ? '已开启' : '无振动' : '读取中…'}</span>
        <Toggle label="手环振动" checked={settings?.vibrationEnabled ?? true} disabled={busy || !settings} onChange={value => void change(value)} />
      </div>
    </div>
    {error && <p className="auto-launch-error" role="alert">{error}</p>}
  </div>;
}
