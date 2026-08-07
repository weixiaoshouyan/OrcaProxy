// ============================================================
// src/agent/git-tools.ts
// Git-native tools for the agent system
// Provides: status, diff, commit, log, branch operations
// ============================================================

import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import { log } from "../utils/log";

function runGit(args: string[], cwd: string, timeoutMs = 30000): { ok: boolean; output: string } {
  try {
    const output = String(execFileSync("git", args, {
      cwd, encoding: "utf-8", timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024
    }));
    return { ok: true, output: output.slice(0, 10000) };
  } catch (e: any) {
    const stderr = e.stderr ? String(e.stderr).slice(0, 5000) : "";
    const stdout = e.stdout ? String(e.stdout).slice(0, 5000) : "";
    return { ok: false, output: `${stdout}\n${stderr}`.trim() };
  }
}

function isGitRepo(workspacePath: string): boolean {
  try {
    return fs.existsSync(path.join(workspacePath, ".git"));
  } catch { return false; }
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
  conflicted: string[];
}

export function getGitStatus(workspacePath: string): GitStatus {
  const result: GitStatus = {
    isRepo: false, branch: "", ahead: 0, behind: 0,
    modified: [], staged: [], untracked: [], conflicted: []
  };

  if (!isGitRepo(workspacePath)) return result;
  result.isRepo = true;

  const branchRes = runGit(["rev-parse", "--abbrev-ref", "HEAD"], workspacePath);
  if (branchRes.ok) result.branch = branchRes.output.trim();

  const aheadBehind = runGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], workspacePath);
  if (aheadBehind.ok) {
    const parts = aheadBehind.output.trim().split("\t");
    if (parts.length === 2) {
      result.ahead = parseInt(parts[0]) || 0;
      result.behind = parseInt(parts[1]) || 0;
    }
  }

  const statusRes = runGit(["status", "--porcelain", "-u"], workspacePath);
  if (statusRes.ok) {
    for (const line of statusRes.output.split("\n")) {
      if (line.length < 3) continue;
      const indexStatus = line[0];
      const workStatus = line[1];
      const file = line.slice(3);

      if (indexStatus === "U" || workStatus === "U" || indexStatus === "D" && workStatus === "D") {
        result.conflicted.push(file);
      } else if (indexStatus !== " " && indexStatus !== "?") {
        result.staged.push(file);
      }
      if (workStatus === "M") result.modified.push(file);
      if (indexStatus === "?" && workStatus === "?") result.untracked.push(file);
    }
  }

  return result;
}

export function getGitDiff(workspacePath: string, options: { staged?: boolean; file?: string; context?: number } = {}): string {
  if (!isGitRepo(workspacePath)) return "Not a git repository";

  const args = ["diff"];
  if (options.staged) args.push("--staged");
  if (options.context) args.push(`-U${options.context}`);
  else args.push("-U3");
  args.push("--no-color");
  if (options.file) args.push("--", options.file);

  const result = runGit(args, workspacePath);
  return result.ok ? result.output : `Error: ${result.output}`;
}

export function getGitLog(workspacePath: string, options: { count?: number; file?: string; author?: string } = {}): string {
  if (!isGitRepo(workspacePath)) return "Not a git repository";

  const args = ["log", `--max-count=${options.count || 10}`, `--format=%h %an %ad %s`, "--date=short", "--no-color"];
  if (options.author) args.push(`--author=${options.author}`);
  if (options.file) args.push("--", options.file);

  const result = runGit(args, workspacePath);
  return result.ok ? result.output : `Error: ${result.output}`;
}

export function gitCommit(workspacePath: string, message: string, options: { amend?: boolean; allowEmpty?: boolean } = {}): { ok: boolean; output: string } {
  if (!isGitRepo(workspacePath)) return { ok: false, output: "Not a git repository" };

  // Safety: never stage/commit outside the workspace. `git add -A` in a repo
  // whose root is a parent directory would sweep unrelated files (and secrets)
  // into the commit — refuse unless the repo root is inside the workspace.
  const rootResult = runGit(["rev-parse", "--show-toplevel"], workspacePath);
  if (!rootResult.ok) return { ok: false, output: `Could not determine repo root: ${rootResult.output}` };
  const repoRoot = String(rootResult.output).trim();
  const resolvedWs = path.resolve(workspacePath);
  const resolvedRoot = path.resolve(repoRoot);
  if (resolvedRoot !== resolvedWs && !resolvedWs.startsWith(resolvedRoot + path.sep) && !resolvedRoot.startsWith(resolvedWs + path.sep)) {
    return { ok: false, output: `Refusing to commit: repo root ${repoRoot} is outside the workspace ${workspacePath}` };
  }

  const stageResult = runGit(["add", "-A"], workspacePath);
  if (!stageResult.ok) return { ok: false, output: `Stage failed: ${stageResult.output}` };

  const args = ["commit", "-m", message];
  if (options.amend) args.push("--amend", "--no-edit");
  if (options.allowEmpty) args.push("--allow-empty");

  return runGit(args, workspacePath);
}

export function gitBranch(workspacePath: string): { branches: string[]; current: string } {
  if (!isGitRepo(workspacePath)) return { branches: [], current: "" };
  const result = runGit(["branch", "--format=%(refname:short)", "--no-color"], workspacePath);
  if (!result.ok) return { branches: [], current: "" };

  const branches = result.output.split("\n").filter(Boolean);
  const current = getGitStatus(workspacePath).branch;
  return { branches, current };
}

export function gitCreateBranch(workspacePath: string, branchName: string, checkout = true): { ok: boolean; output: string } {
  if (!isGitRepo(workspacePath)) return { ok: false, output: "Not a git repository" };

  if (checkout) {
    return runGit(["checkout", "-b", branchName], workspacePath);
  }
  return runGit(["branch", branchName], workspacePath);
}

/**
 * Format git status for agent context
 */
export function formatGitStatusForAgent(status: GitStatus): string {
  if (!status.isRepo) return "Not a git repository.";

  const parts: string[] = [`Branch: ${status.branch}`];
  if (status.ahead > 0) parts.push(`Ahead: ${status.ahead} commit(s)`);
  if (status.behind > 0) parts.push(`Behind: ${status.behind} commit(s)`);

  if (status.staged.length > 0) parts.push(`Staged (${status.staged.length}): ${status.staged.slice(0, 5).join(", ")}${status.staged.length > 5 ? "..." : ""}`);
  if (status.modified.length > 0) parts.push(`Modified (${status.modified.length}): ${status.modified.slice(0, 5).join(", ")}${status.modified.length > 5 ? "..." : ""}`);
  if (status.untracked.length > 0) parts.push(`Untracked (${status.untracked.length}): ${status.untracked.slice(0, 5).join(", ")}${status.untracked.length > 5 ? "..." : ""}`);
  if (status.conflicted.length > 0) parts.push(`⚠️ Conflicted (${status.conflicted.length}): ${status.conflicted.join(", ")}`);

  if (status.staged.length === 0 && status.modified.length === 0 && status.untracked.length === 0) {
    parts.push("Working tree clean.");
  }

  return parts.join("\n");
}
