// ============================================================
// agent/engine.ts
// Reasonix-style agent engine — the round-based main loop that
// replaces the old recursive executeAgentCompletions.
//
// Architecture:
//   - ONE HTTP request = ONE agent task = a sequence of ROUNDS.
//   - Every round: the host upserts a composed <task-state> directive,
//     calls the model once, executes any tool calls, and then evaluates
//     the DELIVERY GATE. If the model ends its turn with unfinished
//     todo items, the host REFUSES the turn (injects a reason) and
//     forces another round.
//   - Progress lives in taskState.todos (todo_write replaces the whole
//     list, complete_step signs off steps with session-verified
//     evidence, update_goal declares how the round should end).
// ============================================================

import { loadConfig } from "../providers";
import { log } from "../utils/log";
import {
  type TaskState, createTaskState, loadTaskState, saveTaskState,
} from "./task-state";
import { parseTaskPlan, mergeTaskPlan, buildReplanPrompt, parsePlanProgress, applyPlanProgress } from "./planner";
import { parsePlanTodos } from "./todo";
import { verifyToolResults } from "./verifier";
import { generateReflection, buildReflectionPrompt } from "./reflection";
import { evaluateToolGuards } from "./guards";
import { recordEvidence, buildDeliveryReport, checkDeliveryGate } from "./ledger";
import { releaseAllClaims } from "./claims";
import { accumulateCost } from "../services/billing";
import { buildProbeUrl } from "../services/health";
import { setCachedResponse } from "../cache";
import { compressContextIfNeeded } from "./compression";
import {
  mkChunk, fetchWithRetry, executeToolsInParallel, truncateMessagesIfNeeded,
  saveTurnCheckpointIfChanged, getAnthropicMaxOutput,
} from "./loop";
import { composeDirective, turnRefusal } from "./prompts";
import { evaluateFinalGate } from "./gates";
import { createAgentEvent, formatAgentEvent, type AgentEventType } from "./events";
import type { ChatMessage, ToolDefinition, ToolCall, UsageInfo, ResolvedModel } from "./types";
import type { Request, Response } from "express";

const MAX_ROUNDS = 60;
const AGENT_HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

function broadcast(type: AgentEventType, taskId: string, data: Record<string, unknown> = {}): void {
  try {
    const fn = (global as any).__orca_broadcastAgentEvent;
    if (typeof fn === "function") fn(formatAgentEvent(createAgentEvent(type, taskId, data)));
  } catch (e) { /* ignore */ }
}

/** Upsert the per-round <task-state> directive as the LAST system message. */
function upsertDirective(messages: ChatMessage[], taskState: TaskState | undefined, round: number, goal: string): void {
  const directive = composeDirective(taskState, round, goal);
  // Drop legacy <orca_task_plan> blocks carried over from older sessions.
  const legacyIdx = messages.findIndex(
    (m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith("<orca_task_plan>")
  );
  if (legacyIdx >= 0) messages.splice(legacyIdx, 1);
  // The directive is the last system message; replace if one is already there.
  const last = messages[messages.length - 1];
  if (last && last.role === "system" && typeof last.content === "string" && last.content.startsWith("<task-state")) {
    last.content = directive;
  } else {
    messages.push({ role: "system", content: directive } satisfies ChatMessage);
  }
}

interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  usage: UsageInfo | null;
  streamInterrupted: boolean;
  /** Non-streaming raw upstream payload (used to replay it on finalize). */
  rawData?: any;
}

