// ============================================================
// apps/server/agent/todo.ts
// Reasonix-style todo state machine for the agent dialogue flow.
//
// Semantics ported from Reasonix (internal/evidence/evidence.go):
//  - todo_write replaces the WHOLE list on every update
//  - at most one in_progress item
//  - completed items form a serial prefix (no completed after a pending)
//  - level 0 = phase, level 1 = sub-step; a phase can only complete
//    after all of its sub-steps are completed
//  - complete_step signs off the current item; the host then advances the
//    list (next pending -> in_progress) and emits a synthetic update
// ============================================================

import type { TodoItem, TodoStatus } from "./task-state";

export interface TodoValidation {
  ok: boolean;
  error?: string;
}

/** Validate a full todo list per the serial-todo protocol. */
export function validateTodos(todos: TodoItem[]): TodoValidation {
  if (!Array.isArray(todos) || todos.length === 0) {
    return { ok: true }; // empty list is fine (clearing)
  }

  const inProgress = todos.filter((t) => t.status === "in_progress");
  if (inProgress.length > 1) {
    return { ok: false, error: `Invalid todos: at most one item may be in_progress, found ${inProgress.length}` };
  }

  // Completed must form a serial prefix
  let seenNonCompleted = false;
  for (const t of todos) {
    if (t.status === "completed") {
      if (seenNonCompleted) {
        return { ok: false, error: `Invalid todos: completed item "${t.content.slice(0, 40)}" appears after a non-completed item (completed items must form a serial prefix)` };
      }
    } else {
      seenNonCompleted = true;
    }
  }

  // Phase gating: a level-0 phase cannot be completed while any of its
  // sub-steps (the level-1 items following it) are not completed.
  for (let i = 0; i < todos.length; i++) {
    const t = todos[i];
    if (t.level === 0 && t.status === "completed") {
      const subs = todos.slice(i + 1).filter((s) => (s.level ?? 1) === 1);
      if (subs.length > 0 && subs.some((s) => s.status !== "completed")) {
        return { ok: false, error: `Invalid todos: phase "${t.content.slice(0, 40)}" is completed but not all of its sub-steps are completed` };
      }
    }
  }

  return { ok: true };
}

/**
 * Auto-repair the common todo_write protocol violations instead of rejecting
 * the whole list (models frequently resend stale lists with two in_progress
 * items or an out-of-order completed item, and a hard rejection makes them
 * retry the same mistake). Each repair is reported in `notes` so the model
 * learns the rule. Strict validation (validateTodos) still exists for tests
 * and non-tool callers.
 */
export function repairTodos(todos: TodoItem[]): { items: TodoItem[]; notes: string[] } {
  const items = todos.map((t) => ({ ...t }));
  const notes: string[] = [];
  const brief = (s: string) => (s.length > 30 ? s.slice(0, 30) + "…" : s);

  // 1. At most one in_progress: keep the first, demote the rest to pending.
  let seenInProgress = false;
  for (const t of items) {
    if (t.status === "in_progress") {
      if (seenInProgress) {
        t.status = "pending";
        notes.push(`"${brief(t.content)}" 降为 pending（in_progress 只能有一个）`);
      }
      seenInProgress = true;
    }
  }

  // 2. Completed items must form a serial prefix: demote out-of-order ones.
  let seenNonCompleted = false;
  for (const t of items) {
    if (t.status === "completed") {
      if (seenNonCompleted) {
        t.status = "pending";
        notes.push(`"${brief(t.content)}" 降为 pending（completed 必须连续前缀）`);
      }
    } else {
      seenNonCompleted = true;
    }
  }

  // 3. A phase (level 0) marked completed while its sub-steps are unfinished
  //    is demoted back to pending.
  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    if (t.level === 0 && t.status === "completed") {
      const subs = items.slice(i + 1).filter((s) => (s.level ?? 1) === 1);
      if (subs.length > 0 && subs.some((s) => s.status !== "completed")) {
        t.status = "pending";
        notes.push(`阶段 "${brief(t.content)}" 恢复为 pending（子步骤未全部完成）`);
      }
    }
  }

  return { items, notes };
}

/** Count helper for receipts and rendering. */
export function todoCounts(todos: TodoItem[]): { total: number; completed: number; inProgress: number; pending: number } {
  return {
    total: todos.length,
    completed: todos.filter((t) => t.status === "completed").length,
    inProgress: todos.filter((t) => t.status === "in_progress").length,
    pending: todos.filter((t) => t.status === "pending").length,
  };
}

