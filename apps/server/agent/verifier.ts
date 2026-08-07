// ============================================================
// src/agent/verifier.ts
// Verification after write tool calls: file existence + auto tests
// ============================================================

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { ToolResultRecord } from "./task-state";
import { log } from "../utils/log";
import { loadConfig } from "../providers";

export interface VerificationResult {
  ok: boolean;
  note: string;
}

const WRITE_TOOLS = new Set([
  "patch_workspace_file",
  "multi_edit",
  "write_workspace_file",
  "run_terminal_command",
  "run_skill_script",
]);

function wasWriteOperation(records: ToolResultRecord[]): boolean {
  return records.some((r) => WRITE_TOOLS.has(r.name) || r.name.startsWith("mcp__"));
}

function fileExists(workspacePath: string, relativePath: string): boolean {
  try {
    return fs.existsSync(path.join(workspacePath, relativePath));
  } catch {
    return false;
  }
}

function runCommand(cmd: string, cwd: string, timeoutMs = 120000): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, { cwd, encoding: "utf-8", timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, output: output.slice(0, 8000) };
  } catch (e: any) {
    const stderr = e.stderr ? String(e.stderr).slice(0, 8000) : "";
    const stdout = e.stdout ? String(e.stdout).slice(0, 8000) : "";
    return { ok: false, output: `${stdout}\n${stderr}`.trim() };
  }
}

function detectVerificationCommands(workspacePath: string): { cmd: string; label: string }[] {
  const commands: { cmd: string; label: string }[] = [];
  const pkgPath = path.join(workspacePath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.test && pkg.scripts.test !== "echo \"Error: no test specified\"") {
        commands.push({ cmd: "npm test", label: "npm test" });
      }
      if (pkg.scripts?.lint) {
        commands.push({ cmd: "npm run lint", label: "npm run lint" });
      }
      if (pkg.scripts?.build) {
        commands.push({ cmd: "npm run build", label: "npm run build" });
      }
    } catch { /* ignore */ }
  }
  if (fs.existsSync(path.join(workspacePath, "tsconfig.json"))) {
    commands.push({ cmd: "npx tsc --noEmit", label: "tsc --noEmit" });
  }
  if (
    fs.existsSync(path.join(workspacePath, ".eslintrc.js")) ||
    fs.existsSync(path.join(workspacePath, ".eslintrc.cjs")) ||
    fs.existsSync(path.join(workspacePath, ".eslintrc.json")) ||
    fs.existsSync(path.join(workspacePath, ".eslintrc")) ||
    fs.existsSync(path.join(workspacePath, "eslint.config.js")) ||
    fs.existsSync(path.join(workspacePath, "eslint.config.mjs")) ||
    fs.existsSync(path.join(workspacePath, "eslint.config.cjs"))
  ) {
    commands.push({ cmd: "npx eslint . --max-warnings=0", label: "eslint" });
  }
  return commands;
}

export function verifyToolResults(
  records: ToolResultRecord[],
  workspacePath: string
): VerificationResult {
  if (!wasWriteOperation(records)) {
    return { ok: true, note: "Read-only operations, no verification needed." };
  }

  const notes: string[] = [];
  let ok = true;

  for (const r of records) {
    if (r.name === "patch_workspace_file" || r.name === "write_workspace_file" || r.name === "multi_edit") {
      try {
        const args = JSON.parse(r.arguments || "{}") as { relativeFilePath?: string; relative_path?: string };
        const relPath = args.relativeFilePath || args.relative_path;
        if (relPath && !fileExists(workspacePath, relPath)) {
          ok = false;
          notes.push(`${relPath}: file does not exist after write`);
        }
      } catch {
        // ignore parse errors; model will see raw output
      }
    }

    const errorPatterns = [/\[Execution Error\]/, /\[Exit Code [^0]/, /Error: /, /error: /, /\bFAIL\b/];
    const hasError = errorPatterns.some((p) => p.test(r.output));
    if (hasError) {
      ok = false;
      notes.push(`${r.name}: output contains error markers`);
    }
  }

  const cfg = loadConfig();
  if (cfg.autoVerify !== false && fs.existsSync(workspacePath)) {
    const commands = detectVerificationCommands(workspacePath);
    if (commands.length > 0) {
      log("info", `[Verifier] Running ${commands.length} verification command(s) in ${workspacePath}`);
      for (const { cmd, label } of commands) {
        const result = runCommand(cmd, workspacePath);
        if (!result.ok) {
          ok = false;
          notes.push(`${label} failed: ${result.output.slice(0, 300)}`);
        } else {
          notes.push(`${label} passed`);
        }
      }
    }
  }

  return { ok, note: notes.length ? notes.join("; ") : "Write operations completed without obvious errors." };
}