export async function runAgentTask(
  req: Request,
  res: Response,
  body: any,
  resolved: ResolvedModel,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  useAgent: boolean | undefined,
  activeSkillId: string | undefined,
  startTime: number,
  cacheKey: string | null,
  taskState?: TaskState
): Promise<void> {
  if (!(res as any).__orca_closeListenersAdded) {
    (res as any).__orca_closeListenersAdded = true;
    res.on("close", () => { (res as any).__orca_clientDisconnected = true; });
  }
  function isClientGone(): boolean { return !!(res as any).__orca_clientDisconnected || res.destroyed; }

  // ---- Initialize / resume persistent task state (once per task) ----
  let goal = "";
  if (useAgent && !taskState) {
    const resumeId = body.resumeTaskId || body.taskId;
    if (resumeId) {
      taskState = loadTaskState(resumeId);
      if (taskState) {
        log("info", `[Agent] Resuming task ${taskState.taskId} at phase ${taskState.phase}`);
        if (taskState.messages.length) {
          // Keep the persisted history and append only genuinely new user
          // messages (dedupe against the last persisted user message).
          const lastHistUser = [...taskState.messages].reverse().find((m) => m.role === "user");
          const fresh = messages.filter(
            (m) => m.role === "user" && (!lastHistUser || JSON.stringify(m.content) !== JSON.stringify(lastHistUser.content))
          );
          messages = [...taskState.messages, ...fresh];
        }
      }
    }
    if (!taskState) {
      const workspacePath = body.workspacePath || process.cwd();
      const userMsg = messages.find((m) => m.role === "user");
      if (userMsg) {
        const content = userMsg.content as any;
        if (typeof content === "string") goal = content;
        else if (Array.isArray(content)) {
          goal = content.filter((c: any) => c.type === "text").map((c: any) => c.text || "").join(" ");
        }
      }
      taskState = createTaskState(goal, workspacePath);
      log("info", `[Agent] Created task ${taskState.taskId}`);
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

  // ---- Round loop (Reasonix runToolLoop) ----
  let round = 0;
  let goalStatus: string | undefined = taskState?.metadata?.goalStatus as string | undefined;
  let lastUsage: UsageInfo | null = null;
  const accUsage = { prompt: 0, completion: 0, cached: 0 };
  let nonStreamData: any = null;

  while (true) {
    if (taskState) taskState.iteration = round;

    // Round cap — never exceed the configured budget.
    const cap = taskState?.maxIterations ?? MAX_ROUNDS;
    if (round >= cap) {
      const errMsg = `Agent execution exceeded maximum rounds (${cap}). Progress was saved; resume from the Tasks page to continue.`;
      log("warn", `[Chat] ${errMsg}`);
      if (taskState) {
        taskState.phase = "replan";
        taskState.metadata.replanReason = errMsg;
        taskState.messages = messages;
        saveTaskState(taskState);
      }
      const chunk = mkChunk(null, resolved.model, `\n\n[${errMsg}]\n`, "stop");
      if (!res.writableEnded) {
        res.write("data: " + JSON.stringify(chunk) + "\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
      }
      return;
    }

    // Todo-stall guard: track consecutive rounds with no plan progress.
    if (taskState) {
      const stallSignature = (taskState.todos ?? []).map((t) => `${t.content}:${t.status}`).join("|");
      if (round > 0 && taskState.metadata.lastStallSignature !== undefined) {
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
          taskState.messages = messages;
          saveTaskState(taskState);
          const pauseChunk = mkChunk(null, resolved.model, `\n\n[${pauseNote}]\n`, "error");
          if (!res.writableEnded) {
            res.write("data: " + JSON.stringify(pauseChunk) + "\n\n");
            res.write("data: [DONE]\n\n");
            res.end();
          }
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
    }

    // Per-round composed directive — the single source of truth for the model.
    upsertDirective(messages, taskState, round, goal);

    // Hard timeout
    if (Date.now() - startTime > AGENT_HARD_TIMEOUT_MS) {
      const errMsg = `Agent task exceeded hard timeout (${AGENT_HARD_TIMEOUT_MS / 60000} minutes). Please resume from /tasks page.`;
      log("warn", `[Chat] ${errMsg}`);
      if (taskState) {
        taskState.phase = "replan";
        taskState.metadata.replanReason = errMsg;
        taskState.messages = messages;
        saveTaskState(taskState);
      }
      const timeoutChunk = mkChunk(null, resolved.model, `\n\n[${errMsg}]\n`, "stop");
      if (!res.writableEnded) {
        res.write("data: " + JSON.stringify(timeoutChunk) + "\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
      }
      return;
    }

    // First round: compress history once and bump the checkpoint turn.
    if (round === 0) {
      messages = await compressContextIfNeeded(messages, resolved);
      if (taskState) {
        taskState.metadata.checkpointTurn = (Number(taskState.metadata.checkpointTurn) || 0) + 1;
      }
    }

    // ---- Model call (streaming or not) ----
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
          input_schema: t.function.parameters,
        }));
      }
      reqBodyText = JSON.stringify(anthropicBody);
    } else {
      targetUrl = buildProbeUrl(resolved.provider.baseUrl, "/chat/completions");
      headers = { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` };
      reqBodyText = JSON.stringify({ ...requestBody, model: resolved.model });
    }

    const turn: TurnResult = { text: "", toolCalls: [], usage: null, streamInterrupted: false };

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
          await new Promise((resolve) => setTimeout(resolve, 1000));
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
      turn.text = accumulatedText;
      turn.toolCalls = accumulatedToolCalls.filter((tc): tc is ToolCall => tc !== undefined);
      turn.usage = finalUsage;
      turn.streamInterrupted = streamInterrupted;
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
      nonStreamData = data;
      if (data.usage) {
        data.usage.prompt_tokens = data.usage.input_tokens || data.usage.prompt_tokens || 0;
        data.usage.completion_tokens = data.usage.output_tokens || data.usage.completion_tokens || 0;
      }
      const choice = data.choices?.[0];
      if (choice?.message) {
        if (choice.message.reasoning_content) {
          const existingContent = typeof choice.message.content === "string" ? choice.message.content : "";
          choice.message.content = `<think>\n${choice.message.reasoning_content}\n</think>\n${existingContent}`;
        }
        turn.text = typeof choice.message.content === "string" ? choice.message.content : "";
        turn.toolCalls = (choice.message.tool_calls || []).filter((tc: ToolCall) => tc?.function?.name);
        turn.usage = data.usage || null;
      }
    }

    if (turn.streamInterrupted) {
      const interruptedMsg = "The upstream response stream was interrupted (network error). Execution state was preserved; resume the task from the Tasks page to continue.";
      log("error", `[Chat] ${interruptedMsg}`);
      if (taskState) {
        taskState.phase = "replan";
        taskState.metadata.replanReason = interruptedMsg;
        taskState.messages = messages;
        saveTaskState(taskState);
      }
      const errChunk = mkChunk(null, resolved.model, `\n\n[Agent Stream Error] ${interruptedMsg}\n`, "error");
      if (!res.writableEnded) {
        res.write("data: " + JSON.stringify(errChunk) + "\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
      }
      return;
    }

    lastUsage = turn.usage;
    if (turn.usage) {
      accUsage.prompt += turn.usage.prompt_tokens || 0;
      accUsage.completion += turn.usage.completion_tokens || 0;
      accUsage.cached += turn.usage.prompt_tokens_details?.cached_tokens ?? turn.usage.input_token_details?.cache_read ?? 0;
    }

    // ---- Turn text processing: plan parse / progress marker / seed todos ----
    if (taskState && turn.text) {
      const parsedPlan = parseTaskPlan(turn.text);
      if (parsedPlan.length > 0) {
        mergeTaskPlan(taskState, parsedPlan);
        broadcast("task_plan", taskState.taskId, { steps: parsedPlan.length, phase: taskState.phase });
      } else {
        const progress = parsePlanProgress(turn.text);
        if (progress) {
          applyPlanProgress(taskState, progress);
          broadcast("task_plan", taskState.taskId, { steps: taskState.steps.length, phase: taskState.phase });
        } else {
          // Two-level plan (numbered phase + indented bullets): seed the todo list.
          const seeded = parsePlanTodos(turn.text);
          if (seeded.length > 0 && (!Array.isArray(taskState.todos) || taskState.todos.length === 0)) {
            taskState.todos = seeded;
            taskState.steps = seeded.map((t, i) => ({
              id: `step-${i}`,
              description: t.content,
              status: "pending" as const,
            }));
            log("info", `[Todo] Seeded ${seeded.length} todo item(s) from two-level plan`);
          }
        }
      }
      taskState.phase = turn.toolCalls.length > 0 ? "execute" : "done";
      saveTaskState(taskState);
    }

    // ---- Tool execution ----
    if (turn.toolCalls.length > 0) {
      messages.push({ role: "assistant", content: turn.text || null, tool_calls: turn.toolCalls } satisfies ChatMessage);

      const writeDelta = (text: string) => {
        const chunk = mkChunk(null, resolved.model, text);
        if (!res.writableEnded) res.write("data: " + JSON.stringify(chunk) + "\n\n");
      };

      const toolWorkspacePath = taskState?.workspacePath || body.workspacePath || "";
      const { records, aborted } = await executeToolsInParallel(
        turn.toolCalls, writeDelta, messages, toolWorkspacePath, res, isClientGone, resolved, taskState, !useAgent
      );

      if (aborted) {
        if (isClientGone()) return;
        if (taskState) {
          taskState.messages = messages;
          saveTurnCheckpointIfChanged(taskState, messages);
          releaseAllClaims(taskState.taskId);
        }
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
        if (taskState.results.length > 50) {
          taskState.results = taskState.results.slice(-50);
        }
        recordEvidence(taskState, records);
        const verification = verifyToolResults(records, taskState.workspacePath);
        if (!verification.ok) {
          taskState.phase = "replan";
          taskState.metadata.replanReason = verification.note;
          saveTaskState(taskState);
          const failedRecords = records.filter((r) =>
            r.output.startsWith("Error:") || r.output.includes("[Execution Error]")
          );
          if (failedRecords.length > 0) {
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

      // Pick up a goal declaration made via update_goal this round.
      goalStatus = taskState?.metadata?.goalStatus as string | undefined;

      truncateMessagesIfNeeded(messages);
      messages = await compressContextIfNeeded(messages, resolved);
      round++;
      continue;
    }

    // ---- No tool calls: delivery gate decides whether the turn may end ----
    const gate = evaluateFinalGate(taskState, goalStatus);
    if (gate.shouldContinue) {
      if (turn.text) messages.push({ role: "assistant", content: turn.text } satisfies ChatMessage);
      messages.push({ role: "system", content: turnRefusal(gate.reason ?? "Task not complete.") } satisfies ChatMessage);
      truncateMessagesIfNeeded(messages);
      messages = await compressContextIfNeeded(messages, resolved);
      const noteChunk = mkChunk(null, resolved.model, `\n\n[Continuing: ${(gate.reason ?? "").slice(0, 140)}]\n`);
      if (!res.writableEnded) res.write("data: " + JSON.stringify(noteChunk) + "\n\n");
      round++;
      continue;
    }

    // ---- Delivery gate passed: task complete ----
    break;
  }

  // ---- Finalize ----
  const blockedWait = goalStatus === "blocked";
  if (taskState) {
    taskState.phase = blockedWait ? "awaiting_user" : "done";
    taskState.messages = messages;
    saveTurnCheckpointIfChanged(taskState, messages);
    releaseAllClaims(taskState.taskId);
    saveTaskState(taskState);
  }

  const promptTok = accUsage.prompt;
  const compTok = accUsage.completion;
  const cachedTok = accUsage.cached;
  accumulateCost(resolved.model, promptTok, compTok, cachedTok);

  if (body.stream) {
    if (taskState && !blockedWait) {
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
      if (!res.writableEnded) res.write("data: " + JSON.stringify(reportChunk) + "\n\n");
    }
    if (!res.writableEnded) {
      const finalChunk = mkChunk(null, resolved.model, "", "stop");
      res.write("data: " + JSON.stringify(finalChunk) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
    }
    log("info", `[Chat] Done ${Date.now() - startTime}ms`);
  } else {
    if (cacheKey && loadConfig().cacheEnabled && nonStreamData) {
      setCachedResponse(cacheKey, nonStreamData);
    }
    if (!res.writableEnded) res.json(nonStreamData ?? {});
    log("info", `[Chat] Done ${Date.now() - startTime}ms`);
  }
}
