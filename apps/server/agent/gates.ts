// ============================================================
// agent/gates.ts
// Reasonix-style delivery gate: the model is not allowed to end a
// turn while the task list is unfinished. Instead of trusting the
// model's prose, the HOST evaluates the gate and refuses the turn
// with an explicit reason when it fails.
// ============================================================

import type { TaskState } from "./task-state";

export interface FinalGateVerdict {
  /** true = the turn must continue (inject turnRefusal) */
  shouldContinue: boolean;
  reason?: string;
}

/**
 * Evaluate whether the model may end the turn.
 * Rules (Reasonix-compatible):
 *  1. No task list ever established (no todo_write) → refuse: a plan is
 *     required before completion.
 *  2. Task list has unfinished items (pending / in_progress) → refuse with
 *     the count. Sign-offs must happen through complete_step, not prose.
 *  3. Everything completed (serial prefix + phases done) → pass.
 */
export function evaluateFinalGate(taskState: TaskState | undefined, goalStatus: string | undefined): FinalGateVerdict {
  if (!taskState) {
    return { shouldContinue: false, reason: undefined };
  }

  const todos = Array.isArray(taskState.todos) ? taskState.todos : [];
  if (todos.length === 0) {
    return {
      shouldContinue: true,
      reason:
        "No task list has been established. Break the request into a two-level plan (phases with indented sub-steps) and send it via todo_write before doing anything else.",
    };
  }

  const unfinished = todos.filter((t) => t.status !== "completed");
  if (unfinished.length > 0) {
    // A declared blocker wins over the unfinished list: the model hit a wall it
    // cannot cross alone (missing information, needs approval, external
    // dependency). Forcing it to keep running only burns rounds until the
    // stall guard fires. Allow the turn to end so the user can reply; the
    // engine parks the task in awaiting_user (resumable from the Tasks page).
    if (goalStatus === "blocked") {
      return { shouldContinue: false, reason: "update_goal(blocked) declared with unfinished steps — pausing for user input." };
    }
    const inProgress = unfinished.filter((t) => t.status === "in_progress");
    const pending = unfinished.filter((t) => t.status === "pending");
    const parts: string[] = [];
    if (inProgress.length) parts.push(`${inProgress.length} step(s) in_progress: ${inProgress.map((t) => t.content).join("; ")}`);
    if (pending.length) parts.push(`${pending.length} step(s) still pending`);
    return {
      shouldContinue: true,
      reason: `The task list still has unfinished steps — ${parts.join(", ")}. You ended your turn without calling any tools. Continue executing the remaining steps now, and sign off each finished step with complete_step (with evidence).`,
    };
  }

  // Everything completed. Respect the model's goal declaration:
  //  - complete: pass (delivery gate passed)
  //  - continue: keep working
  //  - blocked: allow the turn to end so the user can reply; the engine
  //    persists phase="awaiting_user" and the task can be resumed.
  if (goalStatus === "continue") {
    return { shouldContinue: true, reason: "You declared update_goal(continue) — keep working as stated." };
  }
  return { shouldContinue: false, reason: undefined };
}
