// ============================================================
// src/proxy/models.ts
// /v1/models, /api/discover-models, /api/discover-all routes
// ============================================================

import express from "express";
import { loadConfig, saveConfig, getAllProviders, getProvider, getApiKey } from "../providers";
import { log } from "../utils/log";
import { buildProbeUrl } from "../services/health";
import { isBlockedTarget, fetchWithSsrfCheck } from "../utils/ssrf";

export function registerModelRoutes(app: express.Application): void {

  // ---- 自动发现供应商的可用模型列表 ----
  app.get("/api/discover-models/:providerId", async (req, res) => {
    const provider = getProvider(req.params.providerId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const apiKey = getApiKey(provider.id);
    try {
      const targetUrl = buildProbeUrl(provider.baseUrl, "/models");
      if (isBlockedTarget(targetUrl)) {
        return res.status(400).json({ error: `Blocked target URL: ${targetUrl}` });
      }
      const headers: Record<string, string> = {};
      if (provider.id === "anthropic") {
        if (apiKey) {
          headers["x-api-key"] = apiKey;
          headers["anthropic-version"] = "2023-06-01";
        }
      } else {
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const resp = await fetchWithSsrfCheck(targetUrl, { headers });
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
        for (const val of Object.values(data)) {
          if (Array.isArray(val)) { rawModels = val; break; }
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
        const targetUrl = buildProbeUrl(provider.baseUrl, "/models");
        if (isBlockedTarget(targetUrl)) {
          results.push({ provider: provider.id, models: [], error: "Blocked target URL" });
          send("result", { provider: provider.id, models: [], error: "Blocked target URL" });
          continue;
        }
        const headers: Record<string, string> = {};
        if (provider.id === "anthropic") { if (apiKey) { headers["x-api-key"] = apiKey; headers["anthropic-version"] = "2023-06-01"; } }
        else { if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`; }
        const resp = await fetchWithSsrfCheck(targetUrl, { headers, signal: AbortSignal.timeout(15000) });
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
    for (const entry of providerModels) {
      const pcfg = (current.customProviders || []).find((p: any) => p.id === entry.provider);
      if (pcfg && Array.isArray(entry.models)) {
        pcfg.models = entry.models.map((m: any) => (typeof m === "string" ? { id: m, name: m } : { id: m.id || m, name: m.name || m.id || m }));
        updated++;
      }
    }
    saveConfig(current); res.json({ ok: true, updated });
  });

  app.get("/v1/models", (_req, res) => {
    const providers = getAllProviders();
    const models = providers.flatMap((p) => p.models.map((m) => ({
      id: m.id, object: "model", created: Math.floor(Date.now() / 1000), owned_by: p.id, provider_name: p.name,
    })));
    res.json({ object: "list", data: models });
  });
}
