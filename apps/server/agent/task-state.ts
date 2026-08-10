// ============================================================
// src/agent/task-state.ts
// Persistent task state for Plan-Execute-Verify-Replan agent loop
// ============================================================

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { resolveBaseDir } from "../utils/base-dir";
import { log } from "../utils/log";

export type TaskStepStatus = "pending" | "running" | "completed" | "failed";
export type AgentPhase = "plan" | "execute" | "verify" | "replan" | "pending_approval" | "awaiting_user" | "done";

export type TodoStatus = "pending" | "in_progress" | "completed";

/**
 * Reasonix-style todo item: level 0 = phase/milestone, level 1 = sub-step.
 * The model re-sends the WHOLE list on every todo_write; the host validates.
 */
export interface TodoItem {
  content: string;
  status: TodoStatus;
  /** Present-tense form shown while in progress (e.g. "Installing deps") */
  activeForm?: string;
  /** 0 = phase, 1 = sub-step. Omitted for a flat list. */
  level?: number;
}

export interface TaskStep {
  id: string;
  description: string;
  status: TaskStepStatus;
  dependsOn?: string[];
  toolCalls?: string[]; // tool call ids used for this step
  result?: string;
  error?: string;
}

export interface ToolResultRecord {
  toolCallId: string;
  name: string;
  arguments: string;
  output: string;
  summary?: string;
  verified?: boolean;
  verificationNote?: string;
}

export interface TaskState {
  taskId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  goal: string;
  workspacePath: string;
  phase: AgentPhase;
  steps: TaskStep[];
  /** Reasonix-style two-level todo list (todo_write tool state) */
  todos?: TodoItem[];
  messages: any[]; // conversation history up to the last checkpoint
  iteration: number;
  maxIterations: number;
  results: ToolResultRecord[];
  metadata: Record<string, any>;
}

function tasksDir(): string {
  const baseDir = resolveBaseDir(__dirname, 2);
  const dir = path.join(baseDir, "data", "agent-tasks");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Reject path traversal / weird task ids: only [a-zA-Z0-9_-] allowed.
 * Mirrors services/checkpoints.ts sanitizeId. Throws on invalid input.
 */
export function sanitizeTaskId(taskId: string): string {
  const raw = String(taskId ?? "");
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean || clean !== raw) {
    throw new Error(`Invalid task id: ${raw.slice(0, 40)}`);
  }
  return clean;
}

function statePath(taskId: string): string {
  return path.join(tasksDir(), `${sanitizeTaskId(taskId)}.json`);
}

export function createTaskState(goal: string, workspacePath: string, maxIterations = 40): TaskState {
  return {
    taskId: randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    goal,
    workspacePath,
    phase: "plan",
    steps: [],
    todos: [],
    messages: [],
    iteration: 0,
    maxIterations,
    results: [],
    metadata: {},
  };
}

export function loadTaskState(taskId: string): TaskState | undefined {
  try {
    const p = statePath(taskId);
    if (!fs.existsSync(p)) return undefined;
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as TaskState;
  } catch (e) {
    log("error", `[TaskState] Failed to load ${taskId}:`, e);
    return undefined;
  }
}

export function saveTaskState(state: TaskState): void {
  try {
    state.updatedAt = Date.now();
    fs.writeFileSync(statePath(state.taskId), JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    log("error", `[TaskState] Failed to save ${state.taskId}:`, e);
  }
}

export function deleteTaskState(taskId: string): void {
  try {
    const state = loadTaskState(taskId);
    if (!state) return;
    state.deletedAt = Date.now();
    saveTaskState(state);
  } catch (e) {
    log("error", `[TaskState] Failed to soft-delete ${taskId}:`, e);
  }
}

export function hardDeleteTaskState(taskId: string): void {
  try {
    const p = statePath(taskId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    log("error", `[TaskState] Failed to delete ${taskId}:`, e);
  }
}

export function restoreTaskState(taskId: string): boolean {
  const state = loadTaskState(taskId);
  if (!state) return false;
  delete state.deletedAt;
  saveTaskState(state);
  return true;
}

function readTaskSummaries(filterDeleted: boolean): { taskId: string; goal: string; phase: AgentPhase; updatedAt: number; deletedAt?: number }[] {
  const dir = tasksDir();
  const entries: { taskId: string; goal: string; phase: AgentPhase; updatedAt: number; deletedAt?: number }[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const s = JSON.parse(raw) as TaskState;
      const isDeleted = typeof s.deletedAt === "number";
      if (filterDeleted === isDeleted) {
        entries.push({ taskId: s.taskId, goal: s.goal, phase: s.phase, updatedAt: s.updatedAt, deletedAt: s.deletedAt });
      }
    } catch { /* ignore malformed files */ }
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function listTaskStates(): { taskId: string; goal: string; phase: AgentPhase; updatedAt: number }[] {
  return readTaskSummaries(false).map(({ deletedAt: _d, ...rest }) => rest);
}

export function listArchivedTaskStates(): { taskId: string; goal: string; phase: AgentPhase; updatedAt: number; deletedAt: number }[] {
  return readTaskSummaries(true).filter((s) => typeof s.deletedAt === "number") as { taskId: string; goal: string; phase: AgentPhase; updatedAt: number; deletedAt: number }[];
}

export function updateStepStatus(
  state: TaskState,
  stepId: string,
  status: TaskStepStatus,
  extra?: Partial<TaskStep>
): void {
  const step = state.steps.find((s) => s.id === stepId);
  if (!step) return;
  step.status = status;
  if (extra) Object.assign(step, extra);
}

export function formatTaskPlan(state: TaskState): string {
  const lines = state.steps.map((s) => {
    const marker = s.status === "completed" ? "[x]" : s.status === "running" ? "[/]" : s.status === "failed" ? "[!]" : "[ ]";
    return `- ${marker} ${s.description}`;
  });
  return `<task_plan>\n${lines.join("\n")}\n</task_plan>`;
}

export function nextPendingStep(state: TaskState): TaskStep | undefined {
  return state.steps.find((s) => s.status === "pending");
}
