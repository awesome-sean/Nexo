import { identifyBandModel } from '../../../common/band-models';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { AlertCircle, Settings2, FileText, Bluetooth, PackageCheck, ArrowUpRight } from 'lucide-react';
import { useBandConnection } from '../../hooks/useBandConnection';
import type { ProgressStep } from './ConnectionProgress';
import { INITIAL_SETUP_STEPS } from '../setup/types';
import { BandIllustration } from './BandIllustration';

/** 卡内单按钮：尺寸与标题行「配置手环」一致，宽度自适应左对齐（评审 P1-B） */
const SOLID_BTN =
  'btn-primary rounded-full px-[15px] py-2 text-[12px] font-semibold select-none min-w-[104px] flex items-center justify-center gap-1.5 bg-[var(--accent-primary)] text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const OUTLINE_BTN =
  'rounded-full px-[15px] py-2 text-[12px] font-semibold select-none min-w-[104px] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-secondary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export interface BandManagementPageProps {
  onStartSetup?: (stepIndex?: number) => void;
}

/** 连接状态 → 五步进度条中的位置；未开始 / 失败 → null */
const CONN_STEP: Record<string, ProgressStep | null> = {
  starting: 'starting',
  searching: 'searching',
  connecting: 'connecting',
  authenticating: 'authenticating',
  connected: 'connected',
  idle: null,
  disconnected: null,
  error: null,
};

const STEP_LABELS: Record<ProgressStep, string> = {
  starting: '启动服务',
  searching: '查找手环',
  connecting: '建立连接',
  authenticating: '验证身份',
  connected: '已连接',
};

/**
 * 只有"进行中"的步骤才能被当作失败步骤名。
 *
 * 之前直接取最近一次活跃步骤，于是"已连接 → 链路断开 → error"这条路径会得到
 * failedStep='connected'，界面写出「连接失败于【已连接】」这种自相矛盾的文案。
 * connected 是终态，不是失败点，排除掉；排除后没有已知步骤就不写步骤名。
 */
const FAILABLE_STEPS: readonly ProgressStep[] = ['starting', 'searching', 'connecting', 'authenticating'];

/**
 * 磁盘上的手环配置状态（%LOCALAPPDATA%/Nexo/PulseDev/run/device.json）。
 *
 * 「是否已配置」的唯一权威来源。不能拿 conn.device 判断 —— 见下面的注释。
 */
interface DeviceConfigStatus {
  exists: boolean;
  valid: boolean;
  deviceName?: string;
  maskedAddr?: string;
  codename?: string;
  error?: string;
}

