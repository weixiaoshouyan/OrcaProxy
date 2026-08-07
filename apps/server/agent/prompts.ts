// ============================================================
// agent/prompts.ts
// Reasonix-style prompt architecture:
//   - minimal base system prompt (behavior lives in tool contracts
//     and host-enforced mechanisms, not in prose)
//   - per-round composed directive block (composeDirective) that the
//     host upserts before EVERY model call
//   - turn refusal text (turnRefusal) injected when the model tries to
//     end a turn that does not meet the delivery gate
// ============================================================

import type { TaskState } from "./task-state";

/** Minimal base system prompt — Reasonix philosophy: short and stable. */
export const REASONIX_BASE_PROMPT = `You are the Orca agent, an autonomous coding agent running inside a proxy server.
You work in rounds. In each round the host injects a <task-state> block that tells you the current plan, progress and phase — trust it, it is the single source of truth.
Drive all progress through your tools: todo_write maintains the task list, complete_step signs off finished steps with evidence, update_goal declares how the round should end. Keep your text replies extremely concise; progress is shown by the host from the task state.
Never end a turn while the <task-state> still lists unfinished steps — if you try, the host will refuse the turn and tell you why.`;

/** Compose the per-round directive block (replaces the old <orca_task_plan> injection). */
export function composeDirective(taskState: TaskState | undefined, round: number, goal: string): string {
  if (!taskState) {
    return `<task-state round="${round}" phase="init">
Goal: ${goal || "(none)"}
No task list yet — establish one with todo_write before executing.
</task-state>`;
  }

  const todos = Array.isArray(taskState.todos) ? taskState.todos : [];
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").map((t) => t.content);
  const pending = todos.filter((t) => t.status === "pending").length;
  const next = todos.find((t) => t.status === "pending");

  const lines: string[] = [];
  lines.push(`<task-state round="${round}" phase="${taskState.phase}" goal="${(goal || "").slice(0, 200)}">`);
  lines.push(`Todos: ${completed}/${todos.length} completed, ${pending} pending${inProgress.length ? `, in_progress: ${inProgress.join("; ")}` : ""}`);
  if (next) lines.push(`Next step: "${next.content}"`);
  if (taskState.metadata?.hardStop) lines.push(`Hard stop: ${String(taskState.metadata.hardStop).slice(0, 200)}`);
  lines.push("</task-state>");
  return lines.join("\n");
}

/** Turn refusal — injected when the model ends its turn without meeting the delivery gate. */
export function turnRefusal(reason: string): string {
  return `[Turn refused — task not complete]
${reason}
You must continue working this round: call the next tool(s) to make concrete progress toward completing the remaining steps, then sign off finished steps with complete_step. Do not end the turn again until the delivery gate passes.`;
}

/** Goal-declaration tool description (shared with injectAgentTools). */
export const UPDATE_GOAL_DESCRIPTION =
  "Declare how you want this round to end (the host decides whether to continue). " +
  "status: complete = you believe the task is fully done; continue = keep working; blocked = you cannot proceed without user input or a scope change (give the concrete next_action). " +
  "The host will refuse 'complete' while the task list still has unfinished steps.";
