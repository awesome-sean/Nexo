import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveMiniBarSettings,
  type MiniBarSettings,
} from '../../common/minibar-settings';

export function useMiniBarSettings() {
  const [settings, setSettings] = useState(resolveMiniBarSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    let alive = true;
    let settingsReceived = false;
    let legacyOpacity: number | undefined;
    try {
      const stored = localStorage.getItem('pulse_minibar_bg_opacity');
      if (stored !== null) legacyOpacity = Number(stored);
    } catch {}
    const unsubscribe = window.pulse?.onMiniBarSettingsChanged?.((next) => {
      settingsReceived = true;
      if (alive) setSettings(resolveMiniBarSettings(next));
    });
    if (!window.pulse?.getMiniBarSettings) {
      setLoading(false);
      return unsubscribe;
    }
    window.pulse
      .getMiniBarSettings(legacyOpacity)
      .then((next) => {
        if (alive && !settingsReceived) setSettings(resolveMiniBarSettings(next));
      })
      .catch((reason) => {
        if (alive) setError(String(reason?.message ?? reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  const update = useCallback(async (patch: Partial<MiniBarSettings>) => {
    const request = ++requestRef.current;
    setSaving(true);
    setError(null);
    try {
      if (!window.pulse?.setMiniBarSettings)
        throw new Error('悬浮窗设置接口尚未就绪');
      const next = await window.pulse.setMiniBarSettings(patch);
      if (request === requestRef.current) setSettings(resolveMiniBarSettings(next));
      return true;
    } catch (reason: any) {
      if (request === requestRef.current)
        setError(String(reason?.message ?? reason));
      return false;
    } finally {
      if (request === requestRef.current) setSaving(false);
    }
  }, []);

  return { settings, loading, saving, error, update };
}
