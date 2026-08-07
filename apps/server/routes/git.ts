// ============================================================
// src/routes/git.ts
// Git operations: status, commit
// ============================================================

import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { log } from "../utils/log";

export function registerGitRoutes(app: express.Application): void {
  // ---- Git status ----
  app.post("/api/git/status", (req, res) => {
    try {
      const workspacePath = req.body.cwd || req.body.workspacePath || process.cwd();
      if (!fs.existsSync(workspacePath)) {
        return res.status(400).json({ error: "Workspace directory does not exist" });
      }
      
      let statusOut = "";
      try {
        statusOut = execSync("git status --porcelain", { cwd: workspacePath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      } catch (e) {
        return res.json({ branch: "\u2014", modified: 0, untracked: 0, lastCommit: "\u2014", modifiedFiles: [] });
      }
      
      let branchOut = "";
      try {
        branchOut = execSync("git branch --show-current", { cwd: workspacePath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch (e) {}
      
      let lastCommit = "";
      try {
        lastCommit = execSync('git log -1 --format="%h - %s (%cr)"', { cwd: workspacePath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch (e) {}
      
      const lines = statusOut.split("\n").filter(Boolean);
      const modifiedFiles = lines.map(line => {
        const status = line.substring(0, 2);
        const filepath = line.substring(3).trim();
        return { status, filepath };
      });
      
      const modifiedCount = modifiedFiles.filter((f: any) => !f.status.includes("?")).length;
      const untrackedCount = modifiedFiles.filter((f: any) => f.status.includes("?")).length;
      
      res.json({
        branch: branchOut || "master",
        modified: modifiedCount,
        untracked: untrackedCount,
        lastCommit: lastCommit || "No commits yet",
        modifiedFiles
      });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---- Git commit ----
  app.post("/api/git/commit", (req, res) => {
    try {
      const { workspacePath, message } = req.body;
      const targetPath = workspacePath || process.cwd();
      if (!message) return res.status(400).json({ error: "Commit message is required" });
      if (!fs.existsSync(targetPath)) return res.status(400).json({ error: "Workspace path does not exist" });
      
      execSync("git add .", { cwd: targetPath });
      
      // Use temp file for commit message to avoid shell injection
      const tmpMsgFile = path.join(os.tmpdir(), `orca-commit-msg-${Date.now()}.txt`);
      fs.writeFileSync(tmpMsgFile, message, "utf8");
      let commitOut = "";
      try {
        commitOut = execSync(`git commit -F "${tmpMsgFile}"`, { cwd: targetPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      } finally {
        try { fs.unlinkSync(tmpMsgFile); } catch (e) {}
      }
      
      log("info", `[Git] Committed changes in ${targetPath}: ${message}`);
      res.json({ ok: true, output: commitOut });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
