// ============================================================
// src/index.ts
// Orca Universal Proxy v2.1.0 �?Main Entry Point
// ============================================================
// Architecture:
//   src/utils/     �?base-dir, log, stats (shared utilities)
//   src/proxy/     �?stream.ts, models.ts (SSE streaming, model discovery)
//   src/agent/     �?tools.ts, compression.ts (agent tool injection, context compression)
//   src/routes/    �?chat.ts, management.ts, workspace.ts, git.ts (API routes)
//   src/services/  �?tools.ts, skills.ts, billing.ts, helpers.ts (business logic)
//   src/           �?providers.ts, anthropic.ts, transform.ts, cache.ts, mcp.ts
// ============================================================

import express from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import dns from "dns";

// EPIPE resilience
function isBrokenPipeError(err: any): boolean { return err && err.code === 'EPIPE'; }
process.stdout.on('error', (err: any) => { if (!isBrokenPipeError(err)) throw err; });
process.stderr.on('error', (err: any) => { if (!isBrokenPipeError(err)) throw err; });
const _rawLog = console.log.bind(console);
const _rawErr = console.error.bind(console);
console.log = (...args: any[]) => { try { _rawLog(...args); } catch (err) { if (!isBrokenPipeError(err)) throw err; } };
console.error = (...args: any[]) => { try { _rawErr(...args); } catch (err) { if (!isBrokenPipeError(err)) throw err; } };
dns.setDefaultResultOrder("ipv4first");

import { resolveBaseDir, getStaticDir, IS_ELECTRON } from "./utils/base-dir";
import { initLogger, log } from "./utils/log";
import { startTokenHistory, addCost, incrementRequests } from "./utils/stats";
import {
  transformRequest, createStreamState, processChunk, generateEndEvents, formatError,
  type ResponsesRequest,
} from "./transform";
import {
  transformAnthropicRequest, createAnthropicStreamState, processAnthropicChunk,
  generateAnthropicEndEvents, formatAnthropicError, type AnthropicRequest,
  createAnthropicToOpenAIState, processAnthropicToOpenAIChunk, generateAnthropicToOpenAIEndEvents,
} from "./anthropic";
import { loadConfig, saveConfig, getAllProviders, getProvider, getActiveProvider, getApiKey, resolveModel } from "./providers";
import { initMCPServers, shutdownMCPServers } from "./mcp";
import { streamSSE } from "./proxy/stream";
import { registerModelRoutes } from "./proxy/models";
import { registerChatRoute } from "./routes/chat";
import { registerManagementRoutes, setupIPCHandlers } from "./routes/management";
import { registerWorkspaceRoutes } from "./routes/workspace";
import { registerGitRoutes } from "./routes/git";
import { registerAppsRoutes } from "./routes/apps";
import { seedBillingFile, accumulateCost } from "./services/billing";
import { initSkillsDirectory } from "./services/skills";

dotenv.config({ path: process.env.ORCA_BASE_DIR ? path.join(process.env.ORCA_BASE_DIR, '.env') : undefined });

// ---- Base directories ----
const _BASE_DIR = resolveBaseDir(__dirname, 2);
const _STATIC_DIR = getStaticDir(_BASE_DIR, __dirname);

// ---- Initialize logger ----
initLogger({
  baseDir: _BASE_DIR,
  logLevel: (() => { try { return loadConfig().logLevel; } catch { return "info"; } })()
});

// ---- Stats ----
startTokenHistory();

// ---- Config ----
let cfg: ReturnType<typeof loadConfig>;
try { cfg = loadConfig(); } catch { cfg = { port: 3000, activeProviderId: "deepseek", providerKeys: {}, logLevel: "info" } as any; }
const PORT = cfg.port;
const HOST = "127.0.0.1";

// ---- Express App ----
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

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || req.socket.remoteAddress || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
  message: { error: { message: "Too many requests", type: "rate_limit_error" } },
});
app.use("/v1/", apiLimiter);