export const BandManagementPage: React.FC<BandManagementPageProps> = ({ onStartSetup }) => {
  // 手环设备信息（名称 / 地址 / 连接状态）来自 useBandConnection 的真实快照
  const conn = useBandConnection();


  const [disconnecting, setDisconnecting] = useState(false);

  // 磁盘上的配置状态 —— 「已配置」的权威来源，与"当前是否连着"无关
  const [config, setConfig] = useState<DeviceConfigStatus | null>(null);

  // 记录最近一次进行中的步骤，连接出错时可精准提示失败于哪一步
  const lastActiveStepRef = useRef<ProgressStep | null>(null);
  const step = CONN_STEP[conn.state] ?? null;
  if (step) {
    lastActiveStepRef.current = step;
  }
  const lastStep = lastActiveStepRef.current;
  const failedStep =
    conn.state === 'error' && lastStep && FAILABLE_STEPS.includes(lastStep) ? lastStep : null;

  /**
   * 读磁盘上的配置状态。
   *
   * 「是否已配置」不能用 conn.device 判断：core 的 device.status 在未连接时把 device
   * 直接置为 null（core/src/live.rs:1056 `if connected { live_device_json() } else { Null }`），
   * pulse-core-bridge 的 safeDevice(null) 同样返回 null。于是拿 conn.device 当"已配置"
   * 会把「断开」误判成「尚未配置」—— 已配对的用户一断开就被推回配置向导，
   * 而向导第 1 步是「导入手机日志」、第 2 步才是「连接手环」，
   * 表现成"想连手环必须先点配置手环"。
   *
   * 配置本身确实是连接的技术前提（core/src/live.rs:551 `read_device_auth_mac()?`
   * 需要 device.json 里的 addr 与 32 位 authkey），所以未配置时只给「配置手环」是对的；
   * 错的只是把"已配置"和"当前连着"混为一谈。
   *
   * 重读时机：挂载时、连接状态变化后（向导内连上会触发）、窗口重新获得焦点时
   * （向导是覆盖层，本页不卸载，关闭向导后靠 focus 兜底）。
   */
  const readConfig = useCallback(() => {
    window.pulse
      ?.getDeviceConfigStatus?.()
      .then((s) => {
        if (s) setConfig(s);
      })
      .catch(() => {
        /* IPC 不可用时保持上一次结果，不把"未知"当成"未配置" */
      });
  }, []);

  useEffect(() => {
    readConfig();
  }, [readConfig, conn.state]);

  useEffect(() => {
    window.addEventListener('focus', readConfig);
    return () => window.removeEventListener('focus', readConfig);
  }, [readConfig]);

  const isConnected = conn.state === 'connected';
  const isConnecting = conn.state === 'connecting';
  const isError = conn.state === 'error';

  const handleDisconnect = useCallback(async () => {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      await conn.disconnect();
    } finally {
      setDisconnecting(false);
    }
  }, [conn.disconnect, disconnecting]);

  // 「已配置」看磁盘，不看连接状态 —— 断开手环不会取消配置
  const configKnown = config !== null;
  const isConfigured = Boolean(config?.exists && config?.valid);

  const deviceName = config?.deviceName ?? conn.device?.name ?? '已配对手环';
  // 脱敏地址由主进程 maskMacAddress 给出，渲染层不再自己截断一份
  const addressLabel = config?.maskedAddr ?? null;

  const cardTitle = !configKnown
    ? '手环'
    : isConfigured
    ? deviceName
    : config?.exists
    ? '手环配置无效'
    : '尚未配置手环';

  const connectionLabel = isConnected
    ? '已连接'
    : isConnecting
    ? '正在连接'
    : isError
    ? '连接失败'
    : isConfigured
    ? '未连接'
    : '未配置';

  return (
    <div className="nexo-page nexo-band-page">
      {/* 标题行 */}
      <div className="nexo-page-header">
        <div>
          <h2 className="nexo-page-title">手环</h2>
        </div>
      </div>

      <div className="nexo-band-grid">
      {/* Device state and connection actions share the existing connection hook. */}
      <section className="nexo-band-device-card rounded-[12px] p-5 flex flex-col gap-4">
        <div className="nexo-band-identity">
          {/* 左：静态产品图。屏幕内容属于示意，不表达当前真实表盘或连接状态。 */}
          <div className="min-w-0">
            <BandIllustration dimmed={!isConfigured} model={identifyBandModel(deviceName)?.id} />
          </div>

          {/* 右：设备身份、硬件标识、连接状态与唯一主操作。 */}
          <div className="min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2.5 min-w-0">
              <h3 className="text-[16px] leading-tight font-semibold text-[var(--text-primary)] truncate">
                {cardTitle}
              </h3>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-1 text-[10.5px] font-medium text-[var(--text-secondary)] shrink-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isConnected
                      ? 'bg-[var(--status-success)]'
                      : isConnecting
                      ? 'bg-[var(--status-working)]'
                      : isError
                      ? 'bg-[var(--status-error)]'
                      : 'bg-[var(--status-idle)]'
                  }`}
                />
                {connectionLabel}
              </span>
            </div>

            {isConfigured ? (
              <dl className="nexo-band-device-details mt-5 grid gap-3 border-y border-[var(--border-default)] py-4">
                <div className="min-w-0">
                  <dt className="text-[10.5px] text-[var(--text-muted)]">蓝牙地址</dt>
                  <dd className="mt-1 text-[12px] font-medium text-[var(--text-primary)] tabular-nums truncate">
                    {addressLabel ?? '暂未读取'}
                  </dd>
                </div>
                {config?.codename && (
                  <div className="min-w-0">
                    <dt className="text-[10.5px] text-[var(--text-muted)]">设备代号</dt>
                    <dd className="mt-1 text-[12px] font-medium text-[var(--text-primary)] truncate">
                      {config.codename}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-3 max-w-[340px] text-[11.5px] text-[var(--text-muted)] leading-relaxed">
                {!configKnown
                  ? '正在读取本机手环配置…'
                  : config?.error ?? '从 AstroBox 或手机日志导入连接资料后，即可连接手环。'}
              </p>
            )}

            {/* Configuration is available from the adjacent setup card. */}
            <div className="mt-5 flex">
              {!configKnown ? (
                /* 配置状态还没读回来：不给任何可点动作，避免把"未知"渲染成"未配置" */
                <button type="button" disabled className={`${SOLID_BTN} opacity-50 cursor-not-allowed`}>
                  读取配置中…
                </button>
              ) : !isConfigured ? null : isConnecting ? (
                /* 取消 = 放弃本次连接，复用 device.disconnect，与断开同一个原语 */
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={disconnecting}
                  className={OUTLINE_BTN}
                >
                  取消
                </button>
              ) : isConnected ? (
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={disconnecting}
                  className={OUTLINE_BTN}
                >
                  断开连接
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void conn.connect()}
                  disabled={!conn.canConnect}
                  className={SOLID_BTN}
                >
                  {isError ? '重试连接' : '连接手环'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 五步进度条只在"连接中"和"连接失败"时出现，其余状态一行都不占 */}


        {/* 连接失败诊断：失败于哪一步 + 底层原因。失败原因是这里的主信息，不截断 */}
        {isError && (
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-[var(--status-error)] shrink-0 mt-0.5" />
            <div className="text-[11.5px] min-w-0">
              <p className="font-semibold text-[var(--status-error)]">
                {failedStep ? `连接失败于【${STEP_LABELS[failedStep]}】` : '连接失败'}
              </p>
              <p className="text-[var(--text-muted)] mt-0.5 leading-relaxed">
                {conn.error || '无法与手环建立蓝牙通讯，请确认手环在附近且蓝牙已开启'}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="nexo-band-setup-card">
        <div className="nexo-band-setup-icon"><Settings2 size={23} strokeWidth={1.6} /></div>
        <h3>配置手环</h3>
        <p>导入连接资料，安装快应用</p>
        <ol className="nexo-band-setup-steps">
          <li><FileText size={16} /><span>AstroBox 或手机日志导入</span></li>
          <li><Bluetooth size={16} /><span>连接蓝牙手环</span></li>
          <li><PackageCheck size={16} /><span>安装应用并验证显示</span></li>
        </ol>
        <button type="button" onClick={() => onStartSetup?.()} className="nexo-action btn-primary">
          {isConfigured ? '重新配置' : '开始配置'}<ArrowUpRight size={15} />
        </button>
      </section>
      </div>

      <section className="nexo-band-setup-flow" aria-label="手环设置流程">
        <header>
          <div className="nexo-section-heading"><Settings2 size={22} /><h3>手环设置流程</h3></div>
          <button type="button" className="btn-primary nexo-action" onClick={() => onStartSetup?.(0)}>开始设置<ArrowUpRight size={16} /></button>
        </header>
        <ol>
          {INITIAL_SETUP_STEPS.map((setupStep, index) => (
            <li key={setupStep.id}>
              <button type="button" onClick={() => onStartSetup?.(index)}>
                <span>{index + 1}</span><strong>{setupStep.shortLabel}</strong><ArrowUpRight size={16} />
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};
