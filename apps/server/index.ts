// ============================================================
// apps/server/index.ts
// Orca Universal Proxy v2.1.1 — Main Entry Point
// ============================================================
// Architecture:
//   apps/server/utils/      base-dir, log, stats (shared utilities)
//   apps/server/proxy/      stream.ts, models.ts (SSE streaming, model discovery)
//   apps/server/agent/      tools.ts, compression.ts (agent tool injection, context compression)
//   apps/server/routes/     chat.ts, management.ts, workspace.ts, git.ts (API routes)
//   apps/server/services/   tools.ts, skills.ts, billing.ts, helpers.ts (business logic)
//   apps/server/            providers.ts, anthropic.ts, transform.ts, cache.ts, mcp.ts
// ============================================================

import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import dns from "dns";

// EPIPE resilience
import { isBrokenPipeError } from "./utils/helpers";
process.stdout.on('error', (err: unknown) => { if (!isBrokenPipeError(err)) throw err; });
process.stderr.on('error', (err: unknown) => { if (!isBrokenPipeError(err)) throw err; });
const _rawLog = console.log.bind(console);
const _rawErr = console.error.bind(console);
console.log = (...args: unknown[]) => { try { _rawLog(...args); } catch (err) { if (!isBrokenPipeError(err)) throw err; } };
console.error = (...args: unknown[]) => { try { _rawErr(...args); } catch (err) { if (!isBrokenPipeError(err)) throw err; } };
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
import { loadConfig, saveConfig, getAllProviders, getProvider, getActiveProvider, getApiKey, resolveModel, type Profile } from "./providers";
import { resolveHealthyModel, buildProbeUrl } from "./services/health";
import { setServerPort } from "./services/task-resume";
import { initMCPServers, shutdownMCPServers } from "./mcp";
import { streamSSE } from "./proxy/stream";
import { registerModelRoutes } from "./proxy/models";
import { registerChatRoute } from "./routes/chat";
import { registerManagementRoutes, setupIPCHandlers } from "./routes/management";
import { registerWorkspaceRoutes } from "./routes/workspace";
import { registerGitRoutes } from "./routes/git";
import { registerAppsRoutes } from "./routes/apps";
import { registerExtendedRoutes } from "./routes/extended";
import { seedBillingFile, accumulateCost } from "./services/billing";
import { initSkillsDirectory } from "./services/skills";
import { clearStaleClaims } from "./agent/claims";
import { scanForInterruptedTasks } from "./services/recovery";
import { validateRequest } from "./utils/validate";
import crypto from "crypto";
import { isBlockedTarget } from "./utils/ssrf";

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
export const PORT = process.env.ORCA_PORT ? parseInt(process.env.ORCA_PORT, 10) : cfg.port;
setServerPort(PORT);
const HOST = "127.0.0.1";

// ---- Local auth token ----
// Security default: if LOCAL_AUTH_TOKEN is not set we generate a persistent
// random token (stored in data/.token) so /api/* and agent mode are NEVER
// open by default, while the CLI/browser can keep using the same token across
// restarts. Electron mode always sets LOCAL_AUTH_TOKEN from main.js.
const LOCAL_AUTH_TOKEN = process.env.LOCAL_AUTH_TOKEN || (() => {
  try {
    const tokenFile = path.join(_BASE_DIR, "data", ".token");
    const existing = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf-8").trim() : "";
    if (existing) return existing;
    const token = crypto.randomBytes(24).toString("hex");
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile, token, "utf-8");
    return token;
  } catch {
    return crypto.randomBytes(24).toString("hex");
  }
})();
if (!process.env.LOCAL_AUTH_TOKEN) {
  log("warn", `[auth] LOCAL_AUTH_TOKEN 未设置：已自动生成令牌并保存到 data/.token（重启后保持不变）。`);
  log("warn", `[auth] 浏览器访问 http://${HOST}:${PORT}/?token=${LOCAL_AUTH_TOKEN} 完成登录；或设置 LOCAL_AUTH_TOKEN 环境变量固定令牌。`);
}

// ---- Express App ----
const app = express();
app.use(express.json({ limit: "10mb" }));

