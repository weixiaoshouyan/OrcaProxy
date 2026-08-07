// ============================================================
// src/services/recovery.ts
// Auto Recovery: scans for tasks left in a running state after
// an unexpected app shutdown, flags them as "interrupted", and
// exposes a one-shot recovery helper. Mirrors Reasonix session
// recovery: on startup, stale running tasks are surfaced so the
// user can resume instead of losing work.
// ============================================================

import fs from "fs";
import path from "path";
import { loadTaskState, saveTaskState, listTaskStates } from "../agent/task-state";
import { resolveBaseDir } from "../utils/base-dir";
import { log } from "../utils/log";

const STALE_MS = 10 * 60 * 1000; // a running task this old is almost certainly orphaned

const RUNNING_PHASES = new Set(["plan", "execute", "replan"]);

export interface RecoveryInfo {
  taskId: string;
  goal: string;
  workspacePath: string;
  phase: string;
  updatedAt: number;
  interruptedAt: number;
  stepProgress: { total: number; done: number };
}

/**
 * Scan every persisted task. Tasks that were mid-flight when the app
 * exited are flagged with metadata.interruptedAt so the UI can offer
 * a "recover / resume" action instead of silently abandoning them.
 */
export function scanForInterruptedTasks(): RecoveryInfo[] {
  const now = Date.now();
  const interrupted: RecoveryInfo[] = [];

  for (const summary of listTaskStates()) {
    if (!RUNNING_PHASES.has(summary.phase)) continue;
    // Only consider tasks whose last update is older than STALE_MS —
    // tasks updated recently might still be owned by another process.
    if (now - summary.updatedAt < STALE_MS) continue;

    const state = loadTaskState(summary.taskId);
    if (!state) continue;

    state.metadata.interruptedAt = now;
    state.metadata.interruptReason = "app_restart";
    state.metadata.recoveryNote =
      "This task was interrupted by an app restart while it was still running. " +
      "You can resume it below; its checkpoint history and evidence ledger are preserved.";
    saveTaskState(state);

    interrupted.push({
      taskId: state.taskId,
      goal: state.goal,
      workspacePath: state.workspacePath,
      phase: state.phase,
      updatedAt: state.updatedAt,
      interruptedAt: now,
      stepProgress: {
        total: state.steps.length,
        done: state.steps.filter((s) => s.status === "completed").length,
      },
    });
    log("info", `[Recovery] Flagged interrupted task ${state.taskId} (${state.goal.slice(0, 60)})`);
  }

  return interrupted;
}

/** List tasks that were flagged as interrupted but never recovered. */
export function listRecoverableTasks(): RecoveryInfo[] {
  const now = Date.now();
  const out: RecoveryInfo[] = [];
  for (const summary of listTaskStates()) {
    const state = loadTaskState(summary.taskId);
    if (!state?.metadata?.interruptedAt) continue;
    // A task whose interruptedAt was set but is now "done" has already recovered.
    if (state.phase === "done") {
      delete state.metadata.interruptedAt;
      delete state.metadata.interruptReason;
      saveTaskState(state);
      continue;
    }
    // Interrupted flags older than a week are stale; clear them and skip.
    if (now - state.metadata.interruptedAt > 7 * 24 * 3600 * 1000) {
      delete state.metadata.interruptedAt;
      delete state.metadata.interruptReason;
      saveTaskState(state);
      continue;
    }
    out.push({
      taskId: state.taskId,
      goal: state.goal,
      workspacePath: state.workspacePath,
      phase: state.phase,
      updatedAt: state.updatedAt,
      interruptedAt: state.metadata.interruptedAt,
      stepProgress: {
        total: state.steps.length,
        done: state.steps.filter((s) => s.status === "completed").length,
      },
    });
  }
  return out.sort((a, b) => b.interruptedAt - a.interruptedAt);
}

/** Mark a task as recovered (called by /api/tasks/:id/recover). */
export function clearRecoveryFlag(taskId: string): boolean {
  const state = loadTaskState(taskId);
  if (!state) return false;
  delete state.metadata.interruptedAt;
  delete state.metadata.interruptReason;
  delete state.metadata.recoveryNote;
  saveTaskState(state);
  return true;
}

/** Absolute path of the tasks directory — kept for future GC use. */
export function tasksDirectory(): string {
  const baseDir = resolveBaseDir(__dirname, 2);
  const dir = path.join(baseDir, "data", "agent-tasks");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
