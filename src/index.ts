import express from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import os from "os";
import dns from "dns";

// EPIPE error resilience
function isBrokenPipeError(err: any): boolean { return err && err.code === 'EPIPE'; }
process.stdout.on('error', (err) => { if (!isBrokenPipeError(err)) throw err; });
process.stderr.on('error', (err) => { if (!isBrokenPipeError(err)) throw err; });
const _rawLog = console.log.bind(console);
const _rawErr = console.error.bind(console);
console.log = (...args: any[]) => { try { _rawLog(...args); } catch (err) { if (!isBrokenPipeError(err)) throw err; } };
console.error = (...args: any[]) => { try { _rawErr(...args); } catch (err) { if (!isBrokenPipeError(err)) throw err; } };
dns.setDefaultResultOrder("ipv4first");
import { execSync, spawn } from "child_process";
import {
  transformRequest,
  createStreamState,
  processChunk,
  generateEndEvents,
  formatError,
  type ResponsesRequest,
} from "./transform";
import {
  transformAnthropicRequest,
  createAnthropicStreamState,
  processAnthropicChunk,
  generateAnthropicEndEvents,
  formatAnthropicError,
  type AnthropicRequest,
  createAnthropicToOpenAIState,
  processAnthropicToOpenAIChunk,
  generateAnthropicToOpenAIEndEvents,
} from "./anthropic";
import {
  loadConfig,
  saveConfig,
  getAllProviders,
  getProvider,
  getActiveProvider,
  getApiKey,
  resolveModel,
  type RuntimeConfig,
} from "./providers";
import { initMCPServers, shutdownMCPServers, getAllMCPTools, executeMCPTool, getMCPServerStatuses } from "./mcp";
import { computeCacheKey, getCachedResponse, setCachedResponse, replayStreamResponse } from "./cache";
import { handleAgentToolCall } from "./services/tools";
import { runSkillScript, executeTerminalCommand, initSkillsDirectory, parseFrontmatter, getSkillsSystemPrompt, SKILLS_DIR } from "./services/skills";
import { accumulateCost, seedBillingFile } from "./services/billing";

dotenv.config({ path: process.env.ORCA_BASE_DIR ? path.join(process.env.ORCA_BASE_DIR, '.env') : undefined });

const _isPkg = !!(process as any).pkg;
const _isSEA = typeof (process as any).isSea !== "undefined" && (process as any).isSea;
const _isElectron = !!process.env.ORCA_BASE_DIR;
const _devDir = path.join(__dirname, "..");
const _portableDir = __dirname;
const _BASE_DIR = _isElectron ? process.env.ORCA_BASE_DIR! : ((_isPkg || _isSEA) ? path.dirname(process.execPath) : (fs.existsSync(path.join(_portableDir, "public")) ? _portableDir : _devDir));
const _STATIC_DIR = _isElectron ? path.join(_devDir, "public") : path.join(_BASE_DIR, "public");

const LOG_DIR = path.join(_BASE_DIR, "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "orca.log");
const MAX_LOG_SIZE = 10 * 1024 * 1024;
const MAX_LOG_BACKUPS = 5;
function rotateLogIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_LOG_SIZE) return;
    for (let i = MAX_LOG_BACKUPS - 1; i >= 1; i--) {
      const older = path.join(LOG_DIR, `orca.log.${i}`);
      const newer = path.join(LOG_DIR, `orca.log.${i + 1}`);
      if (fs.existsSync(older)) { if (fs.existsSync(newer)) fs.unlinkSync(newer); fs.renameSync(older, newer); }
    }
    const backup1 = path.join(LOG_DIR, "orca.log.1");
    if (fs.existsSync(backup1)) fs.unlinkSync(backup1);
    fs.renameSync(LOG_FILE, backup1);
  } catch (e) { console.error("Log rotation failed:", e); }
}
const BILLING_FILE = path.join(_BASE_DIR, "data", "billing.json");
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { console.error("Failed to create log directory:", e); }
rotateLogIfNeeded();

const cfg = loadConfig();
const PORT = cfg.port;
const HOST = "127.0.0.1";
const LOG_LEVEL = cfg.logLevel;

const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[LOG_LEVEL] ?? 1;

interface LogEntry { time: string; level: string; message: string; }
const logBuffer: LogEntry[] = [];
const MAX_LOGS = 500;

function log(level: string, ...args: unknown[]) {
  if ((LOG_LEVELS[level] ?? 1) < currentLevel) return;
  const ts = new Date().toISOString();
  const message = args.map((a) => {
    if (a instanceof Error) {
      return a.stack || String(a);
    }
    return typeof a === "string" ? a : JSON.stringify(a);
  }).join(" ");
  console.log(`[${ts}] [${level.toUpperCase()}]`, message);
  logBuffer.push({ time: ts, level, message });
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();

  try {
    fs.appendFileSync(LOG_FILE, `[${ts}] [${level.toUpperCase()}] ${message}\n`, "utf-8");
  } catch (e) { console.error("Failed to write to log file:", e); }
}

interface Stats {
  totalRequests: number;
  codexRequests: number;
  claudeRequests: number;
  chatRequests: number;
  errors: number;
  totalTokens: number;
  startTime: string;
  totalCost?: number;
}

const stats: Stats = {
  totalRequests: 0, codexRequests: 0, claudeRequests: 0,
  chatRequests: 0, errors: 0, totalTokens: 0,
  startTime: new Date().toISOString(),
  totalCost: 0,
};

interface TokenSnapshot { time: string; tokens: number; requests: number; }
const tokenHistory: TokenSnapshot[] = [];
const MAX_HISTORY = 60;
setInterval(() => {
  const now = new Date().toISOString();
  tokenHistory.push({ time: now, tokens: stats.totalTokens, requests: stats.totalRequests });
  if (tokenHistory.length > MAX_HISTORY) tokenHistory.shift();
}, 10000);

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(_STATIC_DIR));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || req.socket.remoteAddress || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
  message: { error: { message: "Too many requests, please try again later", type: "rate_limit_error" } },
});
app.use("/v1/", apiLimiter);

app.use((req, _res, next) => {
  if (req.url.startsWith("/v1/") || req.url.startsWith("/api/")) {
    stats.totalRequests++;
    log("info", `${req.method} ${req.url} from ${req.ip}`);
  }
  next();
});

// ---- Local Token Authentication ----
app.use((req, res, next) => {
  if (!process.env.LOCAL_AUTH_TOKEN) return next();
  if (req.url.startsWith("/api/")) {
    if (req.method === "OPTIONS") return next();
    if (req.url === "/health") return next();
    const token = req.headers["x-local-token"] || req.query.token;
    if (token !== process.env.LOCAL_AUTH_TOKEN) {
      log("warn", `Unauthorized access attempt to ${req.url}`);
      return res.status(401).json({ error: "Unauthorized: Invalid or missing local token" });
    }
  }
  next();
});
// ---- Management API ----

app.get("/health", (_req, res) => {
  const memUsage = process.memoryUsage();
  const ms = getMCPServerStatuses();
  const cs = (() => { try { return require("./cache").getCacheStats(); } catch { return { entries: 0, sizeBytes: 0 }; } })();
  res.json({ status: "ok", uptime: process.uptime(), pid: process.pid, platform: process.platform, nodeVersion: process.version,
    memory: { heapUsedMB: Math.round(memUsage.heapUsed / 10485.76) / 100, heapTotalMB: Math.round(memUsage.heapTotal / 10485.76) / 100, rssMB: Math.round(memUsage.rss / 10485.76) / 100 },
    totalRequests: stats.totalRequests, errors: stats.errors, mcpServers: ms, cache: cs });
});
app.get("/api/status", (_req, res) => {
  const active = getActiveProvider();
  res.json({ status: "ok", version: "2.1.0", uptime: process.uptime(),
    activeProvider: { id: active.id, name: active.name, baseUrl: active.baseUrl }, stats });
});

app.get("/api/providers", (_req, res) => {
  const providers = getAllProviders().map((p) => ({
    ...p, apiKey: getApiKey(p.id) ? "***configured***" : "", configured: !!getApiKey(p.id),
  }));
  res.json(providers);
});

app.get("/api/config", (_req, res) => {
  const c = loadConfig();
  const safeKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.providerKeys)) {
    safeKeys[k] = v ? `${v.slice(0, 8)}...` : "";
  }
  res.json({ ...c, providerKeys: safeKeys });
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

const pendingChooseDirRequests = new Map<string, (result: { path?: string; cancelled?: boolean }) => void>();
const pendingChooseSkillRequests = new Map<string, (result: { path?: string; cancelled?: boolean }) => void>();
const pendingChooseCustomFileRequests = new Map<string, (result: { path?: string; cancelled?: boolean }) => void>();

if (process.send) {
  process.on("message", (msg: any) => {
    if (msg && msg.type === "choose-directory-response") {
      const cb = pendingChooseDirRequests.get(msg.requestId);
      if (cb) {
        cb({ path: msg.path, cancelled: msg.cancelled });
        pendingChooseDirRequests.delete(msg.requestId);
      }
    } else if (msg && msg.type === "choose-file-response") {
      const cb = pendingChooseSkillRequests.get(msg.requestId);
      if (cb) {
        cb({ path: msg.path, cancelled: msg.cancelled });
        pendingChooseSkillRequests.delete(msg.requestId);
      }
    } else if (msg && msg.type === "choose-custom-file-response") {
      const cb = pendingChooseCustomFileRequests.get(msg.requestId);
      if (cb) {
        cb({ path: msg.path, cancelled: msg.cancelled });
        pendingChooseCustomFileRequests.delete(msg.requestId);
      }
    }
  });
}

app.post("/api/choose-directory", (req, res) => {
  if (_isElectron && process.send) {
    const requestId = Math.random().toString(36).substring(2, 15);
    pendingChooseDirRequests.set(requestId, (result) => {
      if (result.cancelled) {
        return res.json({ cancelled: true });
      }
      res.json({ path: result.path });
    });
    
    // Auto-timeout after 5 minutes
    setTimeout(() => {
      if (pendingChooseDirRequests.has(requestId)) {
        const cb = pendingChooseDirRequests.get(requestId);
        if (cb) cb({ cancelled: true });
        pendingChooseDirRequests.delete(requestId);
      }
    }, 5 * 60 * 1000);
    
    process.send({ type: "choose-directory", requestId });
  } else {
    const { exec } = require("child_process");
    const isWindows = process.platform === "win32";
    if (!isWindows) {
      return res.status(400).json({ error: "Unsupported platform. Only Windows is supported." });
    }

    const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '选择项目文件夹 / Select Project Folder'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }`;

    exec(`powershell -NoProfile -Command "${psCommand}"`, (err: any, stdout: string, stderr: string) => {
      if (err) {
        log("error", "PowerShell choose-directory failed: " + err.message);
        return res.status(500).json({ error: err.message });
      }
      const dirPath = stdout.trim();
      if (!dirPath) {
        return res.json({ cancelled: true });
      }
      res.json({ path: dirPath });
    });
  }
});

app.post("/api/test-provider", async (req, res) => {
  const { providerId } = req.body;
  const provider = getProvider(providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  const apiKey = getApiKey(providerId);
  if (!apiKey) return res.status(400).json({ error: "API Key not configured" });
  try {
    const targetUrl = provider.id === "anthropic"
      ? `${provider.baseUrl}/v1/messages`
      : `${provider.baseUrl}/v1/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.id === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const body = provider.id === "anthropic"
      ? JSON.stringify({ model: provider.models[0].id, max_tokens: 5, messages: [{ role: "user", content: "Hi" }] })
      : JSON.stringify({ model: provider.models[0].id, messages: [{ role: "user", content: "Hi" }], max_tokens: 5, stream: false });
    const resp = await fetch(targetUrl, { method: "POST", headers, body });
    if (resp.ok) {
      const data = await resp.json() as any;
      res.json({ ok: true, message: "Connection success", model: provider.models[0].id, data });
    } else {
      const err = await resp.text();
      res.json({ ok: false, message: `API returned ${resp.status}`, error: err });
    }
  } catch (e) { res.json({ ok: false, message: "Connection failed", error: String(e) }); }
});

// ---- 自定义供应商 CRUD ----
app.get("/api/custom-providers", (_req, res) => {
  const cfg = loadConfig();
  res.json(cfg.customProviders || []);
});

