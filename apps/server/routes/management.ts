// ============================================================
// src/routes/management.ts
// Management API routes: /api/providers, /api/config, /api/status, etc.
// ============================================================

import express from "express";
import { loadConfig, saveConfig, getAllProviders, getProvider, getActiveProvider, getApiKey } from "../providers";
import { initMCPServers, getMCPServerStatuses } from "../mcp";
import { log } from "../utils/log";
import { getStats, getTokenHistory } from "../utils/stats";
import { getLogBuffer, clearLogBuffer } from "../utils/log";
import { IS_ELECTRON } from "../utils/base-dir";
import { queryAudit, getAuditStats, flush } from "../services/audit";
import {
  getMcpPermissions, setMcpPermissions, getPendingApprovals,
  approveMcpTool, rejectMcpApproval, clearPendingApprovals,
} from "../services/mcp-permissions";
import { resumeTaskInBackground } from "../services/task-resume";

// Pending file/dir picker promises (Electron IPC bridge)
const pendingChooseDirRequests = new Map<string, (result: { path?: string; cancelled?: boolean }) => void>();
const pendingChooseSkillRequests = new Map<string, (result: { path?: string; cancelled?: boolean }) => void>();
const pendingChooseCustomFileRequests = new Map<string, (result: { path?: string; cancelled?: boolean }) => void>();

const SECRET_MASK = "***configured***";

/**
 * Deep-mask a config object so no secret material ever reaches the client:
 * providerKeys, profile apiKey/env, customProviders apiKey, mcpServers env.
 * Never exposes key prefixes — the mask is all-or-nothing.
 */
export function maskConfigForClient(c: any): any {
  const clone = JSON.parse(JSON.stringify(c));
  const maskVal = (v: unknown) => (v === undefined || v === null || v === "") ? v : SECRET_MASK;

  const safeKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(clone.providerKeys || {})) {
    safeKeys[k] = v ? SECRET_MASK : "";
  }
  clone.providerKeys = safeKeys;

  const safeProfiles: Record<string, any> = {};
  for (const [id, p] of Object.entries(clone.profiles || {})) {
    const prof = { ...(p as any) };
    prof.apiKey = maskVal(prof.apiKey);
    if (prof.env && typeof prof.env === "object") {
      for (const ek of Object.keys(prof.env)) prof.env[ek] = maskVal(prof.env[ek]);
    }
    safeProfiles[id] = prof;
  }
  clone.profiles = safeProfiles;

  clone.customProviders = (clone.customProviders || []).map((p: any) => {
    const cp = { ...p };
    cp.apiKey = maskVal(cp.apiKey);
    return cp;
  });

  if (clone.mcpServers && typeof clone.mcpServers === "object") {
    for (const s of Object.values(clone.mcpServers) as any[]) {
      if (s && s.env && typeof s.env === "object") {
        for (const ek of Object.keys(s.env)) s.env[ek] = maskVal(s.env[ek]);
      }
    }
  }
  return clone;
}

export function setupIPCHandlers(): void {
  if (process.send) {
    process.on("message", (msg: any) => {
      if (msg && msg.type === "choose-directory-response") {
        const cb = pendingChooseDirRequests.get(msg.requestId);
        if (cb) { cb({ path: msg.path, cancelled: msg.cancelled }); pendingChooseDirRequests.delete(msg.requestId); }
      } else if (msg && msg.type === "choose-file-response") {
        const cb = pendingChooseSkillRequests.get(msg.requestId);
        if (cb) { cb({ path: msg.path, cancelled: msg.cancelled }); pendingChooseSkillRequests.delete(msg.requestId); }
      } else if (msg && msg.type === "choose-custom-file-response") {
        const cb = pendingChooseCustomFileRequests.get(msg.requestId);
        if (cb) { cb({ path: msg.path, cancelled: msg.cancelled }); pendingChooseCustomFileRequests.delete(msg.requestId); }
      }
    });
  }
}

export { pendingChooseDirRequests, pendingChooseSkillRequests, pendingChooseCustomFileRequests };

