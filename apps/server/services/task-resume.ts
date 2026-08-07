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
    });

    if (!resp.ok) {
      const err = await resp.text();
      taskState.metadata.resumeError = `${resp.status}: ${err.slice(0, 500)}`;
      taskState.phase = "replan";
      saveTaskState(taskState);
      log("error", `[TaskResume] Auto-resume failed for ${taskId}: ${resp.status} ${err.slice(0, 500)}`);
      return;
    }

    const data = (await resp.json()) as any;
    const output = data.choices?.[0]?.message?.content || JSON.stringify(data);
    delete taskState.metadata.resumeError;
    taskState.metadata.resumeOutput = output.slice(0, 8000);
    taskState.phase = "done";
    saveTaskState(taskState);
    log("info", `[TaskResume] Task ${taskId} auto-resumed successfully`);
  } catch (e: any) {
    taskState.metadata.resumeError = e.message;
    taskState.phase = "replan";
    saveTaskState(taskState);
    log("error", `[TaskResume] Auto-resume exception for ${taskId}:`, e.message);
  } finally {
    resumingTasks.delete(taskId);
  }
}
