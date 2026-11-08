import { assistantNeedsInput, isBlockingInputTool, isQuotaPause } from '../../common/codex-traffic';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SessionManager } from './session-manager';

interface CodexContext {
  sessionId?: string;
  cwd?: string;
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
    try {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const context: CodexContext = {};
      this.contexts.set(filePath, context);

      for (const line of lines) {
        if (!line.trim()) continue;
        this.parseLine(line, context);
      }

      this.filePositions.set(filePath, Buffer.byteLength(content, 'utf-8'));
    } catch (err) {
      console.error(`[CodexTailer] Error reading full file ${filePath}:`, err);
    }
  }

  private readNewLines(filePath: string) {
    try {
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      let pos = this.filePositions.get(filePath) ?? 0;
      if (stat.size < pos) pos = 0; // Truncated or rotated
      if (stat.size === pos) return;

      const fd = fs.openSync(filePath, 'r');
      const bytesToRead = stat.size - pos;
      const buffer = Buffer.alloc(bytesToRead);
      try {
        fs.readSync(fd, buffer, 0, bytesToRead, pos);
      } finally {
        fs.closeSync(fd);
      }

      // 只处理到最后一个换行为止（理由同 claude-desktop-tailer.readNewLines）：
      // 把位置推到 stat.size 会把尾部那半行永久丢掉，多字节字符还可能被切坏。
      const lastNewline = buffer.lastIndexOf(0x0a);
      if (lastNewline < 0) return;

      this.filePositions.set(filePath, pos + lastNewline + 1);

      let context = this.contexts.get(filePath);
      if (!context) {
        // Existing files were fast-forwarded at startup. Recover their identity before reading appended events.
        context = this.readFileContext(filePath);
        this.contexts.set(filePath, context);
      }

      const chunk = buffer.subarray(0, lastNewline).toString('utf-8');
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        this.parseLine(line, context);
      }
    } catch (err) {
      // Ignore transient file lock errors
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
      const update = (patch: Parameters<SessionManager['updateSession']>[2]) =>
        this.sessionManager.updateSession(sessionId, 'codex', {...patch, updatedAt: eventAt});

      if (recordType === 'event_msg') {
        const payloadType = payload.type;
        if (payloadType === 'task_started') {
          update({
            status: 'thinking',
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
            currentTool: null,
          });
        } else if (payloadType === 'task_complete' || payloadType === 'turn_complete') {
          const message=payload.last_agent_message || this.sessionManager.getSession(sessionId)?.lastMessage;
          if(isQuotaPause(payload.error)) update({status:'waiting',trafficWaitReason:'quota',error:typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error),currentTool:null});
          else if(assistantNeedsInput(message)) update({status:'waiting',trafficWaitReason:'input',currentTool:null});
          else update({status:'completed',currentTool:null,lastMessage:message});
        } else if (payloadType === 'turn_aborted') {
          if(isQuotaPause(payload.error || payload.reason)) update({status:'waiting',trafficWaitReason:'quota',currentTool:null});
          else update({status:'idle',currentTool:null});
        } else if (payloadType === 'error') {
          if(payload.willRetry === true || payload.will_retry === true) update({status:'thinking',currentTool:null});
          else if(isQuotaPause(payload)) update({status:'waiting',trafficWaitReason:'quota',error:payload.message || 'Codex usage limit reached',currentTool:null});
          else update({status:'error',error:payload.message || 'Task failed or aborted',currentTool:null});
        }
      } else if (recordType === 'response_item') {
        const payloadType = payload.type;
        if (payloadType === 'reasoning') {
          update({
            status: 'thinking',
          });
        } else if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
          const toolName = payload.name || 'tool';
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
