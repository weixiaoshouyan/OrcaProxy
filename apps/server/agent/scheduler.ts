// ============================================================
// src/agent/scheduler.ts
// Dependency-aware tool scheduling for agent execution
// ============================================================

import { MAX_PARALLEL_READS } from "../utils/helpers";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

const WRITE_TOOLS = new Set([
  "patch_workspace_file",
  "multi_edit",
  "write_workspace_file",
  "run_terminal_command",
  "run_skill_script",
]);

function isReadOnly(name: string): boolean {
  return !WRITE_TOOLS.has(name) && !name.startsWith("mcp__");
}

/**
 * Group tool calls into batches.
 * Batch 0 = all read-only calls that are independent (capped at MAX_PARALLEL_READS).
 * Subsequent batches = each write call (and any read call that depends on the same path) runs alone.
 */
export function scheduleToolCalls(calls: ToolCall[]): ToolCall[][] {
  const readOnly = calls.filter((c) => isReadOnly(c.name));
  const writeOrUnknown = calls.filter((c) => !isReadOnly(c.name));

  // Independent read-only calls can run in parallel, but cap to avoid system overload.
  const batches: ToolCall[][] = [];
  for (let i = 0; i < readOnly.length; i += MAX_PARALLEL_READS) {
    batches.push(readOnly.slice(i, i + MAX_PARALLEL_READS));
  }

  // For write operations, run them one-by-one to preserve order and avoid conflicts.
  for (const c of writeOrUnknown) {
    batches.push([c]);
  }

  return batches;
}

export function formatToolBatchForModel(batches: ToolCall[][]): string {
  return batches
    .map((batch, idx) => `Batch ${idx + 1} (${batch.length} tool call${batch.length > 1 ? "s" : ""}): ${batch.map((c) => c.name).join(", ")}`)
    .join("\n");
}
