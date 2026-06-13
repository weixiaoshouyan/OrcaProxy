// ============================================================
// src/routes/workspace.ts
// Workspace management: file listing, file reading, open file
// ============================================================

import express from "express";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { log } from "../utils/log";

export function registerWorkspaceRoutes(app: express.Application): void {
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
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Read file content ----
  app.post("/api/workspace/file-content", (req, res) => {
    try {
      const { filepath } = req.body;
      if (!filepath) return res.status(400).json({ error: "filepath is required" });
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
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Open file with system default app ----
  app.post("/api/open-file", (req, res) => {
    try {
      const { filepath } = req.body;
      if (!filepath) return res.status(400).json({ error: "filepath is required" });
      if (!fs.existsSync(filepath)) {
        return res.status(400).json({ error: `File not found: ${filepath}` });
      }
      
      const child = spawn("cmd.exe", ["/c", "start", "", filepath], { detached: true, stdio: "ignore" });
      child.unref();
      
      log("info", `[File] Opened file: ${filepath}`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
