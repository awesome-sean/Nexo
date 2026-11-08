import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Download, ExternalLink, FileText, Loader2, Monitor, RefreshCw, Watch } from 'lucide-react';
import type { AstroBoxImportDevice } from '../../../main/services/astrobox-import';
import { LogImportStep } from './LogImportStep';

type ImportSource = 'astrobox' | 'log';

function AstroBoxImport({ onSuccess }: { onSuccess?: () => void }) {
  const [devices, setDevices] = useState<AstroBoxImportDevice[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const [pairingRequired, setPairingRequired] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const readDevices = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setDevices([]);
    setSelected('');
    try {
      const result = await window.pulse?.listAstroBoxDevices();
      if (!alive.current) return;
      setHasRead(true);
      setPairingRequired(result?.pairingRequired === true);
      setDevices(result?.devices ?? []);
      const available = result?.devices.filter(device => device.connectionAvailable !== false) ?? [];
      if (available.length === 1) setSelected(available[0].id);
      if (!result?.ok && !result?.pairingRequired) setError(result?.error || '桌面服务尚未就绪，请重新打开 Nexo。');
    } catch {
      if (alive.current) setError('读取失败，请确认 AstroBox 正在电脑上运行后重试。');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const importDevice = async () => {
    if (busy || !selected) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.pulse?.importAstroBoxDevice(selected);
      if (!alive.current) return;
      if (result?.ok) onSuccess?.();
      else setError(result?.error || '导入失败，请重新读取设备。');
    } catch {
      if (alive.current) setError('导入失败，请重新读取设备后重试。');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section className="nexo-import-panel" aria-label="AstroBox 设备导入">
      <div className="nexo-import-icon"><Monitor size={22} /></div>
      <h5>读取 AstroBox 设备资料</h5>
      <p>读取已同步的设备，选择后导入。</p>
      <button type="button" className="btn-primary nexo-import-read" onClick={readDevices} disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        {busy ? '正在处理…' : hasRead ? '重新读取 AstroBox 设备' : '读取 AstroBox 设备'}
      </button>
      {pairingRequired && (
        <div className="nexo-import-notice" role="status">
          <strong>请在 AstroBox 中批准 Nexo</strong>
          <p>切到 AstroBox，允许 Nexo 读取设备资料，然后回到这里点击「重新读取 AstroBox 设备」。</p>
        </div>
      )}
      {error && <p className="nexo-import-error" role="alert">{error}</p>}
      {hasRead && !busy && !error && !pairingRequired && devices.length === 0 && (
        <div className="nexo-import-notice" role="status">
          <strong>尚未找到目标手环</strong>
          <p>请按右侧教程在 AstroBox 登录小米账号并同步设备，再重新读取。可识别手环 9、10、11 的标准版和 NFC 版。</p>
        </div>
      )}
      {devices.length > 0 && (
        <fieldset className="nexo-import-devices" disabled={busy}>
          <legend>选择要导入的手环</legend>
          {devices.map((device) => (
            <label key={device.id} className={`nexo-import-device ${selected === device.id ? 'is-selected' : ''}`}>
              <input type="radio" name="astrobox-device" disabled={device.connectionAvailable === false} checked={selected === device.id} onChange={() => setSelected(device.id)} />
              <Watch size={19} />
              <span><strong>{device.name}</strong><small>{device.maskedMac} · {device.connected ? 'AstroBox 已连接' : '已保存设备'}</small><small>{device.modelStatus}</small></span>
              {selected === device.id && <CheckCircle2 size={17} />}
            </label>
          ))}
        </fieldset>
      )}
      <div className="nexo-import-footer">
        <span>导入后在 AstroBox 中断开手环，再由 Nexo 连接。</span>
        <button type="button" className="btn-primary" onClick={importDevice} disabled={busy || !selected}>
          导入并继续 <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}

export function DeviceImportStep({ onSuccess }: { onSuccess?: () => void }) {
  const [source, setSource] = useState<ImportSource>('astrobox');
  const [helpError, setHelpError] = useState('');
  const openHelp = async (topic: 'download' | 'connection' | 'logs') => {
    setHelpError('');
    try {
      const result = await window.pulse?.openSetupHelp(topic);
      if (!result?.ok) setHelpError('打开教程失败，请稍后重试。');
    } catch {
      setHelpError('打开教程失败，请检查系统默认浏览器。');
    }
  };
  return (
    <div className="nexo-import-layout">
      <div className="nexo-import-workspace">
        <div className="nexo-import-tabs" role="tablist" aria-label="设备资料导入渠道">
          <button type="button" id="astrobox-tab" role="tab" aria-selected={source === 'astrobox'} aria-controls="device-import-panel" onClick={() => setSource('astrobox')}>
            <Monitor size={16} /> AstroBox 导入
          </button>
          <button type="button" id="log-tab" role="tab" aria-selected={source === 'log'} aria-controls="device-import-panel" onClick={() => setSource('log')}>
            <FileText size={16} /> 手机日志导入
          </button>
        </div>
        <div id="device-import-panel" role="tabpanel" aria-labelledby={source === 'astrobox' ? 'astrobox-tab' : 'log-tab'}>
          {source === 'astrobox' ? <AstroBoxImport onSuccess={onSuccess} /> : <LogImportStep onSuccess={onSuccess} />}
        </div>
      </div>
      <aside className="nexo-import-guide" aria-label="导入操作教程">
        <div className="nexo-import-guide-heading"><BookOpen size={18} /><span>导入帮助</span></div>
        <ol>
          {source === 'astrobox' ? <>
            <li><strong>打开 AstroBox</strong><p>安装 Windows 版并保持运行。</p></li>
            <li><strong>登录并同步手环</strong><p>使用与小米运动健康相同的小米账号。</p></li>
            <li><strong>回到 Nexo 导入</strong><p>读取设备，批准授权后选择目标手环。</p></li>
          </> : <>
            <li><strong>手机同步手环</strong><p>在小米运动健康中完成同步。</p></li>
            <li><strong>导出并复制日志</strong><p>将日志压缩包或 .log 文件复制到电脑。</p></li>
            <li><strong>选择日志并保存</strong><p>导入后确认手环信息，继续连接。</p></li>
          </>}
        </ol>
        {source === 'astrobox' && <button type="button" onClick={() => openHelp('download')}><Download size={15} />下载 AstroBox<ExternalLink size={13} /></button>}
        <button type="button" onClick={() => openHelp(source === 'astrobox' ? 'connection' : 'logs')}>查看详细教程<ExternalLink size={13} /></button>
        <details className="setup-model-notes"><summary>支持型号与适配说明</summary><p>小米手环 9 / 10 / 11，标准版和 NFC 版。手环 9 已确认实机可用，其他型号待实机检验。</p></details>
        {helpError && <p className="nexo-import-error" role="alert">{helpError}</p>}
      </aside>
    </div>
  );
}
