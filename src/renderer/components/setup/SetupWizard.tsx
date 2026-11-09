import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, AlertCircle, ChevronRight, ChevronLeft, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  type SetupStepId,
  type StepStatus,
  type StepExecutionStatus,
  type SetupStep,
  INITIAL_SETUP_STEPS,
} from './types';
import { DeviceImportStep } from './DeviceImportStep';
import { ConnectBandStep } from './ConnectBandStep';
import { InstallAppStep } from './InstallAppStep';

export interface SetupWizardProps {
  onClose: () => void;
  onFinish?: () => void;
  /** 打开时直接落在第几步（0-based）。 */
  initialStepIndex?: number;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onClose, onFinish, initialStepIndex }) => {
  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    const max = INITIAL_SETUP_STEPS.length - 1;
    const start = typeof initialStepIndex === 'number' ? initialStepIndex : 0;
    return Math.min(Math.max(0, start), max);
  });
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const [stepError, setStepError] = useState<string | null>(null);

  // 严格记录每一步的真实执行状态，绝不根据访问顺序伪造成功标记
  const [stepExecution, setStepExecution] = useState<Partial<Record<SetupStepId, StepExecutionStatus>>>(() => {
    const initial: Partial<Record<SetupStepId, StepExecutionStatus>> = {
      import_log: 'pending',
      connect_band: 'pending',
      install_app: 'pending',
    };
    const start = typeof initialStepIndex === 'number' ? initialStepIndex : 0;
    const startId = INITIAL_SETUP_STEPS[start]?.id;
    if (startId) {
      initial[startId] = 'visited';
    }
    return initial;
  });

  // 挂载时检查本机已有真实配置与手环连接，如已真实就绪则标记为已成功
  useEffect(() => {
    let alive = true;
    window.pulse?.getDeviceConfigStatus?.()
      .then((status) => {
        if (alive && status?.exists && status?.valid) {
          setStepExecution((prev) => ({
            ...prev,
            import_log: 'success',
          }));
        }
      })
      .catch(() => {});

    window.pulse?.getCoreState?.()
      .then((s) => {
        if (alive && s?.connection?.state === 'connected') {
          setStepExecution((prev) => ({
            ...prev,
            connect_band: 'success',
          }));
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  // ---- 模态焦点管理（审查第 13 项）：打开迁入、Tab 约束在向导内、关闭后恢复触发元素 ----
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // 焦点先落在面板本身（tabIndex=-1，不显示焦点圈），Tab 从关闭按钮开始
    dialogRef.current?.focus();
    return () => {
      // 卸载（Esc / 关闭 / 完成）时把焦点还给打开向导的元素
      previousFocusRef.current?.focus?.();
    };
  }, []);

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const handleWizardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = dialogRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && panel.contains(active);
    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const steps: SetupStep[] = INITIAL_SETUP_STEPS.map((step, idx) => {
    const exec = stepExecution[step.id] || 'pending';
    let status: StepStatus = 'pending';
    if (exec === 'success') {
      status = 'completed';
    } else if (idx === currentIndex) {
      status = stepError ? 'error' : 'active';
    } else {
      status = 'pending';
    }
    return {
      ...step,
      executionStatus: exec,
      status,
      error: idx === currentIndex && stepError ? stepError : undefined,
    };
  });

  const currentStep = steps[currentIndex];
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === steps.length - 1;
  const currentExec = stepExecution[currentStep.id] || 'pending';
  const isCurrentSuccess = currentExec === 'success';

  // 这几个回调会作为 prop 交给子步骤。不包 useCallback 的话每次渲染都是新函数，
  // 子步骤里把它放进 effect 依赖就会跟着无限重渲染（见 ConnectBandStep 的说明）。
  const handleFinish = useCallback(
    () => {
      onFinish?.();
      onClose();
    },
    [onFinish, onClose]
  );

  const handleImportLogSuccess = useCallback(() => {
    setStepExecution((prev) => ({ ...prev, import_log: 'success' }));
    setCurrentIndex(1);
    setStepExecution((prev) => ({
      ...prev,
      connect_band: prev.connect_band === 'pending' ? 'visited' : prev.connect_band,
    }));
  }, []);

  const handleConnectBandSuccess = useCallback(() => {
    setStepExecution((prev) => ({ ...prev, connect_band: 'success' }));
    void (async () => {
      try {
        const bridge = window.pulse;
        if (!bridge?.appInstall) return;
        const [bundled, result] = await Promise.all([bridge.appInstall.getBundledInfo(), bridge.quickApps.list()]);
        if (!dialogRef.current?.isConnected || currentIndexRef.current !== 1) return;
        const packageId = bundled.packageId || 'com.codeisland.band';
        if (result.apps.some(app => app.package_name === packageId)) {
          onFinish?.();
          onClose();
        } else {
          setCurrentIndex(2);
        }
      } catch {
        setStepError('连接已成功，读取安装状态失败。可关闭向导，在桌搭页刷新版本。');
      }
    })();
  }, [onFinish, onClose]);

  const handleInstallAppSuccess = useCallback(() => {
    setStepExecution((prev) => ({ ...prev, install_app: 'success' }));
  }, []);

  const handleNext = () => {
    setStepError(null);
    if (isLastStep) {
      if (isCurrentSuccess) {
        handleFinish();
      } else {
        setStepExecution((prev) => ({
          ...prev,
          [currentStep.id]: prev[currentStep.id] === 'success' ? 'success' : 'skipped',
        }));
        handleFinish();
      }
    } else {
      // 未确认成功的步骤在跳往下一步时标记为已跳过
      if (!isCurrentSuccess) {
        setStepExecution((prev) => ({
          ...prev,
          [currentStep.id]: prev[currentStep.id] === 'success' ? 'success' : 'skipped',
        }));
      }
      const nextIndex = Math.min(steps.length - 1, currentIndex + 1);
      setCurrentIndex(nextIndex);
      const nextStep = INITIAL_SETUP_STEPS[nextIndex];
      if (nextStep) {
        setStepExecution((prev) => ({
          ...prev,
          [nextStep.id]: prev[nextStep.id] === 'pending' ? 'visited' : prev[nextStep.id],
        }));
      }
    }
  };

  const handlePrev = () => {
    setStepError(null);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };

  const handleStepClick = (index: number) => {
    setStepError(null);
    setCurrentIndex(index);
    const targetStep = INITIAL_SETUP_STEPS[index];
    if (targetStep) {
      setStepExecution((prev) => ({
        ...prev,
        [targetStep.id]: prev[targetStep.id] === 'pending' ? 'visited' : prev[targetStep.id],
      }));
    }
  };

  const renderStepContent = (step: SetupStep) => {
    if (step.id === 'import_log') return <DeviceImportStep onSuccess={handleImportLogSuccess} />;
    if (step.id === 'connect_band') return <ConnectBandStep onSuccess={handleConnectBandSuccess} />;
    if (step.id === 'install_app') return <InstallAppStep onSuccess={handleInstallAppSuccess} />;
    return null;
  };

  return createPortal(
    <div className="nexo-setup-overlay setup-overlay no-drag" onKeyDown={handleWizardKeyDown}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="手环配置向导" className="nexo-setup-dialog setup-dialog">
        <div className="setup-progress-header">
          <nav className="setup-progress" aria-label="手环配置进度">
            {steps.map((step, index) => <button type="button" key={step.id} onClick={() => handleStepClick(index)} aria-current={index === currentIndex ? 'step' : undefined} data-completed={step.executionStatus === 'success'}>
              <span className="setup-progress-track" aria-hidden="true" />
              <span className="setup-progress-label"><span>{step.executionStatus === 'success' ? <CheckCircle2 size={16} /> : String(index + 1).padStart(2, '0')}</span>{step.shortLabel}</span>
            </button>)}
          </nav>
          <button type="button" className="setup-close no-drag" onClick={onClose} aria-label="关闭向导" title="关闭向导"><X size={23} aria-hidden="true" /></button>
        </div>
        <main className="nexo-setup-content setup-content custom-scrollbar">
          <div className="setup-step-heading"><h2>{currentStep.title}</h2><span>{currentIndex + 1} / {steps.length}</span></div>
          {currentStep.status === 'error' && currentStep.error && <p className="setup-error" role="alert"><AlertCircle size={18} />{currentStep.error}</p>}
          {renderStepContent(currentStep)}
        </main>
        <div className="setup-footer">
          <button type="button" className="setup-back" disabled={isFirstStep} onClick={handlePrev}><ChevronLeft size={17} />上一步</button>
          <button type="button" className={isCurrentSuccess ? 'setup-next btn-primary' : 'setup-next'} onClick={handleNext}>
            {isLastStep ? '完成' : isCurrentSuccess ? '下一步' : '跳过此步'}{isLastStep ? null : <ChevronRight size={17} />}
          </button>
        </div>
      </div>
    </div>, document.body
  );
};
