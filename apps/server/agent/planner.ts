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

/**
 * Parse a one-line progress marker that agents output on turns AFTER the
 * initial plan (Reasonix-style dialogue flow), e.g.:
 *   ⏳ [2/5] 执行：安装依赖
 *   ✅ [2/5] 完成：安装依赖
 *   ❌ [2/5] 失败：安装依赖 — 原因
 * Returns null when the content has no such marker.
 */
export function parsePlanProgress(content: string): { index: number; total: number; status: TaskStep["status"]; description: string } | null {
  const m = content.match(/^\s*([✅⏳❌✔️✓✗])\s*\[(\d+)\/(\d+)\]\s*(?:完成|执行|进行中|失败|开始|done|start|running|failed|complete)?\s*[:：]?\s*(.+)$/m);
  if (!m) return null;
  const emoji = m[1];
  let status: TaskStep["status"] = "running";
  if (emoji === "✅" || emoji === "✔️" || emoji === "✓") status = "completed";
  else if (emoji === "❌" || emoji === "✗") status = "failed";
  return {
    index: parseInt(m[2], 10) - 1,
    total: parseInt(m[3], 10),
    status,
    description: m[4].trim(),
  };
}

/**
 * Apply a one-line progress marker to the task state (by step index).
 * Returns true when a step was updated.
 */
export function applyPlanProgress(state: TaskState, progress: { index: number; status: TaskStep["status"]; description: string }): boolean {
  if (!Array.isArray(state.steps) || state.steps.length === 0) return false;
  const step = state.steps[progress.index];
  if (!step) return false;
  step.status = progress.status;
  if (progress.description) step.description = progress.description;
  return true;
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