/** Receipt text returned to the model (mirrors Reasonix todo.go). */
export function todoReceipt(todos: TodoItem[]): string {
  const c = todoCounts(todos);
  return `Todos updated: ${c.total} total — ${c.completed} completed, ${c.inProgress} in progress, ${c.pending} pending.`;
}

/**
 * Advance the serial list: complete the current in_progress item, then
 * promote the next pending unit to in_progress.
 * Phase-aware: when sub-steps of a phase are all completed, the phase itself
 * becomes in_progress (awaiting sign-off), and once signed off, the next
 * pending unit is promoted.
 */
export function advanceTodos(todos: TodoItem[]): TodoItem[] {
  const next = todos.map((t) => ({ ...t }));
  if (next.length === 0) return next;

  // 1. Complete whatever is in_progress
  for (const t of next) {
    if (t.status === "in_progress") t.status = "completed";
  }

  // 2. Promote the next pending unit.
  //    Phase (level 0) with pending sub-steps cannot be promoted directly —
  //    its first pending sub-step goes first.
  for (let i = 0; i < next.length; i++) {
    const t = next[i];
    if (t.status !== "pending") continue;
    if (t.level === 0) {
      // find first pending sub-step of this phase
      const sub = next.slice(i + 1).find((s) => (s.level ?? 1) === 1 && s.status === "pending");
      if (sub) {
        sub.status = "in_progress";
        return next;
      }
    }
    t.status = "in_progress";
    return next;
  }
  return next;
}

/**
 * Match a complete_step target against the todo list: by 1-based index,
 * or by fuzzy title match. Returns the item index or -1.
 */
export function matchTodoStep(todos: TodoItem[], step: string, stepIndex?: number): number {
  // 1-based index takes precedence — it works even when the step title is empty
  if (typeof stepIndex === "number" && stepIndex >= 1 && stepIndex <= todos.length) {
    return stepIndex - 1;
  }
  if (!step) return -1;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
  const target = norm(step);
  for (let i = 0; i < todos.length; i++) {
    const t = todos[i];
    if (norm(t.content) === target || norm(t.content).includes(target) || target.includes(norm(t.content))) {
      return i;
    }
  }
  return -1;
}

/** Render the current todo state as one compact line for the chat stream. */
export function renderTodoLine(todos: TodoItem[]): string {
  const c = todoCounts(todos);
  const current = todos.find((t) => t.status === "in_progress");
  const currentText = current ? (current.activeForm || current.content) : "—";
  return `> 📋 Todos [${c.completed}/${c.total}] ⏳ ${currentText.slice(0, 80)}`;
}

/** Render the full todo list as markdown (for the UI / plan text). */
export function renderTodosMarkdown(todos: TodoItem[]): string {
  const lines = todos.map((t) => {
    const marker = t.status === "completed" ? "x" : t.status === "in_progress" ? "/" : " ";
    const indent = t.level === 0 ? "" : "   ";
    return `${indent}- [${marker}] ${t.content}`;
  });
  return lines.join("\n");
}

/** Parse a Reasonix-style two-level markdown plan into TodoItems. */
export function parsePlanTodos(text: string): TodoItem[] {
  const todos: TodoItem[] = [];
  const lines = text.split("\n");
  let currentPhase: TodoItem | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    // level-1 sub-step: indented bullet
    const subMatch = line.match(/^\s{2,}[-*]\s+(.+)$/);
    if (subMatch && currentPhase) {
      todos.push({ content: subMatch[1].trim(), status: "pending", level: 1 });
      continue;
    }
    // level-0 phase: numbered item ("1. xxx") or top-level bullet
    const phaseMatch = line.match(/^\s*(?:\d+[.)]\s+|[-*]\s+)(.+)$/);
    if (phaseMatch) {
      currentPhase = { content: phaseMatch[1].trim(), status: "pending", level: 0 };
      todos.push(currentPhase);
      continue;
    }
    // plain line without list marker: treat as phase text
    if (line.trim() && !line.trim().startsWith("#")) {
      currentPhase = { content: line.trim(), status: "pending", level: 0 };
      todos.push(currentPhase);
    }
  }
  return todos.filter((t) => t.content.length > 0);
}
