import { safeStorage } from 'electron';
import type {
  ApiTemplate,
  CustomAgentSnapshot,
  ManualApiDraft,
  UsagePlan,
} from '../../common/custom-agents';

interface SavedSource extends ManualApiDraft {
  origin: string;
}
type Bindings = Record<string, { apiOrigin: string; apiTemplate: ApiTemplate }>;
interface Store {
  load(): string | undefined;
  save(encrypted: string, bindings: Bindings): void;
  changed(): void;
}

const templates: ApiTemplate[] = [
  'auto',
  'json',
  'new-api',
  'sub2api',
  'deepseek',
  'openrouter',
];

export function validateManualSource(
  draft: ManualApiDraft,
  previous?: SavedSource,
): SavedSource {
  if (
    !draft ||
    typeof draft.id !== 'string' ||
    !/^custom-[a-zA-Z0-9_-]+$/.test(draft.id)
  )
    throw new Error('Agent 标识无效');
  const endpoint = draft.endpoint?.trim() || previous?.endpoint || '';
  const url = new URL(endpoint);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('请填写有效的 HTTP 或 HTTPS 服务地址');
  if (draft.confirmedOrigin !== url.origin)
    throw new Error('请确认密钥发送的目标域名');
  if (!templates.includes(draft.template))
    throw new Error('请选择支持的查询模板');
  const apiKey = draft.apiKey || previous?.apiKey || '';
  if (!apiKey.trim() || /[\r\n]/.test(apiKey))
    throw new Error('请输入有效密钥');
  if (draft.template === 'new-api' && !(draft.userId || previous?.userId))
    throw new Error('New API 查询需要用户 ID');
  return {
    id: draft.id,
    endpoint: url.toString(),
    origin: url.origin,
    confirmedOrigin: url.origin,
    apiKey,
    template: draft.template,
    userId: draft.userId || previous?.userId,
    unit: (draft.unit || previous?.unit || 'USD').slice(0, 20),
    remainingPath:
      draft.remainingPath?.trim() || previous?.remainingPath || 'balance',
    usedPath: draft.usedPath?.trim() || previous?.usedPath,
    totalPath: draft.totalPath?.trim() || previous?.totalPath,
  };
}

function numeric(value: unknown, allowNegative = false): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) && (allowNegative || number >= 0)
    ? number
    : undefined;
}

function field(data: any, path?: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce((value, key) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      return undefined;
    return value && typeof value === 'object' && Object.hasOwn(value, key)
      ? value[key]
      : undefined;
  }, data);
}

