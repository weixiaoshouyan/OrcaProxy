// ============================================================
// src/agent/loop.ts
// Core agent execution loop, tool dispatch, and stream helpers
// Optimized for better streaming, error handling, and progress tracking
// ============================================================

import { log } from "../utils/log";
import {
  type TaskState, saveTaskState, updateStepStatus,
  nextPendingStep, type ToolResultRecord,
} from "./task-state";
import {
  validateTodos, todoCounts, todoReceipt, advanceTodos, matchTodoStep, renderTodoLine,
} from "./todo";
import { maybeSummarize } from "../agent/summarizer";
import { scheduleToolCalls } from "./scheduler";
import { evaluateToolGuards } from "./guards";
import { handleAgentToolCall } from "../services/tools";
import { saveTurnCheckpoint } from "../services/checkpoints";
import {
  isMcpToolAllowed, requestMcpApproval,
  type PendingApproval,
} from "../services/mcp-permissions";
import { ensureToolPairing, dropOrphanedToolResults } from "./compression";
import { TOOL_TIMEOUT_MS } from "../utils/helpers";
import { getCachedToolResult, setCachedToolResult, CACHEABLE_TOOLS, invalidateCache } from "../services/tool-cache";
import { logAudit } from "../services/audit";
import type { ChatMessage, ToolDefinition, ToolCall, StreamChunk, ResolvedModel } from "./types";
import type { Response } from "express";
import { createAgentEvent, formatAgentEvent, type AgentEventType } from "./events";

// ---- Agent event broadcasting (real-time SSE progress) ----

function broadcast(type: AgentEventType, taskId: string, data: Record<string, unknown> = {}): void {
  try {
    const fn = (global as any).__orca_broadcastAgentEvent;
    if (typeof fn === "function") fn(formatAgentEvent(createAgentEvent(type, taskId, data)));
  } catch (e) { /* ignore */ }
}

// ---- Tool category helpers ----

const READ_ONLY_TOOLS = new Set(["read_workspace_file", "search_grep", "glob_files", "list_workspace_files", "list_available_skills", "get_skill_details", "list_directory", "semantic_search_code"]);
const WRITE_TOOLS = new Set(["write_workspace_file", "patch_workspace_file", "multi_edit", "batch_write_files", "run_terminal_command", "run_skill_script"]);

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

// ---- Turn checkpoint persistence (snapshot the workspace at turn boundaries) ----

export function saveTurnCheckpointIfChanged(taskState: TaskState, messages: ChatMessage[]): void {
  const turn = Number(taskState.metadata?.checkpointTurn || 0);
  if (turn === 0) return;
  if (taskState.metadata?.checkpointSaved === turn) return;
  const userMsg = [...messages].reverse().find((m) => m.role === "user");
  let prompt = "";
  if (userMsg) {
    const content = userMsg.content as any;
    if (typeof content === "string") prompt = content;
    else if (Array.isArray(content)) {
      prompt = content.filter((c: any) => c.type === "text").map((c: any) => c.text || "").join(" ");
    }
  }
  const saved = saveTurnCheckpoint({
    conversationId: taskState.taskId,
    workspacePath: taskState.workspacePath,
    turn,
    prompt,
    messageCount: messages.length,
  });
  if (saved) {
    taskState.metadata.checkpointSaved = turn;
    broadcast("checkpoint", taskState.taskId, { turn, files: saved.files.length, messageCount: saved.messageCount });
  }
}

export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

function mcpToolNameForDisplay(name: string): string {
  const parts = name.split("__");
  if (parts.length >= 3) return `${parts[1]} / ${parts.slice(2).join("__")}`;
  return name;
}

export function formatApprovalRequest(pending: PendingApproval): string {
  return `\n\n[MCP Approval Required]\nTask: ${pending.taskId}\nTool: ${mcpToolNameForDisplay(pending.toolName)}\nToolCallId: ${pending.toolCallId}\nArguments: ${pending.arguments}\n\nThis MCP tool is not in the allowlist. Please approve it in the MCP Permissions page, then resume the task.\n`;
}