// Minimal cookie parser (no external dependency)
app.use((req, _res, next) => {
  const header = req.headers.cookie || "";
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      let val = pair.slice(idx + 1).trim();
      try { val = decodeURIComponent(val); } catch { /* keep raw value on malformed URI */ }
      if (key) cookies[key] = val;
    }
  }
  (req as any).cookies = cookies;
  next();
});
// CORS: only echo back localhost / same-origin requests. We deliberately do
// NOT reflect the caller's origin 鈥?reflecting an arbitrary origin together
// with `Access-Control-Allow-Credentials: true` would let any malicious
// website read responses cross-origin and abuse the user's LLM API keys.
const _ALLOWED_ORIGINS = new Set<string>([
  `http://${HOST}:${PORT}`,
  `http://localhost:${PORT}`,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && _ALLOWED_ORIGINS.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  } else {
    // Unknown / no origin: do NOT echo the origin and do NOT set
    // Access-Control-Allow-Origin: null (that would re-enable cross-origin
    // reads with credentials for arbitrary websites).
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-local-token, anthropic-version");
  if (req.method === "OPTIONS") return res.sendStatus(204);
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
// Security: token is set as HttpOnly cookie on initial page load (GET / with ?token=xxx),
// then all subsequent requests authenticate via cookie 鈥?never via URL query string.
app.use((req, res, next) => {
  // On initial page load, transfer a VALID query-string token to HttpOnly cookie
  if (req.method === "GET" && req.url.startsWith("/") && !req.url.startsWith("/api/") && req.query.token) {
    if (req.query.token === LOCAL_AUTH_TOKEN) {
      res.cookie("orca_token", req.query.token, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }
  }

  const cookieToken = req.cookies?.orca_token;
  const headerToken = req.headers["x-local-token"];
  const authHeader = req.headers.authorization;
  const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;
  const token = headerToken || cookieToken || bearerToken;
  const isAuthed = token === LOCAL_AUTH_TOKEN;

  if (req.url.startsWith("/api/")) {
    if (req.method === "OPTIONS") return next();
    if (req.url === "/health") return next();
    if (!isAuthed) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing local token" });
    }
  }

  // Agent endpoints expose local command execution, so even though they live
  // under /v1/* (which external CLIs use without a token), require the local
  // token whenever a request triggers agent mode.
  if (req.method === "POST" && req.url.startsWith("/v1/chat/completions")) {
    const body = (req as any).body || {};
    const agentMode = body.useAgent !== undefined || typeof body.workspacePath === "string";
    if (agentMode && !isAuthed) {
      return res.status(401).json({ error: "Unauthorized: Agent execution requires a local token" });
    }
  }
  next();
});

// Request body validation (before route handlers)
app.use((req, res, next) => {
  if (req.method === "POST" && (req.url.startsWith("/v1/") || req.url === "/api/config" || req.url.startsWith("/api/profiles"))) {
    if (!validateRequest(req.method, req.url, req.body, res as any)) return;
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
registerExtendedRoutes(app);
setupIPCHandlers();

function attachClientAbort(req: Request, res: Response, controller: AbortController, label: string) {
  const onClose = () => {
    if (!res.writableEnded) {
      log("info", `[${label}] Client disconnected, aborting upstream request`);
      controller.abort();
    }
  };
  req.on("close", onClose);
  res.on("close", onClose);
}

// ---- /v1/responses (Codex CLI) ----
app.post("/v1/responses", async (req, res) => {
  incrementRequests("codex");
  const body = req.body as ResponsesRequest;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  try {
    const resolvedModel = await resolveHealthyModel(body.model, resolveModel);
    const active = resolvedModel.provider;
    const apiKey = resolvedModel.apiKey;
    const chatReq = transformRequest(body, resolvedModel.model);
    const targetUrl = buildProbeUrl(active.baseUrl, "/chat/completions");
    if (isBlockedTarget(targetUrl)) {
      log("warn", `[SSRF] Blocked outbound request to ${targetUrl}`);
      return res.status(400).json({ error: { message: "Blocked target URL", type: "proxy_error" } });
    }
    
    res.setHeader("x-orca-provider", active.id);
    res.setHeader("x-orca-model", resolvedModel.model);
    log("info", `[Codex Proxy] Request model "${body.model}" resolved to provider "${active.id}" model "${resolvedModel.model}"`);

    const abortController = new AbortController();
    attachClientAbort(req, res, abortController, "Codex");
    const upstreamResp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(chatReq),
      signal: abortController.signal,
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
  } catch (err: any) {
    if (err?.name === "AbortError" && res.writableEnded) {
      log("info", "[Codex] Upstream aborted after client disconnect");
      return;
    }
    log("error", "[Codex] Failed:", err);
    if (!res.headersSent) res.status(500).json({ type: "error", error: { type: "api_error", message: String(err) } });
    else if (!res.writableEnded) { res.write(formatError(500, String(err))); res.end(); }
  }
});

// ---- /v1/messages (Claude Desktop) ----
app.post("/v1/messages", async (req, res) => {
  incrementRequests("claude");
  const body = req.body as AnthropicRequest;
  const model = body.model;
  if (!model) {
    return res.status(400).json({ type: "error", error: { type: "invalid_request_error", message: "model is required" } });
  }
  let resolved: Awaited<ReturnType<typeof resolveHealthyModel>>;
  try {
    resolved = await resolveHealthyModel(model, resolveModel);
    if (!resolved.apiKey) {
      throw new Error(`No API key configured for provider: ${resolved.provider.id}`);
    }
  } catch (err: any) {
    log("error", "[Claude] Failed to resolve model:", err);
    return res.status(500).json({ type: "error", error: { type: "api_error", message: String(err) } });
  }

  res.setHeader("x-orca-provider", resolved.provider.id);
  res.setHeader("x-orca-model", resolved.model);
  log("info", `[Claude Proxy] Request model "${body.model}" resolved to provider "${resolved.provider.id}" model "${resolved.model}"`);

  try {
    if (resolved.provider.id === "anthropic") {
      const targetUrl = buildProbeUrl(resolved.provider.baseUrl, "/messages");
      if (isBlockedTarget(targetUrl)) {
        log("warn", `[SSRF] Blocked outbound request to ${targetUrl}`);
        return res.status(400).json({ type: "error", error: { type: "api_error", message: "Blocked target URL" } });
      }
      const abortController = new AbortController();
      attachClientAbort(req, res, abortController, "Claude");
      const upstreamResp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      if (!upstreamResp.ok) {
        const errText = await upstreamResp.text();
        res.write(formatAnthropicError(upstreamResp.status, errText));
        return res.end();
      }
      if (!upstreamResp.body) { res.write(formatAnthropicError(502, "Empty response")); return res.end(); }
      if (body.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        const reader = (upstreamResp.body as any).getReader();
        const decoder = new TextDecoder();
        let clientDisconnected = false;
        req.on("close", () => { clientDisconnected = true; });
        try {
          while (true) {
            if (clientDisconnected) break;
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.writableEnded) res.write(decoder.decode(value, { stream: true }));
          }
        } catch (e) { log("warn", "[Claude Anthropic SSE] Stream error:", e); }
        if (!res.writableEnded) res.end();
      } else {
        const data = await upstreamResp.json() as any;
        if (data?.usage) {
          accumulateCost(resolved.model, data.usage.input_tokens || 0, data.usage.output_tokens || 0, 0);
        }
        res.setHeader("Content-Type", "application/json");
        res.json(data);
      }
    } else {
      const chatReq = transformAnthropicRequest({ ...body, model: resolved.model });
      const targetUrl = buildProbeUrl(resolved.provider.baseUrl, "/chat/completions");
      if (isBlockedTarget(targetUrl)) {
        log("warn", `[SSRF] Blocked outbound request to ${targetUrl}`);
        return res.status(400).json({ type: "error", error: { type: "api_error", message: "Blocked target URL" } });
      }
      const abortController = new AbortController();
      attachClientAbort(req, res, abortController, "Claude");
      const upstreamResp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` },
        body: JSON.stringify(chatReq),
        signal: abortController.signal,
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
  } catch (err: any) {
    if (err?.name === "AbortError" && res.writableEnded) {
      log("info", "[Claude] Upstream aborted after client disconnect");
      return;
    }
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
      const resolved = await resolveHealthyModel(req.body.model, resolveModel);
      provider = resolved.provider;
      apiKey = resolved.apiKey;
      targetModel = resolved.model;
      req.body.model = targetModel;
    } catch (e) {
      log("error", "[Pass-through] Failed to resolve model:", e);
    }
  }

  // Pass-through: req.url starts with /v1/...; if the provider's baseUrl
  // already ends with /v1, we must NOT re-append /v1 鈥?strip it from req.url
  // so the final URL is correct (e.g. LongCat: https://api.longcat.chat/openai/v1/chat/completions).
  const trimmedBase = provider.baseUrl.replace(/\/+$/, "");
  let pathSuffix = req.url;
  if (/\/v\d+$/i.test(trimmedBase)) {
    // baseUrl already includes the version, strip leading /v1 from the request path.
    pathSuffix = req.url.replace(/^\/v\d+(?=\/|$)/i, "");
  }
  const targetUrl = trimmedBase + pathSuffix;
  if (isBlockedTarget(targetUrl)) {
    log("warn", `[SSRF] Blocked pass-through request to ${targetUrl}`);
    return res.status(400).json({ error: { message: "Blocked target URL", type: "proxy_error" } });
  }
  res.setHeader("x-orca-provider", provider.id);
  if (targetModel) {
    res.setHeader("x-orca-model", targetModel);
  }
  log("info", `[Pass-through] ${req.method} ${req.url} -> ${targetUrl} (Provider: ${provider.id}, Model: ${targetModel || 'unknown'})`);
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"] as string;
    const abortController = new AbortController();
    attachClientAbort(req, res, abortController, "Pass-through");
    const resp = await fetch(targetUrl, {
      method: req.method, headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
      signal: abortController.signal,
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
  } catch (err: any) {
    if (err?.name === "AbortError") {
      log("info", "[Pass-through] Upstream aborted after client disconnect");
      if (!res.writableEnded) res.end();
      return;
    }
    log("error", "[Pass-through] Error:", err);
    if (!res.headersSent) {
      res.status(502).json({ error: { message: String(err), type: "proxy_error" } });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// ---- Serve frontend ----
app.get("/", (_req, res) => { res.sendFile(path.join(_STATIC_DIR, "index.html")); });

// ---- Start server ----
const server = app.listen(PORT, HOST, () => {
  seedBillingFile();
  initSkillsDirectory();
  clearStaleClaims();
  const recovered = scanForInterruptedTasks();
  if (recovered.length > 0) {
    log("info", `[Recovery] Found ${recovered.length} interrupted task(s) from a previous session — recoverable via the UI.`);
  }
  const active = getActiveProvider();
  log("info", "===========================================");
  log("info", "  Orca Universal Proxy v2.1.1");
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

// ---- Agent Event Stream (SSE for real-time task progress) ----
const agentEventClients = new Set<express.Response>();

app.get("/api/agent/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  agentEventClients.add(res);
  res.write(`event: connected\ndata: {"timestamp":${Date.now()}}\n\n`);

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(": keep-alive\n\n");
  }, 20000);

  req.on("close", () => {
    clearInterval(keepAlive);
    agentEventClients.delete(res);
  });
});

// Export function for broadcasting agent events
(global as any).__orca_broadcastAgentEvent = (event: any) => {
  const data = `event: agent_event\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of agentEventClients) {
    if (!client.writableEnded) client.write(data);
  }
};

// Configure server timeouts for long agent runs
// 闀夸换鍔℃敮鎸侊細绂佺敤鎵€鏈夐粯璁よ秴鏃讹紝璁?agent 鍙互鏃犱腑鏂湴璺戞暟灏忔椂
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;          // 涔嬪墠 600000 (10min) 鏄彟涓€涓?鑾悕涓柇"鏉ユ簮
server.requestTimeout = 0;          // 0 = 绂佺敤璇锋眰瓒呮椂
server.maxHeadersCount = 0;         // 0 = 鏃犻檺鍒讹紙闃叉 chunked SSE 琚埅鏂級
server.maxRequestsPerSocket = 0;    // 0 = 鏃犻檺鍒讹紙keep-alive 鎸佺画澶嶇敤锛?

// ---- Graceful shutdown ----
function gracefulShutdown(signal: string) {
  log("info", `Received ${signal}, shutting down gracefully...`);
  shutdownMCPServers();
  saveConfig(cfg);
  try {
    const { flush } = require("./services/audit");
    flush();
  } catch { /* ignore */ }
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));


