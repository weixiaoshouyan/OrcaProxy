// ============================================================
// src/agent/loop.ts
// Core agent execution loop, tool dispatch, and stream helpers
// Optimized for better streaming, error handling, and progress tracking
// ============================================================

import { loadConfig } from "../providers";
import { log } from "../utils/log";
import {
  type TaskState, createTaskState, loadTaskState, saveTaskState, updateStepStatus,
  formatTaskPlan, nextPendingStep, type ToolResultRecord,
} from "./task-state";
import { parseTaskPlan, mergeTaskPlan, buildReplanPrompt, parsePlanProgress, applyPlanProgress } from "./planner";
import { verifyToolResults } from "./verifier";
import { maybeSummarize } from "../agent/summarizer";
import { generateReflection, buildReflectionPrompt } from "./reflection";
import { scheduleToolCalls } from "./scheduler";
import { evaluateToolGuards } from "./guards";
import { recordEvidence, buildDeliveryReport, checkDeliveryGate } from "./ledger";
import { releaseAllClaims, clearStaleClaims } from "./claims";
import { handleAgentToolCall } from "../services/tools";
import { saveTurnCheckpoint } from "../services/checkpoints";
import {
  isMcpToolAllowed, requestMcpApproval,
  type PendingApproval,
} from "../services/mcp-permissions";
import { accumulateCost } from "../services/billing";
import { buildProbeUrl } from "../services/health";
import { setCachedResponse } from "../cache";
import { compressContextIfNeeded } from "./compression";
import { ensureToolPairing, dropOrphanedToolResults } from "./compression";
import { TOOL_TIMEOUT_MS } from "../utils/helpers";
import { getCachedToolResult, setCachedToolResult, CACHEABLE_TOOLS } from "../services/tool-cache";
import { logAudit } from "../services/audit";
import type { ChatMessage, ToolDefinition, ToolCall, StreamChunk, UsageInfo, ResolvedModel, AnthropicContentBlock } from "./types";
import type { Request, Response } from "express";
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