export function extractManualUsage(
  data: any,
  source: Pick<
    SavedSource,
    'template' | 'unit' | 'remainingPath' | 'usedPath' | 'totalPath'
  >,
): UsagePlan[] {
  if (
    !data ||
    typeof data !== 'object' ||
    data.success === false ||
    data.isValid === false
  )
    throw new Error('接口返回无效额度');
  let plans: UsagePlan[];
  if (source.template === 'auto') {
    const template = data.balance_infos ? 'deepseek' : data.data?.total_credits !== undefined ? 'openrouter' : data.data?.quota !== undefined ? 'new-api' : data.quota ? 'sub2api' : 'json';
    const remainingPath = ['balance','data.balance','remaining','data.remaining'].find(path => field(data,path) !== undefined) || source.remainingPath;
    return extractManualUsage(data,{...source,template,remainingPath});
  }
  switch (source.template) {
    case 'new-api': {
      const remaining = numeric(data.data?.quota, true);
      const used = numeric(data.data?.used_quota);
      plans = [
        {
          remaining: remaining === undefined ? undefined : remaining / 500000,
          used: used === undefined ? undefined : used / 500000,
          total:
            remaining === undefined || used === undefined
              ? undefined
              : (remaining + used) / 500000,
          unit: 'USD',
        },
      ];
      break;
    }
    case 'sub2api':
      plans = [
        {
          remaining: numeric(data.remaining),
          used: numeric(data.quota?.used),
          total: numeric(data.quota?.limit),
          unit:
            typeof data.unit === 'string'
              ? data.unit.slice(0, 20)
              : source.unit,
          planName:
            typeof data.planName === 'string'
              ? data.planName.slice(0, 80)
              : undefined,
          extra: data.remaining === -1 ? '无限额' : undefined,
        },
      ];
      break;
    case 'deepseek':
      plans = (Array.isArray(data.balance_infos) ? data.balance_infos : []).map(
        (item: any) => ({
          remaining: numeric(item.total_balance, true),
          unit:
            typeof item.currency === 'string'
              ? item.currency.slice(0, 20)
              : source.unit,
        }),
      );
      break;
    case 'openrouter':
      plans = [
        {
          total: numeric(data.data?.total_credits),
          used: numeric(data.data?.total_usage),
          unit: 'USD',
        },
      ];
      break;
    default:
      plans = [
        {
          remaining: numeric(field(data, source.remainingPath) ?? data.balance ?? data.data?.balance ?? data.remaining ?? data.data?.remaining, true),
          used: numeric(field(data, source.usedPath)),
          total: numeric(field(data, source.totalPath)),
          unit: source.unit,
        },
      ];
  }
  for (const plan of plans) {
    if (
      plan.remaining === undefined &&
      plan.total !== undefined &&
      plan.used !== undefined
    )
      plan.remaining = Math.max(0, plan.total - plan.used);
  }
  if (
    !plans.length ||
    plans.every(
      (plan) =>
        plan.remaining === undefined &&
        plan.used === undefined &&
        plan.total === undefined &&
        !plan.extra,
    )
  )
    throw new Error('接口没有有效额度字段，请检查模板和字段路径');
  return plans;
}

export async function fetchManualUsage(
  source: SavedSource,
  fetcher: typeof fetch = fetch,
): Promise<UsagePlan[]> {
  if (source.template === 'auto') {
    const host = new URL(source.endpoint).hostname;
    const template = host === 'api.deepseek.com' ? 'deepseek' : host === 'openrouter.ai' ? 'openrouter' : 'json';
    const endpoint = new URL(source.endpoint);
    if (template === 'json' && /^\/?(?:v1\/?)?$/.test(endpoint.pathname)) endpoint.pathname='/v1/usage';
    if (template !== 'json') return fetchManualUsage({...source,template},fetcher);
    const plans = await fetchManualUsage({...source,endpoint:endpoint.toString(),template:'json'},fetcher);
    return plans;
  }
  const root = new URL(source.endpoint);
  if (root.origin !== source.confirmedOrigin)
    throw new Error('数据源域名尚未确认');
  const endpoint = new URL(source.endpoint);
  let base = endpoint.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  if (source.template === 'openrouter') base = base.replace(/\/api$/, '');
  const paths: Partial<Record<ApiTemplate, string>> = {
    'new-api': '/api/user/self',
    sub2api: '/v1/usage',
    deepseek: '/user/balance',
    openrouter: '/api/v1/credits',
  };
  if (paths[source.template]) {
    endpoint.pathname = base + paths[source.template];
    endpoint.search = '';
  }
  if (endpoint.origin !== source.confirmedOrigin)
    throw new Error('查询域名与已确认域名不一致');
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + source.apiKey,
    Accept: 'application/json',
  };
  if (source.template === 'new-api') headers['New-Api-User'] = source.userId!;
  const response = await fetcher(endpoint, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('额度接口返回 HTTP ' + response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('额度接口返回空响应');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) throw new Error('额度响应过大');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return extractManualUsage(
    JSON.parse(Buffer.concat(chunks).toString('utf8')),
    source,
  );
}

/** Credentials come only from the user's source form and stay encrypted in the main process. */
export class ManualApiSourceService {
  private records = new Map<string, SavedSource>();
  private snapshots: Record<string, CustomAgentSnapshot> = {};
  private queue = new Set<string>();
  private active = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;
  private loadError = false;

