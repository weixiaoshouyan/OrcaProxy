// ============================================================
// src/services/audit.ts
// Audit logging for all agent write operations
// ============================================================

import fs from "fs";
import path from "path";
import { resolveBaseDir } from "../utils/base-dir";

export type AuditAction =
  | "file_write"
  | "file_patch"
  | "command_execute"
  | "skill_run"
  | "mcp_tool_call"
  | "task_create"
  | "task_resume"
  | "task_delete";

export interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  taskId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  result?: string;
  success: boolean;
  durationMs?: number;
}

let _auditDir: string | null = null;
let _currentDate: string | null = null;
const _buffer: AuditEntry[] = [];
let _flushTimer: NodeJS.Timeout | null = null;

function getAuditDir(): string {
  if (_auditDir) return _auditDir;
  const baseDir = resolveBaseDir(__dirname, 2);
  _auditDir = path.join(baseDir, "data", "audit");
  if (!fs.existsSync(_auditDir)) fs.mkdirSync(_auditDir, { recursive: true });
  return _auditDir;
}

function getCurrentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getLogFile(date: string): string {
  return path.join(getAuditDir(), `audit-${date}.jsonl`);
}

/**
 * Roll the daily audit file over when the date changes. Flushes the previous
 * day's buffer to the previous day's file BEFORE switching, then updates the
 * current date — previously the date flip happened inside getLogFile() after
 * a flush(), which re-entered getLogFile() and relied on an empty buffer to
 * terminate (fragile implicit recursion).
 */
function ensureCurrentDate(): void {
  const date = getCurrentDate();
  if (date !== _currentDate) {
    flush();
    _currentDate = date;
  }
}

export function logAudit(entry: AuditEntry): void {
  ensureCurrentDate();
  _buffer.push(entry);

  if (!_flushTimer) {
    _flushTimer = setTimeout(flush, 2000);
  }
}

export function flush(): void {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (_buffer.length === 0) return;

  const entries = _buffer.splice(0);
  // Entries buffered under the previous date flush to the previous date's
  // file; on the same day _currentDate is already today.
  const date = _currentDate ?? getCurrentDate();
  const logFile = getLogFile(date);
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

  try {
    fs.appendFileSync(logFile, lines, "utf-8");
  } catch (e) {
    console.error("[Audit] Failed to write audit log:", e);
  }
}

export function queryAudit(filter?: {
  action?: AuditAction;
  taskId?: string;
  since?: number;
  limit?: number;
}): AuditEntry[] {
  const dir = getAuditDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().reverse();
  const results: AuditEntry[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines.reverse()) {
        const entry = JSON.parse(line) as AuditEntry;
        if (filter?.action && entry.action !== filter.action) continue;
        if (filter?.taskId && entry.taskId !== filter.taskId) continue;
        if (filter?.since && new Date(entry.timestamp).getTime() < filter.since) continue;
        results.push(entry);
        if (filter?.limit && results.length >= filter.limit) return results;
      }
    } catch { /* skip malformed */ }
  }
  return results;
}

export function getAuditStats(): { totalEntries: number; todayEntries: number; dirSize: number } {
  const dir = getAuditDir();
  let totalEntries = 0;
  let todayEntries = 0;
  let dirSize = 0;
  const today = getCurrentDate();

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const stat = fs.statSync(path.join(dir, file));
      dirSize += stat.size;
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      const count = content.split("\n").filter(Boolean).length;
      totalEntries += count;
      if (file.includes(today)) todayEntries = count;
    }
  } catch { /* ignore */ }

  return { totalEntries, todayEntries, dirSize };
}
