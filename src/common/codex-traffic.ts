export type TrafficState = 'idle' | 'working' | 'waiting' | 'done';
export type TrafficSource = 'hook' | 'cli' | 'session';
export type TrafficWaitReason = 'approval' | 'input' | 'quota';
export const DONE_DURATION_MS = 10 * 60_000;
export const TRAFFIC_COLORS: Record<TrafficState, string> = {
  idle: 'transparent', working: '#F2CF4A', waiting: '#F04452', done: '#24CE87',
};
export const TRAFFIC_LABELS: Record<TrafficState, string> = {
  idle: '空闲待命', working: '正在工作', waiting: '需要你介入', done: '任务已完成',
};
export interface TrafficTask {
  id: string;
  sessionId: string;
  state: TrafficState;
  source: TrafficSource;
  updatedAt: number;
  workspace?: string;
  waitReason?: TrafficWaitReason;
}
export interface TrafficSnapshot {
  state: TrafficState;
  sampledAt: number;
  counts: Record<TrafficState, number>;
  expiresAt: number | null;
}
export interface TrafficEvent {
  id: string;
  sessionId: string;
  state?: TrafficState;
  source: TrafficSource;
  at: number;
  workspace?: string;
  clear?: boolean;
  endSession?: boolean;
  quit?: boolean;
  waitReason?: TrafficWaitReason;
  hookEvent?: string;
}
export function isTrafficState(value: unknown): value is TrafficState {
  return value === 'idle' || value === 'working' || value === 'waiting' || value === 'done';
}
export function aggregateTraffic(tasks: Iterable<TrafficTask>, now = Date.now()): TrafficSnapshot {
  const counts = {idle:0, working:0, waiting:0, done:0};
  let expiresAt: number | null = null;
  for (const task of tasks) {
    if (task.state === 'done') {
      const expiry = task.updatedAt + DONE_DURATION_MS;
      if (expiry <= now) continue;
      expiresAt = Math.max(expiresAt ?? 0, expiry);
    }
    counts[task.state]++;
  }
  const state = counts.waiting ? 'waiting' : counts.working ? 'working' : counts.done ? 'done' : 'idle';
  return {state, counts, sampledAt:now, expiresAt:state === 'done' ? expiresAt : null};
}
export function applyTrafficEvent(tasks: Map<string, TrafficTask>, event: TrafficEvent): void {
  if (event.clear) { for (const [id,task] of tasks) if(task.updatedAt<=event.at) tasks.delete(id); return; }
  if (event.endSession) {
    for (const [id, task] of tasks) if (task.sessionId === event.sessionId && task.updatedAt<=event.at) tasks.delete(id);
    return;
  }
  if (!event.state) return;
  const current = tasks.get(event.id);
  if (current && current.updatedAt > event.at) return;
  // Explicit progress can release an old Hook wait. Inferred waiting cannot undo a Hook result.
  if (current && current.source !== 'session' && event.source === 'session') {
    if (current.source === 'cli' || (event.state !== 'working' && event.waitReason !== 'quota')) return;
  }
  // A failed model attempt may still be followed by Stop. Keep the quota pause until progress resumes.
  if (current?.waitReason === 'quota' && (event.hookEvent === 'Stop' || event.hookEvent === 'SubagentStop') && event.state === 'done') return;
  const source = current?.source === 'hook' && event.source === 'session' ? 'hook' : event.source;
  tasks.set(event.id, {id:event.id, sessionId:event.sessionId, state:event.state, source, updatedAt:event.at, workspace:event.workspace,
    waitReason:event.state === 'waiting' ? event.waitReason : undefined});
}
export function assistantNeedsInput(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const ending = message.trim().split(/\n\s*\n/).at(-1)?.slice(-400) || '';
  return /(?:^|[。！？\n])\s*(?:请(?:你)?|需要你|等待你|麻烦你).{0,35}(?:确认|授权|批准|选择|补充|提供|回复)|(?:^|[.!?\n])\s*(?:please|i need you to|waiting for you to).{0,60}(?:confirm|approve|provide|choose|reply)/i.test(ending);
}
export function isBlockingInputTool(name: string): boolean {
  return /(?:^|[.:_])(?:request_user_input|ask_user|askuserquestion)$/i.test(name);
}
export function isQuotaPause(error: unknown): boolean {
  if (typeof error === 'string') {
    return /usage_?limit_?exceeded|insufficient_quota|credit_balance_exhausted|(?:organization|project)_spend_limit_exceeded|(?:hit|reached|exceeded).{0,35}(?:usage limit|quota)|(?:quota|credits?).{0,25}(?:exhausted|depleted|insufficient)|(?:额度|用量|余额).{0,12}(?:耗尽|不足|用完|上限)/i.test(error);
  }
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return ['code','type','message','error','codexErrorInfo','codex_error_info','additionalDetails'].some(key => isQuotaPause(record[key]));
}
export function hookTrafficEvent(name: string, payload: Record<string, unknown>, at = Date.now()): TrafficEvent | null {
  const sessionId = String(payload.session_id || payload.thread_id || '').slice(0,256);
  if (!sessionId) return null;
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.slice(0,256) : '';
  const id = agentId ? sessionId + ':' + agentId : sessionId;
  const base: TrafficEvent = {id,sessionId,source:'hook',at,hookEvent:name,workspace:typeof payload.cwd === 'string' ? payload.cwd.slice(0,1024) : undefined};
  if (name === 'SessionEnd' || name === 'Interrupt') return {...base,endSession:true};
  if (name === 'SessionStart') return {...base,state:'idle'};
  if (name === 'PermissionRequest') return {...base,state:'waiting',waitReason:'approval'};
  if (name === 'PostModelRequest') {
    if (payload.status === 'cancelled') return null;
    if (payload.status === 'failed' && payload.willRetry !== true && payload.will_retry !== true && isQuotaPause(payload.error)) return {...base,state:'waiting',waitReason:'quota'};
    return {...base,state:'working'};
  }
  if (name === 'Stop' || name === 'SubagentStop') {
    if (name === 'SubagentStop' && !agentId) return null;
    const needsInput = assistantNeedsInput(payload.last_assistant_message);
    return {...base,state:needsInput ? 'waiting' : 'done',waitReason:needsInput ? 'input' : undefined};
  }
  if (name === 'PreToolUse' && isBlockingInputTool(String(payload.tool_name || ''))) return {...base,state:'waiting',waitReason:'input'};
  if (['UserPromptSubmit','PreToolUse','PostToolUse','PreModelRequest','SubagentStart'].includes(name)) return {...base,state:'working'};
  return null;
}