app.post("/api/custom-providers", (req, res) => {
  try {
    const cfg = loadConfig();
    const p = req.body;
    if (!p.id || !p.name || !p.baseUrl) return res.status(400).json({ error: "id, name, baseUrl required" });
    const exists = cfg.customProviders.findIndex((cp: any) => cp.id === p.id);
    const provider = {
      id: p.id, name: p.name, baseUrl: p.baseUrl, apiKeyEnv: p.apiKeyEnv || "",
      models: p.models || [], openaiCompatible: p.openaiCompatible !== false,
      description: p.description || "",
    };
    if (exists >= 0) cfg.customProviders[exists] = provider;
    else cfg.customProviders.push(provider);
    if (p.apiKey) cfg.providerKeys[p.id] = p.apiKey;
    saveConfig(cfg);
    res.json({ ok: true, message: "Provider saved" });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

app.delete("/api/custom-providers/:id", (req, res) => {
  try {
    const cfg = loadConfig();
    cfg.customProviders = cfg.customProviders.filter((p: any) => p.id !== req.params.id);
    delete cfg.providerKeys[req.params.id];
    saveConfig(cfg);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

app.get("/api/logs", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const level = req.query.level as string;
  const query = req.query.query as string;
  
  let filtered = [...logBuffer];
  if (level && level !== "all") {
    filtered = filtered.filter(l => l.level === level);
  }
  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter(l => l.message.toLowerCase().includes(q));
  }
  res.json(filtered.slice(-limit));
});

app.delete("/api/logs", (_req, res) => { logBuffer.length = 0; res.json({ ok: true }); });
app.get("/api/stats", (_req, res) => { res.json(stats); });
app.get("/api/token-history", (_req, res) => { res.json(tokenHistory); });
app.get("/api/billing-history", (_req, res) => {
  try {
    if (fs.existsSync(BILLING_FILE)) {
      const data = JSON.parse(fs.readFileSync(BILLING_FILE, "utf-8"));
      res.json(data);
    } else {
      res.json({});
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/reset-billing", (_req, res) => {
  try {
    if (fs.existsSync(BILLING_FILE)) {
      fs.writeFileSync(BILLING_FILE, JSON.stringify({}, null, 2));
    }
    stats.totalRequests = 0;
    stats.codexRequests = 0;
    stats.claudeRequests = 0;
    stats.chatRequests = 0;
    stats.errors = 0;
    stats.totalTokens = 0;
    stats.totalCost = 0;
    tokenHistory.length = 0;
    log("info", "[Stats] Billing data and stats reset successfully");
    res.json({ ok: true });
  } catch (e) {
    log("error", "Failed to reset billing stats:", e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/mcp/tools", (_req, res) => {
  try {
    res.json(getAllMCPTools());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Skills & Agents Management ----
app.get("/api/skills", (_req, res) => {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      return res.json([]);
    }
    const dirs = fs.readdirSync(SKILLS_DIR);
    const skillsList = [];
    for (const d of dirs) {
      const skillPath = path.join(SKILLS_DIR, d);
      const skillFile = path.join(skillPath, "SKILL.md");
      if (fs.existsSync(skillFile)) {
        const text = fs.readFileSync(skillFile, "utf-8");
        const parsed = parseFrontmatter(text);
        skillsList.push({
          id: d,
          name: parsed.name || d,
          description: parsed.description || "",
          path: skillPath,
        });
      }
    }
    res.json(skillsList);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/skills/:id", (req, res) => {
  const { id } = req.params;
  const skillPath = path.join(SKILLS_DIR, id);
  const skillFile = path.join(skillPath, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    return res.status(404).json({ error: "Skill not found" });
  }
  try {
    const text = fs.readFileSync(skillFile, "utf-8");
    const parsed = parseFrontmatter(text);
    
    // Scan scripts directory
    let scripts: string[] = [];
    const scriptsDir = path.join(skillPath, "scripts");
    if (fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory()) {
      scripts = fs.readdirSync(scriptsDir).filter(f => f.endsWith(".py") || f.endsWith(".js"));
    }

    // Scan references directory
    let references: string[] = [];
    const referencesDir = path.join(skillPath, "references");
    if (fs.existsSync(referencesDir) && fs.statSync(referencesDir).isDirectory()) {
      references = fs.readdirSync(referencesDir).filter(f => f.endsWith(".md"));
    }

    res.json({
      id,
      name: parsed.name || id,
      description: parsed.description || "",
      instructions: parsed.body,
      scripts,
      references,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/skills/:id/run-script", async (req, res) => {
  const { id } = req.params;
  const { scriptName, args } = req.body;
  try {
    const output = await runSkillScript(id, scriptName, args);
    res.json({ ok: true, output });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/skills/import", (req, res) => {
  const getSelectedFilePath = (): Promise<{ path?: string; cancelled?: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (_isElectron && process.send) {
        const requestId = Math.random().toString(36).substring(2, 15);
        pendingChooseSkillRequests.set(requestId, (result) => {
          resolve({ path: result.path, cancelled: result.cancelled });
        });
        
        // Auto-timeout after 5 minutes
        setTimeout(() => {
          if (pendingChooseSkillRequests.has(requestId)) {
            const cb = pendingChooseSkillRequests.get(requestId);
            if (cb) cb({ cancelled: true });
            pendingChooseSkillRequests.delete(requestId);
          }
        }, 5 * 60 * 1000);
        
        process.send({ type: "choose-file", requestId });
      } else {
        const { exec } = require("child_process");
        const isWindows = process.platform === "win32";
        if (!isWindows) {
          return resolve({ error: "Unsupported platform. Only Windows is supported." });
        }

        const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title = '选择技能的 README.md 或 SKILL.md 文件 / Select Skill README File'; $f.Filter = 'Markdown files (*.md)|*.md'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }`;

        exec(`powershell -NoProfile -Command "${psCommand}"`, (err: any, stdout: string, stderr: string) => {
          if (err) {
            log("error", "PowerShell choose-file failed: " + err.message);
            return resolve({ error: err.message });
          }
          const filePath = stdout.trim();
          if (!filePath) {
            return resolve({ cancelled: true });
          }
          resolve({ path: filePath });
        });
      }
    });
  };

  getSelectedFilePath().then(async (result) => {
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    if (result.cancelled || !result.path) {
      return res.json({ cancelled: true });
    }

    const selectedFile = result.path;
    try {
      if (!fs.existsSync(selectedFile)) {
        return res.status(400).json({ error: "所选文件不存在" });
      }

      const sourceDir = path.dirname(selectedFile);
      const folderName = path.basename(sourceDir);
      
      // Slugify directory name to create a valid skill ID (letters, numbers, hyphens, underscores)
      let skillId = folderName
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .toLowerCase();
      if (!skillId) {
        skillId = "imported_skill_" + Math.random().toString(36).substring(2, 7);
      }

      // Check if target directory already exists, if so, append suffix to avoid conflict
      let targetDir = path.join(SKILLS_DIR, skillId);
      let suffix = 1;
      let finalSkillId = skillId;
      while (fs.existsSync(targetDir)) {
        finalSkillId = `${skillId}_${suffix}`;
        targetDir = path.join(SKILLS_DIR, finalSkillId);
        suffix++;
      }

      fs.mkdirSync(targetDir, { recursive: true });

      // Recursively copy sourceDir to targetDir
      const copyFolderRecursiveSync = (from: string, to: string) => {
        if (!fs.existsSync(to)) {
          fs.mkdirSync(to, { recursive: true });
        }
        const items = fs.readdirSync(from);
        for (const item of items) {
          // Skip .git, node_modules, and other common build/system files
          if (item === ".git" || item === "node_modules" || item === ".DS_Store") {
            continue;
          }
          const srcPath = path.join(from, item);
          const dstPath = path.join(to, item);
          const stat = fs.statSync(srcPath);
          if (stat.isFile()) {
            fs.copyFileSync(srcPath, dstPath);
          } else if (stat.isDirectory()) {
            copyFolderRecursiveSync(srcPath, dstPath);
          }
        }
      };

      copyFolderRecursiveSync(sourceDir, targetDir);

      // Check for SKILL.md in the imported folder
      const targetSkillFile = path.join(targetDir, "SKILL.md");
      if (!fs.existsSync(targetSkillFile)) {
        // If SKILL.md doesn't exist, read the selected markdown file (e.g. README.md)
        // and wrap it as SKILL.md
        const selectedFileBase = path.basename(selectedFile);
        const targetSelectedFile = path.join(targetDir, selectedFileBase);
        
        let mdContent = "";
        if (fs.existsSync(targetSelectedFile)) {
          mdContent = fs.readFileSync(targetSelectedFile, "utf-8");
        } else if (fs.existsSync(selectedFile)) {
          mdContent = fs.readFileSync(selectedFile, "utf-8");
        }

        // Generate SKILL.md
        // Attempt to parse existing name/description if there is frontmatter
        let parsed = { name: "", description: "", body: mdContent };
        if (mdContent.startsWith("---")) {
          parsed = parseFrontmatter(mdContent);
        }

        const skillName = parsed.name || folderName;
        const skillDesc = parsed.description || `Imported from ${selectedFileBase}`;
        const skillBody = parsed.body || mdContent;

        const newSkillContent = `---
name: "${skillName}"
description: "${skillDesc}"
---
${skillBody}`;

        fs.writeFileSync(targetSkillFile, newSkillContent, "utf-8");
      }

      log("info", `[Skills] Successfully imported skill: ${finalSkillId}`);
      res.json({ ok: true, id: finalSkillId });
    } catch (e: any) {
      log("error", "Failed to import skill: " + e.message);
      res.status(500).json({ error: e.message });
    }
  }).catch((e) => {
    res.status(500).json({ error: String(e) });
  });
});

app.post("/api/skills/github-import", async (req, res) => {
  const { repoUrl } = req.body || {};
  if (!repoUrl || typeof repoUrl !== "string") return res.status(400).json({ error: "repoUrl is required" });
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\/tree\/([^\/]+)(?:\/(.+))?)?(?:\/)?$/);
  if (!match) return res.status(400).json({ error: "Invalid GitHub URL. Expected: https://github.com/owner/repo" });
  const [, owner, repoName, branch, subPath] = match;
  const ref = branch || "main";
  try {
    const apiUrl = subPath ? `https://api.github.com/repos/${owner}/${repoName}/contents/${subPath}?ref=${ref}` : `https://api.github.com/repos/${owner}/${repoName}/contents?ref=${ref}`;
    log("info", `[Skills] GitHub import: ${owner}/${repoName}${subPath ? "/" + subPath : ""}@${ref}`);
    const resp = await fetch(apiUrl, { headers: { "User-Agent": "Orca-Proxy/2.1.0", "Accept": "application/vnd.github+json" } });
    if (!resp.ok) { if (resp.status === 404) return res.status(404).json({ error: "Repo not found or is private." }); if (resp.status === 403) return res.status(403).json({ error: "GitHub rate limit exceeded." }); return res.status(resp.status).json({ error: `GitHub ${resp.status}` }); }
    const items = await resp.json() as any[];
    if (!Array.isArray(items)) return res.status(400).json({ error: "Unexpected GitHub API response." });
    let skillId = repoName.toLowerCase().replace(/[^a-z0-9_-]/g, "_"); if (!skillId) skillId = "github_skill_" + Date.now().toString(36);
    let targetDir = path.join(SKILLS_DIR, skillId), suffix = 1, finalSkillId = skillId;
    while (fs.existsSync(targetDir)) { finalSkillId = `${skillId}_${suffix}`; targetDir = path.join(SKILLS_DIR, finalSkillId); suffix++; }
    fs.mkdirSync(targetDir, { recursive: true });
    let downloaded = 0; const MAX_FILES = 100;
    const BIN_EXT = [".exe",".dll",".so",".dylib",".png",".jpg",".jpeg",".gif",".bmp",".ico",".zip",".gz",".tar",".7z",".mp3",".mp4",".avi",".mov",".class",".pyc",".db",".sqlite"];
    const downloadDir = async (dirItems: any[], _base: string) => {
      for (const item of dirItems) {
        if (downloaded >= MAX_FILES) break; if (!item || typeof item !== "object") continue;
        if (item.type === "file") {
          const parts = (item.name || "").split("."); const ext = "." + parts[parts.length - 1];
          if (BIN_EXT.includes(ext.toLowerCase())) continue;
          try { const fr = await fetch(item.download_url, { headers: { "User-Agent": "Orca-Proxy/2.1.0" } }); if (!fr.ok) continue; const content = await fr.text(); const tp = path.join(targetDir, item.path); const pd = path.dirname(tp); if (!fs.existsSync(pd)) fs.mkdirSync(pd, { recursive: true }); fs.writeFileSync(tp, content, "utf-8"); downloaded++; } catch {}
        } else if (item.type === "dir" && item.name !== ".git" && item.name !== "node_modules") {
          try { const sr = await fetch(item.url, { headers: { "User-Agent": "Orca-Proxy/2.1.0", "Accept": "application/vnd.github+json" } }); if (sr.ok) { const si = await sr.json() as any[]; if (Array.isArray(si)) await downloadDir(si, _base); } } catch {}
        }
      }
    };
    await downloadDir(items, "");
    log("info", `[Skills] GitHub import: ${downloaded} files from ${owner}/${repoName} => ${finalSkillId}`);
    res.json({ ok: true, id: finalSkillId, repo: `${owner}/${repoName}`, files: downloaded });
  } catch (e: any) { log("error", "GitHub import failed:", e); res.status(500).json({ error: e.message || "Unknown error" }); }
});

app.post("/api/skills", (req, res) => {
  const { id, name, description, instructions } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: "技能 ID 和名称为必填项" });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: "技能 ID 只能包含英文字符、数字和中划线" });
  }

  const skillPath = path.join(SKILLS_DIR, id);
  const skillFile = path.join(skillPath, "SKILL.md");
  if (fs.existsSync(skillFile)) {
    return res.status(400).json({ error: `技能 ID 为 ${id} 的技能已经存在` });
  }

  try {
    if (!fs.existsSync(skillPath)) {
      fs.mkdirSync(skillPath, { recursive: true });
    }
    const mdContent = `---
name: "${name}"
description: "${description || ""}"
---
${instructions || ""}`;

    fs.writeFileSync(skillFile, mdContent, "utf-8");
    log("info", `[Skills] Created new skill: ${id} (${name})`);
    res.json({ ok: true });
  } catch (e: any) {
    log("error", `Failed to create skill ${id}:`, e);
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/skills/:id", (req, res) => {
  const { id } = req.params;
  const { name, description, instructions } = req.body;
  if (!name) {
    return res.status(400).json({ error: "技能名称为必填项" });
  }

  const skillPath = path.join(SKILLS_DIR, id);
  const skillFile = path.join(skillPath, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    return res.status(404).json({ error: "未找到待编辑的技能" });
  }

  try {
    if (!fs.existsSync(skillPath)) {
      fs.mkdirSync(skillPath, { recursive: true });
    }
    const mdContent = `---
name: "${name}"
description: "${description || ""}"
---
${instructions || ""}`;

    fs.writeFileSync(skillFile, mdContent, "utf-8");
    log("info", `[Skills] Updated skill: ${id} (${name})`);
    res.json({ ok: true });
  } catch (e: any) {
    log("error", `Failed to update skill ${id}:`, e);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/skills/:id", (req, res) => {
  const { id } = req.params;
  const skillPath = path.join(SKILLS_DIR, id);
  if (!fs.existsSync(skillPath)) {
    return res.status(404).json({ error: "技能不存在，删除失败" });
  }

  try {
    fs.rmSync(skillPath, { recursive: true, force: true });
    log("info", `[Skills] Deleted skill: ${id}`);
    res.json({ ok: true });
  } catch (e: any) {
    log("error", `Failed to delete skill ${id}:`, e);
    res.status(500).json({ error: e.message });
  }
});
// ---- Codex CLI: POST /v1/responses ----

app.post("/v1/responses", async (req, res) => {
  const startTime = Date.now();
  stats.codexRequests++;
  try {
    const body = req.body as ResponsesRequest;
    const resolved = resolveModel(body.model);
    if (!resolved.apiKey) {
      res.write(formatError(401, `API Key not configured for ${resolved.provider.name}`));
      res.end(); stats.errors++; return;
    }
    log("info", `[Codex] ${body.model} -> ${resolved.provider.id}/${resolved.model}`);
    if (body.previous_response_id) log("warn", "previous_response_id not supported, ignoring");
    const chatReq = transformRequest(body, resolved.model);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    const targetUrl = resolved.provider.baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";
    const upstreamResp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` },
      body: JSON.stringify(chatReq),
    });
    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      log("error", `[Codex] ${resolved.provider.name} returned ${upstreamResp.status}: ${errText}`);
      res.write(formatError(upstreamResp.status, `${resolved.provider.name} error: ${errText}`));
      res.end(); stats.errors++; return;
    }
    if (!upstreamResp.body) { res.write(formatError(502, "Empty response")); res.end(); stats.errors++; return; }
    await streamSSE(upstreamResp, req, res, (state, chunk) => processChunk(state, chunk),
      (state) => generateEndEvents(state), () => createStreamState(resolved.model));
    log("info", `[Codex] Done ${Date.now() - startTime}ms`);
  } catch (err) {
    log("error", `[Codex] Failed:`, err); stats.errors++;
    if (!res.headersSent) res.status(500).json({ error: { message: String(err), type: "proxy_error" } });
    else if (!res.writableEnded) { res.write(formatError(500, String(err))); res.end(); }
  }
});

// ---- Claude Desktop: POST /v1/messages ----

app.post("/v1/messages", async (req, res) => {
  req.socket.setTimeout(0); // Disable socket timeout for streaming agent loop
  const startTime = Date.now();
  stats.claudeRequests++;
  try {
    const body = req.body as AnthropicRequest;
    const resolved = resolveModel(body.model);
    if (!resolved.apiKey) {
      res.write(formatAnthropicError(401, `API Key not configured for ${resolved.provider.name}`));
      res.end(); stats.errors++; return;
    }
    log("info", `[Claude] ${body.model} -> ${resolved.provider.id}/${resolved.model}`);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let upstreamResp: Response;
    if (resolved.provider.id === "anthropic") {
      // Forward directly to Anthropic's Messages API
      const targetUrl = resolved.provider.baseUrl + "/v1/messages";
      upstreamResp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ ...body, model: resolved.model }),
      });
      if (!upstreamResp.ok) {
        const errText = await upstreamResp.text();
        log("error", `[Claude] Anthropic returned ${upstreamResp.status}: ${errText}`);
        res.write(formatAnthropicError(upstreamResp.status, `Anthropic error: ${errText}`));
        res.end(); stats.errors++; return;
      }
      if (!upstreamResp.body) { res.write(formatAnthropicError(502, "Empty response")); res.end(); stats.errors++; return; }
      // Pass through Anthropic SSE directly (it's already in Anthropic format)
      const reader = (upstreamResp.body as any).getReader();
      const decoder = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break; res.write(decoder.decode(value, { stream: true })); }
      res.end();
    } else {
      // Convert Anthropic format → OpenAI format, forward to OpenAI-compatible provider
      const chatReq = transformAnthropicRequest({ ...body, model: resolved.model });
      const targetUrl = resolved.provider.baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";
      upstreamResp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` },
        body: JSON.stringify(chatReq),
      });
      if (!upstreamResp.ok) {
        const errText = await upstreamResp.text();
        log("error", `[Claude] ${resolved.provider.name} returned ${upstreamResp.status}: ${errText}`);
        res.write(formatAnthropicError(upstreamResp.status, `${resolved.provider.name} error: ${errText}`));
        res.end(); stats.errors++; return;
      }
      if (!upstreamResp.body) { res.write(formatAnthropicError(502, "Empty response")); res.end(); stats.errors++; return; }
      const anthropicState = createAnthropicStreamState(resolved.model);
      await streamSSE(upstreamResp, req, res,
        (_state, chunk) => processAnthropicChunk(anthropicState, chunk),
        (_state) => generateAnthropicEndEvents(anthropicState),
        () => null as any, anthropicState, formatAnthropicError);
    }
    log("info", `[Claude] Done ${Date.now() - startTime}ms`);
  } catch (err) {
    log("error", `[Claude] Failed:`, err); stats.errors++;
    if (!res.headersSent) res.status(500).json({ type: "error", error: { type: "api_error", message: String(err) } });
    else if (!res.writableEnded) { res.write(formatAnthropicError(500, String(err))); res.end(); }
  }
});


async function executeAgentCompletions(
  req: any,
  res: any,
  body: any,
  resolved: any,
  messages: any[],
  tools: any[],
  useAgent: boolean,
  activeSkillId: string,
  startTime: number,
  cacheKey: string | null,
  depth = 0
): Promise<any> {
  const maxDepth = 40;
  if (depth > maxDepth) {
    const errMsg = `Agent execution exceeded maximum recursion depth (${maxDepth})`;
    log("error", `[Chat] ${errMsg}`);
    if (res.headersSent) {
      if (!res.writableEnded) {
        const errorChunk = {
          id: "chatcmpl-" + Date.now(),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: resolved.model,
          choices: [{ index: 0, delta: { content: `\n\n[Agent Execution Error: ${errMsg}]\n` }, finish_reason: "error" }]
        };
        res.write("data: " + JSON.stringify(errorChunk) + "\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
      }
      return;
    } else {
      return res.status(500).json({ error: { message: errMsg } });
    }
  }

  if (!(res as any).__orca_closeListenersAdded) {
    (res as any).__orca_closeListenersAdded = true;
    res.on("close", () => { (res as any).__orca_clientDisconnected = true; });
  }
  function isClientGone(): boolean { return !!(res as any).__orca_clientDisconnected || res.destroyed; }

  // Build the request parameters. If defaultMaxTokens is 0, omit it.
  let tempMaxTokens = body.max_tokens ?? loadConfig().defaultMaxTokens;
  if (tempMaxTokens > 0) {
    const isDeepSeekOrAnthropic =
      resolved.provider?.id === "anthropic" ||
      resolved.provider?.id === "deepseek" ||
      String(resolved.model || "").toLowerCase().includes("deepseek") ||
      String(resolved.model || "").toLowerCase().includes("claude");

    if (isDeepSeekOrAnthropic) {
      if (tempMaxTokens > 8192) {
        tempMaxTokens = 8192;
      }
    } else {
      if (tempMaxTokens > 16384) {
        tempMaxTokens = 16384;
      }
    }
  }
  const maxTokensParam = tempMaxTokens > 0 ? { max_tokens: tempMaxTokens } : {};

  const requestBody = {
    ...body,
    messages,
    ...maxTokensParam,
    ...(tools.length > 0 ? { tools } : {}),
  };
  
  // Clean custom attributes before sending upstream
  delete requestBody.activeSkillId;
  delete requestBody.useAgent;
  delete requestBody.workspacePath;

  let targetUrl: string;
  let headers: Record<string, string>;
  let reqBodyText: string;

  if (resolved.provider.id === "anthropic") {
    targetUrl = resolved.provider.baseUrl + "/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" };
    // Simple OpenAI messages format to Anthropic converter
    const systemMsgs = messages.filter((m: any) => m.role === "system");
    const normalMsgs = messages.filter((m: any) => m.role !== "system");
    const systemText = systemMsgs.map((m: any) => m.content).join("\n");
    
    const anthropicBody: any = {
      model: resolved.model,
      max_tokens: tempMaxTokens || 4096,
      messages: normalMsgs,
    };
    if (systemText) anthropicBody.system = systemText;
    if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;
    if (body.stream) anthropicBody.stream = true;
    if (tools.length > 0) {
      anthropicBody.tools = tools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }));
    }
    reqBodyText = JSON.stringify(anthropicBody);
  } else {
    targetUrl = resolved.provider.baseUrl + "/v1/chat/completions";
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` };
    reqBodyText = JSON.stringify({ ...requestBody, model: resolved.model });
  }

  if (body.stream) {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }
    }

    // Keep connection alive with periodic pings while fetching upstream
    const fetchKeepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": keep-alive\n\n");
      }
    }, 15000);

    let upstreamResp;
    try {
      upstreamResp = await fetch(targetUrl, { method: "POST", headers, body: reqBodyText });
    } finally {
      clearInterval(fetchKeepAlive);
    }
    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      throw new Error(`Upstream returned ${upstreamResp.status}: ${errText}`);
    }

    let accumulatedToolCalls: any[] = [];
    let accumulatedText = "";
    let hasOpenedThinkBlock = false;
    let hasClosedThinkBlock = false;
    let finalUsage: any = null;
    const reader = (upstreamResp.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let retryCount = 0;
    const MAX_STREAM_RETRIES = 3;

    while (true) {
      if (isClientGone()) {
        log("info", "[Chat] Response connection closed by client. Aborting stream reader loop.");
        break;
      }
      
      let done = false;
      let value: any = null;
      
      try {
        const result = await reader.read();
        done = result.done;
        value = result.value;
        retryCount = 0; // Reset retry count on successful read
      } catch (readError) {
        log("warn", "[Chat] Stream read error:", readError);
        retryCount++;
        if (retryCount >= MAX_STREAM_RETRIES) {
          log("error", "[Chat] Max stream retries reached, aborting");
          break;
        }
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("data: ")) {
          const dataStr = line.substring(6).trim();
          if (dataStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.usage) {
              finalUsage = parsed.usage;
            }
            const choice = parsed.choices?.[0];
            if (choice) {
              if (choice.delta?.tool_calls) {
                // Close think block if it was opened
                if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
                  hasClosedThinkBlock = true;
                  const closeChunk = {
                    id: parsed.id || ("chatcmpl-" + Date.now()),
                    object: "chat.completion.chunk",
                    created: parsed.created || Math.floor(Date.now() / 1000),
                    model: parsed.model || resolved.model,
                    choices: [{ index: 0, delta: { content: "\n</think>\n" }, finish_reason: null }]
                  };
                  res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
                  accumulatedText += "\n</think>\n";
                }
                for (const tc of choice.delta.tool_calls) {
                  const idx = tc.index;
                  if (!accumulatedToolCalls[idx]) {
                    accumulatedToolCalls[idx] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
                  }
                  if (tc.id) accumulatedToolCalls[idx].id = tc.id;
                  if (tc.function?.name) accumulatedToolCalls[idx].function.name += tc.function.name;
                  if (tc.function?.arguments) accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
                }
              } else if (choice.delta?.reasoning_content) {
                // If we have reasoning tokens, stream them wrapped in <think> tags
                if (!hasOpenedThinkBlock) {
                  hasOpenedThinkBlock = true;
                  const openChunk = {
                    id: parsed.id || ("chatcmpl-" + Date.now()),
                    object: "chat.completion.chunk",
                    created: parsed.created || Math.floor(Date.now() / 1000),
                    model: parsed.model || resolved.model,
                    choices: [{ index: 0, delta: { content: "<think>\n" }, finish_reason: null }]
                  };
                  res.write("data: " + JSON.stringify(openChunk) + "\n\n");
                  accumulatedText += "<think>\n";
                }
                const contentChunk = {
                  id: parsed.id || ("chatcmpl-" + Date.now()),
                  object: "chat.completion.chunk",
                  created: parsed.created || Math.floor(Date.now() / 1000),
                  model: parsed.model || resolved.model,
                  choices: [{ index: 0, delta: { content: choice.delta.reasoning_content }, finish_reason: null }]
                };
                res.write("data: " + JSON.stringify(contentChunk) + "\n\n");
                accumulatedText += choice.delta.reasoning_content;
              } else if (choice.delta?.content) {
                // Close think block if it was opened
                if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
                  hasClosedThinkBlock = true;
                  const closeChunk = {
                    id: parsed.id || ("chatcmpl-" + Date.now()),
                    object: "chat.completion.chunk",
                    created: parsed.created || Math.floor(Date.now() / 1000),
                    model: parsed.model || resolved.model,
                    choices: [{ index: 0, delta: { content: "\n</think>\n" }, finish_reason: null }]
                  };
                  res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
                  accumulatedText += "\n</think>\n";
                }
                accumulatedText += choice.delta.content;
                res.write(line + "\n\n");
              }
            }
          } catch (e) { log("warn", "Failed to parse SSE chunk:", e); }
        }
      }
    }

    if (isClientGone()) {
      try {
        await reader.cancel();
      } catch (e) { log("warn", "Failed to cancel stream reader:", e); }
      return;
    }

    // Ensure think block is closed if it was opened
    if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
      hasClosedThinkBlock = true;
      const closeChunk = {
        id: "chatcmpl-" + Date.now(),
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: resolved.model,
        choices: [{ index: 0, delta: { content: "\n</think>\n" }, finish_reason: null }]
      };
      res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
      accumulatedText += "\n</think>\n";
    }

    const toolCalls = accumulatedToolCalls.filter(Boolean);
    if (toolCalls.length > 0) {
      const id = "chatcmpl-" + Date.now();
      const created = Math.floor(Date.now() / 1000);
      
      const writeDelta = (text: string) => {
        const chunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: resolved.model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
        };
        res.write("data: " + JSON.stringify(chunk) + "\n\n");
      };

      messages.push({ role: "assistant", tool_calls: toolCalls });

      let tcIdx = 0;
      for (const tc of toolCalls) {
        if (isClientGone()) {
          log("info", "[Chat] Response connection closed by client. Aborting tool execution loop.");
          break;
        }
        writeDelta(`\n\n> 🔧 **Agent Executing Tool:** \`${tc.function.name}\`...\n`);
        const workspacePath = body.workspacePath || "";

        // Keep connection alive with periodic pings while executing local tools
        const toolKeepAlive = setInterval(() => {
          if (!res.writableEnded) {
            res.write(": keep-alive\n\n");
          }
        }, 15000);

        let output;
        try {
          output = await handleAgentToolCall(tc, workspacePath);
        } finally {
          clearInterval(toolKeepAlive);
        }

        writeDelta(`\n\`\`\`\n${output}\n\`\`\`\n`);
        
        // Truncate tool output to prevent request body overflow
        const MAX_TOOL_OUTPUT = 30 * 1024; // 30KB limit for tool output in messages
        let toolContent = output;
        if (toolContent.length > MAX_TOOL_OUTPUT) {
          toolContent = toolContent.substring(0, MAX_TOOL_OUTPUT) + "\n\n[Output truncated to prevent request overflow]";
        }
        
        const isLastTool = tcIdx === toolCalls.length - 1;
        if (isLastTool) {
          toolContent += `\n\n[System Reminder: Please output the updated Task Plan (e.g. - [x] completed, - [/] in-progress, - [ ] pending) at the beginning of your next response, then continue executing the steps or summarize the results.]`;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
        tcIdx++;
      }

      // Truncate entire messages array if it's getting too large
      let estimatedSize = 0;
      for (const msg of messages) {
        const contentLen = typeof msg.content === "string" ? msg.content.length : (msg.content ? JSON.stringify(msg.content).length : 0);
        estimatedSize += contentLen + 100;
        if (msg.tool_call_id) {
          estimatedSize += msg.tool_call_id.length + 50;
        }
        if (msg.tool_calls) {
          estimatedSize += JSON.stringify(msg.tool_calls).length;
        }
      }
      const MAX_MESSAGES_SIZE = 800 * 1024; // 800KB limit for messages
      if (estimatedSize > MAX_MESSAGES_SIZE) {
        log("warn", `[Chat] Messages array too large (~${Math.round(estimatedSize/1024)}KB), truncating older messages`);
        const systemMsg = messages.find(m => m.role === "system");
        const recentMessages = messages.slice(-20);
        messages = systemMsg ? [systemMsg, ...recentMessages] : recentMessages;
      }

      if (isClientGone()) {
        log("info", "[Chat] Response connection closed by client. Aborting agent execution loop recursion.");
        if (!res.writableEnded) res.end();
        return;
      }

      return executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey, depth + 1);
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
      // Track billing for estimation based on text chunks length
      // Improved token estimation: CJK chars ~2.5 tokens each, ASCII ~0.25 tokens per char
      const estimateTokens = (text: string) => {
        let count = 0;
        for (let i = 0; i < text.length; i++) {
          count += text.charCodeAt(i) > 0x7F ? 2.5 : 0.25;
        }
        return Math.round(count);
      };
      const estPromptTokens = estimateTokens(JSON.stringify(messages));
      const estOutputTokens = estimateTokens(accumulatedText);
      
      const promptTok = finalUsage?.prompt_tokens || estPromptTokens;
      const compTok = finalUsage?.completion_tokens || estOutputTokens;
      let cachedTok = 0;
      if (finalUsage?.prompt_tokens_details?.cached_tokens !== undefined) {
        cachedTok = finalUsage.prompt_tokens_details.cached_tokens;
      } else if (finalUsage?.input_token_details?.cache_read !== undefined) {
        cachedTok = finalUsage.input_token_details.cache_read;
      }
      accumulateCost(resolved.model, promptTok, compTok, cachedTok);

      // Persistent Caching
      if (cacheKey && accumulatedText && loadConfig().cacheEnabled) {
        const fullCachedResp = {
          id: "chatcmpl-" + Date.now(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: resolved.model,
          choices: [{ index: 0, message: { role: "assistant", content: accumulatedText }, finish_reason: "stop" }],
          usage: { prompt_tokens: promptTok, completion_tokens: compTok, total_tokens: promptTok + compTok }
        };
        setCachedResponse(cacheKey, fullCachedResp);
      }
      log("info", `[Chat] Stream Done ${Date.now() - startTime}ms`);
    }
  } else {
    // Non-stream call
    const upstreamResp = await fetch(targetUrl, { method: "POST", headers, body: reqBodyText });
    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      throw new Error(`Upstream returned ${upstreamResp.status}: ${errText}`);
    }

    const data = await upstreamResp.json() as any;
    const choice = data.choices?.[0];
    if (choice?.message) {
      if (choice.message.reasoning_content && choice.message.content !== undefined) {
        choice.message.content = `<think>\n${choice.message.reasoning_content}\n</think>\n${choice.message.content}`;
      }
    }
    if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
      messages.push(choice.message);
      const toolCalls = choice.message.tool_calls;
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const workspacePath = body.workspacePath || "";
        const output = await handleAgentToolCall(tc, workspacePath);
        
        let toolContent = output;
        const isLastTool = i === toolCalls.length - 1;
        if (isLastTool) {
          toolContent += `\n\n[System Reminder: Please output the updated Task Plan (e.g. - [x] completed, - [/] in-progress, - [ ] pending) at the beginning of your next response, then continue executing the steps or summarize the results.]`;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
      }
      return executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey, depth + 1);
    } else {
      const promptTok = data.usage?.prompt_tokens || 0;
      const compTok = data.usage?.completion_tokens || 0;
      let cachedTok = 0;
      if (data.usage?.prompt_tokens_details?.cached_tokens !== undefined) {
        cachedTok = data.usage.prompt_tokens_details.cached_tokens;
      } else if (data.usage?.input_token_details?.cache_read !== undefined) {
        cachedTok = data.usage.input_token_details.cache_read;
      }
      accumulateCost(resolved.model, promptTok, compTok, cachedTok);
      if (cacheKey && loadConfig().cacheEnabled) {
        setCachedResponse(cacheKey, data);
      }
      res.json(data);
      log("info", `[Chat] Done ${Date.now() - startTime}ms`);
    }
  }
}

