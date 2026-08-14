// ============================================================
// src/agent/ledger.ts
// Evidence ledger: records every file-write / command / skill
// execution per task, then builds a "delivery report" that is
// surfaced when the task completes. Mirrors Reasonix's delivery
// gate concept: the agent must show what it actually changed.
// ============================================================

import type { TaskState, ToolResultRecord } from "./task-state";

export type LedgerAction = "write" | "patch" | "delete" | "read" | "command" | "skill" | "mcp";

export interface LedgerEntry {
  toolName: string;
  toolCallId: string;
  action: LedgerAction;
  filePath?: string;
  success: boolean;
  timestamp: number;
  note?: string;
}

const FILE_WRITE_TOOLS: Record<string, LedgerAction> = {
  write_workspace_file: "write",
  patch_workspace_file: "patch",
  multi_edit: "patch",
  batch_write_files: "write",
};

const ACTION_BY_TOOL: Record<string, LedgerAction> = {
  run_terminal_command: "command",
  run_skill_script: "skill",
};

/** Extract a workspace-relative file path from a tool call's JSON arguments. */
function extractFilePath(name: string, args: unknown): string | undefined {
  try {
    const a = typeof args === "string" ? JSON.parse(args) : args;
    if (!a || typeof a !== "object") return undefined;
    const candidate =
      (a as any).path || (a as any).filePath || (a as any).filepath || (a as any).filename ||
      (a as any).targetPath || (a as any).relativeFilePath || (a as any).relativePath || (a as any).fullPath;
    if (typeof candidate === "string" && candidate) return candidate;
    if (Array.isArray((a as any).files)) {
      const first = (a as any).files[0];
      if (first && typeof first === "object") {
        const fp = (first as any).path || (first as any).filePath || (first as any).filepath || (first as any).relativeFilePath;
        if (typeof fp === "string" && fp) return fp;
      }
    }
    if (Array.isArray((a as any).edits)) {
      const first = (a as any).edits[0];
      if (first && typeof first === "object") {
        const fp = (first as any).path || (first as any).filePath;
        if (typeof fp === "string" && fp) return fp;
      }
    }
  } catch { /* ignore malformed args */ }
  return undefined;
}

/** Append write/command evidence to the task's metadata ledger. */
export function recordEvidence(state: TaskState, records: ToolResultRecord[]): void {
  if (!state.metadata.evidence) state.metadata.evidence = [];
  const ledger: LedgerEntry[] = state.metadata.evidence;

  for (const r of records) {
    let action: LedgerAction | undefined = FILE_WRITE_TOOLS[r.name] || ACTION_BY_TOOL[r.name];
    if (!action && r.name.startsWith("mcp__")) action = "mcp";
    if (!action) continue;

    const parsedArgs = (() => { try { return JSON.parse(r.arguments || "{}"); } catch { return {}; } })();
    // batch_write_files returns a multi-line summary that may contain per-file errors
    // without starting with "Error:" — detect partial failures explicitly.
    const hasErrorLine = r.output.includes("Error writing ") || r.output.includes("Error: ");
    const entry: LedgerEntry = {
      toolName: r.name,
      toolCallId: r.toolCallId,
      action,
      filePath: extractFilePath(r.name, parsedArgs),
      success: !r.output.startsWith("Error:") && !r.output.includes("[Execution Error]") && !hasErrorLine,
      timestamp: Date.now(),
    };
    if (action === "command") {
      const cmd = (parsedArgs as any).command || (parsedArgs as any).cmd;
      if (typeof cmd === "string") entry.note = cmd.slice(0, 120);
    } else if (r.verified === false) {
      entry.note = r.verificationNote || "verification failed";
    }
    ledger.push(entry);
  }

  if (ledger.length > 200) {
    state.metadata.evidence = ledger.slice(-200);
  }
}

/**
 * Delivery gate: returns ok=true when there are no failed write
 * operations recorded in the ledger for this task.
 */
export function checkDeliveryGate(state: TaskState): { ok: boolean; note?: string } {
  const ledger: LedgerEntry[] = state.metadata.evidence || [];
  const failedWrites = ledger.filter(
    (e) => !e.success && (e.action === "write" || e.action === "patch" || e.action === "delete")
  );
  if (failedWrites.length === 0) return { ok: true };
  const paths = [...new Set(failedWrites.map((e) => e.filePath).filter(Boolean))].slice(0, 5);
  return {
    ok: false,
    note: `Delivery gate: ${failedWrites.length} write operation(s) failed (${paths.join(", ")}). Review and retry before finishing.`,
  };
}

/** Build a markdown delivery report summarizing what the task changed. */
export function buildDeliveryReport(state: TaskState): string {
  const ledger: LedgerEntry[] = state.metadata.evidence || [];
  const written = ledger.filter((e) => e.action === "write" || e.action === "patch");
  const deleted = ledger.filter((e) => e.action === "delete");
  const commands = ledger.filter((e) => e.action === "command");
  const failed = ledger.filter((e) => !e.success);

  const lines: string[] = [];
  lines.push(`## Delivery Report (${state.taskId.slice(0, 8)})`);
  lines.push("");
  lines.push(`- **Phase**: ${state.phase}`);
  lines.push(`- **Files written/patched**: ${written.length}`);
  lines.push(`- **Files deleted**: ${deleted.length}`);
  lines.push(`- **Commands run**: ${commands.length}`);
  lines.push(`- **Failed operations**: ${failed.length}`);
  lines.push("");

  if (written.length > 0) {
    lines.push("### Changed files");
    lines.push("");
    for (const e of written.slice(0, 50)) {
      lines.push(`- ${e.filePath || "(unknown path)"} \`${e.toolName}\` ${e.success ? "✅" : "❌"}${e.note ? ` — ${e.note}` : ""}`);
    }
    if (written.length > 50) lines.push(`- ... and ${written.length - 50} more`);
    lines.push("");
  }

  if (deleted.length > 0) {
    lines.push("### Deleted files");
    lines.push("");
    for (const e of deleted.slice(0, 20)) {
      lines.push(`- ${e.filePath || "(unknown path)"} ${e.success ? "✅" : "❌"}`);
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("### Failed operations (need attention)");
    lines.push("");
    for (const e of failed.slice(0, 20)) {
      lines.push(`- \`${e.toolName}\` ${e.filePath ? `→ ${e.filePath}` : ""} ❌`);
    }
    lines.push("");
  }

  const totalFiles = new Set(
    written.map((e) => e.filePath).concat(deleted.map((e) => e.filePath)).filter(Boolean)
  ).size;
  lines.push(`> Total unique files touched: ${totalFiles}. Checkpoint available for each turn — use Rewind to restore any file.`);
  return lines.join("\n");
}
