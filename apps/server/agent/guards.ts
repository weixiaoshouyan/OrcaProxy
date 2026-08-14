// ============================================================
// src/agent/guards.ts
// Loop guards borrowed from Reasonix: repeat-failure / repeat-success
// / todo-stall / storm-breaker guards to prevent the agent from
// looping on the same action or stalling without progress.
// ============================================================

import type { TaskState, ToolResultRecord } from "./task-state";

export interface GuardVerdict {
  note?: string;
  toolContentNote?: string;
  /** When true, the caller should abort the whole task immediately. */
  hardStop?: boolean;
}

const STORM_THRESHOLD = 3;
const REPEAT_FAIL_THRESHOLD = 2;
const REPEAT_SUCCESS_THRESHOLD = 2;
/** Same tool failing this many times (regardless of error text) → abort. */
const SAME_TOOL_FAIL_HARD_LIMIT = 4;

/**
 * Host-side meta tools: their "failures" are protocol-bookkeeping errors
 * (malformed todo lists, bad evidence), NOT execution failures. Hard-stopping
 * a whole task because the model misused todo_write burns the user's work —
 * a corrective note is the right response.
 */
const META_TOOLS = new Set(["todo_write", "complete_step", "update_goal", "ask_question"]);

/** Signature of a failure: tool name + first error line. */
function failureSignature(rec: ToolResultRecord): string {
  const errLine = rec.output.split("\n").find((l) => /error|failed|exception|fail/i.test(l)) || "unknown-error";
  return `${rec.name}::${errLine.trim().slice(0, 120)}`;
}

function successSignature(rec: ToolResultRecord): string {
  return `${rec.name}::${(rec.arguments || "").slice(0, 160)}`;
}

/**
 * Storm breaker + repeat-failure guard evaluated after a batch of
 * tool results. Returns an optional instruction appended to the last
 * tool result so the model visibly changes direction.
 */
export function evaluateToolGuards(
  taskState: TaskState,
  records: ToolResultRecord[]
): GuardVerdict {
  if (!taskState.results) return {};

  const failures = records.filter((r) => r.output.startsWith("Error:") || r.output.includes("[Execution Error]"));

  // Storm breaker: same tool + same error signature repeated across turns.
  if (failures.length > 0) {
    const allResults = [...taskState.results, ...records];
    const recentResults = allResults.slice(-24);

    // Hard stop: one REAL tool failed repeatedly no matter the error text —
    // the model is stuck in a retry loop and would keep burning tokens.
    // Meta tools are exempt: their failures are protocol bookkeeping.
    for (const fail of failures) {
      if (META_TOOLS.has(fail.name)) continue;
      const sameToolFails = recentResults.filter(
        (r) => r.name === fail.name && (r.output.startsWith("Error:") || r.output.includes("[Execution Error]"))
      ).length;
      if (sameToolFails >= SAME_TOOL_FAIL_HARD_LIMIT) {
        const lastErr = (fail.output.split("\n").find((l) => /error|failed/i.test(l)) || fail.output.slice(0, 160)).trim();
        return {
          note: `[Guard] Tool "${fail.name}" has failed ${sameToolFails} times in a row — stopping. Last error: ${lastErr.slice(0, 160)}. Retrying the same tool will not succeed; change approach (different arguments, a different tool, or fix the underlying cause first).`,
          hardStop: true,
        };
      }
    }

    // Meta tools failing repeatedly get a corrective note instead of a stop.
    const metaFails = failures.filter((f) => META_TOOLS.has(f.name));
    for (const fail of metaFails) {
      const count = recentResults.filter((r) => r.name === fail.name && (r.output.startsWith("Error:") || r.output.includes("[Execution Error]"))).length;
      if (count >= 3) {
        const hint = fail.name === "todo_write"
          ? "Read the validation error carefully: status must be pending/in_progress/completed; only ONE in_progress; completed items form a serial prefix; phases finish only after all sub-steps."
          : fail.name === "complete_step"
            ? "complete_step needs: the exact current step (title or 1-based index), a result, and at least one evidence item (verification command that ran successfully this session, or file paths written this session)."
            : fail.name === "update_goal"
              ? "update_goal status must be one of: complete / continue / blocked, with reason and next_action."
              : "Check the tool's parameter format and retry once with corrected arguments.";
        return {
          note: `[Guard] ${fail.name} was rejected ${count} times by the host. ${hint}`,
        };
      }
    }

    for (const fail of failures) {
      if (META_TOOLS.has(fail.name)) continue;
      const sig = failureSignature(fail);
      const count = recentResults.filter((r) => r.output.startsWith("Error:") && failureSignature(r) === sig).length;
      if (count >= STORM_THRESHOLD) {
        return {
          note: `[Guard] Tool "${fail.name}" failed with the same error ${count} times. Change approach — do not retry the same tool+arguments.`,
        };
      }
    }

    // Repeat-failure guard: same write intent + same error class twice.
    for (const fail of failures) {
      if (META_TOOLS.has(fail.name)) continue;
      const sig = failureSignature(fail);
      const sameErrorTwice = recentResults.filter((r) => r.output.startsWith("Error:") && failureSignature(r) === sig).length;
      if (sameErrorTwice >= REPEAT_FAIL_THRESHOLD && (fail.name === "write_workspace_file" || fail.name === "patch_workspace_file" || fail.name === "multi_edit")) {
        return {
          note: `[Guard] ${fail.name} failed with the same error twice. Do not retry identical edits; use a different approach (e.g. multi_edit or a fresh write).`,
        };
      }
    }
  }

  // Repeat-success guard: identical write succeeded before — block redundant rewrites.
  const successfulWrites = records.filter((r) => !r.output.startsWith("Error:") && (r.name === "write_workspace_file" || r.name === "patch_workspace_file" || r.name === "multi_edit"));
  if (successfulWrites.length > 0) {
    const allResults = [...taskState.results, ...records];
    const recentResults = allResults.slice(-12);
    for (const rec of successfulWrites) {
      const sig = successSignature(rec);
      const dup = recentResults.filter((r) => successSignature(r) === sig).length;
      if (dup >= REPEAT_SUCCESS_THRESHOLD) {
        return {
          note: `[Guard] ${rec.name} already succeeded with identical arguments (x${dup}). Avoid rewriting the same content repeatedly.`,
        };
      }
    }
  }

  return {};
}
