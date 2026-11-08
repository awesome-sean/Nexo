"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/nexo-cli.ts
var nexo_cli_exports = {};
__export(nexo_cli_exports, {
  runNexoCli: () => runNexoCli
});
module.exports = __toCommonJS(nexo_cli_exports);

// src/main/services/codex-traffic-store.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_crypto = require("node:crypto");

// src/common/codex-traffic.ts
var DONE_DURATION_MS = 10 * 6e4;
var APPROVAL_GRACE_MS = 2e3;
function isTrafficState(value) {
  return value === "idle" || value === "working" || value === "waiting" || value === "done";
}
function aggregateTraffic(tasks, now = Date.now()) {
  const counts = { idle: 0, working: 0, waiting: 0, done: 0 };
  let expiresAt = null;
  for (const task of tasks) {
    if (task.state === "done") {
      const expiry = task.updatedAt + DONE_DURATION_MS;
      if (expiry <= now) continue;
      expiresAt = Math.max(expiresAt ?? 0, expiry);
    }
    const awaitingApproval = task.state === "waiting" && task.waitReason === "approval" && now - task.updatedAt < APPROVAL_GRACE_MS;
    counts[awaitingApproval ? "working" : task.state]++;
  }
  const state = counts.waiting ? "waiting" : counts.working ? "working" : counts.done ? "done" : "idle";
  return { state, counts, sampledAt: now, expiresAt: state === "done" ? expiresAt : null };
}
function applyTrafficEvent(tasks, event) {
  if (event.clear) {
    for (const [id, task] of tasks) if (task.updatedAt <= event.at) tasks.delete(id);
    return;
  }
  if (event.endSession) {
    for (const [id, task] of tasks) if (task.sessionId === event.sessionId && task.updatedAt <= event.at) tasks.delete(id);
    return;
  }
  if (!event.state) return;
  const current = tasks.get(event.id);
  const inputChange = !!(event.inputOpened?.length || event.inputResolved?.length || event.resetInputs);
  const stale = !!current && current.updatedAt > event.at;
  if (stale && !inputChange) return;
  if (current && current.source !== "session" && event.source === "session") {
    if (current.source === "cli" || !inputChange && event.state !== "working" && event.waitReason !== "quota") return;
  }
  if ((current?.quotaPaused || current?.waitReason === "quota") && (event.hookEvent === "Stop" || event.hookEvent === "SubagentStop") && event.state === "done") return;
  let quotaPaused = current?.quotaPaused || current?.waitReason === "quota";
  if (!stale && event.waitReason === "quota") quotaPaused = true;
  else if (!stale && (event.state === "idle" || event.state === "working" && !event.inputResolved?.length && !event.inputOpened?.length)) quotaPaused = false;
  const pending = new Set(current?.pendingInputIds || []);
  const resolved = new Set(current?.resolvedInputIds || []);
  if (event.resetInputs) {
    for (const id of pending) resolved.add(id);
    pending.clear();
  }
  for (const id of event.inputResolved || []) {
    resolved.add(id);
    for (const openId of pending) if (openId === id || openId.startsWith(id + ":")) pending.delete(openId);
  }
  for (const id of event.inputOpened || []) {
    if (![...resolved].some((closedId) => id === closedId || id.startsWith(closedId + ":"))) pending.add(id);
  }
  let state = stale ? current.state : event.state;
  let waitReason = stale ? current.waitReason : event.waitReason;
  if (quotaPaused) {
    state = "waiting";
    waitReason = "quota";
  } else if (pending.size) {
    state = "waiting";
    waitReason = "input";
  } else if (state === "waiting" && waitReason === "input" && current?.pendingInputIds?.length) {
    state = "working";
    waitReason = void 0;
  } else if (state === "waiting" && waitReason === "input" && event.inputOpened?.length) {
    state = current?.state || "working";
    waitReason = current?.waitReason;
  }
  const source = current?.source === "hook" && event.source === "session" ? "hook" : event.source;
  tasks.set(event.id, {
    id: event.id,
    sessionId: event.sessionId,
    state,
    source,
    updatedAt: Math.max(current?.updatedAt || 0, event.at),
    workspace: event.workspace,
    waitReason: state === "waiting" ? waitReason : void 0,
    pendingInputIds: pending.size ? [...pending] : void 0,
    resolvedInputIds: resolved.size ? [...resolved].slice(-128) : void 0,
    quotaPaused: quotaPaused || void 0
  });
}
function assistantNeedsInput(message) {
  if (typeof message !== "string") return false;
  const ending = message.trim().split(/\n\s*\n/).at(-1)?.slice(-400) || "";
  return /(?:你|您|请问|是否|能否|可否|哪|什么|多少|怎么|如何|would you|could you|can you|which|what|how|do you)[^。！!\n]*[?？][\s*”"')）]*$/i.test(ending) || /(?:^|[。！？\n])\s*(?:请(?:你)?|需要你|等待你|麻烦你).{0,35}(?:确认|授权|批准|选择|补充|提供|回复)|(?:^|[.!?\n])\s*(?:please|i need you to|waiting for you to).{0,60}(?:confirm|approve|provide|choose|reply)/i.test(ending);
}
function isBlockingInputTool(name) {
  return /(?:^|[.:/_])(?:request_user_input(?:_async)?|ask_user|askuserquestion)$/i.test(name);
}
function isAsyncInputTool(name) {
  return /(?:^|[.:/_])request_user_input_async$/i.test(name);
}
function inputRequestIds(name, callId, input) {
  if (!isBlockingInputTool(name)) return [];
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const questions = value && typeof value === "object" ? value.questions : null;
  const count = Array.isArray(questions) && questions.length ? questions.length : 1;
  const id = typeof callId === "string" && callId ? callId : name.split(/[.:/]/).at(-1);
  return Array.from({ length: count }, (_, index) => `${id}:${index}`);
}
function answeredInputIds(message) {
  if (typeof message !== "string") return null;
  const match = message.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
  if (!match) return null;
  try {
    const replies = JSON.parse(match[1]);
    if (!Array.isArray(replies)) return [];
    return replies.flatMap((reply) => {
      try {
        const [name, callId, index] = JSON.parse(reply.questionItemId);
        return typeof name === "string" && isBlockingInputTool(name) && typeof callId === "string" && Number.isInteger(index) && index >= 0 ? [`${callId}:${index}`] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
function isQuotaPause(error) {
  if (typeof error === "string") {
    return /usage_?limit_?exceeded|insufficient_quota|credit_balance_exhausted|(?:organization|project)_spend_limit_exceeded|(?:hit|reached|exceeded).{0,35}(?:usage limit|quota)|(?:quota|credits?).{0,25}(?:exhausted|depleted|insufficient)|(?:额度|用量|余额).{0,12}(?:耗尽|不足|用完|上限)/i.test(error);
  }
  if (!error || typeof error !== "object") return false;
  const record = error;
  return ["code", "type", "message", "error", "codexErrorInfo", "codex_error_info", "additionalDetails"].some((key) => isQuotaPause(record[key]));
}
function hookTrafficEvent(name, payload, at = Date.now()) {
  const sessionId = String(payload.session_id || payload.thread_id || "").slice(0, 256);
  if (!sessionId) return null;
  const agentId = typeof payload.agent_id === "string" ? payload.agent_id.slice(0, 256) : "";
  const id = agentId ? sessionId + ":" + agentId : sessionId;
  const base = { id, sessionId, source: "hook", at, hookEvent: name, workspace: typeof payload.cwd === "string" ? payload.cwd.slice(0, 1024) : void 0 };
  if (name === "SessionEnd" || name === "Interrupt") return { ...base, endSession: true };
  if (name === "SessionStart") return { ...base, state: "idle", resetInputs: true };
  if (name === "PermissionRequest") return { ...base, state: "waiting", waitReason: "approval" };
  if (name === "PostModelRequest") {
    if (payload.status === "cancelled") return null;
    if (payload.status === "failed" && payload.willRetry !== true && payload.will_retry !== true && isQuotaPause(payload.error)) return { ...base, state: "waiting", waitReason: "quota" };
    return { ...base, state: "working" };
  }
  if (name === "Stop" || name === "SubagentStop") {
    if (name === "SubagentStop" && !agentId) return null;
    const needsInput = assistantNeedsInput(payload.last_assistant_message);
    return { ...base, state: needsInput ? "waiting" : "done", waitReason: needsInput ? "input" : void 0 };
  }
  const tool = String(payload.tool_name || "");
  const toolUseId = payload.tool_use_id || payload.call_id;
  if (name === "PreToolUse" && isBlockingInputTool(tool)) return { ...base, state: "waiting", waitReason: "input", inputOpened: typeof toolUseId === "string" && toolUseId ? inputRequestIds(tool, toolUseId, payload.tool_input) : void 0 };
  if (name === "PostToolUse" && isAsyncInputTool(tool)) return null;
  if (name === "PostToolUse" && isBlockingInputTool(tool)) return { ...base, state: "working", inputResolved: typeof toolUseId === "string" ? [toolUseId] : inputRequestIds(tool, null, payload.tool_input) };
  if (name === "UserPromptSubmit") {
    const answered = answeredInputIds(payload.prompt);
    return { ...base, state: "working", inputResolved: answered || void 0, resetInputs: answered === null };
  }
  if (["UserPromptSubmit", "PreToolUse", "PostToolUse", "PreModelRequest", "SubagentStart"].includes(name)) return { ...base, state: "working" };
  return null;
}

// src/main/services/codex-traffic-store.ts
function trafficDirectory() {
  return import_node_path.default.join(process.env.LOCALAPPDATA || import_node_path.default.join(import_node_os.default.homedir(), "AppData", "Local"), "Nexo", "traffic");
}
function validEvent(value) {
  if (!value || typeof value !== "object") return false;
  const event = value;
  return typeof event.id === "string" && typeof event.sessionId === "string" && Number.isFinite(event.at) && ["hook", "cli", "session"].includes(event.source) && (isTrafficState(event.state) || event.clear === true || event.endSession === true || event.quit === true);
}
function enqueueTraffic(event, directory = trafficDirectory()) {
  if (!validEvent(event)) throw new Error("\u4EFB\u52A1\u72B6\u6001\u65E0\u6548");
  const queue = import_node_path.default.join(directory, "events");
  import_node_fs.default.mkdirSync(queue, { recursive: true });
  const file = import_node_path.default.join(queue, String(event.at).padStart(16, "0") + "-" + process.pid + "-" + (0, import_node_crypto.randomUUID)() + ".json");
  const temporary = file + ".tmp";
  import_node_fs.default.writeFileSync(temporary, JSON.stringify(event), "utf8");
  import_node_fs.default.renameSync(temporary, file);
}
function readTrafficTasks(directory = trafficDirectory()) {
  const tasks = /* @__PURE__ */ new Map();
  try {
    const saved = JSON.parse(import_node_fs.default.readFileSync(import_node_path.default.join(directory, "state.json"), "utf8"));
    for (const task of saved.tasks || []) {
      if (typeof task.id === "string" && typeof task.sessionId === "string" && isTrafficState(task.state) && Number.isFinite(task.updatedAt)) tasks.set(task.id, task);
    }
  } catch {
  }
  return tasks;
}
function queuedFiles(directory) {
  try {
    return import_node_fs.default.readdirSync(import_node_path.default.join(directory, "events")).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
}
function readTrafficSnapshot(directory = trafficDirectory()) {
  const tasks = readTrafficTasks(directory);
  let receipts = [];
  try {
    receipts = JSON.parse(import_node_fs.default.readFileSync(import_node_path.default.join(directory, "state.json"), "utf8")).receipts || [];
  } catch {
  }
  for (const file of queuedFiles(directory)) {
    if (receipts.includes(file)) continue;
    try {
      const event = JSON.parse(import_node_fs.default.readFileSync(import_node_path.default.join(directory, "events", file), "utf8"));
      if (validEvent(event)) applyTrafficEvent(tasks, event);
    } catch {
    }
  }
  return aggregateTraffic(tasks.values());
}

// src/main/services/codex-hook-install.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_os2 = __toESM(require("node:os"), 1);
var CODEX_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "PreModelRequest", "PostModelRequest", "SubagentStart", "SubagentStop", "Stop", "Interrupt", "SessionEnd"];
var codexHome = () => process.env.CODEX_HOME || import_node_path2.default.join(import_node_os2.default.homedir(), ".codex");
function ours(handler) {
  return typeof handler.command === "string" && handler.command.includes("nexo-codex.ps1") && handler.statusMessage === "Nexo Codex \u72B6\u6001\u706F";
}
function read(file) {
  if (!import_node_fs2.default.existsSync(file)) return {};
  const value = JSON.parse(import_node_fs2.default.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value) || value.hooks && (typeof value.hooks !== "object" || Array.isArray(value.hooks))) throw new Error("\u73B0\u6709 hooks.json \u683C\u5F0F\u5F02\u5E38\uFF0C\u8BF7\u5148\u4FEE\u590D\u6587\u4EF6\u3002");
  return value;
}
function removeOwn(config) {
  const hooks = {};
  for (const [event, groups] of Object.entries(config.hooks || {})) {
    if (!Array.isArray(groups)) throw new Error("\u73B0\u6709 Hook \u4E8B\u4EF6\u914D\u7F6E\u683C\u5F0F\u5F02\u5E38\u3002");
    hooks[event] = groups.map((group) => ({ ...group, hooks: (group.hooks || []).filter((handler) => !ours(handler)) })).filter((group) => group.hooks.length);
  }
  return { ...config, hooks };
}
function atomicWrite(file, value) {
  import_node_fs2.default.mkdirSync(import_node_path2.default.dirname(file), { recursive: true });
  if (import_node_fs2.default.existsSync(file)) import_node_fs2.default.copyFileSync(file, file + ".nexo-backup");
  import_node_fs2.default.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n", "utf8");
  import_node_fs2.default.renameSync(file + ".tmp", file);
}
var CodexHookInstaller = class {
  file;
  wrapper;
  source;
  directory;
  executable;
  constructor(source, directory, executable, home = codexHome()) {
    this.source = source;
    this.directory = directory;
    this.executable = executable;
    this.file = import_node_path2.default.join(home, "hooks.json");
    this.wrapper = import_node_path2.default.join(directory, "nexo-codex.ps1");
  }
  status() {
    const config = read(this.file);
    const installed = CODEX_HOOK_EVENTS.every((event) => (config.hooks?.[event] || []).some((group) => group.hooks?.some(ours))) && import_node_fs2.default.existsSync(this.wrapper) && import_node_fs2.default.existsSync(import_node_path2.default.join(this.directory, "nexo-cli.cjs"));
    return { installed, settingsPath: this.file, command: installed ? this.wrapper : null };
  }
  install() {
    const config = removeOwn(read(this.file));
    const script = import_node_fs2.default.readFileSync(this.source, "utf8");
    import_node_fs2.default.mkdirSync(this.directory, { recursive: true });
    import_node_fs2.default.writeFileSync(import_node_path2.default.join(this.directory, "nexo-cli.cjs"), script, "utf8");
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const wrapper = [
      "param([Parameter(ValueFromRemainingArguments=$true)][string[]]$NexoArguments)",
      "$env:ELECTRON_RUN_AS_NODE = '1'",
      "& " + quote(this.executable) + " " + quote(import_node_path2.default.join(this.directory, "nexo-cli.cjs")) + " @NexoArguments",
      "exit $LASTEXITCODE",
      ""
    ].join("\r\n");
    import_node_fs2.default.writeFileSync(this.wrapper, "\uFEFF" + wrapper, "utf8");
    for (const event of CODEX_HOOK_EVENTS) {
      const command = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + this.wrapper + '" hook ' + event;
      (config.hooks[event] ||= []).push({ hooks: [{ type: "command", command, commandWindows: command, timeout: 5, statusMessage: "Nexo Codex \u72B6\u6001\u706F" }] });
    }
    atomicWrite(this.file, config);
    return this.status();
  }
  remove() {
    atomicWrite(this.file, removeOwn(read(this.file)));
    return this.status();
  }
};
function codexHookDirectory() {
  return import_node_path2.default.join(import_node_path2.default.dirname(trafficDirectory()), "codex-hooks");
}

// src/main/services/codex-rate-limits.ts
var import_node_child_process = require("node:child_process");
var import_node_readline = require("node:readline");
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
function parseCodexRateLimits(response) {
  const bucket = response.rateLimitsByLimitId?.codex ?? (!response.rateLimits?.limitId || response.rateLimits.limitId === "codex" ? response.rateLimits : null);
  const windows = [bucket?.primary, bucket?.secondary];
  const read2 = (minutes) => {
    const window = windows.find((item) => item?.windowDurationMins === minutes);
    if (!window || !Number.isFinite(window.usedPercent) || !Number.isFinite(window.resetsAt) || window.resetsAt <= 0) {
      return { pct: null, resetMs: 0 };
    }
    return {
      pct: Math.round(Math.min(100, Math.max(0, window.usedPercent))),
      resetMs: window.resetsAt * 1e3
    };
  };
  return { primary: read2(300), secondary: read2(10080) };
}
function codexCommand() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const root = import_node_path3.default.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    try {
      const candidates = import_node_fs3.default.readdirSync(root).map((name) => import_node_path3.default.join(root, name, "codex.exe")).filter((file) => import_node_fs3.default.existsSync(file)).sort((a, b) => import_node_fs3.default.statSync(b).mtimeMs - import_node_fs3.default.statSync(a).mtimeMs);
      if (candidates[0]) return candidates[0];
    } catch {
    }
  }
  return "codex";
}
function readCodexRateLimits(command = codexCommand(), args = ["app-server"]) {
  return new Promise((resolve, reject) => {
    const child = (0, import_node_child_process.spawn)(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const lines = (0, import_node_readline.createInterface)({ input: child.stdout });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("Codex \u989D\u5EA6\u8BFB\u53D6\u8D85\u65F6")), 2e4);
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    child.on("error", () => finish(new Error("\u627E\u4E0D\u5230 Codex CLI\uFF0C\u8BF7\u5B89\u88C5 CLI \u6216\u8BBE\u7F6E CODEX_CLI_PATH")));
    child.stdin.on("error", () => finish(new Error("Codex app-server \u8F93\u5165\u901A\u9053\u5DF2\u5173\u95ED")));
    child.on("exit", () => finish(new Error("Codex app-server \u63D0\u524D\u9000\u51FA\uFF0C\u8BF7\u68C0\u67E5\u767B\u5F55\u72B6\u6001")));
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) {
        finish(new Error("Codex \u989D\u5EA6\u63A5\u53E3\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5 CLI \u7248\u672C\u4E0E ChatGPT \u767B\u5F55\u72B6\u6001"));
        return;
      }
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read" });
      } else if (message.result && typeof message.result === "object") {
        finish(null, message.result);
      } else {
        finish(new Error("Codex \u989D\u5EA6\u54CD\u5E94\u683C\u5F0F\u65E0\u6548"));
      }
    });
    send({ id: 1, method: "initialize", params: {
      clientInfo: { name: "nexo_band9", title: "Nexo", version: "0.3.0" }
    } });
  });
}
async function fetchCodexUsage() {
  return parseCodexRateLimits(await readCodexRateLimits());
}

