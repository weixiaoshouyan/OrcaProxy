// ============================================================
// src/routes/workspace.ts
// Workspace management: file listing, file reading, open file
// ============================================================

import express from "express";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { log } from "../utils/log";

/** Workspaces picked through the trusted Electron directory dialog. */
const registeredWorkspaces = new Set<string>();
// Auto-register the server's own working directory on startup.
try {
  registeredWorkspaces.add(path.resolve(process.cwd()));
} catch { /* ignore */ }

/** Register a workspace path (used by the trusted directory picker). */
export function registerWorkspace(p: string): boolean {
  try {
    const resolved = path.resolve(p);
    if (resolved === path.parse(resolved).root) return false;
    if (!fs.existsSync(resolved)) return false;
    registeredWorkspaces.add(resolved);
    return true;
  } catch {
    return false;
  }
}

/**
 * 验证目标路径是否在工作区目录内
 * 返回 null 表示合法，否则返回错误信息
 */
function validateWithinWorkspace(filepath: string, workspacePath: string): string | null {
  if (!workspacePath) {
    return "workspacePath is required for security scoping";
  }
  const resolvedFile = path.resolve(filepath);
  const resolvedWorkspace = path.resolve(workspacePath);
  // Refuse filesystem roots as workspaces ("C:\\", "/") — they would grant
  // read access to the entire disk.
  if (resolvedWorkspace === path.parse(resolvedWorkspace).root) {
    return "Access denied: filesystem root is not a valid workspace";
  }
  const sep = path.sep;
  if (!resolvedFile.startsWith(resolvedWorkspace + sep) && resolvedFile !== resolvedWorkspace) {
    return "Access denied: file is outside the workspace directory";
  }
  // 额外 symlink 检查，直接使用 realpathSync 避免 TOCTOU 竞争条件。
  // Failure to resolve either path is treated as DENIED (fail closed): a
  // missing workspace means the request is stale; a missing target file gets
  // a proper error instead of being silently treated as valid.
  try {
    const realWorkspace = fs.realpathSync(resolvedWorkspace);
    const realFile = fs.realpathSync(resolvedFile);
    if (!realFile.startsWith(realWorkspace + sep) && realFile !== realWorkspace) {
      return "Access denied: symlink traversal detected";
    }
  } catch {
    return "Access denied: workspace or file does not exist / is inaccessible";
  }
  return null;
}

