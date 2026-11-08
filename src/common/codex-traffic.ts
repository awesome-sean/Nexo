export type TrafficState = 'idle' | 'working' | 'waiting' | 'done';
export type TrafficSource = 'hook' | 'cli' | 'session';
export type TrafficWaitReason = 'approval' | 'input' | 'quota';
export const DONE_DURATION_MS = 10 * 60_000;
export const APPROVAL_GRACE_MS = 10_000;
export const MIXED_TRAFFIC_PHASE_MS = 1000;
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
  activeSince?: number;
  workspace?: string;
  waitReason?: TrafficWaitReason;
  pendingInputIds?: string[];
  resolvedInputIds?: string[];
  quotaPaused?: boolean;
  approvalsReviewer?: 'user' | 'auto_review';
}
export interface TrafficSnapshot {
  state: TrafficState;
  sampledAt: number;
  counts: Record<TrafficState, number>;
  expiresAt: number | null;
}
export function hasMixedTraffic(traffic?: TrafficSnapshot, now = Date.now()): boolean {
  return traffic?.state === 'working' && traffic.counts?.working > 0 && traffic.counts?.done > 0
    && typeof traffic.expiresAt === 'number' && now < traffic.expiresAt;
}
/** Visual alternation must not create task transitions, expression switches or repeated alerts. */
export function getTrafficLightState(traffic?: TrafficSnapshot, now = Date.now()): TrafficState {
  if (hasMixedTraffic(traffic, now)) return Math.floor(now / MIXED_TRAFFIC_PHASE_MS) % 2 === 0 ? 'working' : 'done';
  return traffic?.state ?? 'idle';
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
  inputOpened?: string[];
  inputResolved?: string[];
  resetInputs?: boolean;
}
export function isTrafficState(value: unknown): value is TrafficState {
  return value === 'idle' || value === 'working' || value === 'waiting' || value === 'done';
}
function workspaceKey(workspace?: string): string | null {
  if (!workspace) return null;
  let key = workspace.trim().replace(/\\/g, '/');
  // Relative or unresolved paths do not establish a separate project.
  if (!/^(?:[a-z]:\/|\/)/i.test(key) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(key)) return null;
  if (/^[a-z]:\//i.test(key) || key.startsWith('//')) key = key.toLowerCase();
  return key.replace(/\/+/g, '/').replace(/\/$/, '');
}
export function aggregateTraffic(tasks: Iterable<TrafficTask>, now = Date.now()): TrafficSnapshot {
  const counts = {idle:0, working:0, waiting:0, done:0};
  let expiresAt: number | null = null;
  const projects: {task: TrafficTask; workspace: string; startedAt: number}[] = [];
  for (const task of tasks) {
    if (task.state === 'done') {
      const expiry = task.updatedAt + DONE_DURATION_MS;
      if (expiry <= now) continue;
      expiresAt = Math.max(expiresAt ?? 0, expiry);
    }
    // PermissionRequest also fires for automatic review, which can outlast a long command.
    const awaitingApproval = task.state === 'waiting' && task.waitReason === 'approval'
      && (task.approvalsReviewer === 'auto_review' || (task.approvalsReviewer !== 'user' && now - task.updatedAt < APPROVAL_GRACE_MS));
    counts[awaitingApproval ? 'working' : task.state]++;
    const workspace = workspaceKey(task.workspace);
    if (workspace && task.id === task.sessionId && typeof task.activeSince === 'number'
      && Number.isFinite(task.activeSince) && task.activeSince <= task.updatedAt) {
      projects.push({task, workspace, startedAt:task.activeSince});
    }
  }
  const state = counts.waiting ? 'waiting' : counts.working ? 'working' : counts.done ? 'done' : 'idle';
  let mixedExpiresAt = 0;
  if (state === 'working') {
    const working = projects.filter(project => project.task.state === 'working');
    for (const completed of projects.filter(project => project.task.state === 'done')) {
      // A finished chat does not mean its project finished while another chat there is active.
      const stillWorking = working.some(active => active.workspace === completed.workspace
        || active.workspace.startsWith(completed.workspace + '/')
        || completed.workspace.startsWith(active.workspace + '/'));
      if (stillWorking) continue;
      const overlapping = working.some(active => active.task.sessionId !== completed.task.sessionId
        && active.startedAt < completed.task.updatedAt);
      if (overlapping) mixedExpiresAt = Math.max(mixedExpiresAt, completed.task.updatedAt + DONE_DURATION_MS);
    }
  }
  // A zero deadline also suppresses alternation in existing band builds that use this field.
  return {state, counts, sampledAt:now, expiresAt:state === 'done' ? expiresAt : state === 'working' ? mixedExpiresAt : null};
}
export function applyTrafficEvent(tasks: Map<string, TrafficTask>, event: TrafficEvent): void {
  if (event.clear) { for (const [id,task] of tasks) if(task.updatedAt<=event.at) tasks.delete(id); return; }
  if (event.endSession) {
    for (const [id, task] of tasks) if (task.sessionId === event.sessionId && task.updatedAt<=event.at) tasks.delete(id);
    return;
  }
  if (!event.state) return;
  const current = tasks.get(event.id);
  const inputChange = !!(event.inputOpened?.length || event.inputResolved?.length || event.resetInputs);
  const stale = !!current && current.updatedAt > event.at;
  if (stale && !inputChange) return;
  // Explicit progress can release an old Hook wait. Inferred waiting cannot undo a Hook result.
  if (current && current.source !== 'session' && event.source === 'session') {
    if (current.source === 'cli' || (!inputChange && event.state !== 'working' && event.waitReason !== 'quota')) return;
  }
  // A failed model attempt may still be followed by Stop. Keep the quota pause until progress resumes.
  if ((current?.quotaPaused || current?.waitReason === 'quota') && (event.hookEvent === 'Stop' || event.hookEvent === 'SubagentStop') && event.state === 'done') return;
  let quotaPaused = current?.quotaPaused || current?.waitReason === 'quota';
  if (!stale && event.waitReason === 'quota') quotaPaused = true;
  else if (!stale && (event.state === 'idle' || (event.state === 'working' && !event.inputResolved?.length && !event.inputOpened?.length))) quotaPaused = false;
  const pending = new Set(current?.pendingInputIds || []);
  const resolved = new Set(current?.resolvedInputIds || []);
  if (event.resetInputs) { for (const id of pending) resolved.add(id); pending.clear(); }
  for (const id of event.inputResolved || []) {
    resolved.add(id);
    for (const openId of pending) if (openId === id || openId.startsWith(id + ':')) pending.delete(openId);
  }
  for (const id of event.inputOpened || []) {
    if (![...resolved].some(closedId => id === closedId || id.startsWith(closedId + ':'))) pending.add(id);
  }
  let state = stale ? current!.state : event.state;
  let waitReason = stale ? current!.waitReason : event.waitReason;
  if (quotaPaused) { state = 'waiting'; waitReason = 'quota'; }
  else if (pending.size) { state = 'waiting'; waitReason = 'input'; }
  else if (state === 'waiting' && waitReason === 'input' && current?.pendingInputIds?.length) {
    state = 'working'; waitReason = undefined;
  }
  else if (state === 'waiting' && waitReason === 'input' && event.inputOpened?.length) {
    state = current?.state || 'working'; waitReason = current?.waitReason;
  }
  const source = current?.source === 'hook' && event.source === 'session' ? 'hook' : event.source;
  const activeSince = !stale && state === 'working'
    && (typeof current?.activeSince !== 'number' || current.state === 'idle' || current.state === 'done')
    ? event.at : current?.activeSince;
  tasks.set(event.id, {id:event.id, sessionId:event.sessionId, state, source, updatedAt:Math.max(current?.updatedAt || 0, event.at), activeSince,
    workspace:event.workspace ?? current?.workspace ?? tasks.get(event.sessionId)?.workspace,
    waitReason:state === 'waiting' ? waitReason : undefined,approvalsReviewer:current?.approvalsReviewer ?? tasks.get(event.sessionId)?.approvalsReviewer,
    pendingInputIds:pending.size ? [...pending] : undefined,
    resolvedInputIds:resolved.size ? [...resolved].slice(-128) : undefined,quotaPaused:quotaPaused || undefined});
}
export function assistantNeedsInput(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const ending = message.trim().split(/\n\s*\n/).at(-1)?.slice(-400) || '';
  return /(?:你|您|请问|是否|能否|可否|哪|什么|多少|怎么|如何|would you|could you|can you|which|what|how|do you)[^。！!\n]*[?？][\s*”"')）]*$/i.test(ending)
    || /(?:^|[。！？\n])\s*(?:请(?:你)?|需要你|等待你|麻烦你).{0,35}(?:确认|授权|批准|选择|补充|提供|回复)|(?:^|[.!?\n])\s*(?:please|i need you to|waiting for you to).{0,60}(?:confirm|approve|provide|choose|reply)/i.test(ending);
}
export function isBlockingInputTool(name: string): boolean {
  return /(?:^|[.:/_])(?:request_user_input(?:_async)?|ask_user|askuserquestion)$/i.test(name);
}
export function isAsyncInputTool(name: string): boolean {
  return /(?:^|[.:/_])request_user_input_async$/i.test(name);
}
export function inputRequestIds(name: string, callId: unknown, input: unknown): string[] {
  if (!isBlockingInputTool(name)) return [];
  let value = input;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  const questions = value && typeof value === 'object' ? (value as Record<string, unknown>).questions : null;
  const count = Array.isArray(questions) && questions.length ? questions.length : 1;
  const id = typeof callId === 'string' && callId ? callId : name.split(/[.:/]/).at(-1)!;
  return Array.from({length:count}, (_, index) => `${id}:${index}`);
}
export function answeredInputIds(message: unknown): string[] | null {
  if (typeof message !== 'string') return null;
  const match = message.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
  if (!match) return null;
  try {
    const replies = JSON.parse(match[1]);
    if (!Array.isArray(replies)) return [];
    return replies.flatMap(reply => {
      try {
        const [name, callId, index] = JSON.parse(reply.questionItemId);
        return typeof name === 'string' && isBlockingInputTool(name) && typeof callId === 'string' && Number.isInteger(index) && index >= 0 ? [`${callId}:${index}`] : [];
      } catch { return []; }
    });
  } catch { return []; }
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
  if (name === 'SessionStart') return {...base,state:'idle',resetInputs:true};
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
  const tool = String(payload.tool_name || '');
  const toolUseId = payload.tool_use_id || payload.call_id;
  if (name === 'PreToolUse' && isBlockingInputTool(tool)) return {...base,state:'waiting',waitReason:'input',inputOpened:typeof toolUseId === 'string' && toolUseId ? inputRequestIds(tool,toolUseId,payload.tool_input) : undefined};
  if (name === 'PostToolUse' && isAsyncInputTool(tool)) return null;
  if (name === 'PostToolUse' && isBlockingInputTool(tool)) return {...base,state:'working',inputResolved:typeof toolUseId === 'string' ? [toolUseId] : inputRequestIds(tool,null,payload.tool_input)};
  if (name === 'UserPromptSubmit') {
    const answered = answeredInputIds(payload.prompt);
    return {...base,state:'working',inputResolved:answered || undefined,resetInputs:answered === null};
  }
  if (['UserPromptSubmit','PreToolUse','PostToolUse','PreModelRequest','SubagentStart'].includes(name)) return {...base,state:'working'};
  return null;
}