// Request logging
app.use((req, _res, next) => {
  if (req.url.startsWith("/v1/") || req.url.startsWith("/api/")) {
    log("info", `${req.method} ${req.url} from ${req.ip}`);
  }
  next();
});

// Local token auth
app.use((req, res, next) => {
  if (!process.env.LOCAL_AUTH_TOKEN) return next();
  if (req.url.startsWith("/api/")) {
    if (req.method === "OPTIONS") return next();
    if (req.url === "/health") return next();
    const token = req.headers["x-local-token"] || req.query.token;
    if (token !== process.env.LOCAL_AUTH_TOKEN) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing local token" });
    }
  }
  next();
});

// ---- Register all route modules ----
registerManagementRoutes(app);
registerModelRoutes(app);
registerChatRoute(app);
registerWorkspaceRoutes(app);
registerGitRoutes(app);
registerAppsRoutes(app);
setupIPCHandlers();

// ---- /v1/responses (Codex CLI) ----
app.post("/v1/responses", async (req, res) => {
  incrementRequests("codex");
  const body = req.body as ResponsesRequest;
  const resolved = (() => { try { return loadConfig(); } catch { return null; } })();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  try {
    const resolvedModel = resolveModel(body.model);
    const active = resolvedModel.provider;
    const apiKey = resolvedModel.apiKey;
    const chatReq = transformRequest(body, resolvedModel.model);
    const targetUrl = active.baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";
    
    res.setHeader("x-orca-provider", active.id);
    res.setHeader("x-orca-model", resolvedModel.model);
    log("info", `[Codex Proxy] Request model "${body.model}" resolved to provider "${active.id}" model "${resolvedModel.model}"`);

    const upstreamResp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(chatReq),
    });
    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      res.write(formatError(upstreamResp.status, errText));
      return res.end();
    }
    if (!upstreamResp.body) { res.write(formatError(502, "Empty response")); return res.end(); }
    const state = createStreamState(resolvedModel.model);
    await streamSSE(upstreamResp, req, res, processChunk, generateEndEvents, () => state, state, formatError, (s) => {
      if (s && s.usage) {
        accumulateCost(resolvedModel.model, s.usage.input_tokens, s.usage.output_tokens, s.usage.input_tokens_details?.cached_tokens || 0);
      }
    });
  } catch (err) {
    log("error", "[Codex] Failed:", err);
    if (!res.headersSent) res.status(500).json({ type: "error", error: { type: "api_error", message: String(err) } });
    else if (!res.writableEnded) { res.write(formatError(500, String(err))); res.end(); }
  }
});