export function registerWorkspaceRoutes(app: express.Application): void {
  // ---- Workspace registration (trusted path source: Electron picker) ----
  // Registered workspaces are accepted; other valid absolute paths remain
  // usable (historical localStorage entries), so registration is advisory.
  app.post("/api/workspace/register", (req, res) => {
    const { workspacePath } = req.body || {};
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      return res.status(400).json({ error: "workspacePath is required" });
    }
    const p = path.resolve(workspacePath.trim());
    if (p === path.parse(p).root) {
      return res.status(400).json({ error: "filesystem root is not a valid workspace" });
    }
    if (!fs.existsSync(p)) {
      return res.status(400).json({ error: "workspace path does not exist" });
    }
    registeredWorkspaces.add(p);
    res.json({ ok: true, registered: [...registeredWorkspaces] });
  });

  // ---- List workspace files ----
  app.post("/api/workspace/list", (req, res) => {
    try {
      const { workspacePath, subPath } = req.body;
      const base = workspacePath || process.cwd();
      if (!fs.existsSync(base)) {
        return res.status(400).json({ error: "Workspace path does not exist" });
      }
      const targetDir = subPath ? path.join(base, subPath) : base;
      
      // Safety check: prevent path traversal outside workspace
      const relative = path.relative(base, targetDir);
      if (relative.startsWith("..") && !path.isAbsolute(relative)) {
        return res.status(400).json({ error: "Access denied" });
      }
      
      if (!fs.existsSync(targetDir)) {
        return res.status(404).json({ error: "Directory not found" });
      }
      
      const items = fs.readdirSync(targetDir, { withFileTypes: true });
      const ignoredDirs = [".git", "node_modules", "dist", "build", "release", "out", ".venv", "env", "bin", "obj"];
      const ignoredFiles = [".DS_Store", "thumbs.db"];
      
      const result = items
        .filter(item => {
          if (item.isDirectory() && ignoredDirs.includes(item.name)) return false;
          if (item.isFile() && ignoredFiles.includes(item.name)) return false;
          return true;
        })
        .map(item => {
          const itemPath = path.join(targetDir, item.name);
          const relPath = path.relative(base, itemPath);
          return {
            name: item.name,
            relativePath: relPath.replace(/\\/g, "/"),
            absolutePath: itemPath.replace(/\\/g, "/"),
            isDirectory: item.isDirectory(),
            size: item.isFile() ? fs.statSync(itemPath).size : undefined
          };
        })
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
        
      res.json({ ok: true, items: result });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---- Read file content (scoped to workspace) ----
  app.post("/api/workspace/file-content", (req, res) => {
    try {
      const { filepath, workspacePath } = req.body;
      if (!filepath) return res.status(400).json({ error: "filepath is required" });
      if (!workspacePath) return res.status(400).json({ error: "workspacePath is required" });

      // 安全：强限制在工作区目录内
      const scopeError = validateWithinWorkspace(filepath, workspacePath);
      if (scopeError) {
        log("warn", `[Workspace] Blocked file-content access: ${scopeError} (${filepath})`);
        return res.status(403).json({ error: scopeError });
      }

      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: "File not found" });
      }
      
      const stats = fs.statSync(filepath);
      if (stats.size > 2 * 1024 * 1024) {
        return res.status(400).json({ error: "File is too large to preview (> 2MB)" });
      }
      
      const content = fs.readFileSync(filepath, "utf8");
      res.json({ ok: true, content });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

// ---- Open file with system default app ----
  app.post("/api/open-file", (req, res) => {
    try {
      const { filepath, workspacePath } = req.body;
      if (!filepath) return res.status(400).json({ error: "filepath is required" });
      if (!workspacePath) return res.status(400).json({ error: "workspacePath is required to scope the open request" });

      const scopeError = validateWithinWorkspace(filepath, workspacePath);
      if (scopeError) {
        log("warn", `[File] Blocked open-file outside workspace: ${filepath}`);
        return res.status(403).json({ error: scopeError });
      }

      if (!fs.existsSync(filepath)) {
        return res.status(400).json({ error: `File not found: ${filepath}` });
      }

      // Reject cmd.exe metacharacters so a crafted path cannot escape the /c start command line
      if (/["&|^<>%!()]/.test(filepath)) {
        return res.status(400).json({ error: "Invalid characters in filepath" });
      }

      const cmdArgs = ['/c', 'start', '', `"${filepath}"`];
      const child = spawn("cmd.exe", cmdArgs, { detached: true, stdio: "ignore" });
      child.unref();
      
      log("info", `[File] Opened file: ${filepath}`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---- Rerun a terminal command (TerminalPanel "rerun" action, P1-8) ----
  // Reuses the agent's executeTerminalCommand so the same dangerous-command
  // blacklist / output truncation rules apply. Workspace path is required to
  // scope execution; absolute paths outside a registered workspace are refused.
  app.post("/api/workspace/run-command", (req, res) => {
    (async () => {
      const { command, workspacePath } = req.body || {};
      if (typeof command !== "string" || !command.trim()) {
        return res.status(400).json({ error: "command is required" });
      }
      if (typeof workspacePath !== "string" || !workspacePath.trim()) {
        return res.status(400).json({ error: "workspacePath is required to scope command execution" });
      }
      const resolved = path.resolve(workspacePath);
      if (resolved === path.parse(resolved).root) {
        return res.status(403).json({ error: "filesystem root is not a valid workspace" });
      }
      if (!fs.existsSync(resolved)) {
        return res.status(400).json({ error: "workspace path does not exist" });
      }
      const { executeTerminalCommand } = await import("../services/skills");
      const output = await executeTerminalCommand(command, resolved);
      const blocked = output.startsWith("[BLOCKED]");
      res.json({ ok: !blocked, output, blocked });
    })().catch((e: any) => {
      log("error", "[Workspace] run-command failed:", e);
      res.status(500).json({ error: "命令执行失败", detail: String((e as Error)?.message || e) });
    });
  });
}
