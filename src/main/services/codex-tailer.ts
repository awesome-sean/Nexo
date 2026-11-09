import { answeredInputIds, assistantNeedsInput, inputRequestIds, isAsyncInputTool, isBlockingInputTool, isQuotaPause } from '../../common/codex-traffic.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SessionManager } from './session-manager';

interface CodexContext {
  sessionId?: string;
  cwd?: string;
  pendingInputs?: Set<string>;
  inputCalls?: Map<string, {ids: string[]; async: boolean}>;
}

export class CodexSessionTailer {
  private rootDir: string;
  private sessionManager: SessionManager;
  private filePositions: Map<string, number> = new Map();
  private contexts: Map<string, CodexContext> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  /** fs.watch 是否成功建立并存活；false = 退化为 500ms 兜底轮询 */
  private watchActive = false;
  private isProcessing = false;

  constructor(sessionManager: SessionManager, customDir?: string) {
    this.sessionManager = sessionManager;
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.rootDir = customDir || path.join(codexHome, 'sessions');
  }

  public start() {
    if (!fs.existsSync(this.rootDir)) {
      console.log(`[CodexTailer] Sessions directory does not exist: ${this.rootDir}`);
      return;
    }

    console.log(`[CodexTailer] Watching Codex sessions at: ${this.rootDir}`);
    this.scanInitialFiles();

    try {
      this.watcher = fs.watch(this.rootDir, { recursive: true }, (_, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;
        const fullPath = path.join(this.rootDir, filename);
        this.readNewLines(fullPath);
      });
      this.watcher.on('error', () => {
        this.watchActive = false;
      });
      this.watchActive = true;
    } catch (err) {
      this.watchActive = false;
      console.error('[CodexTailer] fs.watch recursive failed, falling back to polling:', err);
    }

    // Secondary poll every 500ms for active files to ensure near zero-latency updates
    this.pollInterval = setInterval(() => {
      this.checkActiveFiles();
    }, 500);
  }

  /** 会话检测是否为事件驱动（fs.watch 主通路存活）；false = 只剩 500ms 兜底轮询 */
  public get isEventDriven(): boolean {
    return this.watchActive;
  }

