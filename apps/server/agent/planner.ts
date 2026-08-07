// ============================================================
// src/agent/planner.ts
// Parse task plans produced by the model into structured steps
// ============================================================

import type { TaskState, TaskStep } from "./task-state";

const STEP_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function makeStepId(): string {
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += STEP_ID_CHARS.charAt(Math.floor(Math.random() * STEP_ID_CHARS.length));
  }
  return id;
}

export function parseTaskPlan(content: string): TaskStep[] {
  const steps: TaskStep[] = [];
  // Extract plan from <task_plan> tags if present
  const planMatch = content.match(/<task_plan[^>]*>([\s\S]*?)<\/task_plan>/i);
  const planText = planMatch ? planMatch[1] : content;
  const lines = planText.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^[-*]\s+\[([ xX/!])\]\s+(.*)$/);
    if (!match) continue;
    const marker = match[1].toLowerCase();
    const description = match[2].trim();
    if (!description) continue;

    let status: TaskStep["status"] = "pending";
    if (marker === "x") status = "completed";
    else if (marker === "/") status = "running";
    else if (marker === "!") status = "failed";

    steps.push({ id: makeStepId(), description, status });
  }

  return steps;
}

export function mergeTaskPlan(state: TaskState, parsed: TaskStep[]): void {
  // Preserve progress for steps that match. Step descriptions can legitimately
  // collide (e.g. two "Update config" steps), so we only reuse an existing
  // step's status when its description is unique among the current steps.
  // Ambiguous matches fall back to the freshly parsed step to avoid cross-wiring
  // statuses between different steps.
  const existing = new Map<string, TaskStep[]>();
  for (const s of state.steps) {
    const list = existing.get(s.description) || [];
    list.push(s);
    existing.set(s.description, list);
  }

  state.steps = parsed.map((p) => {
    const matches = existing.get(p.description);
    if (matches && matches.length === 1) {
      matches[0].status = p.status;
      return matches[0];
    }
    return p;
  });
}

export function buildReplanPrompt(state: TaskState, failureReason: string): string {
  return `The previous execution step failed or did not pass verification.\n` +
    `Failure reason: ${failureReason}\n\n` +
    `Current task plan:\n${state.steps.map((s) => `- [${s.status === "completed" ? "x" : s.status === "running" ? "/" : " "}] ${s.description}`).join("\n")}\n\n` +
    `Please update the <task_plan> and continue with a corrected approach. Do not repeat the exact failed command blindly; analyze the error and replan.`;
}