// ---- Anthropic max output tokens ----

const ANTHROPIC_MAX_OUTPUT: Record<string, number> = {
  "claude-3-opus": 4096,
  "claude-3-sonnet": 4096,
  "claude-3-haiku": 4096,
  "claude-3.5-sonnet": 8192,
  "claude-3-5-haiku": 8192,
  "claude-3.5-haiku": 8192,
  "claude-sonnet-4": 16384,
  "claude-opus-4": 16384,
};

export function getAnthropicMaxOutput(model: string): number {
  const m = model.toLowerCase();
  if (ANTHROPIC_MAX_OUTPUT[m] !== undefined) return ANTHROPIC_MAX_OUTPUT[m];
  const sorted = Object.keys(ANTHROPIC_MAX_OUTPUT).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (m.includes(key)) return ANTHROPIC_MAX_OUTPUT[key];
  }
  return 8192;
}

// ---- Chunk helper ----

export function mkChunk(parsed: StreamChunk | null, model: string, content: string, finishReason: string | null = null): StreamChunk {
  return {
    id: parsed?.id || ("chatcmpl-" + Date.now()),
    object: "chat.completion.chunk",
    created: parsed?.created || Math.floor(Date.now() / 1000),
    model: parsed?.model || model,
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }]
  };
}

// ---- Fetch with Retry ----

