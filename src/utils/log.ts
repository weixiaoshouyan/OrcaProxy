// ============================================================
// src/utils/log.ts
// Unified logging with buffer, rotation, and file output
// ============================================================

import fs from "fs";
import path from "path";

export interface LogEntry { time: string; level: string; message: string; }

let _logDir: string;
let _logFile: string;
let _maxLogSize: number;
let _maxBackups: number;
let _logLevel: string;
let _buffer: LogEntry[] = [];
let _maxBuffer: number;
let _logWriteCount = 0;
const _LOG_WRITE_CHECK_INTERVAL = 50; // Check rotation every 50 writes during runtime

const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function initLogger(opts: {
  baseDir: string;
  logLevel?: string;
  maxLogSize?: number;
  maxBackups?: number;
  maxBuffer?: number;
}) {
  _logDir = path.join(opts.baseDir, "data", "logs");
  _logFile = path.join(_logDir, "orca.log");
  _maxLogSize = opts.maxLogSize ?? 10 * 1024 * 1024;
  _maxBackups = opts.maxBackups ?? 5;
  _logLevel = opts.logLevel ?? "info";
  _maxBuffer = opts.maxBuffer ?? 500;

  try { fs.mkdirSync(_logDir, { recursive: true }); } catch (e) { console.error("Failed to create log directory:", e); }
  rotateLogIfNeeded();
}

function rotateLogIfNeeded(): void {
  try {
    if (!fs.existsSync(_logFile)) return;
    const stat = fs.statSync(_logFile);
    if (stat.size < _maxLogSize) return;
    for (let i = _maxBackups - 1; i >= 1; i--) {
      const older = path.join(_logDir, `orca.log.${i}`);
      const newer = path.join(_logDir, `orca.log.${i + 1}`);
      if (fs.existsSync(older)) { if (fs.existsSync(newer)) fs.unlinkSync(newer); fs.renameSync(older, newer); }
    }
    const backup1 = path.join(_logDir, "orca.log.1");
    if (fs.existsSync(backup1)) fs.unlinkSync(backup1);
    fs.renameSync(_logFile, backup1);
  } catch (e) { console.error("Log rotation failed:", e); }
}

export function log(level: string, ...args: unknown[]) {
  if ((LOG_LEVELS[level] ?? 1) < (LOG_LEVELS[_logLevel] ?? 1)) return;
  const ts = new Date().toISOString();
  const message = args.map((a) => {
    if (a instanceof Error) return a.stack || String(a);
    return typeof a === "string" ? a : JSON.stringify(a);
  }).join(" ");
  console.log(`[${ts}] [${level.toUpperCase()}]`, message);
  _buffer.push({ time: ts, level, message });
  if (_buffer.length > _maxBuffer) _buffer.shift();

  try {
    fs.appendFileSync(_logFile, `[${ts}] [${level.toUpperCase()}] ${message}\n`, "utf-8");
    // Runtime log rotation: check size every N writes to prevent unbounded growth
    _logWriteCount++;
    if (_logWriteCount >= _LOG_WRITE_CHECK_INTERVAL) {
      _logWriteCount = 0;
      rotateLogIfNeeded();
    }
  } catch (e) { console.error("Failed to write to log file:", e); }
}

export function getLogBuffer(): LogEntry[] { return _buffer; }
export function clearLogBuffer(): void { _buffer = []; }
