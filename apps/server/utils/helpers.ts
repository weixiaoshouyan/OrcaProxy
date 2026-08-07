// ============================================================
// src/utils/helpers.ts
// Shared utility functions used across the backend
// ============================================================

import fs from "fs";

/**
 * Write a file atomically: write to a temp sibling then rename, so a crash
 * mid-write never leaves a truncated/corrupt JSON file behind.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data, "utf-8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    // Windows: rename over an existing open file can fail — fall back to
    // remove+rename, then plain write as a last resort.
    try { fs.rmSync(filePath, { force: true }); fs.renameSync(tmpPath, filePath); }
    catch { try { fs.writeFileSync(filePath, data, "utf-8"); } finally { try { fs.rmSync(tmpPath, { force: true }); } catch {} } }
  }
}

/**
 * Check if an error is a broken pipe (EPIPE) error.
 * These errors occur when the client disconnects before the response is complete,
 * and should be silently ignored rather than crashing the server.
 */
export function isBrokenPipeError(err: any): boolean {
  return err && err.code === 'EPIPE';
}

/**
 * Binary file extensions that should be skipped when reading/searching files.
 */
export const BINARY_EXTS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.webp', '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.woff', '.woff2', '.ttf', '.otf',
  '.eot', '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.class', '.pyc', '.pyd', '.obj',
  '.o', '.a', '.lib', '.db', '.sqlite', '.sqlite3', '.bin', '.dat', '.lock',
]);

// ---- Constants ----

/** Maximum buffer size for file reads (50KB) */
export const MAX_FILE_BUFFER = 50 * 1024;

/** Maximum recursion depth for agent tool execution */
export const AGENT_MAX_DEPTH = 40;

/** Agent idle timeout (30 minutes) */
export const AGENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Agent hard timeout (2 hours) */
export const AGENT_HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** Individual tool execution timeout (2 minutes) */
export const TOOL_TIMEOUT_MS = 2 * 60 * 1000;

/** Maximum parallel read-only tool calls */
export const MAX_PARALLEL_READS = 12;

/** Maximum tool output length before summarization */
export const MAX_TOOL_OUTPUT_LENGTH = 2500;

/** Streaming throttle interval for frontend (ms) */
export const STREAM_THROTTLE_MS = 80;