export async function fetchWithRetry(url: string, options: RequestInit & { timeoutMs?: number }, retries = 3, delay = 2000) {
  const timeoutMs = options?.timeoutMs ?? 600000;
  const { timeoutMs: _om, ...fetchOptions } = options;
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutId);

      if (resp.status === 429) {
        const retryAfter = resp.headers.get("retry-after");
        const parsedRetry = retryAfter ? parseInt(retryAfter, 10) : NaN;
        // Cap the wait: upstream misconfigurations must not stall the agent
        // for hours. Max 60s per attempt, and never NaN.
        const wait = Math.min(Number.isFinite(parsedRetry) && parsedRetry > 0 ? parsedRetry * 1000 : delay * Math.pow(2, i), 60_000);
        log("warn", `[Chat] Upstream rate limited (429). Waiting ${wait}ms before retry ${i + 1}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      if (!resp.ok && resp.status >= 500) {
        const wait = delay * Math.pow(2, i);
        log("warn", `[Chat] Upstream server error (${resp.status}). Waiting ${wait}ms before retry ${i + 1}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      return resp;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const errMsg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        log("warn", `[Chat] Upstream request timed out (${timeoutMs / 1000}s).`);
        if (i === retries - 1) throw new Error(`Upstream request timed out after ${timeoutMs / 1000} seconds`);
      } else {
        log("warn", `[Chat] Upstream fetch error: ${errMsg}.`);
        if (i === retries - 1) throw err;
      }
      const wait = delay * Math.pow(2, i);
      log("warn", `[Chat] Waiting ${wait}ms before retry ${i + 1}/${retries}...`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw new Error("Failed to fetch after retries");
}

// ---- Tool timeout wrapper ----

async function withToolTimeout<T>(promise: Promise<T>, toolName: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ---- Execute tools in parallel (with dependency-aware scheduling) ----

export interface ToolExecutionResult {
  records: ToolResultRecord[];
  aborted: boolean;
}

/**
 * Host-handled Reasonix-style meta tools: todo_write and complete_step.
 * These never reach the generic tool executor 鈥?the host validates state,
 * updates taskState.todos, emits synthetic stream text and advances the list.
 */
function handleTodoMetaTool(
  toolName: string,
  args: any,
  workspacePath: string,
  readOnlyMode: boolean,
  records: ToolResultRecord[],
  taskState: TaskState | undefined,
  writeDelta: (text: string) => void
): string {
  if (!taskState) return "Error: no active task state.";

  if (toolName === "todo_write") {
    const rawTodos = Array.isArray(args?.todos) ? args.todos : null;
    if (!rawTodos) return "Error: todos parameter must be an array.";
    const normalized = rawTodos.map((t: any) => ({
      content: String(t?.content ?? "").slice(0, 300),
      status: (["pending", "in_progress", "completed"].includes(t?.status) ? t.status : "pending") as any,
      ...(t?.activeForm ? { activeForm: String(t.activeForm).slice(0, 120) } : {}),
      ...(t?.level === 0 || t?.level === 1 ? { level: t.level } : {}),
    }));
    const validation = validateTodos(normalized);
    if (!validation.ok) return `Error: ${validation.error}`;
    taskState.todos = normalized;
    saveTaskState(taskState);
    const receipt = todoReceipt(normalized);
    // Synthetic one-line stream update (Reasonix-style: progress lives in the
    // todo state, not in model text).
    writeDelta(`\n> 馃搵 ${renderTodoLine(normalized)}\n`);
    broadcast("task_plan", taskState.taskId, { todos: normalized, phase: taskState.phase });
    return receipt;
  }

  if (toolName === "complete_step") {
    if (readOnlyMode) {
      return "[Blocked] complete_step is only available in Build mode (plan mode is read-only).";
    }
    if (!Array.isArray(taskState.todos) || taskState.todos.length === 0) {
      return "Error: no todo list established 鈥?call todo_write first.";
    }
    const step = String(args?.step ?? "");
    const idx = matchTodoStep(taskState.todos, step, typeof args?.step_index === "number" ? args.step_index : undefined);
    if (idx < 0) return `Error: step "${step.slice(0, 80)}" not found in the todo list. Use the exact step title or its 1-based number.`;
    const item = taskState.todos[idx];
    if (item.status === "completed") return `Step "${item.content}" is already completed.`;
    if (item.level === 0) {
      const subs = taskState.todos.slice(idx + 1).filter((t) => (t.level ?? 1) === 1);
      if (subs.some((s) => s.status !== "completed")) {
        return `Error: phase "${item.content}" has unfinished sub-steps 鈥?sign off its sub-steps first.`;
      }
    }

    const resultText = String(args?.result ?? "").trim();
    if (!resultText) return "Error: result is required (what is now true after this step).";
    const evidence: any[] = Array.isArray(args?.evidence) ? args.evidence : [];
    if (evidence.length === 0) return "Error: at least one evidence item is required.";

    // Build the session ledger from this batch's records AND the persisted
    // task history (cross-round evidence): successfully run commands and
    // successfully written file paths.
    const successCommands = new Set<string>();
    const writtenPaths = new Set<string>();
    // Same failure markers used by the verifier; exit code is authoritative.
    const failedOutput = /^\[Exit Code [^0]|\[Command Timeout|^\[Execution Error|^Error:/;
    const allRecords = [...records, ...(taskState?.results ?? [])];
    for (const r of allRecords) {
      if (failedOutput.test(r.output)) continue;
      try {
        const a = JSON.parse(r.arguments);
        if (r.name === "run_terminal_command" && a?.command) successCommands.add(String(a.command).trim());
        // Written-path parsing per tool: the write tools use relativeFilePath
        // (batch_write_files: files[].relativeFilePath), older paths/filePath
        // kept as fallback.
        if (r.name === "write_workspace_file" || r.name === "patch_workspace_file" || r.name === "multi_edit") {
          if (typeof a?.relativeFilePath === "string") writtenPaths.add(a.relativeFilePath);
        } else if (r.name === "batch_write_files" && Array.isArray(a?.files)) {
          for (const f of a.files) {
            if (f && typeof f.relativeFilePath === "string") writtenPaths.add(f.relativeFilePath);
          }
        }
        if (typeof a?.filePath === "string") writtenPaths.add(a.filePath);
        if (Array.isArray(a?.paths)) {
          for (const p of a.paths) writtenPaths.add(String(p));
        }
      } catch { /* ignore malformed args */ }
    }

    let hostVerified = 0;
    let manualCount = 0;
    const kinds: string[] = [];
    for (const ev of evidence) {
      const kind = String(ev?.kind ?? "");
      kinds.push(kind);
      if (kind === "verification") {
        const cmd = String(ev?.command ?? "").trim();
        if (cmd && successCommands.has(cmd)) { hostVerified++; continue; }
        return `Error: verification evidence rejected 鈥?command "${cmd || "<missing>"}" did not run successfully in this session. Run it first, then sign off.`;
      }
      if (kind === "diff" || kind === "files") {
        const paths: string[] = Array.isArray(ev?.paths) ? ev.paths.map((p: any) => String(p)) : [];
        if (paths.length > 0 && paths.every((p) => writtenPaths.has(p))) { hostVerified++; continue; }
        return `Error: ${kind} evidence rejected 鈥?paths were not written successfully in this session: ${paths.join(", ") || "<none>"}`;
      }
      if (kind === "manual") { manualCount++; continue; }
      if (kind === "review") { manualCount++; continue; } // no in-process review system: counted, not host-verified
    }
    if (hostVerified === 0) {
      return "Error: no host-verifiable evidence 鈥?include a verification command that ran successfully, or paths that were written this session.";
    }

    // Sign off + advance
    taskState.todos[idx].status = "completed";
    taskState.todos = advanceTodos(taskState.todos);
    saveTaskState(taskState);
    const c = todoCounts(taskState.todos);
    const receipt =
      `Step "${item.content}" signed off with ${evidence.length} evidence item(s) [${kinds.join(", ")}]. ` +
      `Host evidence: host-verified ${hostVerified}, manual/unverified ${manualCount}. ` +
      `Todos: ${c.completed}/${c.total} completed. The host advanced the task list; continue with the next step.`;
    writeDelta(`\n鉁?**${item.content}** 鈥?${resultText.slice(0, 300)}\n`);
    if (c.inProgress > 0) {
      writeDelta(`\n> 馃搵 ${renderTodoLine(taskState.todos)}\n`);
    }
    broadcast("task_plan", taskState.taskId, { todos: taskState.todos, phase: taskState.phase });
    return receipt;
  }

  if (toolName === "update_goal") {
    const status = ["continue", "complete", "blocked"].includes(String(args?.status ?? "")) ? String(args.status) : "continue";
    taskState.metadata.goalStatus = status;
    taskState.metadata.goalReason = String(args?.reason ?? "").slice(0, 500);
    taskState.metadata.goalNextAction = String(args?.next_action ?? "").slice(0, 300);
    if (status === "blocked") {
      taskState.phase = "replan";
      taskState.metadata.replanReason = `[Goal blocked] ${String(args?.reason ?? "").slice(0, 300)}`;
    }
    saveTaskState(taskState);
    const parts = [`[Goal declared: ${status}]`];
    if (args?.reason) parts.push(`Reason: ${String(args.reason).slice(0, 200)}`);
    if (args?.next_action) parts.push(`Next action: ${String(args.next_action).slice(0, 200)}`);
    if (status === "complete") parts.push("The host will verify the delivery gate (all todo items signed off) before ending the turn.");
    return parts.join(" ");
  }

  return `Error: unknown meta tool ${toolName}`;
}

export async function executeToolsInParallel(
  toolCalls: ToolCall[],
  writeDelta: (text: string) => void,
  messages: ChatMessage[],
  workspacePath: string,
  res: Response,
  isClientGone: () => boolean,
  resolved?: ResolvedModel,
  taskState?: TaskState,
  readOnlyMode: boolean = false
): Promise<ToolExecutionResult> {
  const MAX_TOOL_OUTPUT = 30 * 1024;
  const records: ToolResultRecord[] = [];
  let aborted = false;

  const cpContext = taskState?.taskId
    ? { conversationId: taskState.taskId, workspacePath, turn: Number(taskState.metadata?.checkpointTurn || 0) }
    : null;

  const scheduled = scheduleToolCalls(toolCalls.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })));

  for (let batchIdx = 0; batchIdx < scheduled.length; batchIdx++) {
    const batch = scheduled[batchIdx];
    if (isClientGone()) {
      log("info", "[Chat] Client disconnected, aborting tool execution.");
      aborted = true;
      break;
    }

    const runningStep = taskState ? nextPendingStep(taskState) : undefined;
    if (taskState && runningStep) updateStepStatus(taskState, runningStep.id, "running");

    const names = batch.map((tc) => tc.name).join(", ");
    const batchStartTime = Date.now();
    writeDelta(`\n\n> 馃敡 **Agent Executing ${batch.length > 1 ? `${batch.length} tools in parallel` : "Tool"}:** \`${names}\`...\n`);
    if (taskState) {
      for (const tc of batch) {
        broadcast("tool_start", taskState.taskId, { toolName: tc.name, toolCallId: tc.id, arguments: tc.arguments });
      }
    }

    const toolKeepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, 15000);

    let outputs: string[];
    try {
      const batchToolCalls = batch.map((b) => toolCalls.find((tc) => tc.id === b.id)).filter((tc): tc is ToolCall => tc !== undefined);

      for (const tc of batchToolCalls) {
        const toolName = tc.function.name;
        if (isMcpTool(toolName) && !isMcpToolAllowed(toolName)) {
          const pending: PendingApproval = {
            taskId: taskState?.taskId || "unknown",
            toolCallId: tc.id,
            toolName,
            arguments: tc.function.arguments || "{}",
            requestedAt: Date.now(),
          };
          requestMcpApproval(pending);
          if (taskState) {
            taskState.phase = "pending_approval";
            saveTaskState(taskState);
          }
          const approvalText = formatApprovalRequest(pending);
          writeDelta(approvalText);
          clearInterval(toolKeepAlive);
          return { records, aborted: true };
        }
      }

      if (batch.length > 1 && batch.every((tc) => isReadOnlyTool(tc.name))) {
        outputs = await Promise.all(batchToolCalls.map((tc) => {
          const toolName = tc.function.name;
          let parsedArgs: Record<string, unknown> = {};
          try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore */ }

          if (CACHEABLE_TOOLS.has(toolName)) {
            const cached = getCachedToolResult(toolName, parsedArgs, workspacePath);
            if (cached !== null) return Promise.resolve(`[Cached] ${cached}`);
          }

          return withToolTimeout(handleAgentToolCall(tc, workspacePath, cpContext), toolName)
            .then((result) => {
              if (CACHEABLE_TOOLS.has(toolName) && !result.startsWith("Error:")) {
                setCachedToolResult(toolName, parsedArgs, result, workspacePath);
              }
              return result;
            })
            .catch((err: Error) => {
              log("warn", `[Tool] ${toolName} failed: ${err.message}`);
              return `Error: ${toolName} failed: ${err.message}`;
            });
        }));
      } else {
        outputs = [];
        for (const tc of batchToolCalls) {
          if (isClientGone()) { aborted = true; break; }
          const toolName = tc.function.name;
          let parsedArgs: Record<string, unknown> = {};
          try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore */ }

          // Plan / read-only mode gate: only read-only tools may execute.
          // This is the enforcement point 鈥?even if a tool sneaks into the
          // injected tool list, execution is refused here.
          if (readOnlyMode && !isReadOnlyTool(toolName)) {
            log("warn", `[Gate] Tool "${toolName}" blocked in read-only mode`);
            outputs.push(`[Blocked] Tool "${toolName}" is not allowed in read-only (plan) mode. Only read-only tools can be used here.`);
            continue;
          }

          if (CACHEABLE_TOOLS.has(toolName)) {
            const cached = getCachedToolResult(toolName, parsedArgs, workspacePath);
            if (cached !== null) { outputs.push(`[Cached] ${cached}`); continue; }
          }

          // ---- Reasonix-style todo bookkeeping (host-handled meta tools) ----
          if (toolName === "todo_write" || toolName === "complete_step" || toolName === "update_goal") {
            const metaResult = handleTodoMetaTool(toolName, parsedArgs, workspacePath, readOnlyMode, records, taskState, writeDelta);
            outputs.push(metaResult);
            continue;
          }

          let result: string;
          try {
            result = await withToolTimeout(handleAgentToolCall(tc, workspacePath, cpContext), toolName);
          } catch (err: any) {
            log("warn", `[Tool] ${toolName} failed: ${err.message}`);
            result = `Error: ${toolName} failed: ${err.message}`;
          }
          if (CACHEABLE_TOOLS.has(toolName) && !result.startsWith("Error:")) {
            setCachedToolResult(toolName, parsedArgs, result, workspacePath);
          }
          outputs.push(result);
        }
      }
    } finally {
      clearInterval(toolKeepAlive);
    }

    if (aborted) break;

    const batchDuration = Date.now() - batchStartTime;

    for (let j = 0; j < batch.length; j++) {
      const tc = toolCalls.find((t) => t.id === batch[j].id);
      if (!tc) continue;
      const rawOutput = outputs[j] || "Error: No output";
      const output = resolved
        ? await maybeSummarize(rawOutput, resolved.provider, resolved.apiKey, tc.function.name)
        : rawOutput;

      const durationStr = batch.length > 1 ? ` (${Math.round(batchDuration / 1000)}s)` : "";
      writeDelta(`\n\`\`\`\n${output.slice(0, 500)}${output.length > 500 ? '\n... [truncated]' : ''}\n\`\`\`${durationStr}\n`);

      if (taskState) {
        const failed = output.startsWith("Error:") || output.includes("[Execution Error]");
        broadcast(failed ? "tool_error" : "tool_result", taskState.taskId, {
          toolName: tc.function.name,
          toolCallId: tc.id,
          durationMs: batchDuration,
          error: failed ? output.slice(0, 500) : undefined,
        });
      }

      let toolContent = output;
      if (toolContent.length > MAX_TOOL_OUTPUT) {
        toolContent = toolContent.substring(0, MAX_TOOL_OUTPUT) + "\n\n[Output truncated to prevent request overflow]";
      }

      const isLastGlobally = batchIdx === scheduled.length - 1 && j === batch.length - 1;
      if (isLastGlobally) {
        toolContent += `\n\n[System Reminder: Keep your text response minimal. Update progress via todo_write (flip statuses) and sign off finished steps with complete_step (with evidence); the host advances the list for you. Then continue executing or summarize the results.]`;
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: toolContent } satisfies ChatMessage);

      records.push({
        toolCallId: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        output: rawOutput,
        summary: output !== rawOutput ? output : undefined,
      });

      // Audit log for write operations
      if (isWriteTool(tc.function.name) || isMcpTool(tc.function.name)) {
        logAudit({
          timestamp: new Date().toISOString(),
          action: tc.function.name === "run_terminal_command" ? "command_execute"
            : tc.function.name === "run_skill_script" ? "skill_run"
            : isMcpTool(tc.function.name) ? "mcp_tool_call"
            : "file_write",
          taskId: taskState?.taskId,
          toolName: tc.function.name,
          arguments: (() => { try { return JSON.parse(tc.function.arguments || "{}"); } catch { return {}; } })(),
          result: rawOutput.slice(0, 500),
          success: !rawOutput.startsWith("Error:"),
          durationMs: batchDuration,
        });
      }
    }

    // Invalidate the read-only tool cache after any successful write, so
    // subsequent reads (read_workspace_file / search_grep / glob) see fresh
    // content instead of up-to-5-minute-old stale results.
    if (records.some((r) => isWriteTool(r.name) && !r.output.startsWith("Error:"))) {
      invalidateCache();
    }

    if (runningStep) {
      const errorPatterns = [/\[Execution Error\]/, /\[Exit Code [^0]/, /Error: /, /error: /];
      const hadError = outputs.some((o) => errorPatterns.some((p) => p.test(o)));
      updateStepStatus(taskState!, runningStep.id, hadError ? "failed" : "completed", {
        result: outputs.join("\n").slice(0, 500),
        error: hadError ? outputs.join("\n").slice(0, 500) : undefined,
      });
      broadcast(hadError ? "step_fail" : "step_complete", taskState!.taskId, {
        stepId: runningStep.id,
        description: runningStep.description,
        durationMs: batchDuration,
      });
    }
  }

  // Loop guards: storm breaker / repeat-failure / repeat-success.
  if (taskState && records.length > 0) {
    const verdict = evaluateToolGuards(taskState, records);
    if (verdict.hardStop) {
      writeDelta(`\n\n> 馃洃 **${verdict.note}**\n`);
      log("error", `[Guard] Hard stop: ${verdict.note}`);
      if (taskState) {
        taskState.phase = "replan";
        taskState.metadata.hardStop = verdict.note;
        saveTaskState(taskState);
      }
      if (!res.writableEnded) {
        try { res.end(); } catch { /* already closed */ }
      }
      return { records, aborted: true };
    }
    if (verdict.note) {
      const lastToolMsg = [...messages].reverse().find((m) => m.role === "tool");
      if (lastToolMsg) {
        const content = typeof lastToolMsg.content === "string" ? lastToolMsg.content : "";
        lastToolMsg.content = `${content}\n\n[${verdict.note}]`;
      }
      writeDelta(`\n\n> 鈿狅笍 **${verdict.note}**\n`);
    }
  }

  // Ask tool: pause task and wait for user answer.
  const askRecord = records.find((r) => r.output.includes("[ASK_QUESTION]"));
  if (askRecord && taskState) {
    taskState.phase = "pending_approval";
    taskState.metadata.pendingAsk = {
      toolCallId: askRecord.toolCallId,
      question: askRecord.output.slice("[ASK_QUESTION]".length, askRecord.output.indexOf("\n") >= 0 ? askRecord.output.indexOf("\n") : undefined).trim(),
      options: (askRecord.output.match(/^\d+\. (.+)$/gm) || []).map((m) => m.replace(/^\d+\. /, "")),
    };
    saveTaskState(taskState);
    broadcast("task_error", taskState.taskId, { ask: taskState.metadata.pendingAsk });
    writeDelta(`\n\n> 鉂?**${taskState.metadata.pendingAsk.question}**\n${(taskState.metadata.pendingAsk.options as string[] || []).map((o: string, i: number) => `${i + 1}. ${o}`).join("\n")}\n\n*${"Waiting for your answer 鈥?the task will resume when you reply."}*\n`);
    return { records, aborted: true };
  }

  return { records, aborted };
}