export function registerManagementRoutes(app: express.Application): void {
  // ---- Health ----
  app.get("/health", (_req, res) => {
    const memUsage = process.memoryUsage();
    const ms = getMCPServerStatuses();
    const cs = (() => { try { return require("../cache").getCacheStats(); } catch { return { entries: 0, sizeBytes: 0 }; } })();
    res.json({
      status: "ok", uptime: process.uptime(), pid: process.pid, platform: process.platform, nodeVersion: process.version,
      memory: {
        heapUsedMB: Math.round(memUsage.heapUsed / 10485.76) / 100,
        heapTotalMB: Math.round(memUsage.heapTotal / 10485.76) / 100,
        rssMB: Math.round(memUsage.rss / 10485.76) / 100
      },
      totalRequests: getStats().totalRequests, errors: getStats().errors, mcpServers: ms, cache: cs
    });
  });

  // ---- Status ----
  app.get("/api/status", (_req, res) => {
    const active = getActiveProvider();
    res.json({
      status: "ok", version: "2.1.0", uptime: process.uptime(),
      activeProvider: { id: active.id, name: active.name, baseUrl: active.baseUrl },
      stats: getStats()
    });
  });

  // ---- Providers ----
  app.get("/api/providers", (_req, res) => {
    const cfg = loadConfig();
    const providers = getAllProviders().map((p) => {
      const dbKey = cfg.providerKeys[p.id] || "";
      const envKey = p.apiKeyEnv ? (process.env[p.apiKeyEnv] || "") : "";
      const configured = !!(dbKey || envKey);
      const fromEnv = !dbKey && !!envKey;
      return {
        ...p,
        apiKey: configured ? "***configured***" : "",
        configured,
        fromEnv
      };
    });
    res.json(providers);
  });

  // ---- Config ----
  app.get("/api/config", (_req, res) => {
    const c = loadConfig();
    res.json(maskConfigForClient(c));
  });

  app.post("/api/config", (req, res) => {
    try {
      const current = loadConfig();
      const updates = req.body;
      if (updates.activeProviderId) current.activeProviderId = updates.activeProviderId;
      if (updates.port) {
        const port = parseInt(updates.port);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return res.status(400).json({ error: "端口必须是 1024-65535 之间的数字" });
        }
        current.port = port;
      }
      if (updates.logLevel) current.logLevel = updates.logLevel;
      if (updates.modelOverrides) current.modelOverrides = { ...current.modelOverrides, ...updates.modelOverrides };
      if (updates.routingRules) current.routingRules = updates.routingRules;
      if (updates.discoveredModels) current.discoveredModels = updates.discoveredModels;
      if (updates.language) current.language = updates.language;
      if (updates.defaultTemperature !== undefined) current.defaultTemperature = Number(updates.defaultTemperature);
      if (updates.defaultMaxTokens !== undefined) current.defaultMaxTokens = Number(updates.defaultMaxTokens);
      if (updates.autoSyncInterval) current.autoSyncInterval = updates.autoSyncInterval;
      if (updates.cacheEnabled !== undefined) current.cacheEnabled = Boolean(updates.cacheEnabled);
      if (updates.fallbackProviderIds !== undefined) current.fallbackProviderIds = updates.fallbackProviderIds;
      if (updates.modelPricing !== undefined) current.modelPricing = updates.modelPricing;
      if (updates.mcpServers !== undefined) {
        current.mcpServers = updates.mcpServers;
        initMCPServers(updates.mcpServers).catch(e => log("error", "Failed to reload MCP servers on config change:", e));
      }
      
      if (updates.providerKeys) {
        for (const [k, v] of Object.entries(updates.providerKeys)) {
          if (typeof v === "string") {
            if (v === "" || v === "__clear__") {
              delete current.providerKeys[k];
            } else if (!v.includes("***") && !v.includes("...")) {
              current.providerKeys[k] = v;
            }
          }
        }
      }
      saveConfig(current);
      res.json({ ok: true, message: "Config saved" });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  });

  // ---- Theme ----
  app.post("/api/theme", (req, res) => {
    const { theme } = req.body;
    try {
      const current = loadConfig();
      current.theme = theme;
      saveConfig(current);
    } catch (e) {
      log("error", "Failed to save theme in config:", e);
    }
    if (process.send) {
      process.send({ type: "theme", theme });
    }
    res.json({ ok: true });
  });

  // ---- Billing ----
  app.get("/api/billing", (_req, res) => {
    try {
      const { accumulateCost } = require("../services/billing");
      const stats = getStats();
      res.json({
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost || 0,
        startTime: stats.startTime,
        requests: stats.totalRequests,
        errors: stats.errors,
      });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---- Stats (Dashboard) ----
  app.get("/api/stats", (_req, res) => {
    try {
      const stats = getStats();
      res.json({
        totalRequests: stats.totalRequests,
        interceptedRequests: stats.interceptedRequests || 0,
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost || 0,
        errors: stats.errors,
        startTime: stats.startTime,
      });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---- Billing History ----
  app.get("/api/billing-history", (_req, res) => {
    try {
      const { BILLING_FILE } = require("../services/billing");
      const fs = require("fs");
      if (fs.existsSync(BILLING_FILE)) {
        const data = JSON.parse(fs.readFileSync(BILLING_FILE, "utf-8"));
        res.json(data);
      } else {
        res.json({});
      }
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---- Logs ----
  app.get("/api/logs", (_req, res) => {
    const buffer = getLogBuffer();
    res.json({ logs: buffer, count: buffer.length });
  });

  app.delete("/api/logs", (_req, res) => {
    clearLogBuffer();
    res.json({ ok: true });
  });

  // ---- Token History ----
  app.get("/api/token-history", (_req, res) => {
    res.json(getTokenHistory());
  });

  // ---- Workspace Select ----
  app.post("/api/select-workspace-dir", async (req, res) => {
    if (IS_ELECTRON && process.send) {
      return new Promise<void>((resolve) => {
        const requestId = Math.random().toString(36).substring(2, 15);
        pendingChooseDirRequests.set(requestId, (result) => {
          if (result.cancelled) { res.json({ cancelled: true }); }
          else if (result.path) { res.json({ ok: true, path: result.path }); }
          else { res.status(500).json({ error: "No path selected" }); }
          resolve();
        });
        setTimeout(() => {
          if (pendingChooseDirRequests.has(requestId)) {
            const cb = pendingChooseDirRequests.get(requestId);
            if (cb) cb({ cancelled: true });
            pendingChooseDirRequests.delete(requestId);
          }
        }, 5 * 60 * 1000);
        process.send!({ type: "choose-directory", requestId });
      });
    } else {
      // Non-Electron fallback: try multiple methods
      const { exec } = require("child_process");
      // Try FolderBrowserDialog first
      exec(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select workspace folder'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }"`,
        (err: any, stdout: string) => {
          if (err || !stdout.trim()) {
            // Fallback: try simple input method via PowerShell
            exec(`powershell -NoProfile -Command "$f = (New-Object -ComObject Shell.Application).BrowseForFolder(0, 'Select workspace folder', 0); if ($f) { $f.Self.Path }"`,
              (err2: any, stdout2: string) => {
                const p = stdout2.trim();
                if (err2 || !p) return res.json({ cancelled: true });
                res.json({ ok: true, path: p });
              });
            return;
          }
          const p = stdout.trim();
          if (!p) return res.json({ cancelled: true });
          res.json({ ok: true, path: p });
        });
    }
  });

  // ---- Skill file chooser ----
  app.post("/api/select-skill-file", async (req, res) => {
    if (IS_ELECTRON && process.send) {
      return new Promise<void>((resolve) => {
        const requestId = Math.random().toString(36).substring(2, 15);
        pendingChooseSkillRequests.set(requestId, (result) => {
          if (result.cancelled) { res.json({ cancelled: true }); }
          else if (result.path) { res.json({ ok: true, path: result.path }); }
          else { res.status(500).json({ error: "No file selected" }); }
          resolve();
        });
        setTimeout(() => {
          if (pendingChooseSkillRequests.has(requestId)) {
            const cb = pendingChooseSkillRequests.get(requestId);
            if (cb) cb({ cancelled: true });
            pendingChooseSkillRequests.delete(requestId);
          }
        }, 5 * 60 * 1000);
        process.send!({ type: "choose-file", requestId, filters: [{ name: "Skill Markdown Files (*.md)", extensions: ["md"] }] });
      });
    } else {
      const { exec } = require("child_process");
      exec(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title = 'Select SKILL.md file'; $f.Filter = 'Skill Markdown Files (*.md)|*.md|All Files (*.*)|*.*'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }"`,
        (err: any, stdout: string) => {
          if (err) return res.status(500).json({ error: "Internal server error" });
          const p = stdout.trim();
          if (!p) return res.json({ cancelled: true });
          res.json({ ok: true, path: p });
        });
    }
  });

  // ---- Custom providers ----
  app.post("/api/custom-providers", (req, res) => {
    try {
      const { providers: newProviders } = req.body;
      if (!Array.isArray(newProviders) || newProviders.length === 0) {
        return res.status(400).json({ error: "providers array required" });
      }
      const current = loadConfig();
      if (!current.customProviders) current.customProviders = [];
      current.customProviders = newProviders;
      saveConfig(current);
      res.json({ ok: true, message: `${newProviders.length} custom provider(s) saved` });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  });

  app.get("/api/custom-providers", (_req, res) => {
    const c = loadConfig();
    res.json((c.customProviders || []).map((p: any) => ({ ...p, apiKey: p.apiKey ? "***configured***" : "" })));
  });

  // ---- MCP Permissions & Approvals ----
  app.get("/api/mcp/permissions", (_req, res) => {
    res.json({ permissions: getMcpPermissions(), pending: getPendingApprovals() });
  });

  app.put("/api/mcp/permissions", (req, res) => {
    try {
      setMcpPermissions(req.body);
      res.json({ ok: true, permissions: getMcpPermissions() });
    } catch (e) { res.status(400).json({ error: String(e) }); }
  });

  app.post("/api/mcp/approve", (req, res) => {
    const { taskId, toolCallId } = req.body || {};
    if (!taskId || !toolCallId) {
      return res.status(400).json({ error: "taskId and toolCallId are required" });
    }
    if (!approveMcpTool(taskId, toolCallId)) {
      return res.status(404).json({ error: "No pending approval found" });
    }
    resumeTaskInBackground(taskId).catch((e) => log("error", "[MCP] Resume after approval failed:", e));
    res.json({ ok: true, pending: getPendingApprovals() });
  });

  app.post("/api/mcp/reject", (req, res) => {
    const { taskId, toolCallId } = req.body || {};
    if (!taskId || !toolCallId) {
      return res.status(400).json({ error: "taskId and toolCallId are required" });
    }
    rejectMcpApproval(taskId, toolCallId);
    res.json({ ok: true, pending: getPendingApprovals() });
  });

  app.post("/api/mcp/clear-pending", (req, res) => {
    clearPendingApprovals(req.body?.taskId);
    res.json({ ok: true, pending: getPendingApprovals() });
  });

  // ---- Audit Log ----
  app.get("/api/audit", (req, res) => {
    const { action, taskId, limit } = req.query;
    const entries = queryAudit({
      action: action as any,
      taskId: taskId as string,
      limit: limit ? parseInt(limit as string) : 100,
    });
    res.json(entries);
  });

  app.get("/api/audit/stats", (_req, res) => {
    res.json(getAuditStats());
  });

  app.post("/api/audit/flush", (_req, res) => {
    flush();
    res.json({ ok: true });
  });

  // ---- Tool Cache Stats ----
  app.get("/api/tool-cache/stats", (_req, res) => {
    try {
      const { getCacheStats } = require("../services/tool-cache");
      res.json(getCacheStats());
    } catch { res.json({ entries: 0, hitRate: 0 }); }
  });

  app.post("/api/tool-cache/clear", (_req, res) => {
    try {
      const { invalidateCache } = require("../services/tool-cache");
      invalidateCache();
      res.json({ ok: true });
    } catch { res.json({ ok: false }); }
  });
}
