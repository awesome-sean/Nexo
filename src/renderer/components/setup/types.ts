import type { SetupStepId, SetupStepStatus } from '../../../common/types';

export type {
  SetupStatus,
  SetupStepId,
  SetupStepStatus,
  SetupStepState,
  SetupError,
  SetupState,
  SetupAction,
  LogImportStatus,
  LogImportState,
  InstallAppStatus,
  InstallAppState,
  VerifyQuotaStatus,
  VerifyQuotaState,
} from '../../../common/types';

/** 向后兼容现有 SetupWizard 内部引用的别名 */
export type StepStatus = SetupStepStatus;

/**
 * 步骤真实执行结果状态：
 * - pending: 尚未访问过
 * - visited: 已访问但未完成
 * - skipped: 用户主动选择跳过稍后配置
 * - success: 真实操作已成功确认
 */
export type StepExecutionStatus = 'pending' | 'visited' | 'skipped' | 'success';

export interface SetupStep {
  id: SetupStepId;
  index: number;
  title: string;
  shortLabel: string;
  description: string;
  status: SetupStepStatus;
  executionStatus?: StepExecutionStatus;
  error?: string;
}

export const INITIAL_SETUP_STEPS: SetupStep[] = [
  {
    id: 'import_log',
    index: 1,
    title: '导入手环资料',
    shortLabel: '导入资料',
    description: '选择 AstroBox 或手机日志，导入目标手环的连接资料。',
    status: 'active',
  },
  {
    id: 'connect_band',
    index: 2,
    title: '连接手环',
    shortLabel: '连接手环',
    description: '通过蓝牙 RFCOMM 建立安全连接并验证鉴权握手。',
    status: 'pending',
  },
  {
    id: 'install_app',
    index: 3,
    title: '安装手环应用',
    shortLabel: '安装应用',
    description: '一键将配套的 Nexo 手环端快应用推送到手环。',
    status: 'pending',
  },
  {
    id: 'verify_quota',
    index: 4,
    title: '验证额度',
    shortLabel: '确认显示',
    description: '检查电脑端额度数据获取，并在手环端确认卡片展示正常。',
    status: 'pending',
  },
];