// ---- Truncate messages if too large (preserves tool pairing) ----

export function truncateMessagesIfNeeded(messages: ChatMessage[]): void {
  let estimatedSize = 0;
  for (const msg of messages) {
    const contentLen = typeof msg.content === "string" ? msg.content.length : (msg.content ? JSON.stringify(msg.content).length : 0);
    estimatedSize += contentLen + 100;
    if (msg.tool_call_id) estimatedSize += msg.tool_call_id.length + 50;
    if (msg.tool_calls) estimatedSize += JSON.stringify(msg.tool_calls).length;
  }
  const MAX_MESSAGES_SIZE = 800 * 1024;
  if (estimatedSize > MAX_MESSAGES_SIZE) {
    log("warn", `[Chat] Messages array too large (~${Math.round(estimatedSize / 1024)}KB), truncating older messages`);
    const systemMsg = messages.find((m) => m.role === "system");
    const activeMessages = messages.filter((m) => m.role !== "system");
    let keepStart = Math.max(0, activeMessages.length - 30);
    keepStart = ensureToolPairing(activeMessages, keepStart);
    const recentMessages = dropOrphanedToolResults(activeMessages.slice(keepStart));
    messages.length = 0;
    if (systemMsg) messages.push(systemMsg);
    messages.push(...recentMessages);
    log("info", `[Chat] Truncated to ${messages.length} messages (paired: ${recentMessages.filter(m => m.tool_call_id).length} tool results)`);
  }
}

// ---- Core Agent Execution Loop ----

interface AgentRequestBody {
  model?: string;
  messages?: ChatMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  tool_choice?: unknown;
  activeSkillId?: string;
  useAgent?: boolean;
  workspacePath?: string;
  resumeTaskId?: string;
  taskId?: string;
  [key: string]: unknown;
}

