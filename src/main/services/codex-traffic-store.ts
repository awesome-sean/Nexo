import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { aggregateTraffic, applyTrafficEvent, isTrafficState, type TrafficTask, type TrafficEvent } from '../../common/codex-traffic.ts';
import type { AgentSession } from '../../common/types';

export function trafficDirectory(): string {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'Nexo','traffic');
}
function validEvent(value: unknown): value is TrafficEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as TrafficEvent;
  return typeof event.id === 'string' && typeof event.sessionId === 'string' && Number.isFinite(event.at)
    && ['hook','cli','session'].includes(event.source) && (isTrafficState(event.state) || event.clear === true || event.endSession === true || event.quit === true);
}
export function enqueueTraffic(event: TrafficEvent, directory = trafficDirectory()): void {
  if (!validEvent(event)) throw new Error('任务状态无效');
  const queue = path.join(directory,'events');
  fs.mkdirSync(queue,{recursive:true});
  const file = path.join(queue,String(event.at).padStart(16,'0') + '-' + process.pid + '-' + randomUUID() + '.json');
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary,JSON.stringify(event),'utf8');
  fs.renameSync(temporary,file);
}
export function readTrafficTasks(directory = trafficDirectory()): Map<string, TrafficTask> {
  const tasks = new Map<string,TrafficTask>();
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8'));
    for (const task of saved.tasks || []) {
      if (typeof task.id === 'string' && typeof task.sessionId === 'string' && isTrafficState(task.state) && Number.isFinite(task.updatedAt)) tasks.set(task.id,task);
    }
  } catch { /* First run has no saved snapshot. */ }
  return tasks;
}
function queuedFiles(directory: string): string[] {
  try { return fs.readdirSync(path.join(directory,'events')).filter(file=>file.endsWith('.json')).sort(); }
  catch { return []; }
}
export function readTrafficSnapshot(directory = trafficDirectory()) {
  const tasks = readTrafficTasks(directory);
  let receipts:string[]=[];
  try { receipts=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8')).receipts || []; } catch {}
  for (const file of queuedFiles(directory)) {
    if(receipts.includes(file)) continue;
    try {
      const event = JSON.parse(fs.readFileSync(path.join(directory,'events',file),'utf8'));
      if (validEvent(event)) applyTrafficEvent(tasks,event);
    } catch { /* An incomplete producer write is never published as .json. */ }
  }
  return aggregateTraffic(tasks.values());
}
export class CodexTrafficService extends EventEmitter {
  private tasks: Map<string,TrafficTask>;
  private timer: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private lastState = '';
  private receipts = new Set<string>();
  private directory: string;
  constructor(directory = trafficDirectory()) {
    super();
    this.directory = directory;
    fs.mkdirSync(path.join(directory,'events'),{recursive:true});
    this.tasks = readTrafficTasks(directory);
    try { const saved=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8'));this.receipts=new Set(saved.receipts || []); } catch {}
  }
  start(): void {
    if (this.timer) return;
    this.drain();
    this.watcher = fs.watch(path.join(this.directory,'events'),()=>this.drain());
    this.watcher.on('error',()=>{ this.watcher?.close(); this.watcher = null; });
    this.timer = setInterval(()=>{this.drain();this.publish();},1000);
    this.publish();
  }
  getSnapshot() { return aggregateTraffic(this.tasks.values()); }
  trackSessions(sessions: AgentSession[]): void {
    let changed = false;
    const liveSessionIds = new Set(sessions.filter(session => session.agent === 'codex').map(session => session.id));
    // JSONL fallback state belongs to the current session inventory, including after a restart.
    for (const [id, task] of this.tasks) {
      if (task.source === 'session' && task.state !== 'done' && !liveSessionIds.has(task.sessionId)) {
        this.tasks.delete(id);
        changed = true;
      }
    }
    for (const session of sessions) {
      if (session.agent !== 'codex') continue;
      const current = this.tasks.get(session.id);
      if (current && current.updatedAt >= session.updatedAt) continue;
      const state = session.status === 'waiting' || session.status === 'error' ? 'waiting' : session.status === 'completed' ? 'done' : session.status === 'thinking' || session.status === 'running_tool' ? 'working' : 'idle';
      if(current?.source === 'cli') continue;
      if(current?.source === 'hook' && state !== 'working' && session.trafficWaitReason !== 'quota') continue;
      applyTrafficEvent(this.tasks,{id:session.id,sessionId:session.id,state,source:'session',at:session.updatedAt,workspace:session.cwd,waitReason:session.trafficWaitReason});
      changed = true;
    }
    if (changed) { this.save(); this.publish(); }
  }
  private save(): void {
    const file = path.join(this.directory,'state.json');
    fs.writeFileSync(file+'.tmp',JSON.stringify({version:1,tasks:[...this.tasks.values()],receipts:[...this.receipts]}),'utf8');
    fs.renameSync(file+'.tmp',file);
  }
  private drain(): void {
    const consumed: string[] = [];
    let quit=false;
    const queued=queuedFiles(this.directory);
    this.receipts=new Set([...this.receipts].filter(file=>queued.includes(file)));
    for (const file of queued.slice(0,1000)) {
      const fullPath = path.join(this.directory,'events',file);
      try {
        const event = JSON.parse(fs.readFileSync(fullPath,'utf8'));
        if (!validEvent(event)) { fs.renameSync(fullPath,fullPath+'.invalid'); continue; }
        if(!this.receipts.has(file)) { applyTrafficEvent(this.tasks,event);quit ||= event.quit===true; }
        this.receipts.add(file);
        consumed.push(fullPath);
      } catch { /* Retry transient file access errors on the next tick. */ }
    }
    if (!consumed.length) return;
    // Persist receipts with state before deleting events, preventing destructive replay after a crash.
    this.save();
    for (const file of consumed) { try { fs.unlinkSync(file); } catch {} }
    this.publish();
    if(quit)this.emit('quit');
  }
  private publish(): void {
    const snapshot = this.getSnapshot();
    const signature = JSON.stringify({state:snapshot.state,counts:snapshot.counts,expiresAt:snapshot.expiresAt});
    if (signature !== this.lastState) { this.lastState = signature; this.emit('update',snapshot); }
  }
  stop(): void { this.watcher?.close();this.watcher=null;if(this.timer)clearInterval(this.timer);this.timer=null; }
}