// scripts/nexo-cli.ts
async function stdinJson() {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > 1048576) throw new Error("Hook \u8F93\u5165\u8FC7\u5927");
  }
  return text.trim() ? JSON.parse(text) : {};
}
async function runNexoCli(args = process.argv.slice(2)) {
  const command = args[0] || "status";
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : void 0;
  };
  const directory = option("--data-dir") || trafficDirectory();
  if (command === "hook") {
    try {
      const payload = await stdinJson();
      const event = hookTrafficEvent(args[1] || String(payload.hook_event_name || ""), payload);
      if (event) enqueueTraffic(event, directory);
    } catch {
    }
    process.stdout.write("{}");
    return;
  }
  if (command === "hooks") {
    const installer = new CodexHookInstaller(process.argv[1], codexHookDirectory(), option("--runtime") || process.execPath, option("--home"));
    const result = args[1] === "install" ? installer.install() : args[1] === "remove" ? installer.remove() : installer.status();
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "quit") {
    enqueueTraffic({ id: "control", sessionId: "control", source: "cli", at: Date.now(), quit: true }, directory);
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify(readTrafficSnapshot(directory), null, 2));
    return;
  }
  if (command === "quota") {
    console.log(JSON.stringify(await fetchCodexUsage(), null, 2));
    return;
  }
  if (command === "clear" || isTrafficState(command)) {
    const id = option("--task") || "manual";
    enqueueTraffic({ id, sessionId: id, source: "cli", at: Date.now(), state: isTrafficState(command) ? command : void 0, clear: command === "clear", workspace: option("--workspace") }, directory);
    console.log(JSON.stringify(readTrafficSnapshot(directory), null, 2));
    return;
  }
  if (command === "help" || command === "--help") {
    console.log("Nexo Codex CLI\n  working | waiting | done | idle [--task ID] [--workspace PATH]\n  status | clear | quota | quit\n  hooks install | remove | status [--runtime PATH]\n  --data-dir PATH \u53EF\u6307\u5B9A\u72B6\u6001\u76EE\u5F55");
    return;
  }
  throw new Error("\u672A\u77E5\u547D\u4EE4\uFF0C\u8FD0\u884C help \u67E5\u770B\u7528\u6CD5");
}
if (!process.env.NEXO_CLI_LIBRARY) runNexoCli().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runNexoCli
});
