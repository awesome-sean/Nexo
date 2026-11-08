export interface CustomAgentSummary {
  id: string;
  name: string;
  icon: string;
  color: string;
  source: 'api' | 'cc-switch';
  apiOrigin?: string;
  apiTemplate?: ApiTemplate;
}

export type ApiTemplate =
  | 'auto'
  | 'json'
  | 'new-api'
  | 'sub2api'
  | 'deepseek'
  | 'openrouter';

export interface ManualApiDraft {
  id: string;
  endpoint: string;
  apiKey: string;
  template: ApiTemplate;
  userId?: string;
  unit?: string;
  remainingPath?: string;
  usedPath?: string;
  totalPath?: string;
  confirmedOrigin: string;
}

export interface UsagePlan {
  planName?: string;
  remaining?: number;
  used?: number;
  total?: number;
  unit?: string;
  extra?: string;
}

export interface CustomAgentSnapshot {
  plans: UsagePlan[];
  sampledAt?: number;
  error?: string;
  loading?: boolean;
}

export function usagePercent(plan?: UsagePlan): number | null {
  if (!plan || !(typeof plan.total === 'number' && plan.total > 0)) return null;
  const remaining =
    plan.remaining ??
    (plan.used === undefined ? undefined : plan.total - plan.used);
  return remaining === undefined
    ? null
    : Math.max(0, Math.min(100, (remaining / plan.total) * 100));
}

export function usageAmount(value?: number, unit?: string): string {
  if (value === undefined) return '—';
  const amount = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit === 'USD'
    ? '$' + amount
    : unit === 'CNY'
      ? '¥' + amount
      : amount + (unit ? ' ' + unit : '');
}
