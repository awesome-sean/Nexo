import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, Bluetooth, BluetoothOff, CircleDot, FileText, PackageCheck, Watch } from 'lucide-react';
import { identifyBandModel } from '../../../common/band-models';
import type { MinibarState } from '../../../common/types';
import type { UseBandConnectionResult } from '../../hooks/useBandConnection';
import type { QuotaDisplay } from '../../hooks/useQuotaDisplay';
import { Band9Preview } from './Band9Preview';
import { BandIllustration } from './BandIllustration';
import { QuickAppPage } from './QuickAppPage';
import { BandAppUpdateSection } from './BandAppUpdateSection';

type DeviceConfigStatus = Awaited<ReturnType<NonNullable<Window['pulse']>['getDeviceConfigStatus']>>;

interface Props {
  quota: MinibarState | null;
  display: QuotaDisplay;
  connection: UseBandConnectionResult;
  setupOpen: boolean;
  onStartSetup: (step?: number) => void;
}

export function BandDeskPage({ quota, display, connection, setupOpen, onStartSetup }: Props) {
  const [config, setConfig] = useState<DeviceConfigStatus | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [stageWidth, setStageWidth] = useState(560);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const readConfig = () => {
      if (!window.pulse) {
        setConfigError('设备服务尚未就绪');
        setConfigLoading(false);
        return;
      }
      setConfigLoading(true);
      window.pulse.getDeviceConfigStatus().then(value => {
        if (active) { setConfig(value); setConfigError(''); }
      }).catch(() => {
        if (active) setConfigError('读取手环资料失败，请重试');
      }).finally(() => { if (active) setConfigLoading(false); });
    };
    readConfig();
    window.addEventListener('focus', readConfig);
    return () => { active = false; window.removeEventListener('focus', readConfig); };
  }, [connection.state, setupOpen]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setStageWidth(Math.max(1, element.clientWidth - 40)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const connected = connection.state === 'connected';
  const connecting = connection.busy || ['starting', 'searching', 'connecting', 'authenticating'].includes(connection.state);
  const configured = Boolean(config?.exists && config.valid);
  const deviceName = connection.device?.name || config?.deviceName || '小米手环';
  const model = identifyBandModel(deviceName);
  const logicalWidth = model ? model.height * 192 / model.width : 490;
  const previewScale = Math.min(stageWidth / logicalWidth, 1.3);
  const statusLabel = connected ? '已连接' : connecting ? '正在连接' : connection.state === 'error' ? '连接失败' : '未连接';

  const disconnect = async () => {
    if (disconnecting) return;
    setDisconnecting(true);
    try { await connection.disconnect(); }
    finally { setDisconnecting(false); }
  };

  const connect = () => {
    if (configured) void connection.connect();
    else onStartSetup(0);
  };

  return <div className="workspace-band-page">
    <div className="workspace-band-grid">
      <section className="workspace-band-preview">
        <div className="workspace-card-header">
          <div className="nexo-section-heading"><Watch size={21} strokeWidth={1.7} /><h3>手环画面</h3></div>
          <span className="nexo-live-badge nexo-pill" data-connected={connected}><CircleDot size={13} />{connected ? display.fresh ? '额度已更新' : '等待额度数据' : '等待连接'}</span>
        </div>
        <div ref={stageRef} className="workspace-band-stage">
          {connected ? <div className="workspace-band-screen" style={{ width: logicalWidth * previewScale, height: 192 * previewScale }}>
            <div style={{ transform: 'scale(' + previewScale + ')', transformOrigin: 'top left' }}>
              <Band9Preview screenWidth={model?.width} screenHeight={model?.height} traffic={quota?.traffic?.state} trafficSnapshot={quota?.traffic}
                time={display.time} date={display.date} five={display.five} week={display.week}
                fiveReset={display.resetClock} weekReset={display.resetDate} cny={display.cny} partial={display.partial} />
            </div>
          </div> : <div className="workspace-unpaired-state">
            <div className="workspace-unpaired-emblem"><Watch size={52} strokeWidth={1.4} /><span><BluetoothOff size={19} /></span></div>
            <h4>{connecting ? '正在连接你的手环' : '连接你的手环桌搭'}</h4>
            <p>{connecting ? '请保持手环亮屏并靠近电脑' : '点击右侧「连接手环」，同步时间、额度与任务状态'}</p>
          </div>}
        </div>
        <div className="nexo-preview-caption"><span>{deviceName} · 横屏</span><span>15 秒同步周期</span></div>
      </section>

      <section className="workspace-device-card" data-connected={connected}>
        <div className="workspace-card-header"><h3>我的设备</h3><Bluetooth size={20} strokeWidth={1.7} /></div>
        {connected ? <div className="workspace-device-details">
          <div className="workspace-device-product"><BandIllustration model={model?.id} /></div>
          <div className="workspace-device-information">
            <h4>{deviceName}</h4>
            <span className="workspace-device-status"><span className="nexo-dot" />{statusLabel}</span>
            <dl><dt>蓝牙地址</dt><dd title={config?.maskedAddr}>{config?.maskedAddr || '读取中…'}</dd><dt>设备代号</dt><dd>{config?.codename || '--'}</dd></dl>
          </div>
        </div> : <div className="workspace-pairing-guide">
          <span className="workspace-pairing-icon"><Watch size={29} strokeWidth={1.5} /></span>
          <h4>{configured ? deviceName : '配置手环'}</h4>
          <p>{configured ? '连接资料已保存，下次一键连接' : '首次使用，三个步骤完成配置'}</p>
          <ol>
            {!configured && <li><FileText size={18} /><span>导入手环资料</span></li>}
            <li><Bluetooth size={18} /><span>{configured ? '点击下方按钮连接手环' : '连接蓝牙手环'}</span></li>
            <li><PackageCheck size={18} /><span>{configured ? '已安装 Nexo 时自动打开' : '安装后立即打开 Nexo'}</span></li>
          </ol>
          {configured && <div className="workspace-saved-config"><CircleDot size={15} /><span>更新快应用可在连接后单独操作</span></div>}
        </div>}
        {(connection.error || configError) && <p className="workspace-inline-error" role="alert"><AlertCircle size={16} />{connection.error || configError}</p>}
        <div className="workspace-device-actions">
          <button type="button" className={connected ? 'nexo-action nexo-action-secondary' : 'nexo-action btn-primary'}
            disabled={disconnecting || configLoading}
            onClick={connected || connecting ? () => void disconnect() : connect}>
            {disconnecting ? '处理中…' : configLoading ? '读取资料…' : connected ? '断开连接' : connecting ? '取消连接' : connection.state === 'error' ? '重试连接' : '连接手环'}<ArrowUpRight size={18} />
          </button>
          {configured && <button type="button" className="workspace-reconfigure" onClick={() => onStartSetup(0)}>重新配置</button>}
        </div>
      </section>
    </div>
    <BandAppUpdateSection />
    <QuickAppPage embedded />
  </div>;
}