// ---- /v1/messages (Claude Desktop) ----
app.post("/v1/messages", async (req, res) => {
  incrementRequests("claude");
  const body = req.body as AnthropicRequest;
  const resolved = (() => {
    const model = body.model;
    if (!model) throw new Error("model is required");
    const resolvedModel = resolveModel(model);
    if (!resolvedModel.apiKey) {
      throw new Error(`No API key configured for provider: ${resolvedModel.provider.id}`);
    }
    return resolvedModel;
  })();

  res.setHeader("x-orca-provider", resolved.provider.id);
  res.setHeader("x-orca-model", resolved.model);
  log("info", `[Claude Proxy] Request model "${body.model}" resolved to provider "${resolved.provider.id}" model "${resolved.model}"`);

  try {
    if (resolved.provider.id === "anthropic") {
      const targetUrl = resolved.provider.baseUrl + "/v1/messages";
      const upstreamResp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
      });
      if (!upstreamResp.ok) {
        const errText = await upstreamResp.text();
        res.write(formatAnthropicError(upstreamResp.status, errText));
        return res.end();
      }
      if (!upstreamResp.body) { res.write(formatAnthropicError(502, "Empty response")); return res.end(); }
      const reader = (upstreamResp.body as any).getReader();
      const decoder = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break; res.write(decoder.decode(value, { stream: true })); }
      res.end();
    } else {
      const chatReq = transformAnthropicRequest({ ...body, model: resolved.model });
      const targetUrl = resolved.provider.baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";
      const upstreamResp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` },
        body: JSON.stringify(chatReq),
      });
      if (!upstreamResp.ok) {
        const errText = await upstreamResp.text();
        res.write(formatAnthropicError(upstreamResp.status, `${resolved.provider.name} error: ${errText}`));
        return res.end();
      }
      if (!upstreamResp.body) { res.write(formatAnthropicError(502, "Empty response")); return res.end(); }
      const anthropicState = createAnthropicStreamState(resolved.model);
      await streamSSE(upstreamResp, req, res,
        (_state: any, chunk: any) => processAnthropicChunk(anthropicState, chunk),
        (_state: any) => generateAnthropicEndEvents(anthropicState),
        () => null as any, anthropicState, formatAnthropicError, (s) => {
          if (s && s.usage) {
            accumulateCost(resolved.model, s.usage.input_tokens, s.usage.output_tokens, 0);
          }
        });
    }
  } catch (err) {
    log("error", `[Claude] Failed:`, err);
    if (!res.headersSent) res.status(500).json({ type: "error", error: { type: "api_error", message: String(err) } });
    else if (!res.writableEnded) { res.write(formatAnthropicError(500, String(err))); res.end(); }
  }
});

// ---- Fallback pass-through for everything else under /v1/ ----
app.all("/v1/*", async (req, res) => {
  incrementRequests("chat");
  req.socket.setTimeout(0);
  let provider = getActiveProvider();
  let apiKey = getApiKey(provider.id);
  let targetModel = "";

  if (req.body && typeof req.body.model === "string") {
    try {
      const resolved = resolveModel(req.body.model);
      provider = resolved.provider;
      apiKey = resolved.apiKey;
      targetModel = resolved.model;
      req.body.model = targetModel;
    } catch (e) {
      log("error", "[Pass-through] Failed to resolve model:", e);
    }
  }

  const targetUrl = provider.baseUrl.replace(/\/+$/, "") + req.url;
  res.setHeader("x-orca-provider", provider.id);
  if (targetModel) {
    res.setHeader("x-orca-model", targetModel);
  }
  log("info", `[Pass-through] ${req.method} ${req.url} -> ${targetUrl} (Provider: ${provider.id}, Model: ${targetModel || 'unknown'})`);
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
      try {
        const json = JSON.parse(text);
        if (json.usage && targetModel) {
          accumulateCost(targetModel, json.usage.prompt_tokens, json.usage.completion_tokens, json.usage.prompt_tokens_details?.cached_tokens || 0);
        }
      } catch (e) {}
      res.status(resp.status).setHeader("Content-Type", resp.headers.get("content-type") || "application/json").send(text);
    }
  } catch (err) {
    log("error", "[Pass-through] Error:", err);
    res.status(502).json({ error: { message: String(err), type: "proxy_error" } });
  }
});

// ---- Serve frontend ----
app.get("/", (_req, res) => { res.sendFile(path.join(_STATIC_DIR, "index.html")); });

// ---- Start server ----
const server = app.listen(PORT, HOST, () => {
  seedBillingFile();
  initSkillsDirectory();
  const active = getActiveProvider();
  log("info", "===========================================");
  log("info", "  Orca Universal Proxy v2.1.0");
  log("info", `  Listening on http://${HOST}:${PORT}`);
  log("info", `  Active provider: ${active.name} (${active.baseUrl})`);
  log("info", `  Log level: ${cfg.logLevel || "info"}`);
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

  if (cfg.mcpServers && Object.keys(cfg.mcpServers).length > 0) {
    initMCPServers(cfg.mcpServers).catch((e: any) => log("error", "Failed to initialize MCP servers:", e));
  }
});

// Configure server timeouts for long agent runs
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 600000;
server.requestTimeout = 0;

// ---- Graceful shutdown ----
function gracefulShutdown(signal: string) {
  log("info", `Received ${signal}, shutting down gracefully...`);
  shutdownMCPServers();
  saveConfig(loadConfig());
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