  constructor(
    private store: Store,
    private fetcher: typeof fetch = fetch,
  ) {
    const encrypted = store.load();
    if (encrypted) {
      try {
        const rows = JSON.parse(
          safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
        );
        if (!Array.isArray(rows)) throw new Error('Invalid source records');
        for (const row of rows)
          this.records.set(row.id, validateManualSource(row));
      } catch {
        this.loadError = true;
      }
    }
  }

  state(ids: string[] = []): Record<string, CustomAgentSnapshot> {
    if (this.loadError)
      return Object.fromEntries(
        ids.map((id) => [
          id,
          {
            plans: [],
            error: '数据源凭据无法解密，请使用原 Windows 用户打开 Nexo',
          },
        ]),
      );
    return this.snapshots;
  }
  start(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 5 * 60000);
  }

  private encode(records: Map<string, SavedSource>): string {
    if (this.loadError)
      throw new Error('已保存的数据源无法解密，请使用原 Windows 用户打开 Nexo');
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('系统凭据加密尚未就绪');
    return safeStorage
      .encryptString(JSON.stringify([...records.values()]))
      .toString('base64');
  }

  retain(ids: string[]): string | undefined {
    const retained = new Map(
      [...this.records].filter(([id]) => ids.includes(id)),
    );
    return retained.size === this.records.size
      ? undefined
      : this.encode(retained);
  }

  prune(ids: string[]): void {
    for (const id of this.records.keys())
      if (!ids.includes(id)) {
        this.records.delete(id);
        this.queue.delete(id);
        delete this.snapshots[id];
      }
  }

  async testConnection(draft: ManualApiDraft): Promise<{message: string}> {
    const source = validateManualSource(draft,this.records.get(draft.id));
    if (source.template !== 'auto') {
      await fetchManualUsage(source,this.fetcher);
      return {message:'连接成功，已读取额度数据'};
    }
    const endpoint = new URL(source.endpoint);
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/models';
    endpoint.search='';
    const response = await this.fetcher(endpoint,{method:'GET',headers:{Authorization:'Bearer '+source.apiKey,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
    await response.body?.cancel();
    if (!response.ok) throw new Error('连接失败，HTTP '+response.status);
    return {message:'连接成功，模型接口可访问。余额查询需服务商提供用量接口。'};
  }

  configure(draft: ManualApiDraft): void {
    const record = validateManualSource(draft, this.records.get(draft.id));
    const records = new Map(this.records).set(record.id, record);
    const bindings = Object.fromEntries(
      [...records.values()].map((item) => [
        item.id,
        { apiOrigin: item.origin, apiTemplate: item.template },
      ]),
    );
    this.store.save(this.encode(records), bindings);
    this.records = records;
    this.snapshots[record.id] = { plans: [], loading: true };
    this.refresh(record.id);
  }

  refresh(id?: string): void {
    if (this.disposed || this.loadError) return;
    for (const record of this.records.values()) {
      if (id && record.id !== id) continue;
      if (this.active.has(record.id)) continue;
      this.queue.add(record.id);
      this.snapshots[record.id] = {
        ...this.snapshots[record.id],
        plans: this.snapshots[record.id]?.plans ?? [],
        loading: true,
      };
    }
    this.store.changed();
    this.drain();
  }

  private drain(): void {
    while (!this.disposed && this.active.size < 3 && this.queue.size) {
      const id = this.queue.values().next().value!;
      this.queue.delete(id);
      const record = this.records.get(id);
      if (!record) continue;
      this.active.add(id);
      void fetchManualUsage(record, this.fetcher)
        .then((plans) => {
          if (this.records.get(id) === record)
            this.snapshots[id] = { plans, sampledAt: Date.now() };
        })
        .catch(() => {
          if (this.records.get(id) === record)
            this.snapshots[id] = {
              plans: [],
              error: '额度查询失败，请检查服务地址、密钥及模板',
            };
        })
        .finally(() => {
          this.active.delete(id);
          if (this.disposed) return;
          this.store.changed();
          if (this.records.has(id) && this.records.get(id) !== record)
            this.refresh(id);
          this.drain();
        });
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.queue.clear();
  }
}
