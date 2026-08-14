// ============================================================
// src/services/task-resume.ts
// Background task auto-resume after MCP approval or pause
// ============================================================

import { loadTaskState, saveTaskState } from "../agent/task-state";
import { log } from "../utils/log";

let serverPort = 0;

export function setServerPort(port: number): void {
  serverPort = port;
}

export function getServerPort(): number {
  return serverPort;
}

// In-flight guard: never resume the same task twice concurrently, and never
// re-run a task that already finished.
const resumingTasks = new Set<string>();
const TASK_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export async function resumeTaskInBackground(taskId: string): Promise<void> {
  if (!serverPort) {
    log("warn", `[TaskResume] Server port not set, cannot auto-resume ${taskId}`);
    return;
  }

  if (resumingTasks.has(taskId)) {
    log("warn", `[TaskResume] Task ${taskId} is already being resumed, skipping duplicate`);
    return;
  }

  const taskState = loadTaskState(taskId);
  if (!taskState) {
    log("warn", `[TaskResume] Task ${taskId} not found for auto-resume`);
    return;
  }

  // Do not replay a task that is already running or finished recently —
  // replaying completed work can re-trigger side effects (writes, API calls).
  if (taskState.phase === "done") {
    log("info", `[TaskResume] Task ${taskId} already done, skipping resume`);
    return;
  }
  if (taskState.phase === "execute" && taskState.updatedAt && Date.now() - taskState.updatedAt < TASK_ACTIVE_WINDOW_MS) {
    log("warn", `[TaskResume] Task ${taskId} appears to be actively running, skipping resume`);
    return;
  }

  const originalRequest = taskState.metadata?.originalRequest;
  if (!originalRequest) {
    log("warn", `[TaskResume] No original request stored for task ${taskId}`);
    return;
  }

  resumingTasks.add(taskId);
  try {
    const body = { ...originalRequest, resumeTaskId: taskId, stream: false };
    const url = `http://127.0.0.1:${serverPort}/v1/chat/completions`;

    log("info", `[TaskResume] Auto-resuming task ${taskId} in background`);
    taskState.phase = "execute";
    saveTaskState(taskState);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.LOCAL_AUTH_TOKEN) headers["x-local-token"] = process.env.LOCAL_AUTH_TOKEN;

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // Long-running headless execution: the agent loop may run up to its 2h
      // hard timeout. A short client-side timeout would kill the fetch
      // mid-task — the server loop would keep running unseen while the
      // bookkeeping below races with it. 6h covers the loop's own hard cap
      // with margin; a dead server still fails fast (connection refused).
      signal: AbortSignal.timeout(6 * 60 * 60 * 1000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      // Re-load the CURRENT task state — the agent loop has been updating it
      // during the request. The snapshot captured at resume start is stale;
      // writing it would roll back messages/results/todos saved meanwhile.
      const fresh = loadTaskState(taskId);
      if (fresh) {
        fresh.metadata.resumeError = `${resp.status}: ${err.slice(0, 500)}`;
        fresh.phase = "replan";
        saveTaskState(fresh);
      }
      log("error", `[TaskResume] Auto-resume failed for ${taskId}: ${resp.status} ${err.slice(0, 500)}`);
      return;
    }

    const data = (await resp.json()) as any;
    const output = data.choices?.[0]?.message?.content || JSON.stringify(data);
    const fresh = loadTaskState(taskId);
    if (fresh) {
      delete fresh.metadata.resumeError;
      fresh.metadata.resumeOutput = output.slice(0, 8000);
      fresh.phase = "done";
      saveTaskState(fresh);
    }
    log("info", `[TaskResume] Task ${taskId} auto-resumed successfully`);
  } catch (e: any) {
    const fresh = loadTaskState(taskId);
    if (fresh) {
      fresh.metadata.resumeError = e.message;
      fresh.phase = "replan";
      saveTaskState(fresh);
    }
    log("error", `[TaskResume] Auto-resume exception for ${taskId}:`, e.message);
  } finally {
    resumingTasks.delete(taskId);
  }
}