function saveTurnCheckpointIfChanged(taskState: TaskState, messages: ChatMessage[]): void {
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
    writeDelta(`\n\n> 🔧 **Agent Executing ${batch.length > 1 ? `${batch.length} tools in parallel` : "Tool"}:** \`${names}\`...\n`);
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
            const cached = getCachedToolResult(toolName, parsedArgs);
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
          // This is the enforcement point — even if a tool sneaks into the
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

          let result: string;
          try {
            result = await withToolTimeout(handleAgentToolCall(tc, workspacePath, cpContext), toolName);
          } catch (err: any) {
            log("warn", `[Tool] ${toolName} failed: ${err.message}`);
            result = `Error: ${toolName} failed: ${err.message}`;
          }
          if (CACHEABLE_TOOLS.has(toolName) && !result.startsWith("Error:")) {
            setCachedToolResult(toolName, parsedArgs, result);
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
        toolContent += `\n\n[System Reminder: Please output the updated Task Plan (e.g. - [x] completed, - [/] in-progress, - [ ] pending) at the beginning of your next response, then continue executing the steps or summarize the results.]`;
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
      writeDelta(`\n\n> 🛑 **${verdict.note}**\n`);
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
      writeDelta(`\n\n> ⚠️ **${verdict.note}**\n`);
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
    writeDelta(`\n\n> ❓ **${taskState.metadata.pendingAsk.question}**\n${(taskState.metadata.pendingAsk.options as string[] || []).map((o: string, i: number) => `${i + 1}. ${o}`).join("\n")}\n\n*${"Waiting for your answer — the task will resume when you reply."}*\n`);
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

export async function executeAgentCompletions(
  req: Request,
  res: Response,
  body: AgentRequestBody,
  resolved: ResolvedModel,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  useAgent: boolean | undefined,
  activeSkillId: string,
  startTime: number,
  cacheKey: string | null,
  depth = 0,
  taskState?: TaskState
): Promise<void> {
const maxDepth = 50;
  const AGENT_HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

  if (depth > maxDepth || (taskState && depth > (taskState.maxIterations ?? maxDepth))) {
    const errMsg = `Agent execution exceeded maximum recursion depth (${maxDepth})`;
    log("error", `[Chat] ${errMsg}`);
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.write("data: " + JSON.stringify(mkChunk(null, resolved.model, `\n\n[Agent Execution Error: ${errMsg}]\n`, "error")) + "\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
      }
      return;
    } else {
      res.status(500).json({ error: { message: errMsg } });
      return;
    }
  }

  if (!(res as any).__orca_closeListenersAdded) {
    (res as any).__orca_closeListenersAdded = true;
    res.on("close", () => { (res as any).__orca_clientDisconnected = true; });
  }
  function isClientGone(): boolean { return !!(res as any).__orca_clientDisconnected || res.destroyed; }

  // Initialize / resume persistent task state
  if (useAgent && !taskState) {
    const resumeId = body.resumeTaskId || body.taskId;
    if (resumeId) {
      taskState = loadTaskState(resumeId);
      if (taskState) {
        log("info", `[Agent] Resuming task ${taskState.taskId} at phase ${taskState.phase}`);
        messages = taskState.messages.length ? taskState.messages : messages;
      }
    }
    if (!taskState) {
      const workspacePath = body.workspacePath || process.cwd();
      const userMsg = messages.find((m) => m.role === "user");
      let goal = "";
      if (userMsg) {
        const content = userMsg.content as any;
        if (typeof content === "string") goal = content;
        else if (Array.isArray(content)) {
          goal = content.filter((c: any) => c.type === "text").map((c: any) => c.text || "").join(" ");
        }
      }
      taskState = createTaskState(goal, workspacePath);
      log("info", `[Agent] Created task ${taskState.taskId}`);
      // Bound the stored original request: keep only the last 20 messages,
      // each capped at 4k chars, so large requests cannot balloon the JSON file.
      const boundedOriginal: any = JSON.parse(JSON.stringify(body));
      delete boundedOriginal.resumeTaskId;
      delete boundedOriginal.taskId;
      if (Array.isArray(boundedOriginal.messages)) {
        boundedOriginal.messages = boundedOriginal.messages.slice(-20).map((m: any) => ({
          ...m,
          content: typeof m.content === "string" ? m.content.slice(0, 4000) : m.content,
        }));
      }
      taskState.metadata.originalRequest = boundedOriginal;
      saveTaskState(taskState);
      broadcast("task_start", taskState.taskId, { goal, workspacePath });
    }
  }

  if (taskState) {
    taskState.iteration = depth;
    taskState.messages = messages;

    // Todo-stall guard: track consecutive turns with no plan progress.
    const stallSignature = taskState.steps.map((s) => `${s.id}:${s.status}`).join("|");
    if (depth > 0 && taskState.metadata.lastStallSignature !== undefined) {
      const progressed = taskState.metadata.lastStallSignature !== stallSignature;
      const stallCounter = (taskState.metadata.todoStallCounter as number) || 0;
      const nextCounter = progressed ? 0 : stallCounter + 1;
      taskState.metadata.todoStallCounter = nextCounter;
      if (!progressed && nextCounter >= 16) {
        const pauseNote = "[Guard] No plan progress for 16 rounds. Pausing execution to avoid a loop — progress was saved; reconsider the approach or resume.";
        log("warn", `[Guard] ${pauseNote}`);
        broadcast("task_error", taskState.taskId, { error: pauseNote });
        taskState.phase = "replan";
        taskState.metadata.replanReason = pauseNote;
        saveTaskState(taskState);
        const pauseChunk = mkChunk(null, resolved.model, `\n\n[${pauseNote}]\n`, "error");
        res.write("data: " + JSON.stringify(pauseChunk) + "\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      if (!progressed && nextCounter >= 8) {
        const nudgeNote = `[Guard] No plan progress for ${nextCounter} rounds. Ensure each next step makes concrete progress or complete the task.`;
        taskState.metadata.replanReason = nudgeNote;
        messages.push({ role: "system" as const, content: nudgeNote });
        log("warn", `[Guard] ${nudgeNote}`);
      }
    }
    taskState.metadata.lastStallSignature = stallSignature;
    saveTaskState(taskState);

    const planText = formatTaskPlan(taskState);
    const planMarker = "<orca_task_plan>";
    const existingPlanIdx = messages.findIndex((m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith(planMarker));
    const planMessage = { role: "system" as const, content: `${planMarker}\nCurrent phase: ${taskState.phase}\n${planText}\n</orca_task_plan>` };
    if (existingPlanIdx >= 0) {
      messages[existingPlanIdx] = planMessage;
    } else {
      messages.unshift(planMessage);
    }

    if (taskState.phase === "replan" && taskState.metadata?.replanReason) {
      const replanMsg = { role: "system" as const, content: buildReplanPrompt(taskState, taskState.metadata.replanReason as string) };
      const existingReplanIdx = messages.findIndex((m) => m.role === "system" && typeof m.content === "string" && m.content.includes("The previous execution step failed"));
      if (existingReplanIdx < 0) messages.push(replanMsg);
    }
  }

  if (depth === 0) {
    messages = await compressContextIfNeeded(messages, resolved);
    if (taskState) {
      taskState.metadata.checkpointTurn = (Number(taskState.metadata.checkpointTurn) || 0) + 1;
    }
  }

  // Hard timeout
  if (Date.now() - startTime > AGENT_HARD_TIMEOUT_MS) {
    const errMsg = `Agent task exceeded hard timeout (${AGENT_HARD_TIMEOUT_MS / 60000} minutes). Please resume from /tasks page.`;
    log("warn", `[Chat] ${errMsg}`);
    if (taskState) {
      taskState.phase = "replan";
      taskState.metadata.replanReason = errMsg;
      saveTaskState(taskState);
    }
    const timeoutChunk = mkChunk(null, resolved.model, `\n\n[${errMsg}]\n`, "stop");
    res.write("data: " + JSON.stringify(timeoutChunk) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  // Build request body
  const maxTokensParam = body.max_tokens ? { max_tokens: body.max_tokens } : {};
  const requestBody = {
    ...body,
    messages,
    ...maxTokensParam,
    ...(tools.length > 0 ? { tools } : {}),
  };
  delete requestBody.activeSkillId;
  delete requestBody.useAgent;
  delete requestBody.workspacePath;

  let targetUrl: string;
  let headers: Record<string, string>;
  let reqBodyText: string;

  if (resolved.provider.id === "anthropic") {
    targetUrl = buildProbeUrl(resolved.provider.baseUrl, "/messages");
    headers = { "Content-Type": "application/json", "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" };
    const systemMsgs = messages.filter((m) => m.role === "system");
    const normalMsgs = messages.filter((m) => m.role !== "system");
    const systemText = systemMsgs.map((m) => {
      const content = m.content as any;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.filter((c: any) => c.type === "text").map((c: any) => c.text || "").join("\n");
      }
      return "";
    }).filter(Boolean).join("\n");

    const anthropicBody: Record<string, unknown> = {
      model: resolved.model,
      max_tokens: body.max_tokens || getAnthropicMaxOutput(resolved.model),
      messages: normalMsgs,
    };
    if (systemText) anthropicBody.system = systemText;
    if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;
    if (body.stream) anthropicBody.stream = true;
    if (tools.length > 0) {
      anthropicBody.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }));
    }
    reqBodyText = JSON.stringify(anthropicBody);
  } else {
    targetUrl = buildProbeUrl(resolved.provider.baseUrl, "/chat/completions");
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` };
    reqBodyText = JSON.stringify({ ...requestBody, model: resolved.model });
  }

  if (body.stream) {
    // ---- Streaming path ----
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();
    }

    const fetchKeepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, 15000);

    let upstreamResp;
    try {
      upstreamResp = await fetchWithRetry(targetUrl, { method: "POST", headers, body: reqBodyText });
    } finally {
      clearInterval(fetchKeepAlive);
    }
    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      throw new Error(`Upstream returned ${upstreamResp.status}: ${errText}`);
    }

    const accumulatedToolCalls: ToolCall[] = [];
    let accumulatedText = "";
    let hasOpenedThinkBlock = false;
    let hasClosedThinkBlock = false;
    let finalUsage: UsageInfo | null = null;
    let streamInterrupted = false;
    const reader = (upstreamResp.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let retryCount = 0;
    const MAX_STREAM_RETRIES = 3;

    while (true) {
      if (isClientGone()) {
        log("info", "[Chat] Response connection closed by client. Aborting stream reader loop.");
        break;
      }

      let done = false;
      let value: Uint8Array | null = null;

      try {
        const result = await reader.read();
        done = result.done;
        value = result.value;
        retryCount = 0;
      } catch (readError) {
        log("warn", "[Chat] Stream read error:", readError);
retryCount++;
        if (retryCount >= MAX_STREAM_RETRIES) {
          log("error", "[Chat] Max stream retries reached, aborting");
          streamInterrupted = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("data: ")) {
          const dataStr = line.substring(6).trim();
          if (dataStr === "[DONE]") continue;
try {
            const parsed = JSON.parse(dataStr);

            if (resolved.provider.id === "anthropic") {
              const evtType = parsed.type as string | undefined;
              if (evtType === "message_start") {
                if (parsed.message?.usage) finalUsage = parsed.message.usage;
              } else if (evtType === "content_block_start") {
                const block = parsed.content_block || {};
                if (block.type === "tool_use") {
                  if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
                    hasClosedThinkBlock = true;
                    const closeChunk = mkChunk(null, resolved.model, `\n</think>\n`);
                    res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
                    accumulatedText += "\n</think>\n";
                  }
                  const idx = typeof parsed.index === "number" ? parsed.index : accumulatedToolCalls.length;
                  accumulatedToolCalls[idx] = { id: block.id || `toolu_${idx}`, type: "function", function: { name: block.name || "", arguments: "" } };
                }
              } else if (evtType === "content_block_delta") {
                const delta = parsed.delta || {};
                const idx = typeof parsed.index === "number" ? parsed.index : 0;
                if (delta.type === "text_delta") {
                  if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
                    hasClosedThinkBlock = true;
                    const closeChunk = mkChunk(null, resolved.model, `\n</think>\n`);
                    res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
                    accumulatedText += "\n</think>\n";
                  }
                  const text = delta.text || "";
                  accumulatedText += text;
                  const openaiChunk = mkChunk(null, resolved.model, text);
                  res.write("data: " + JSON.stringify(openaiChunk) + "\n\n");
                } else if (delta.type === "input_json_delta") {
                  const target = accumulatedToolCalls[idx];
                  if (target) target.function.arguments += delta.partial_json || "";
                }
              }
              continue;
            }

            if (parsed.usage) finalUsage = parsed.usage;
            const choice = parsed.choices?.[0];
            if (choice) {
              if (choice.delta?.tool_calls) {
                if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
                  hasClosedThinkBlock = true;
                  const closeChunk = mkChunk(parsed, resolved.model, `\n</think>\n`);
                  res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
                  accumulatedText += "\n</think>\n";
                }
                for (const tc of choice.delta.tool_calls) {
                  const idx = tc.index;
                  if (!accumulatedToolCalls[idx]) {
                    accumulatedToolCalls[idx] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
                  }
                  if (tc.id) accumulatedToolCalls[idx].id = tc.id;
                  if (tc.function?.name) accumulatedToolCalls[idx].function.name += tc.function.name;
                  if (tc.function?.arguments) accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
                }
              } else if (choice.delta?.reasoning_content) {
                if (!hasOpenedThinkBlock) {
                  hasOpenedThinkBlock = true;
                  const openChunk = mkChunk(parsed, resolved.model, `<think>\n`);
                  res.write("data: " + JSON.stringify(openChunk) + "\n\n");
                  accumulatedText += "<think>\n";
                }
                const contentChunk = mkChunk(parsed, resolved.model, choice.delta.reasoning_content);
                res.write("data: " + JSON.stringify(contentChunk) + "\n\n");
                accumulatedText += choice.delta.reasoning_content;
              } else if (choice.delta?.content) {
                if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
                  hasClosedThinkBlock = true;
                  const closeChunk = mkChunk(parsed, resolved.model, `\n</think>\n`);
                  res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
                  accumulatedText += "\n</think>\n";
                }
                accumulatedText += choice.delta.content;
                res.write(line + "\n\n");
              }
            }
          } catch (e) { log("warn", "Failed to parse SSE chunk:", e); }
        }
      }
    }

    if (isClientGone()) {
      try { await reader.cancel(); } catch (e) { log("warn", "Failed to cancel stream reader:", e); }
      return;
    }

if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
      hasClosedThinkBlock = true;
      const closeChunk = mkChunk(null, resolved.model, `\n response\n`);
      res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
      accumulatedText += "\n response\n";
    }

    if (streamInterrupted) {
      const interruptedMsg = "The upstream response stream was interrupted (network error). Execution state was preserved; resume the task from the Tasks page to continue.";
      log("error", `[Chat] ${interruptedMsg}`);
      if (taskState) {
        taskState.phase = "replan";
        taskState.metadata.replanReason = interruptedMsg;
        saveTaskState(taskState);
      }
      const errChunk = mkChunk(null, resolved.model, `\n\n[Agent Stream Error] ${interruptedMsg}\n`, "error");
      res.write("data: " + JSON.stringify(errChunk) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const toolCalls = accumulatedToolCalls.filter((tc): tc is ToolCall => tc !== undefined);

    if (taskState) {
      if (accumulatedText) {
        const parsedPlan = parseTaskPlan(accumulatedText);
        if (parsedPlan.length > 0) {
          mergeTaskPlan(taskState, parsedPlan);
          broadcast("task_plan", taskState.taskId, { steps: parsedPlan.length, phase: taskState.phase });
        } else {
          // Reasonix-style one-line progress marker (e.g. "✅ [2/5] 完成：xxx")
          const progress = parsePlanProgress(accumulatedText);
          if (progress) {
            applyPlanProgress(taskState, progress);
            broadcast("task_plan", taskState.taskId, { steps: taskState.steps.length, phase: taskState.phase });
          }
        }
      }
      taskState.phase = toolCalls.length > 0 ? "execute" : "done";
      saveTaskState(taskState);
    }

    if (toolCalls.length > 0) {
      messages.push({ role: "assistant", content: accumulatedText || null, tool_calls: toolCalls } satisfies ChatMessage);

      const writeDelta = (text: string) => {
        const chunk = mkChunk(null, resolved.model, text);
        res.write("data: " + JSON.stringify(chunk) + "\n\n");
      };

      const { records, aborted } = await executeToolsInParallel(toolCalls, writeDelta, messages, body.workspacePath || "", res, isClientGone, resolved, taskState, !useAgent);

      if (aborted) {
        if (isClientGone()) return;
        if (taskState) {
          saveTurnCheckpointIfChanged(taskState, messages);
          releaseAllClaims(taskState.taskId);
        }
        // Pending approval / ask: end the stream cleanly; the task resumes in the
        // background via /api/tasks/:taskId/resume and events are broadcast on SSE.
        if (!res.writableEnded) {
          const isAsk = taskState?.metadata?.pendingAsk;
          const note = isAsk
            ? "\n\n[Waiting for your answer... Reply in the chat to continue the task.]\n"
            : "\n\n[Waiting for approval... Task will resume automatically.]\n";
          const approvalChunk = mkChunk(null, resolved.model, note, "stop");
          res.write("data: " + JSON.stringify(approvalChunk) + "\n\n");
          res.write("data: [DONE]\n\n");
          res.end();
        }
        return;
      }

      if (taskState) {
        taskState.results.push(...records);
        recordEvidence(taskState, records);
        const verification = verifyToolResults(records, taskState.workspacePath);
        if (!verification.ok) {
          taskState.phase = "replan";
          taskState.metadata.replanReason = verification.note;
          saveTaskState(taskState);

          // Self-reflection: analyze failures before replanning
          const failedRecords = records.filter((r) =>
            r.output.startsWith("Error:") || r.output.includes("[Execution Error]")
          );
          if (failedRecords.length > 0 && resolved) {
            const reflection = await generateReflection(taskState, failedRecords, resolved.provider, resolved.apiKey, resolved.model);
            const reflectionPrompt = buildReflectionPrompt(reflection);
            messages.push({ role: "system" as const, content: reflectionPrompt });
            writeDelta(`\n\n[Self-Reflection] ${reflection.analysis}\n`);
          }

          messages.push({ role: "system" as const, content: buildReplanPrompt(taskState, verification.note) });
        } else {
          taskState.phase = "execute";
          saveTaskState(taskState);
        }
      }

      truncateMessagesIfNeeded(messages);
      messages = await compressContextIfNeeded(messages, resolved);

      return executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey, depth + 1, taskState);
} else {
      const unfinishedCount = taskState?.steps.filter((s) => s.status === "pending" || s.status === "failed").length ?? 0;
      const continueCount = taskState?.metadata?.noToolContinues ?? 0;
      if (taskState && unfinishedCount > 0 && depth < maxDepth && continueCount < 4) {
        taskState.metadata.noToolContinues = continueCount + 1;
        taskState.phase = "execute";
        saveTaskState(taskState);
        if (accumulatedText) {
          messages.push({ role: "assistant", content: accumulatedText } satisfies ChatMessage);
        }
        messages.push({
          role: "system",
          content: `[Continuation] The task plan still has ${unfinishedCount} unfinished step(s). You ended your turn without calling any tools. Continue the plan now: output a one-line progress marker (e.g. ⏳ [2/5] 执行：<step>) and call the next tool(s) for the remaining steps. Do not end the turn until every step is complete.`,
        });
        truncateMessagesIfNeeded(messages);
        messages = await compressContextIfNeeded(messages, resolved);
        const noteChunk = mkChunk(null, resolved.model, `\n\n[Continuing execution: ${unfinishedCount} step(s) remaining...]\n`);
        res.write("data: " + JSON.stringify(noteChunk) + "\n\n");
        return executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey, depth + 1, taskState);
      }
      if (taskState) {
        taskState.phase = "done";
        taskState.messages = messages;
        saveTurnCheckpointIfChanged(taskState, messages);
        releaseAllClaims(taskState.taskId);
        saveTaskState(taskState);
      }
      const promptTok = finalUsage?.prompt_tokens || 0;
      const compTok = finalUsage?.completion_tokens || 0;
      let cachedTok = 0;
      if (finalUsage?.prompt_tokens_details?.cached_tokens !== undefined) {
        cachedTok = finalUsage.prompt_tokens_details.cached_tokens;
      } else if (finalUsage?.input_token_details?.cache_read !== undefined) {
        cachedTok = finalUsage.input_token_details.cache_read;
      }
      accumulateCost(resolved.model, promptTok, compTok, cachedTok);

      if (taskState) {
        broadcast("usage", taskState.taskId, {
          promptTokens: promptTok,
          completionTokens: compTok,
          cachedTokens: cachedTok,
          cacheHitRate: promptTok > 0 ? Math.round((cachedTok / promptTok) * 100) : 0,
          model: resolved.model,
        });
        const gate = checkDeliveryGate(taskState);
        const report = buildDeliveryReport(taskState);
        taskState.metadata.deliveryGateOk = gate.ok;
        taskState.metadata.deliveryNote = gate.note;
        saveTaskState(taskState);
        broadcast("task_complete", taskState.taskId, {
          durationMs: Date.now() - startTime,
          stepCount: taskState.steps.length,
          doneCount: taskState.steps.filter((s) => s.status === "completed").length,
          cachedTokens: cachedTok,
          promptTokens: promptTok,
          completionTokens: compTok,
          deliveryGateOk: gate.ok,
          deliveryNote: gate.note,
          deliveryReport: report,
        });
        const reportChunk = mkChunk(null, resolved.model, `\n\n${report}\n`, "content");
        res.write("data: " + JSON.stringify(reportChunk) + "\n\n");
      }

      const finalChunk = mkChunk(null, resolved.model, "", "stop");
      res.write("data: " + JSON.stringify(finalChunk) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
      log("info", `[Chat] Done ${Date.now() - startTime}ms`);
    }
  } else {
    // ---- Non-streaming path ----
    let upstreamResp;
    try {
      upstreamResp = await fetchWithRetry(targetUrl, { method: "POST", headers, body: reqBodyText });
    } catch (e) {
      throw e;
    }
    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      throw new Error(`Upstream returned ${upstreamResp.status}: ${errText}`);
    }

    const data = await upstreamResp.json() as any;

    // Normalize Anthropic non-streaming response to OpenAI shape
    if (!data.choices && Array.isArray(data.content)) {
      const textParts = data.content
        .filter((b: AnthropicContentBlock) => b.type === "text")
        .map((b: AnthropicContentBlock) => b.text || "")
        .join("\n")
        .trim();
      const toolUses = data.content.filter((b: AnthropicContentBlock) => b.type === "tool_use");
      const message: ChatMessage = { role: "assistant", content: textParts || null };
      if (toolUses.length > 0) {
        message.tool_calls = toolUses.map((b: AnthropicContentBlock, i: number) => ({
          id: b.id || `call_${i}`,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      }
      data.choices = [{
        index: 0,
        message,
        finish_reason: data.stop_reason === "tool_use" ? "tool_calls" : "stop",
      }];
      if (data.usage) {
        data.usage.prompt_tokens = data.usage.input_tokens || 0;
        data.usage.completion_tokens = data.usage.output_tokens || 0;
      }
    }

    const choice = data.choices?.[0];
    if (choice?.message) {
      if (choice.message.reasoning_content) {
        const existingContent = typeof choice.message.content === "string" ? choice.message.content : "";
        choice.message.content = `<think>\n${choice.message.reasoning_content}\n</think>\n${existingContent}`;
      }
    }
    if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
      messages.push(choice.message);
      const toolCalls: ToolCall[] = choice.message.tool_calls;

      if (taskState) {
        if (choice.message.content) {
          const parsedPlan = parseTaskPlan(choice.message.content);
          if (parsedPlan.length > 0) {
            mergeTaskPlan(taskState, parsedPlan);
          } else {
            const progress = parsePlanProgress(choice.message.content);
            if (progress) applyPlanProgress(taskState, progress);
          }
        }
        taskState.phase = "execute";
        saveTaskState(taskState);
      }

      const { records, aborted } = await executeToolsInParallel(toolCalls, () => {}, messages, body.workspacePath || "", res, isClientGone, resolved, taskState, !useAgent);

      if (aborted) {
        if (isClientGone()) return;
        if (taskState) {
          saveTurnCheckpointIfChanged(taskState, messages);
          releaseAllClaims(taskState.taskId);
        }
        if (!res.writableEnded) {
          res.json({ pendingApproval: true, note: "Waiting for approval. Task will resume automatically." });
        }
        return;
      }

      if (taskState) {
        taskState.results.push(...records);
        // Bound the result history: keep the last 50 tool executions so long
        // tasks do not grow the state file without limit.
        if (taskState.results.length > 50) {
          taskState.results = taskState.results.slice(-50);
        }
        recordEvidence(taskState, records);
        const verification = verifyToolResults(records, taskState.workspacePath);
        if (!verification.ok) {
          taskState.phase = "replan";
          taskState.metadata.replanReason = verification.note;
          saveTaskState(taskState);
          messages.push({ role: "system" as const, content: buildReplanPrompt(taskState, verification.note) });
        } else {
          taskState.phase = "execute";
          saveTaskState(taskState);
        }
      }

      truncateMessagesIfNeeded(messages);
      messages = await compressContextIfNeeded(messages, resolved);
      return executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey, depth + 1, taskState);
    } else {
      const unfinishedCount = taskState?.steps.filter((s) => s.status === "pending" || s.status === "failed").length ?? 0;
      const continueCount = taskState?.metadata?.noToolContinues ?? 0;
      if (taskState && unfinishedCount > 0 && depth < maxDepth && continueCount < 4) {
        taskState.metadata.noToolContinues = continueCount + 1;
        taskState.phase = "execute";
        saveTaskState(taskState);
        if (data.choices?.[0]?.message?.content) {
          messages.push(data.choices[0].message);
        }
        messages.push({
          role: "system" as const,
          content: `[Continuation] The task plan still has ${unfinishedCount} unfinished step(s). You ended your turn without calling any tools. Continue the plan now: output a one-line progress marker (e.g. ⏳ [2/5] 执行：<step>) and call the next tool(s) for the remaining steps. Do not end the turn until every step is complete.`,
        });
        truncateMessagesIfNeeded(messages);
        messages = await compressContextIfNeeded(messages, resolved);
        return executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey, depth + 1, taskState);
      }
      if (taskState) {
        taskState.phase = "done";
        taskState.messages = messages;
        saveTurnCheckpointIfChanged(taskState, messages);
        releaseAllClaims(taskState.taskId);
        saveTaskState(taskState);
        const gate = checkDeliveryGate(taskState);
        taskState.metadata.deliveryGateOk = gate.ok;
        taskState.metadata.deliveryNote = gate.note;
        saveTaskState(taskState);
      }
      const promptTok = data.usage?.prompt_tokens || 0;
      const compTok = data.usage?.completion_tokens || 0;
      let cachedTok = 0;
      if (data.usage?.prompt_tokens_details?.cached_tokens !== undefined) {
        cachedTok = data.usage.prompt_tokens_details.cached_tokens;
      } else if (data.usage?.input_token_details?.cache_read !== undefined) {
        cachedTok = data.usage.input_token_details.cache_read;
      }
      accumulateCost(resolved.model, promptTok, compTok, cachedTok);
      if (cacheKey && loadConfig().cacheEnabled) {
        setCachedResponse(cacheKey, data);
      }
      res.json(data);
      log("info", `[Chat] Done ${Date.now() - startTime}ms`);
    }
  }
}