  private scanInitialFiles() {
    try {
      const files: { path: string; mtime: number }[] = [];
      const findJsonl = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const res = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            findJsonl(res);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            const stat = fs.statSync(res);
            files.push({ path: res, mtime: stat.mtimeMs });
          }
        }
      };

      findJsonl(this.rootDir);
      files.sort((a, b) => b.mtime - a.mtime);

      // Fast-forward all existing historical files so we NEVER replay past notifications!
      for (const item of files) {
        try {
          const stat = fs.statSync(item.path);
          this.filePositions.set(item.path, stat.size);
        } catch {}
      }

      // Reconstruct recently active files in timestamp order, including parallel sessions.
      for (const item of files.filter(file => Date.now() - file.mtime < 5 * 60 * 1000).reverse()) {
        this.readFullFile(item.path);
      }
    } catch (err) {
      console.error('[CodexTailer] Error scanning initial files:', err);
    }
  }

  private checkActiveFiles() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      // 1. Check existing tracked files
      for (const filePath of Array.from(this.filePositions.keys())) {
        if (fs.existsSync(filePath)) {
          this.readNewLines(filePath);
        } else {
          // 会话文件被删/轮转：不再每 500ms 对它空转，也不让 map 无限增长
          this.filePositions.delete(filePath);
          this.contexts.delete(filePath);
        }
      }

      // 2. Proactively discover newly created session files in ~/.codex/sessions/YYYY/MM/DD
      const now = new Date();
      const yyyy = now.getFullYear().toString();
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const dd = now.getDate().toString().padStart(2, '0');
      const todayDir = path.join(this.rootDir, yyyy, mm, dd);

      if (fs.existsSync(todayDir)) {
        const files = fs.readdirSync(todayDir);
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const fullPath = path.join(todayDir, file);
            if (!this.filePositions.has(fullPath)) {
              // Brand new session created after Nexo started
              this.readFullFile(fullPath);
            }
          }
        }
      }
    } catch (err) {
      // Ignore transient errors
    } finally {
      this.isProcessing = false;
    }
  }

  private readFullFile(filePath: string) {
    this.filePositions.set(filePath, 0);
    this.contexts.set(filePath, {});
    this.readNewLines(filePath);
  }

  private readNewLines(filePath: string) {
    try {
      const stat = fs.statSync(filePath);
      let position = this.filePositions.get(filePath) ?? 0;
      if (stat.size < position) position = 0;
      if (stat.size === position) return;

      let context = this.contexts.get(filePath);
      if (!context) {
        context = this.readFileContext(filePath);
        this.contexts.set(filePath, context);
      }

      const fd = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(256 * 1024);
        let fragments: Buffer[] = [];
        // Only a single unfinished record can span buffers. Decode after its newline
        // so UTF-8 characters split across reads remain intact.
        while (position < stat.size) {
          const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - position), position);
          if (!length) break;
          let start = 0;
          let newline = buffer.indexOf(0x0a, start);
          while (newline >= 0 && newline < length) {
            const segment = buffer.subarray(start, newline);
            const line = fragments.length
              ? Buffer.concat([...fragments, segment]).toString('utf8')
              : segment.toString('utf8');
            fragments = [];
            this.filePositions.set(filePath, position + newline + 1);
            if (line.trim()) this.parseLine(line, context);
            start = newline + 1;
            newline = buffer.indexOf(0x0a, start);
          }
          if (start < length) fragments.push(Buffer.from(buffer.subarray(start, length)));
          position += length;
        }
        // Leave the saved offset at the last complete record. The next read picks
        // up any partially written JSON, including incomplete UTF-8 sequences.
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // The writer may temporarily lock, rotate or remove the file.
    }
  }

  private readFileContext(filePath: string): CodexContext {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, length).toString('utf8').split(/\r?\n/, 1)[0];
      const metadata = JSON.parse(firstLine);
      if (metadata.type === 'session_meta') {
        return { sessionId: metadata.payload?.id || metadata.payload?.session_id, cwd: metadata.payload?.cwd };
      }
    } catch { /* The file may still be receiving its metadata line. */ }
    finally { fs.closeSync(fd); }
    const id = path.basename(filePath).match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0];
    return { sessionId: id };
  }

  private parseLine(line: string, context: CodexContext) {
    try {
      const doc = JSON.parse(line);
      const recordType = doc.type;
      const payload = doc.payload;
      if (!payload) return;
      const parsedAt = Date.parse(doc.timestamp);
      const eventAt = Number.isFinite(parsedAt) ? parsedAt : Date.now();

      if (recordType === 'session_meta') {
        context.sessionId = payload.id || payload.session_id || context.sessionId;
        context.cwd = payload.cwd || context.cwd;
        if (context.sessionId) {
          this.sessionManager.updateSession(context.sessionId, 'codex', {
            cwd: context.cwd,
            title: context.cwd ? path.basename(context.cwd) : 'Codex Session',
            status: 'idle',
            updatedAt: eventAt,
          });
        }
        return;
      }

      const sessionId = context.sessionId || 'codex-active';
      if (recordType === 'turn_context') {
        if (payload.approvals_reviewer === 'user' || payload.approvals_reviewer === 'auto_review') {
          this.sessionManager.updateSession(sessionId, 'codex', {approvalsReviewer:payload.approvals_reviewer,updatedAt:eventAt});
        }
        return;
      }
      const pending: Set<string> = context.pendingInputs ||= new Set();
      const inputCalls: NonNullable<CodexContext['inputCalls']> = context.inputCalls ||= new Map();
      const update = (patch: Parameters<SessionManager['updateSession']>[2]) => {
        const waiting = pending.size && patch.status !== 'idle';
        return this.sessionManager.updateSession(sessionId, 'codex', {...patch,
          ...(waiting ? {status:'waiting',trafficWaitReason:'input'} as const : {}),
          pendingInputIds:[...pending],updatedAt:eventAt});
      };
      const openInput = (tool: string, id: unknown, input: unknown) => {
        const ids = inputRequestIds(tool, id, input);
        for (const inputId of ids) pending.add(inputId);
        if (ids.length) inputCalls.set(typeof id === 'string' && id ? id : tool, {ids,async:isAsyncInputTool(tool)});
      };
      const resolveInput = (id: unknown, output: unknown): string[] => {
        const call = typeof id === 'string' ? inputCalls.get(id) : undefined;
        if (!call) return [];
        let result = output;
        if (typeof result === 'string') { try { result = JSON.parse(result); } catch { result = null; } }
        if (call.async && result && typeof result === 'object' && (result as Record<string,unknown>).accepted === true && (result as Record<string,unknown>).isError !== true) return [];
        for (const inputId of call.ids) pending.delete(inputId);
        inputCalls.delete(String(id));
        return call.ids;
      };
      const replyText = payload.type === 'user_message' ? payload.message : payload.type === 'message' && payload.role === 'user'
        ? payload.content?.map((item: {text?:string}) => item.text || '').join('') : null;
      const answered = answeredInputIds(replyText);
      if (answered) {
        for (const id of answered) pending.delete(id);
        for (const [id,call] of inputCalls) if (!call.ids.some(inputId => pending.has(inputId))) inputCalls.delete(id);
        update({status:'thinking',resolvedInputIds:answered,currentTool:null});
        return;
      }

      if (recordType === 'event_msg') {
        const payloadType = payload.type;
        if (payloadType === 'task_started') {
          pending.clear(); inputCalls.clear();
          update({
            status: 'thinking',
            clearPendingInputs:true,
            startedAt: eventAt,
            lastMessage: 'Task started',
          });
        } else if (payloadType === 'agent_message') {
          const msg = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload.message);
          update({
            lastMessage: msg.slice(-1000),
          });
        } else if (payloadType === 'patch_apply_begin') {
          update({
            status: 'running_tool',
            currentTool: {
              name: 'apply_patch',
              startedAt: Date.now(),
              paramsSummary: 'Modifying files...',
            },
          });
        } else if (payloadType === 'patch_apply_end') {
          update({
            status: 'thinking',
            currentTool: null,
          });
        } else if (payloadType === 'mcp_tool_call_begin') {
          const toolName = payload.tool_name || payload.name || 'mcp_tool';
          openInput(toolName,payload.call_id || payload.tool_use_id,payload.arguments);
          update({
            status: isBlockingInputTool(toolName) ? 'waiting' : 'running_tool',
            trafficWaitReason: isBlockingInputTool(toolName) ? 'input' : undefined,
            currentTool: {
              name: toolName,
              startedAt: Date.now(),
              paramsSummary: payload.arguments ? JSON.stringify(payload.arguments).slice(0, 60) : undefined,
            },
          });
        } else if (payloadType === 'mcp_tool_call_end') {
          update({
            status: 'thinking',
            resolvedInputIds:resolveInput(payload.call_id || payload.tool_use_id || payload.tool_name || payload.name || this.sessionManager.getSession(sessionId)?.currentTool?.name,payload.result || payload.output),
            currentTool: null,
          });
        } else if (payloadType === 'task_complete' || payloadType === 'turn_complete') {
          const message=payload.last_agent_message || this.sessionManager.getSession(sessionId)?.lastMessage;
          if(isQuotaPause(payload.error)) update({status:'waiting',trafficWaitReason:'quota',error:typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error),currentTool:null});
          else if(assistantNeedsInput(message)) update({status:'waiting',trafficWaitReason:'input',currentTool:null});
          else update({status:'completed',currentTool:null,lastMessage:message});
        } else if (payloadType === 'turn_aborted') {
          pending.clear(); inputCalls.clear();
          if(isQuotaPause(payload.error || payload.reason)) update({status:'waiting',trafficWaitReason:'quota',currentTool:null});
          else update({status:'idle',clearPendingInputs:true,currentTool:null});
        } else if (payloadType === 'error') {
          if(payload.willRetry === true || payload.will_retry === true) update({status:'thinking',currentTool:null});
          else if(isQuotaPause(payload)) update({status:'waiting',trafficWaitReason:'quota',error:payload.message || 'Codex usage limit reached',currentTool:null});
          else update({status:'thinking',error:payload.message || 'Task request failed',currentTool:null});
        }
      } else if (recordType === 'response_item') {
        const payloadType = payload.type;
        if (payloadType === 'reasoning') {
          update({
            status: 'thinking',
          });
        } else if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
          const toolName = payload.name || 'tool';
          openInput(toolName,payload.call_id,payload.arguments);
          let paramsSummary: string | undefined;
          if (payload.arguments) {
            paramsSummary = typeof payload.arguments === 'string'
              ? payload.arguments.slice(0, 60)
              : JSON.stringify(payload.arguments).slice(0, 60);
          }
          update({
            status: isBlockingInputTool(toolName) ? 'waiting' : 'running_tool',
            trafficWaitReason: isBlockingInputTool(toolName) ? 'input' : undefined,
            currentTool: {
              name: toolName,
              paramsSummary,
              startedAt: Date.now(),
            },
          });
        } else if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
          update({
            status: 'thinking',
            resolvedInputIds:resolveInput(payload.call_id || this.sessionManager.getSession(sessionId)?.currentTool?.name,payload.output),
            currentTool: null,
          });
        } else if (payloadType === 'message' && payload.role === 'assistant') {
          if (Array.isArray(payload.content)) {
            const textPart = payload.content.find((c: any) => c.type === 'text' || c.type === 'output_text');
            if (textPart && textPart.text) {
              update({
                lastMessage: textPart.text.slice(-1000),
              });
            }
          }
        }
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  public stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
