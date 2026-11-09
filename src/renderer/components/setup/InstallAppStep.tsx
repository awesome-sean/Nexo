import { userFacingError } from '../../../common/user-facing-error';
import React, { useCallback, useEffect, useState } from 'react';
import { PackageCheck, Loader2, AlertCircle, XCircle, CheckCircle2 } from 'lucide-react';
import type { InstallProgressEvent, SetupError } from '../../../common/types';

export interface InstallAppStepProps {
  initialState?: {
    status?: string;
    error?: SetupError;
  };
  onSuccess?: () => void;
}

interface BundledInfo {
  exists: boolean;
  packageId?: string;
  versionName?: string;
  versionCode?: number;
  fileSize?: number;
  manifestValid?: boolean;
}

type StepState = 'idle' | 'installing' | 'done' | 'failed';

/**
 * 向导第 3 步：一键安装内置的 Nexo 手环端快应用。
 *
 * 内置包随桌面端发布，用户不需要选择文件。点击后一次完成
 * prepare -> 全部分块 -> commit，结束条件只有 pulse-core 依据真实设备结果
 * 返回的 coreStatus === 'completed'，否则一律按未完成处理。
 */
export const InstallAppStep: React.FC<InstallAppStepProps> = ({ onSuccess }) => {
  const [bundled, setBundled] = useState<BundledInfo | null>(null);
  const [state, setState] = useState<StepState>('idle');
  const [percentage, setPercentage] = useState<number>(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    window.pulse?.appInstall
      ?.getBundledInfo?.()
      .then((info) => {
        if (alive && info) setBundled(info as BundledInfo);
      })
      .catch(() => {
        if (alive) setBundled({ exists: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.pulse?.appInstall?.onProgress?.((ev: InstallProgressEvent) => {
      if (typeof ev.percentage === 'number') setPercentage(ev.percentage);
    });
    return () => unsubscribe?.();
  }, []);

  const install = useCallback(async () => {
    setState('installing');
    setPercentage(0);
    setMessage(null);
    try {
      const res = await window.pulse?.appInstall?.installBundled?.();
      if (!res) {
        setState('failed');
        setMessage({ ok: false, text: '安装接口不可用' });
        return;
      }
      if (res.coreStatus === 'completed') {
        setState('done');
        setMessage({
          ok: true,
          text: '设备已确认 Nexo 快应用安装完成',
        });
        onSuccess?.();
      } else {
        setState('failed');
        setMessage({
          ok: false,
          text: `设备未确认安装完成（core 状态：${res.coreStatus ?? 'unknown'}）`,
        });
      }
    } catch (err: any) {
      setState('failed');
      setMessage({ ok: false, text: err?.message ?? '安装失败' });
    }
  }, []);

  const missing = bundled !== null && bundled.exists !== true;
  const canInstall = bundled?.exists === true && state !== 'installing';

  return (
    <div className="space-y-4">


      <div className="setup-install-summary">
        <PackageCheck size={32} />
        <div><strong>Nexo 快应用</strong>{bundled === null ? <p>读取安装包…</p> : missing ? <p role="alert">安装包暂不可用，请重新安装桌面端。</p> : <p>版本 {bundled.versionName ?? '未知'} · {((bundled.fileSize ?? 0) / 1024 / 1024).toFixed(1)} MB</p>}</div>
      </div>

      {/* 一键安装动作 */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={install}
          disabled={!canInstall}
          className="w-full px-4 py-2.5 rounded-[var(--radius-md)] bg-[var(--accent-primary)] text-white text-xs font-medium transition-colors shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
        >
          {state === 'installing' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <PackageCheck className="w-3.5 h-3.5" />
          )}
          <span>
            {state === 'installing'
              ? `正在安装… ${percentage}%`
              : state === 'done'
              ? '重新安装'
              : '一键安装到手环'}
          </span>
        </button>

        {missing && (
          <p className="text-xs text-[var(--status-error)] flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>内置安装包缺失，无法安装。请重新安装 Nexo 桌面端。</span>
          </p>
        )}

        {message && (
          <p
            className={`text-xs leading-relaxed flex items-start gap-1.5 ${
              message.ok ? 'text-emerald-400' : 'text-[var(--status-error)]'
            }`}
          >
            {message.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            )}
            <span>{userFacingError(message.text)}</span>
          </p>
        )}

        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          安装前请先在「手环」页连接手环；未连接时安装会失败。
        </p>
      </div>
    </div>
  );
};