// ---- OpenAI passthrough: POST /v1/chat/completions ----

async function compressContextIfNeeded(messages: any[], resolved: any): Promise<any[]> {
  // Guard: bail out if resolved is missing provider info
  if (!resolved?.provider?.baseUrl || !resolved?.apiKey) {
    log("warn", "[Context Compression] Cannot compress: missing provider baseUrl or apiKey");
    return messages;
  }

  const estimateTokens = (text: string) => {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      count += text.charCodeAt(i) > 0x7F ? 2.5 : 0.25;
    }
    return Math.round(count);
  };
  const totalTokens = estimateTokens(JSON.stringify(messages));
  if (totalTokens <= 15000) {
    return messages;
  }
  
  log("info", `[Context Compression] Context size (${totalTokens} tokens) exceeds 15,000 threshold. Compacting context...`);
  
  const systemMessages = messages.filter(m => m.role === "system");
  const activeMessages = messages.filter(m => m.role !== "system");
  
  if (activeMessages.length < 8) {
    return messages;
  }
  
  const keepCount = 6;
  const toCompress = activeMessages.slice(0, activeMessages.length - keepCount);
  const toKeep = activeMessages.slice(activeMessages.length - keepCount);
  
  const summaryPrompt = "Please analyze the following conversation history and write a dense, concise summary. Highlight what tasks have been completed, what is in progress, any active file paths, and key decisions made. Keep the summary under 500 words.";
  
  const conversationText = toCompress.map(m => {
    let contentStr = "";
    if (typeof m.content === "string") {
      contentStr = m.content;
    } else if (Array.isArray(m.content)) {
      contentStr = m.content.map((c: any) => c.text || JSON.stringify(c)).join("\n");
    } else if (m.tool_calls) {
      contentStr = `Calls tools: ${m.tool_calls.map((tc: any) => tc.function.name).join(", ")}`;
    }
    return `[${m.role.toUpperCase()}]: ${contentStr}`;
  }).join("\n\n");
  
  try {
    const baseUrl = resolved.provider.baseUrl.replace(/\/+$/, "");
    const targetUrl = baseUrl.endsWith("/v1") ? baseUrl + "/chat/completions" : baseUrl + "/v1/chat/completions";
    const headers = { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${resolved.apiKey}` 
    };
    
    const compressionBody = {
      model: resolved.model,
      messages: [
        { role: "system", content: "You are a helpful assistant that summarizes conversation logs concisely." },
        { role: "user", content: `${summaryPrompt}\n\nCONVERSATION:\n${conversationText}` }
      ],
      max_tokens: 800,
      temperature: 0.3
    };
    
    log("info", `[Context Compression] Requesting summary from upstream...`);
    const compressionController = new AbortController();
    const compressionTimeout = setTimeout(() => compressionController.abort(), 20000); // 20s timeout
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(compressionBody),
      signal: compressionController.signal
    });
    clearTimeout(compressionTimeout);
    
    if (!resp.ok) {
      throw new Error(`Compression upstream returned ${resp.status}`);
    }
    const data = await resp.json() as any;
    const summary = data.choices?.[0]?.message?.content;
    if (summary) {
      log("info", `[Context Compression] Successfully compressed middle context.`);
      const summaryMessage = {
        role: "system",
        content: `[System Note: Below is a compacted summary of the conversation history prior to the last few turns. Refer to this summary for context on what has already been done.]\n\n${summary}`
      };
      return [...systemMessages, summaryMessage, ...toKeep];
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      log("warn", "[Context Compression] Compression request timed out after 20s.");
    } else {
      log("warn", `[Context Compression] Failed to get AI summary:`, err);
    }
  }
  
  log("info", `[Context Compression] Falling back to simple truncation (keeping last 12 messages).`);
  if (activeMessages.length > 12) {
    return [...systemMessages, ...activeMessages.slice(activeMessages.length - 12)];
  }
  return messages;
}

app.post("/v1/chat/completions", async (req, res) => {
  req.socket.setTimeout(0); // Disable socket timeout for streaming agent loop
  const startTime = Date.now();
  stats.chatRequests++;
  
  const body = req.body;
  const activeSkillId = body.activeSkillId || "";
  const useAgent = body.useAgent; // undefined = no agent, true = Build mode, false = Plan mode
  
  // Resolve target model early for context compression
  const resolvedTarget = resolveModel(body.model);
  
  // Compress messages if context is too large
  let messages = [...(body.messages || [])];
  messages = await compressContextIfNeeded(messages, resolvedTarget);

  // Persistent Caching Check
  let cacheKey: string | null = null;
  const canUseResponseCache = body.useAgent === undefined && !body.activeSkillId && !body.workspacePath && !body.tool_choice && !body.tools;
  if (loadConfig().cacheEnabled && canUseResponseCache) {
    cacheKey = computeCacheKey(body);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      log("info", `[Cache] Hit cache for key ${cacheKey}`);
      const promptTok = cached.usage?.prompt_tokens || 0;
      const compTok = cached.usage?.completion_tokens || 0;
      accumulateCost(cached.model || body.model, promptTok, compTok, promptTok);

      if (body.stream) {
        const fullText = cached.choices?.[0]?.message?.content || "";
        await replayStreamResponse(res, fullText, cached.model || body.model, () => {
          log("info", `[Cache] Streaming cache replay completed in ${Date.now() - startTime}ms`);
        });
        return;
      } else {
        return res.json(cached);
      }
    }
  }

  // Load Active Skill instructions
  if (activeSkillId) {
    const skillPath = path.join(SKILLS_DIR, activeSkillId);
    const skillFile = path.join(skillPath, "SKILL.md");
    if (fs.existsSync(skillFile)) {
      try {
        const text = fs.readFileSync(skillFile, "utf-8");
        const parsed = parseFrontmatter(text);
        const skillSystemPrompt = `[Active Agent Skill: ${parsed.name}]\nInstructions:\n${parsed.body}`;
        const systemMsgIdx = messages.findIndex(m => m.role === "system");
        if (systemMsgIdx >= 0) {
          messages[systemMsgIdx] = {
            role: "system",
            content: messages[systemMsgIdx].content + "\n\n" + skillSystemPrompt
          };
        } else {
          messages.unshift({ role: "system", content: skillSystemPrompt });
        }
      } catch (e) {
        log("error", "Failed to load skill system prompt:", e);
      }
    }
  }

  // Inject Workspace and Skills System Prompts if useAgent is defined
  if (useAgent !== undefined) {
    let agentPrompt = "";
    if (useAgent === true) {
      agentPrompt = `[Agentic Mode (Build)]
You are running in Build (Agentic) mode. You have full edit and execution access to automate coding tasks. You have access to internal/built-in agent skills under "${SKILLS_DIR}". You can list, detail, and execute scripts from these skills using available tools to automate tasks (e.g., editing documents, Excel, PPT files, writing scripts, running tests).

[Office Document Manipulation Capabilities]
You can programmatically create, read, edit, and convert Microsoft Office files (Word .docx, Excel .xlsx, PowerPoint .pptx) and PDFs using Python libraries.
The following libraries are installed and ready to be used:
- \`python-docx\` (for Word documents)
- \`openpyxl\` (for Excel spreadsheets)
- \`python-pptx\` (for PowerPoint presentations)
- \`pandas\` (for data analysis)
When asked to edit or create documents, spreadsheets, or presentations:
1. Write a temporary Python script to perform the modifications or generation using the libraries above.
2. Save the script using \`write_workspace_file\` (e.g. as \`temp_edit.py\`).
3. Run the script using \`run_terminal_command\` (e.g. \`python temp_edit.py\`).
4. Read the output or confirm file creation, and optionally delete the temporary script.

[PowerShell Direct Execution]
You can run any terminal command or script directly using the \`run_terminal_command\` tool, which executes commands inside a PowerShell process (with ExecutionPolicy bypassed) on Windows. If no workspace is selected, commands will run in the server's working directory.

[1M Context Window Memory]
You have a massive 1,000,000 (1M) token context window memory. You can read, process, and retain large files, extensive project logs, and multiple workspace documents simultaneously without losing context.

[Task Planning & Sequential Execution]
CRITICAL: When the user issues a command or task, you MUST first parse and break down the request into a step-by-step "Task Plan" (Checklist) at the very beginning of your response.
The Task Plan must be formatted exactly as standard task markdown list:
   - [ ] Task Description (for pending tasks)
   - [/] Task Description (for the active task currently executing)
   - [x] Task Description (for completed tasks)
You MUST output this Task Plan in your text response before calling any tools, or at the start of any response that calls tools, so that the UI can parse and render the checklist correctly.
In every subsequent turn, you MUST update the status of each task (e.g. marking completed tasks as [x], the current task as [/], and pending ones as [ ]) and output the updated Task Plan at the beginning of your text response.
Execute each task step-by-step. Do not skip printing the task list at any turn.

重要提示 (任务规划与分步执行)：
当用户发出指令或任务时：
1. 你必须在回复的【最开始】将任务解析并拆解为分步执行的“任务清单”(Task Plan)。
2. 任务清单必须使用以下标准的 Markdown 任务列表格式：
   - [ ] 任务描述 (表示待处理任务)
   - [/] 任务描述 (表示当前正在执行的任务)
   - [x] 任务描述 (表示已完成的任务)
3. 在进行任何工具调用之前，你必须在文本回复中先输出这个任务清单，以便前端 UI 正确渲染分步执行面板。
4. 在后续的每一次迭代回复中，你必须在回复的最开始输出更新后的任务清单（例如，将已完成的标记为 [x]，正在执行的标记为 [/]，待执行的标记为 [ ]），绝对不能省略。
5. 按照清单步骤，一步一步执行，直至所有任务完成。
` + getSkillsSystemPrompt() + `

[Token Conservation & Codex Level Performance]
1. Be extremely concise. Avoid conversational filler, preambles, and lengthy explanations.
2. Write minimal, precise search-and-replace patches using the \`patch_workspace_file\` tool. Never rewrite or output the entire file content if only a small part changes.
3. When writing code, write only the modified code blocks, comments, or diffs. Avoid outputting unchanged sections.
4. Focus on completing tasks with the fewest tool calls and tokens possible, matching the speed and density of Codex CLI.
`;
    } else {
      // Plan Mode (useAgent === false)
      agentPrompt = `[Agentic Mode (Plan)]
You are running in Plan (Read-Only) mode. You are an expert AI planning agent.
You can read, search, and analyze files in the workspace using read-only tools, but you CANNOT write files, run scripts, execute terminal commands, or use MCP tools.
Your goal is to thoroughly research the codebase/task and produce a detailed, step-by-step implementation plan or roadmap in task list format (e.g. - [ ] tasks). Do not attempt to modify any files or run commands.

[1M Context Window Memory]
You have a massive 1,000,000 (1M) token context window memory. You can read, process, and retain large files, extensive project logs, and multiple workspace documents simultaneously without losing context.
`;
    }

    if (body.workspacePath) {
      if (useAgent === true) {
        agentPrompt += `\n[Active Workspace Directory]\nYou are working inside the active workspace directory: "${body.workspacePath}".\nYou can use list_workspace_files, read_workspace_file, write_workspace_file, patch_workspace_file, search_grep, and glob_files to scan, inspect, edit, modify, search, or create files inside this workspace directory. When modifying existing files, you should prefer using patch_workspace_file to perform precise search-and-replace edits instead of rewriting the entire file. Use search_grep to search for specific code patterns (like function names or imports) recursively in the workspace. Use glob_files to list files matching a specific pattern. Use these capabilities to autonomously read and edit workspace documents or run skill scripts directly to finish editing work.`;
      } else {
        agentPrompt += `\n[Active Workspace Directory]\nYou are working inside the active workspace directory: "${body.workspacePath}".\nYou have read-only access. You can use list_workspace_files, read_workspace_file, search_grep, and glob_files to scan, inspect, and search files inside this workspace directory. You cannot use write_workspace_file, patch_workspace_file, run_terminal_command, run_skill_script, or any MCP tools. Please use the read-only capabilities to analyze the code and prepare a detailed plan.`;
      }
    } else {
      agentPrompt += `\nNo active workspace folder is currently selected. If you need to access files, please ask the user to select or edit the workspace directory using the UI.`;
    }
    const systemMsgIdx = messages.findIndex(m => m.role === "system");
    if (systemMsgIdx >= 0) {
      messages[systemMsgIdx] = {
        role: "system",
        content: messages[systemMsgIdx].content + "\n\n" + agentPrompt
      };
    } else {
      messages.unshift({ role: "system", content: agentPrompt });
    }
  }

  // 强化中英文自动对齐策略（加在 system prompt 最末尾，具有最强约束力）
  const langConstraint = `\n\n[Language Alignment Constraint]\nIMPORTANT: You MUST think (inside <think> tags) and respond in the exact same language that the user uses to ask questions. If the user writes in Chinese, write your reasoning and responses in Chinese. If the user writes in English, write your reasoning and responses in English. Keep language alignment consistent at all times.\n重要：你必须使用与用户提问完全相同的语言进行思考（在 <think> 标签内）和回复。如果用户使用中文提问，你的思考过程和回复都必须使用中文。如果用户使用英文提问，你的思考和回复必须使用英文。时刻保持语言一致。`;
  
  const finalSystemMsgIdx = messages.findIndex(m => m.role === "system");
  if (finalSystemMsgIdx >= 0) {
    messages[finalSystemMsgIdx] = {
      role: "system",
      content: messages[finalSystemMsgIdx].content + langConstraint
    };
  } else {
    messages.unshift({ role: "system", content: langConstraint });
  }

  // Collect Tools: Active Skill scripts + MCP tools + built-in workspace & skill tools
  let tools = [...(body.tools || [])];
  if (useAgent !== undefined) {
    // 1. Read-only tools (always added in both Plan and Build modes)
    tools.push({
      type: "function",
      function: {
        name: "list_workspace_files",
        description: "List all files in the active workspace recursively up to 3 levels deep (excluding node_modules, .git, and dist)."
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "read_workspace_file",
        description: "Read the contents of a file inside the active workspace.",
        parameters: {
          type: "object",
          properties: {
            relativeFilePath: {
              type: "string",
              description: "The relative path of the file from the workspace root (e.g. 'src/App.tsx' or 'document.txt')"
            }
          },
          required: ["relativeFilePath"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "search_grep",
        description: "Search for a text pattern or regular expression recursively across all files in the active workspace. Equivalent to ripgrep (rg) search.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The pattern to search for inside workspace files."
            },
            filePattern: {
              type: "string",
              description: "Optional glob pattern to restrict search files (e.g. '*.ts' or 'src/**/*.tsx')."
            }
          },
          required: ["query"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "glob_files",
        description: "Find files in the active workspace matching a specific glob or pattern (e.g. '*.json' or 'src/**/*.ts').",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The pattern to match files against."
            }
          },
          required: ["pattern"]
        }
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "list_available_skills",
        description: "List all available internal/built-in agent skills under the skills directory, including their skill ID, name, and description."
      }
    });

    tools.push({
      type: "function",
      function: {
        name: "get_skill_details",
        description: "Get detailed documentation (SKILL.md) and list of executable helper automation scripts (py/js files) for a specific skill by skill ID.",
        parameters: {
          type: "object",
          properties: {
            skillId: {
              type: "string",
              description: "The skill ID (e.g. folder name under the skills directory)"
            }
          },
          required: ["skillId"]
        }
      }
    });

    // 2. Modifying and executing tools (only added in Build mode)
    if (useAgent === true) {
      tools.push({
        type: "function",
        function: {
          name: "run_terminal_command",
          description: "Execute a terminal command on the host machine using PowerShell within the active workspace directory.",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "The exact shell command to run (e.g. 'npm run build', 'git status', 'python test.py', etc.)"
              }
            },
            required: ["command"]
          }
        }
      });

      tools.push({
        type: "function",
        function: {
          name: "write_workspace_file",
          description: "Create or overwrite a file in the active workspace with the provided content.",
          parameters: {
            type: "object",
            properties: {
              relativeFilePath: {
                type: "string",
                description: "The relative path of the file from the workspace root (e.g. 'src/App.tsx' or 'document.txt')"
              },
              content: {
                type: "string",
                description: "The complete content to write into the file"
              }
            },
            required: ["relativeFilePath", "content"]
          }
        }
      });

      tools.push({
        type: "function",
        function: {
          name: "patch_workspace_file",
          description: "Perform a search-and-replace modification inside an existing file in the active workspace. Provide the exact text to match, and the replacement text.",
          parameters: {
            type: "object",
            properties: {
              relativeFilePath: {
                type: "string",
                description: "The relative path of the file from the workspace root (e.g. 'src/App.tsx')"
              },
              searchContent: {
                type: "string",
                description: "The exact, unique block of code/text in the file that you want to replace. Spacing, indentation, and newlines must match the file content exactly."
              },
              replacementContent: {
                type: "string",
                description: "The replacement content to substitute for the matched searchContent block."
              }
            },
            required: ["relativeFilePath", "searchContent", "replacementContent"]
          }
        }
      });

      tools.push({
        type: "function",
        function: {
          name: "run_skill_script",
          description: "Execute a script inside a skill folder (e.g. standard python/js automation tool script) with arguments, and return the execution results.",
          parameters: {
            type: "object",
            properties: {
              skillId: {
                type: "string",
                description: "The skill ID containing the script"
              },
              scriptName: {
                type: "string",
                description: "The filename of the script to run (e.g. 'generate_report.py')"
              },
              arguments: {
                type: "array",
                items: { type: "string" },
                description: "List of string arguments to pass to the script"
              }
            },
            required: ["skillId", "scriptName", "arguments"]
          }
        }
      });

      const mcpTools = getAllMCPTools();
      for (const tool of mcpTools) {
        tools.push({
          type: "function",
          function: {
            name: `mcp__${tool.serverName}__${tool.name}`,
            description: tool.description,
            parameters: tool.inputSchema
          }
        });
      }
    }
  }

  // Load Balancing and Disaster Recovery Fallback Loop
  const mainProviderId = resolvedTarget.provider.id;
  const fallbackIds = loadConfig().fallbackProviderIds || [];
  const providersToTry = [mainProviderId, ...fallbackIds.filter(id => id !== mainProviderId)];

  let lastError: any = new Error("No provider succeeded");
  for (const provId of providersToTry) {
    const provider = getProvider(provId);
    if (!provider) continue;
    const apiKey = getApiKey(provId);
    if (!apiKey) continue;

    const resolved = {
      provider,
      model: provId === resolvedTarget.provider.id ? resolvedTarget.model : body.model,
      apiKey
    };

    // If model is not native, map to first model
    const isNative = provider.models.some(m => m.id === resolved.model);
    if (!isNative && provider.models.length > 0) {
      resolved.model = provider.models[0].id;
    }

    try {
      log("info", `[Route] Attempting route ${body.model} -> ${provider.id}/${resolved.model}`);
      await executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey);
      return; // Succeeded!
    } catch (err) {
      log("warn", `[Route] Provider ${provId} failed:`, err);
      lastError = err;
      // If headers were already sent to the client, we cannot redirect or retry another provider
      if (res.headersSent) {
        log("info", `[Route] Headers already sent. Aborting route fallback logic.`);
        break;
      }
    }
  }

  // If we reach here, all providers failed
  stats.errors++;
  log("error", `[Route] All routes failed. Last error:`, lastError);
  if (!res.headersSent) {
    res.status(502).json({ error: { message: `All routing paths failed. Last error: ${String(lastError)}`, type: "proxy_error" } });
  } else if (!res.writableEnded) {
    const errText = `\n\n[Proxy Execution Error: ${String(lastError)}]\n`;
    const errorChunk = {
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "error-handler",
      choices: [{ index: 0, delta: { content: errText }, finish_reason: "error" }]
    };
    res.write("data: " + JSON.stringify(errorChunk) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

// ---- Models ----

// ---- 自动发现供应商的可用模型列表 ----
app.get("/api/discover-models/:providerId", async (req, res) => {
  const provider = getProvider(req.params.providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  const apiKey = getApiKey(provider.id);
  try {
    const targetUrl = provider.baseUrl + "/v1/models";
    const headers: Record<string, string> = {};
    if (provider.id === "anthropic") {
      if (apiKey) {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
      }
    } else {
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const resp = await fetch(targetUrl, { headers });
    if (!resp.ok) return res.status(resp.status).json({ error: await resp.text() });
    const data = await resp.json() as any;
    
    let rawModels: any[] = [];
    if (Array.isArray(data)) {
      rawModels = data;
    } else if (data && Array.isArray(data.data)) {
      rawModels = data.data;
    } else if (data && Array.isArray(data.models)) {
      rawModels = data.models;
    } else if (data && typeof data === "object") {
      // Robust scanning for any arrays (e.g. some wrapper response)
      for (const val of Object.values(data)) {
        if (Array.isArray(val)) {
          rawModels = val;
          break;
        }
      }
    }
    
    const models = rawModels.map((m: any) => {
      if (typeof m === "string") return { id: m, name: m };
      const id = m.id || m.name || String(m);
      const name = m.display_name || m.name || id;
      return { id, name };
    });
    
    res.json({ provider: provider.id, models });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// SSE streaming: discover models from ALL enabled providers with progress
app.get("/api/discover-all", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const providers = getAllProviders();
  const toDiscover = providers.filter((p) => { if (p.id === "custom") return false; return !!getApiKey(p.id); });
  const send = (event: string, data: any) => { if (res.writableEnded) return; try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { } };
  send("init", { total: toDiscover.length, providers: toDiscover.map((p) => p.id) });
  const results: any[] = [];
  for (const provider of toDiscover) {
    send("progress", { provider: provider.id, status: "fetching", completed: results.length, total: toDiscover.length });
    const apiKey = getApiKey(provider.id);
    try {
      const targetUrl = provider.baseUrl + "/v1/models";
      const headers: Record<string, string> = {};
      if (provider.id === "anthropic") { if (apiKey) { headers["x-api-key"] = apiKey; headers["anthropic-version"] = "2023-06-01"; } }
      else { if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`; }
      const resp = await fetch(targetUrl, { headers, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) { results.push({ provider: provider.id, models: [], error: `HTTP ${resp.status}` }); send("result", { provider: provider.id, models: [], error: `HTTP ${resp.status}` }); continue; }
      const data = await resp.json() as any; let rawModels: any[] = [];
      if (Array.isArray(data)) rawModels = data;
      else if (data && Array.isArray(data.data)) rawModels = data.data;
      else if (data && Array.isArray(data.models)) rawModels = data.models;
      else if (data && typeof data === "object") { for (const val of Object.values(data)) { if (Array.isArray(val)) { rawModels = val; break; } } }
      const models = rawModels.map((m: any) => { if (typeof m === "string") return { id: m, name: m }; return { id: m.id || m.name || String(m), name: m.display_name || m.name || m.id || String(m) }; });
      results.push({ provider: provider.id, models }); send("result", { provider: provider.id, models, count: models.length });
    } catch (e: any) { results.push({ provider: provider.id, models: [], error: e.message }); send("result", { provider: provider.id, models: [], error: e.message }); }
  }
  send("done", { total_providers: toDiscover.length, results });
  if (!res.writableEnded) res.end();
});
app.post("/api/discover-sync", (req, res) => {
  const { providers: providerModels } = req.body || {};
  if (!Array.isArray(providerModels)) return res.status(400).json({ error: "providers array required" });
  const current = loadConfig(); let updated = 0;
  for (const entry of providerModels) { const pcfg = (current as any).providers?.[entry.provider]; if (pcfg && Array.isArray(entry.models)) { pcfg.models = entry.models.map((m: any) => (typeof m === "string" ? { id: m, name: m } : { id: m.id || m, name: m.name || m.id || m })); updated++; } }
  saveConfig(current); res.json({ ok: true, updated });
});

app.get("/v1/models", (_req, res) => {
  const providers = getAllProviders();
  const models = providers.flatMap((p) => p.models.map((m) => ({
    id: m.id, object: "model", created: Math.floor(Date.now() / 1000), owned_by: p.id, provider_name: p.name,
  })));
  res.json({ object: "list", data: models });
});

app.get("/", (_req, res) => { res.sendFile(path.join(_STATIC_DIR, "index.html")); });
// ---- SSE stream helper ----

async function streamSSE(
  upstreamResp: Response, req: express.Request, res: express.Response,
  processFn: (state: any, chunk: Record<string, unknown>) => string,
  endFn: (state: any) => string, createStateFn: () => any, externalState?: any,
  errorFn?: (status: number, message: string) => string
) {
  const state = externalState || createStateFn();
  const reader = (upstreamResp.body as unknown as ReadableStream).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let clientDisconnected = false;
  let endEventsWritten = false;
  const writeError = errorFn || formatError;
  req.on("close", () => { clientDisconnected = true; });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || clientDisconnected) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") {
          if (!endEventsWritten) {
            const endEvents = endFn(state);
            if (endEvents) res.write(endEvents);
            endEventsWritten = true;
          }
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          try {
            const chunk = JSON.parse(trimmed.slice(6));
            const events = processFn(state, chunk);
            if (events) res.write(events);
          } catch { log("warn", "Failed to parse chunk"); }
        }
      }
    }
  } catch (streamErr) {
    log("error", "Stream error:", streamErr);
    if (!res.writableEnded) res.write(writeError(502, "Stream reading error"));
  }
  if (!res.writableEnded && !endEventsWritten) { const endEvents = endFn(state); if (endEvents) res.write(endEvents); }
  res.end();
  if (state.usage) stats.totalTokens += (state.usage.total_tokens || state.usage.output_tokens || 0);
}

// ---- Fallback pass-through ----

app.all("/v1/*", async (req, res) => {
  req.socket.setTimeout(0);
  const active = getActiveProvider();
  const apiKey = getApiKey(active.id);
  const targetUrl = active.baseUrl + req.url;
  log("info", `[Pass-through] ${req.method} ${req.url} -> ${targetUrl}`);
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"] as string;
    const resp = await fetch(targetUrl, {
      method: req.method, headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    });
    const isSse = (resp.headers.get("content-type") || "").includes("text/event-stream");
    if (isSse) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const reader = (resp.body as any).getReader();
      const decoder = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break; res.write(decoder.decode(value, { stream: true })); }
      res.end();
    } else {
      const text = await resp.text();
      res.status(resp.status).setHeader("Content-Type", resp.headers.get("content-type") || "application/json").send(text);
    }
  } catch (err) {
    log("error", "[Pass-through] Error:", err);
    res.status(502).json({ error: { message: String(err), type: "proxy_error" } });
  }
});

// ---- Start server ----

const server = app.listen(PORT, HOST, () => {
  seedBillingFile();
  initSkillsDirectory();
  const active = getActiveProvider();
  log("info", "===========================================");
  log("info", "  Orca Universal Proxy v2.1.0");
  log("info", `  Listening on http://${HOST}:${PORT}`);
  log("info", `  Active provider: ${active.name} (${active.baseUrl})`);
  log("info", `  Log level: ${LOG_LEVEL}`);
  log("info", "===========================================");
  log("info", "");
  log("info", `  Dashboard: http://${HOST}:${PORT}`);
  log("info", "");
  log("info", "  Codex CLI:");
  log("info", `    $env:OPENAI_BASE_URL = "http://${HOST}:${PORT}/v1"`);
  log("info", `    $env:OPENAI_API_KEY = "sk-dummy"`);
  log("info", "");
  log("info", "  Claude Desktop:");
  log("info", `    Set proxy in claude_desktop_config.json to http://${HOST}:${PORT}`);
  log("info", "");

  const cfg = loadConfig();
  if (cfg.mcpServers && Object.keys(cfg.mcpServers).length > 0) {
    initMCPServers(cfg.mcpServers).catch(e => log("error", "Failed to initialize MCP servers:", e));
  }
});

// Configure server timeouts to prevent connection termination during long agent runs
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 600000; // 10 min headers timeout
server.requestTimeout = 0;

// ---- App Management API ----

interface AppInfo {
  id: string;
  name: string;
  icon: string;
  installed: boolean;
  path: string;
  running: boolean;
  description: string;
  type: string;
  isCustomPath?: boolean;
}

function findFromRegistry(keyPath: string): string {
  try {
    const output = execSync(`reg query "${keyPath}" /ve`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes("REG_SZ")) {
        const parts = line.split("REG_SZ");
        if (parts.length > 1) {
          let cmd = parts[1].trim();
          if (cmd.startsWith('"')) {
            const nextQuote = cmd.indexOf('"', 1);
            if (nextQuote > 0) {
              cmd = cmd.substring(1, nextQuote);
            }
          } else {
            const space = cmd.indexOf(" ");
            if (space > 0) {
              cmd = cmd.substring(0, space);
            }
          }
          if (fs.existsSync(cmd)) {
            return cmd;
          }
        }
      }
    }
  } catch (e) {}
  return "";
}

function findFromUninstallRegistry(appName: string): string {
  const roots = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
  ];
  for (const root of roots) {
    try {
      const output = execSync(`reg query "${root}" /s /f "${appName}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.trim().startsWith("HKEY_")) {
          const keyPath = line.trim();
          try {
            const locOut = execSync(`reg query "${keyPath}" /v "InstallLocation"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const linesL = locOut.split("\n");
            for (const lL of linesL) {
              if (lL.includes("REG_SZ")) {
                const p = lL.split("REG_SZ")[1].trim();
                if (p && fs.existsSync(p)) return p;
              }
            }
          } catch(e) {}
          try {
            const unOut = execSync(`reg query "${keyPath}" /v "UninstallString"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const linesU = unOut.split("\n");
            for (const lU of linesU) {
              if (lU.includes("REG_SZ")) {
                let un = lU.split("REG_SZ")[1].trim();
                if (un.startsWith('"')) {
                  const q = un.indexOf('"', 1);
                  if (q > 0) un = un.substring(1, q);
                } else {
                  const s = un.indexOf(" ");
                  if (s > 0) un = un.substring(0, s);
                }
                const dir = path.dirname(un);
                if (dir && fs.existsSync(dir)) return dir;
              }
            }
          } catch(e) {}
        }
      }
    } catch(e) {}
  }
  return "";
}

function findExe(basePaths: string[], patterns: string[]) {
  for (const bp of basePaths) {
    for (const pat of patterns) {
      try {
        const p = bp + "\\" + pat;
        if (fs.existsSync(p)) return p;
      } catch(e) { log("debug", `findExe: Error checking path ${bp}\\${pat}:`, e); }
    }
  }
  return "";
}

function findInFolder(baseDir: string, exeName: string, maxDepth: number = 2): string {
  if (!baseDir || !fs.existsSync(baseDir) || maxDepth < 0) return "";
  try {
    const direct = baseDir + "\\" + exeName;
    if (fs.existsSync(direct)) return direct;
    if (maxDepth === 0) return "";
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = findInFolder(baseDir + "\\" + entry.name, exeName, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch(e) { log("debug", `findInFolder: Error scanning ${baseDir}:`, e); }
  return "";
}

function scanApps() {
  const apps: AppInfo[] = [];
  let procs = "";
  try { procs = execSync("tasklist /FO CSV /NH 2>nul", { encoding: "utf-8" }); } catch(e) { log("debug", "Failed to get process list:", e); }
  const localApp = process.env.LOCALAPPDATA || "";
  const appData = process.env.APPDATA || "";
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const drives = ["C:", "D:", "E:", "F:"];
  const programDirs: string[] = [];
  for (const drive of drives) {
    if (fs.existsSync(drive + "\\")) {
      programDirs.push(drive + "\\Program Files");
      programDirs.push(drive + "\\Program Files (x86)");
      programDirs.push(drive + "\\Programs");
      programDirs.push(drive);
    }
  }

  // Codex CLI - check PATH and auto-updated binary directory
  let codexCli = false; let codexPath = "";
  const codexBinPath = localApp + "\\OpenAI\\Codex\\bin\\codex.exe";
  try { codexPath = execSync("where codex 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; codexCli = true; } catch(e) { log("debug", "Codex CLI not found in PATH"); }
  if (!codexCli && fs.existsSync(codexBinPath)) { codexCli = true; codexPath = codexBinPath; }
  apps.push({ id: "codex-cli", name: "Codex CLI", icon: "terminal", installed: codexCli, path: codexPath, running: procs.toLowerCase().includes("codex"), description: "OpenAI Codex command-line interface", type: "cli" });

  // Codex Desktop - scan MSIX packages in WindowsApps
  let codexDesktopPath = findFromRegistry("HKCU\\Software\\Classes\\openai-codex\\shell\\open\\command") || 
                         findFromRegistry("HKLM\\Software\\Classes\\openai-codex\\shell\\open\\command");
  if (!codexDesktopPath) {
    const windowsApps = programFiles + "\\WindowsApps";
    try {
      if (fs.existsSync(windowsApps)) {
        const entries = fs.readdirSync(windowsApps);
        const codexDir = entries.find((e: string) => e.startsWith("OpenAI.Codex_"));
        if (codexDir) {
          const candidate = windowsApps + "\\" + codexDir + "\\app\\Codex.exe";
          if (fs.existsSync(candidate)) codexDesktopPath = candidate;
        }
      }
    } catch(e) { log("debug", "Failed to scan WindowsApps for Codex:", e); }
  }
  // Fallback: check AppExecutionAliases
  if (!codexDesktopPath) {
    try {
      const r = execSync("where codex 2>nul", { encoding: "utf-8" });
      const lines = r.trim().split("\n");
      const waLine = lines.find((l: string) => l.includes("WindowsApps"));
      if (waLine) { codexDesktopPath = waLine.trim(); }
    } catch(e) { log("debug", "Codex not found in AppExecutionAliases"); }
  }
  // Fallback: local install paths
  if (!codexDesktopPath) {
    const searchDirs = [
      ...programDirs.map(d => d + "\\codex"),
      ...programDirs.map(d => d + "\\Codex"),
      ...programDirs.map(d => d + "\\openai-codex"),
      localApp + "\\codex",
      localApp + "\\Codex",
      localApp + "\\openai-codex",
      localApp + "\\Programs\\codex",
      localApp + "\\Programs\\Codex",
    ];
    for (const d of searchDirs) {
      const p = findInFolder(d, "Codex.exe");
      if (p) { codexDesktopPath = p; break; }
    }
  }
  apps.push({ id: "codex-desktop", name: "Codex Desktop", icon: "monitor", installed: !!codexDesktopPath, path: codexDesktopPath, running: procs.includes("Codex") || procs.includes("codex"), description: "OpenAI Codex desktop application", type: "desktop" });

  // Claude CLI
  let claudeCli = false; let claudePath = "";
  try { claudePath = execSync("where claude 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; claudeCli = true; } catch(e) { log("debug", "Claude CLI not found in PATH"); }
  apps.push({ id: "claude-cli", name: "Claude CLI", icon: "terminal", installed: claudeCli, path: claudePath, running: procs.toLowerCase().includes("claude"), description: "Anthropic Claude command-line interface", type: "cli" });

  // Claude Desktop - scan MSIX packages in WindowsApps
  let claudeDesktopPath = findFromRegistry("HKCU\\Software\\Classes\\claude\\shell\\open\\command") ||
                         findFromRegistry("HKLM\\Software\\Classes\\claude\\shell\\open\\command");
  if (!claudeDesktopPath) {
    const windowsApps = programFiles + "\\WindowsApps";
    try {
      if (fs.existsSync(windowsApps)) {
        const entries = fs.readdirSync(windowsApps);
        const claudeDir = entries.find((e: string) => e.startsWith("Claude_"));
        if (claudeDir) {
          const candidate = windowsApps + "\\" + claudeDir + "\\app\\claude.exe";
          if (fs.existsSync(candidate)) claudeDesktopPath = candidate;
        }
      }
    } catch(e) { log("debug", "Failed to scan WindowsApps for Claude:", e); }
  }
  // Fallback: check AppExecutionAliases
  if (!claudeDesktopPath) {
    try {
      const r = execSync("where claude 2>nul", { encoding: "utf-8" });
      const lines = r.trim().split("\n");
      const waLine = lines.find((l: string) => l.includes("WindowsApps"));
      if (waLine) { claudeDesktopPath = waLine.trim(); }
    } catch(e) { log("debug", "Claude not found in AppExecutionAliases"); }
  }
  // Fallback: local install paths
  if (!claudeDesktopPath) {
    const searchPaths = [
      localApp + "\\Claude\\Claude.exe",
      localApp + "\\Programs\\Claude\\Claude.exe",
      localApp + "\\Programs\\claude\\Claude.exe",
      ...programDirs.map(d => d + "\\Claude\\Claude.exe"),
      ...programDirs.map(d => d + "\\claude-desktop\\Claude.exe"),
    ];
    for (const p of searchPaths) { if (fs.existsSync(p)) { claudeDesktopPath = p; break; } }
  }
  if (!claudeDesktopPath) {
    const searchDirs = [
      localApp + "\\Claude",
      localApp + "\\claude-desktop",
      localApp + "\\Programs\\Claude",
      localApp + "\\Programs\\claude",
      ...programDirs.map(d => d + "\\Claude"),
      ...programDirs.map(d => d + "\\claude-desktop"),
    ];
    for (const d of searchDirs) {
      const p = findInFolder(d, "Claude.exe");
      if (p) { claudeDesktopPath = p; break; }
    }
  }
  apps.push({ id: "claude-desktop", name: "Claude Desktop", icon: "message-square", installed: !!claudeDesktopPath, path: claudeDesktopPath, running: procs.includes("Claude"), description: "Anthropic Claude desktop application", type: "desktop" });

  // OpenClaw
  let openclaw = false; let openclawPath = "";
  try { openclawPath = execSync("where openclaw 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; openclaw = true; } catch(e) { log("debug", "OpenClaw not found in PATH"); }
  apps.push({ id: "openclaw", name: "OpenClaw", icon: "terminal", installed: openclaw, path: openclawPath, running: procs.toLowerCase().includes("openclaw"), description: "OpenClaw AI coding agent", type: "cli" });

  // OpenCode
  let opencode = false; let opencodePath = "";
  try { opencodePath = execSync("where opencode 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; opencode = true; } catch(e) { log("debug", "OpenCode not found in PATH"); }
  
  let opencodeDesktopPath = findFromUninstallRegistry("OpenCode") || findFromUninstallRegistry("OpenCode 1.15.10");
  if (opencodeDesktopPath && fs.existsSync(path.join(opencodeDesktopPath, "OpenCode.exe"))) {
    opencodeDesktopPath = path.join(opencodeDesktopPath, "OpenCode.exe");
  } else {
    opencodeDesktopPath = "";
  }
  if (!opencodeDesktopPath) {
    const searchPaths = [
      localApp + "\\ai.opencode.desktop\\OpenCode.exe",
      localApp + "\\Programs\\opencode\\OpenCode.exe",
      localApp + "\\Programs\\OpenCode\\OpenCode.exe",
      ...programDirs.map(d => d + "\\OpenCode\\OpenCode.exe"),
      ...programDirs.map(d => d + "\\opencode\\OpenCode.exe"),
      ...programDirs.map(d => d + "\\OpenCode\\opencode.exe"),
      ...programDirs.map(d => d + "\\opencode\\opencode.exe"),
    ];
    for (const p of searchPaths) { if (fs.existsSync(p)) { opencodeDesktopPath = p; break; } }
  }
  apps.push({ id: "opencode-cli", name: "OpenCode CLI", icon: "terminal", installed: opencode, path: opencodePath, running: procs.toLowerCase().includes("opencode"), description: "OpenCode AI coding agent CLI", type: "cli" });
  apps.push({ id: "opencode-desktop", name: "OpenCode Desktop", icon: "monitor", installed: !!opencodeDesktopPath, path: opencodeDesktopPath, running: procs.includes("OpenCode"), description: "OpenCode desktop application", type: "desktop" });

  // Cursor
  let cursorPath = findFromRegistry("HKCU\\Software\\Classes\\cursor\\shell\\open\\command") || 
                   findFromRegistry("HKLM\\Software\\Classes\\cursor\\shell\\open\\command") ||
                   findFromRegistry("HKCU\\Software\\Classes\\Applications\\Cursor.exe\\shell\\open\\command") ||
                   findFromRegistry("HKLM\\Software\\Classes\\Applications\\Cursor.exe\\shell\\open\\command") ||
                   findFromUninstallRegistry("Cursor");
  if (cursorPath && fs.existsSync(path.join(cursorPath, "Cursor.exe"))) {
    cursorPath = path.join(cursorPath, "Cursor.exe");
  } else if (cursorPath && !cursorPath.endsWith("Cursor.exe")) {
    cursorPath = "";
  }
  if (!cursorPath) {
    const searchPaths = [
      localApp + "\\Programs\\cursor\\Cursor.exe",
      localApp + "\\Programs\\Cursor\\Cursor.exe",
      ...programDirs.map(d => d + "\\Cursor\\Cursor.exe"),
      ...programDirs.map(d => d + "\\cursor\\Cursor.exe"),
    ];
    for (const p of searchPaths) { if (fs.existsSync(p)) { cursorPath = p; break; } }
  }
  apps.push({ id: "cursor", name: "Cursor", icon: "code", installed: !!cursorPath, path: cursorPath, running: procs.includes("Cursor"), description: "AI-powered code editor", type: "desktop" });

  // Trae
  let traePath = findFromRegistry("HKCU\\Software\\Classes\\trae\\shell\\open\\command") || 
                 findFromRegistry("HKLM\\Software\\Classes\\trae\\shell\\open\\command") ||
                 findFromRegistry("HKCU\\Software\\Classes\\Applications\\Trae.exe\\shell\\open\\command") ||
                 findFromRegistry("HKLM\\Software\\Classes\\Applications\\Trae.exe\\shell\\open\\command") ||
                 findFromUninstallRegistry("Trae");
  if (traePath && fs.existsSync(path.join(traePath, "Trae.exe"))) {
    traePath = path.join(traePath, "Trae.exe");
  } else if (traePath && !traePath.endsWith("Trae.exe") && !traePath.endsWith("trae.exe")) {
    traePath = "";
  }
  if (!traePath) {
    const searchPaths = [
      localApp + "\\Programs\\trae\\Trae.exe",
      localApp + "\\Programs\\Trae\\Trae.exe",
      localApp + "\\Programs\\trae\\trae.exe",
      localApp + "\\Programs\\Trae\\trae.exe",
      ...programDirs.map(d => d + "\\Trae\\Trae.exe"),
      ...programDirs.map(d => d + "\\trae\\trae.exe"),
    ];
    for (const p of searchPaths) { if (fs.existsSync(p)) { traePath = p; break; } }
  }
  apps.push({ id: "trae", name: "Trae", icon: "code", installed: !!traePath, path: traePath, running: procs.includes("Trae"), description: "ByteDance AI code editor", type: "desktop" });

  // VS Code
  let vscode = false; let vscodePath = "";
  try { 
    vscodePath = execSync("where code 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; 
    if (vscodePath && fs.existsSync(vscodePath)) vscode = true; 
  } catch(e) { log("debug", "VS Code not found in PATH"); }
  if (!vscode) {
    vscodePath = findFromRegistry("HKCU\\Software\\Classes\\vscode\\shell\\open\\command") || 
                 findFromRegistry("HKLM\\Software\\Classes\\vscode\\shell\\open\\command") ||
                 findFromRegistry("HKCU\\Software\\Classes\\Applications\\Code.exe\\shell\\open\\command") ||
                 findFromRegistry("HKLM\\Software\\Classes\\Applications\\Code.exe\\shell\\open\\command") ||
                 findFromUninstallRegistry("Visual Studio Code") ||
                 findFromUninstallRegistry("Microsoft Visual Studio Code");
    if (vscodePath && fs.existsSync(path.join(vscodePath, "Code.exe"))) {
      vscodePath = path.join(vscodePath, "Code.exe");
      vscode = true;
    } else if (vscodePath && vscodePath.endsWith("Code.exe")) {
      vscode = true;
    } else {
      vscodePath = "";
    }
  }
  if (!vscode) {
    const searchPaths = [
      localApp + "\\Programs\\Microsoft VS Code\\Code.exe",
      localApp + "\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe",
      ...programDirs.map(d => d + "\\Microsoft VS Code\\Code.exe"),
      ...programDirs.map(d => d + "\\Microsoft VS Code Insiders\\Code - Insiders.exe"),
    ];
    for (const p of searchPaths) { if (fs.existsSync(p)) { vscodePath = p; vscode = true; break; } }
  }
  apps.push({ id: "vscode", name: "VS Code", icon: "file-code", installed: vscode, path: vscodePath, running: procs.includes("Code"), description: "Visual Studio Code editor", type: "desktop" });

  // Antigravity
  let antigravityPath = findFromUninstallRegistry("Antigravity");
  if (antigravityPath && fs.existsSync(path.join(antigravityPath, "Antigravity.exe"))) {
    antigravityPath = path.join(antigravityPath, "Antigravity.exe");
  } else {
    antigravityPath = "";
  }
  if (!antigravityPath) {
    const searchPaths = [
      localApp + "\\Programs\\antigravity\\Antigravity.exe",
      ...programDirs.map(d => d + "\\Antigravity\\Antigravity.exe"),
      ...programDirs.map(d => d + "\\antigravity\\Antigravity.exe"),
    ];
    for (const p of searchPaths) { if (fs.existsSync(p)) { antigravityPath = p; break; } }
  }
  apps.push({ id: "antigravity", name: "Antigravity", icon: "monitor", installed: !!antigravityPath, path: antigravityPath, running: procs.includes("Antigravity"), description: "Antigravity AI assistant", type: "desktop" });

  // Cline
  let clineInstalled = false;
  let clineConfigPath = path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "claude_dev_settings.json");
  const clineDirs = [
    path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev"),
    path.join(appData, "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev"),
    path.join(appData, "Code - Insiders", "User", "globalStorage", "saoudrizwan.claude-dev")
  ];
  const clineJsonFiles = [
    path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "claude_dev_settings.json"),
    path.join(appData, "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "claude_dev_settings.json"),
    path.join(appData, "Code - Insiders", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "claude_dev_settings.json")
  ];
  for (const p of clineJsonFiles) {
    if (fs.existsSync(p)) {
      clineInstalled = true;
      clineConfigPath = p;
      break;
    }
  }
  if (!clineInstalled) {
    for (const d of clineDirs) {
      if (fs.existsSync(d)) {
        clineInstalled = true;
        clineConfigPath = path.join(d, "settings", "claude_dev_settings.json");
        break;
      }
    }
  }
  apps.push({ id: "cline", name: "Cline", icon: "code", installed: clineInstalled, path: clineConfigPath, running: false, description: "Autonomous coding agent for VS Code (Claude Dev)", type: "desktop" });

  // Roo Code
  let rooInstalled = false;
  let rooConfigPath = path.join(appData, "Code", "User", "globalStorage", "roodev.roo-cline", "settings", "roo_cline_settings.json");
  const rooDirs = [
    path.join(appData, "Code", "User", "globalStorage", "roodev.roo-cline"),
    path.join(appData, "Cursor", "User", "globalStorage", "roodev.roo-cline"),
    path.join(appData, "Code - Insiders", "User", "globalStorage", "roodev.roo-cline")
  ];
  const rooJsonFiles = [
    path.join(appData, "Code", "User", "globalStorage", "roodev.roo-cline", "settings", "roo_cline_settings.json"),
    path.join(appData, "Cursor", "User", "globalStorage", "roodev.roo-cline", "settings", "roo_cline_settings.json"),
    path.join(appData, "Code - Insiders", "User", "globalStorage", "roodev.roo-cline", "settings", "roo_cline_settings.json")
  ];
  for (const p of rooJsonFiles) {
    if (fs.existsSync(p)) {
      rooInstalled = true;
      rooConfigPath = p;
      break;
    }
  }
  if (!rooInstalled) {
    for (const d of rooDirs) {
      if (fs.existsSync(d)) {
        rooInstalled = true;
        rooConfigPath = path.join(d, "settings", "roo_cline_settings.json");
        break;
      }
    }
  }
  apps.push({ id: "roo-code", name: "Roo Code", icon: "code", installed: rooInstalled, path: rooConfigPath, running: false, description: "Autonomous AI coding assistant for VS Code (Roo Cline)", type: "desktop" });

  // Apply user custom app paths overrides from config
  const customPaths = loadConfig().appPaths || {};
  apps.forEach(app => {
    if (customPaths[app.id]) {
      const customPath = customPaths[app.id];
      if (fs.existsSync(customPath)) {
        app.installed = true;
        app.path = customPath;
        app.isCustomPath = true;
      }
    }
  });

  return apps;
}

app.post("/api/git/status", (req, res) => {
  try {
    const workspacePath = req.body.cwd || req.body.workspacePath || _BASE_DIR;
    if (!fs.existsSync(workspacePath)) {
      return res.status(400).json({ error: "Workspace directory does not exist" });
    }
    
    let statusOut = "";
    try {
      statusOut = execSync("git status --porcelain", { cwd: workspacePath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      return res.json({ branch: "—", modified: 0, untracked: 0, lastCommit: "—", modifiedFiles: [] });
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
    
    const modifiedCount = modifiedFiles.filter(f => !f.status.includes("?")).length;
    const untrackedCount = modifiedFiles.filter(f => f.status.includes("?")).length;
    
    res.json({
      branch: branchOut || "master",
      modified: modifiedCount,
      untracked: untrackedCount,
      lastCommit: lastCommit || "No commits yet",
      modifiedFiles
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/git/commit", (req, res) => {
  try {
    const { workspacePath, message } = req.body;
    const targetPath = workspacePath || _BASE_DIR;
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
    res.status(500).json({ error: e.message });
  }
});

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

app.post("/api/workspace/list", (req, res) => {
  try {
    const { workspacePath, subPath } = req.body;
    const base = workspacePath || _BASE_DIR;
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

// Cache for scanApps to avoid blocking event loop
let _appsCache: { data: AppInfo[]; time: number } | null = null;
const APPS_CACHE_TTL = 30000; // 30 seconds

function getCachedApps(): AppInfo[] {
  const now = Date.now();
  if (_appsCache && now - _appsCache.time < APPS_CACHE_TTL) return _appsCache.data;
  const data = scanApps();
  _appsCache = { data, time: now };
  return data;
}

app.get("/api/apps", (_req, res) => {
  try { res.json(getCachedApps()); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post("/api/apps/:id/launch", (req, res) => {
  const { id } = req.params;
  const { providerId } = req.body;
  const provider = getProvider(providerId || loadConfig().activeProviderId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  const proxyUrl = "http://" + HOST + ":" + PORT;
  // Inherit environment variables but override target variables pointing to proxy
  const envVars: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OPENAI_BASE_URL: proxyUrl + "/v1",
    OPENAI_API_KEY: "sk-dummy",
    ANTHROPIC_BASE_URL: proxyUrl,
    ANTHROPIC_API_KEY: "sk-dummy",
  };
  // Delete real/system API keys ending with _API_KEY to force local proxy usage
  for (const key of Object.keys(envVars)) {
    if (key.endsWith("_API_KEY") && key !== "OPENAI_API_KEY" && key !== "ANTHROPIC_API_KEY") {
      delete envVars[key];
    }
  }
  try {
    const apps = getCachedApps();
    const app = apps.find(a => a.id === id);
    if (!app) return res.status(404).json({ error: "App not found" });
    if (!app.installed) return res.status(400).json({ error: app.name + " is not installed" });

    let launchPath = app.path;
    if (app.type === "cli") {
      // Codex CLI/Desktop 需要更新 config.toml 中的代理地址
      if (id.startsWith("codex")) {
        try {
          const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
          if (fs.existsSync(codexConfigPath)) {
            let toml = fs.readFileSync(codexConfigPath, "utf-8");
            // Update [model_providers.OpenAI] base_url
            toml = toml.replace(
              /(\[model_providers\.OpenAI\][\s\S]*?base_url\s*=\s*)"[^"]*"/,
              `$1"${proxyUrl}/v1"`
            );
            // Also update top-level base_url if it points to a non-proxy URL
            if (!toml.match(/^base_url\s*=\s*"http:\/\/127\.0\.0\.1/m)) {
              toml = toml.replace(/^base_url\s*=\s*"[^"]*"/m, `base_url = "${proxyUrl}/v1"`);
            }
            fs.writeFileSync(codexConfigPath, toml, "utf-8");
            log("info", "[Launch] Updated Codex config:", codexConfigPath);
          }
        } catch (e) {
          log("error", "[Launch] Failed to update Codex config:", e);
        }
      }
      const child = spawn("cmd", ["/c", "start", "cmd", "/k",
        "set OPENAI_BASE_URL=" + proxyUrl + "/v1 && set OPENAI_API_KEY=sk-dummy && echo. && echo Orca Proxy: " + proxyUrl + "/v1 && echo Provider: " + provider.name + " && echo App: " + app.name + " && echo. && echo Type: " + app.id.replace(/-.*/, "") + " to start && echo."
      ], { detached: true, stdio: "ignore" });
      child.unref();
      res.json({ ok: true, message: app.name + " terminal opened with " + provider.name });
    } else {
      // Claude Desktop 需要通过配置文件设置代理
      if (id === "claude-desktop" || id === "claude") {
        try {
          const isMac = process.platform === "darwin";
          const claudeConfigPath = isMac 
            ? path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
            : path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
          let claudeConfig: any = {};
          try { claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf-8")); } catch { log("debug", "Claude Desktop config not found, creating new one"); }
          claudeConfig.proxy = { url: proxyUrl };
          fs.mkdirSync(path.dirname(claudeConfigPath), { recursive: true });
          fs.writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2), "utf-8");
          log("info", "[Launch] Updated Claude Desktop config:", claudeConfigPath);
        } catch (e) {
          log("error", "[Launch] Failed to update Claude Desktop config:", e);
        }
      }
      // Codex Desktop 需要更新 config.toml
      if (id.startsWith("codex")) {
        try {
          const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
          if (fs.existsSync(codexConfigPath)) {
            let toml = fs.readFileSync(codexConfigPath, "utf-8");
            toml = toml.replace(
              /(\[model_providers\.OpenAI\][\s\S]*?base_url\s*=\s*)"[^"]*"/,
              `$1"${proxyUrl}/v1"`
            );
            if (!toml.match(/^base_url\s*=\s*"http:\/\/127\.0\.0\.1/m)) {
              toml = toml.replace(/^base_url\s*=\s*"[^"]*"/m, `base_url = "${proxyUrl}/v1"`);
            }
            fs.writeFileSync(codexConfigPath, toml, "utf-8");
            log("info", "[Launch] Updated Codex config:", codexConfigPath);
          }
        } catch (e) {
          log("error", "[Launch] Failed to update Codex config:", e);
        }
      }
      // Cline / Roo Code settings update and launch VS Code fallback
      if (id === "cline" || id === "roo-code") {
        try {
          const configPath = app.path;
          let config: any = {};
          if (fs.existsSync(configPath)) {
            try { config = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch { log("debug", `Failed to parse ${app.name} config, using defaults`); }
          }
          config.apiProvider = "openai";
          config.openAiBaseUrl = proxyUrl + "/v1";
          config.openAiApiKey = "sk-dummy";
          config.openAiModelId = provider.models[0]?.id || "deepseek-chat";
          fs.mkdirSync(path.dirname(configPath), { recursive: true });
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
          log("info", `[Launch] Updated ${app.name} config:`, configPath);
        } catch (e) {
          log("error", `[Launch] Failed to update ${app.name} config:`, e);
        }

        // Override target launch path to VS Code if installed
        const vscodeApp = apps.find(a => a.id === "vscode");
        if (vscodeApp && vscodeApp.installed && vscodeApp.path) {
          launchPath = vscodeApp.path;
        }
      }

      if (launchPath && !launchPath.endsWith(".json")) {
        const child = spawn(launchPath, [], { detached: true, stdio: "ignore", env: envVars });
        child.unref();
      }
      res.json({ ok: true, message: app.name + " launched with " + provider.name });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/apps/:id/choose-path", (req, res) => {
  const { id } = req.params;
  
  const getSelectedPath = (): Promise<{ path?: string; cancelled?: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (_isElectron && process.send) {
        const requestId = Math.random().toString(36).substring(2, 15);
        pendingChooseCustomFileRequests.set(requestId, (result) => {
          resolve({ path: result.path, cancelled: result.cancelled });
        });
        
        // Auto-timeout after 5 minutes
        setTimeout(() => {
          if (pendingChooseCustomFileRequests.has(requestId)) {
            const cb = pendingChooseCustomFileRequests.get(requestId);
            if (cb) cb({ cancelled: true });
            pendingChooseCustomFileRequests.delete(requestId);
          }
        }, 5 * 60 * 1000);
        
        const filters = id === "cline" || id === "roo-code" 
          ? [{ name: "Cline/Roo Config File (settings.json)", extensions: ["json"] }]
          : [{ name: "Executable Application Files (*.exe, *.cmd, *.bat)", extensions: ["exe", "cmd", "bat"] }];

        process.send({ 
          type: "choose-custom-file", 
          requestId,
          title: "选择 " + id + " 的程序文件或配置文件 / Select App Path",
          filters
        });
      } else {
        const { exec } = require("child_process");
        const isWindows = process.platform === "win32";
        if (!isWindows) {
          return resolve({ error: "Unsupported platform. Only Windows is supported." });
        }

        const filter = id === "cline" || id === "roo-code"
          ? "Config Files (*.json)|*.json|All Files (*.*)|*.*"
          : "Executable Application Files (*.exe;*.cmd;*.bat)|*.exe;*.cmd;*.bat|All Files (*.*)|*.*";

        const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title = '选择 ${id} 的程序执行文件或配置文件 / Select App Path'; $f.Filter = '${filter}'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }`;

        exec(`powershell -NoProfile -Command "${psCommand}"`, (err: any, stdout: string, stderr: string) => {
          if (err) {
            log("error", "PowerShell choose-custom-file failed: " + err.message);
            return resolve({ error: err.message });
          }
          const filePath = stdout.trim();
          if (!filePath) {
            return resolve({ cancelled: true });
          }
          resolve({ path: filePath });
        });
      }
    });
  };

  getSelectedPath().then((result) => {
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    if (result.cancelled || !result.path) {
      return res.json({ cancelled: true });
    }

    try {
      const cfg = loadConfig();
      if (!cfg.appPaths) cfg.appPaths = {};
      cfg.appPaths[id] = result.path;
      saveConfig(cfg);
      _appsCache = null; // Clear apps cache to apply changes immediately
      
      log("info", `[Apps] Custom path set for ${id}: ${result.path}`);
      res.json({ ok: true, path: result.path });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }).catch((e) => {
    res.status(500).json({ error: String(e) });
  });
});

app.delete("/api/apps/:id/path", (req, res) => {
  const { id } = req.params;
  try {
    const cfg = loadConfig();
    if (cfg.appPaths && cfg.appPaths[id]) {
      delete cfg.appPaths[id];
      saveConfig(cfg);
    }
    _appsCache = null;
    log("info", `[Apps] Cleared custom path for ${id}`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Graceful shutdown ----

function gracefulShutdown(signal: string) {
  log("info", `Received ${signal}, shutting down gracefully...`);
  shutdownMCPServers();
  saveConfig(loadConfig());
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
