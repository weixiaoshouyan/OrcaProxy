// ============================================================
// src/routes/extended.ts
// Feature routes wired to the UI pages that previously 404'd:
//   profiles, skills, code-index/code-search, tasks, eval,
//   mcp/tools, test-provider, delete custom-provider
// ============================================================

import express from "express";
import fs from "fs";
import path from "path";
import { loadConfig, saveConfig, getProvider, getAllProviders, getApiKey, applyProfileEnv } from "../providers";
import { getAllMCPTools } from "../mcp";
import { log } from "../utils/log";
import { SKILLS_DIR, parseFrontmatter, resolveSafeSkillPath } from "../services/skills";
import { buildIndex, saveIndex, ensureIndex, searchIndex } from "../services/code-index";
import { loadTaskState, deleteTaskState, listTaskStates, listArchivedTaskStates, restoreTaskState, hardDeleteTaskState, saveTaskState } from "../agent/task-state";
import { getPendingAsk, answerPendingAsk } from "../services/tools";
import { resumeTaskInBackground } from "../services/task-resume";
import { loadDataset, loadResults, appendResult, evaluateTask, ensureSampleDataset } from "../agent/eval";
import { listCheckpoints, planRewind, executeRewind, deleteCheckpointsForConversation } from "../services/checkpoints";
import { listRecoverableTasks, clearRecoveryFlag } from "../services/recovery";
import { checkProviderHealth } from "../services/health";
import { checkEmbeddingHealth } from "../services/embeddings";
import { pendingChooseSkillRequests, maskConfigForClient } from "./management";

// ---------- Skills helpers ----------

function listSkills(): { id: string; name: string; description: string }[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const out: { id: string; name: string; description: string }[] = [];
  for (const entry of fs.readdirSync(SKILLS_DIR)) {
    const dirPath = path.join(SKILLS_DIR, entry);
    let stat: fs.Stats;
    try { stat = fs.statSync(dirPath); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let name = entry;
    let description = "";
    const md = path.join(dirPath, "SKILL.md");
    if (fs.existsSync(md)) {
      try {
        const fm = parseFrontmatter(fs.readFileSync(md, "utf-8"));
        name = fm.name || entry;
        description = fm.description || "";
      } catch { /* ignore malformed skill */ }
    }
    out.push({ id: entry, name, description });
  }
  return out;
}

function importSkillFile(filePath: string): string {
  if (!fs.existsSync(filePath)) throw new Error("Selected file not found");
  const text = fs.readFileSync(filePath, "utf-8");
  let fm: { name?: string; id?: string };
  try { fm = parseFrontmatter(text); } catch { fm = {}; }
  const baseName = path.basename(filePath, path.extname(filePath));
  let id = (fm.id || fm.name || baseName)
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";
  let target = path.join(SKILLS_DIR, id);
  if (fs.existsSync(target)) {
    id = `${id}-${Date.now() % 100000}`;
    target = path.join(SKILLS_DIR, id);
  }
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "SKILL.md"), text, "utf-8");
  return id;
}

export function registerExtendedRoutes(app: express.Application): void {
  // ============================================================
  // Profiles
  // ============================================================
  app.get("/api/profiles", (_req, res) => {
    const cfg = loadConfig();
    const masked = maskConfigForClient(cfg);
    res.json({ profiles: masked.profiles || {}, activeProfileId: masked.activeProfileId });
  });

  app.post("/api/profiles", (req, res) => {
    try {
      const p = req.body || {};
      if (!p.id || !p.name || !p.providerId) {
        return res.status(400).json({ error: "id, name and providerId are required" });
      }
      const cfg = loadConfig();
      if (!cfg.profiles) cfg.profiles = {};
      cfg.profiles[p.id] = { ...p };
      saveConfig(cfg);
      res.json({ profile: cfg.profiles[p.id] });
    } catch (e: any) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post("/api/profiles/:id/activate", (req, res) => {
    const cfg = loadConfig();
    const prof = (cfg.profiles || {})[req.params.id];
    if (!prof) return res.status(404).json({ error: "Profile not found" });
    cfg.activeProfileId = req.params.id;
    saveConfig(cfg);
    applyProfileEnv(prof);
    res.json({ ok: true, activeProfileId: req.params.id });
  });

  app.delete("/api/profiles/:id", (req, res) => {
    const cfg = loadConfig();
    if (cfg.profiles && cfg.profiles[req.params.id]) {
      delete cfg.profiles[req.params.id];
    }
    if (cfg.activeProfileId === req.params.id) cfg.activeProfileId = undefined;
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // ============================================================
  // Skills
  // ============================================================
  app.get("/api/skills", (_req, res) => {
    res.json(listSkills());
  });

  app.get("/api/skills/:id", (req, res) => {
    try {
      const skillPath = resolveSafeSkillPath(req.params.id);
      if (!fs.existsSync(skillPath)) return res.status(404).json({ error: "Skill not found" });
      const md = path.join(skillPath, "SKILL.md");
      let name = req.params.id;
      let description = "";
      let instructions = "";
      if (fs.existsSync(md)) {
        const fm = parseFrontmatter(fs.readFileSync(md, "utf-8"));
        name = fm.name || req.params.id;
        description = fm.description || "";
        instructions = fm.body || "";
      }
      const scriptsDir = path.join(skillPath, "scripts");
      let scripts: string[] = [];
      if (fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory()) {
        scripts = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".py") || f.endsWith(".js") || f.endsWith(".ps1") || f.endsWith(".sh"));
      }
      let references: string[] = [];
      try {
        references = fs.readdirSync(skillPath).filter((f) => f.endsWith(".md") && f !== "SKILL.md");
      } catch { /* ignore */ }
      res.json({ id: req.params.id, name, description, instructions, scripts, references });
    } catch (e: any) {
      res.status(400).json({ error: "Internal server error" });
    }
  });

  app.put("/api/skills/:id", (req, res) => {
    try {
      const skillPath = resolveSafeSkillPath(req.params.id);
      if (!fs.existsSync(skillPath)) return res.status(404).json({ error: "Skill not found" });
      const { name, description, instructions } = req.body || {};
      if (typeof instructions !== "string") {
        return res.status(400).json({ error: "instructions is required" });
      }
      const safeName = typeof name === "string" && name.trim() ? name.trim() : req.params.id;
      const safeDesc = typeof description === "string" ? description : "";
      const md = path.join(skillPath, "SKILL.md");
      const header = [
        "---",
        `name: ${JSON.stringify(safeName)}`,
        `description: ${JSON.stringify(safeDesc)}`,
        "---",
      ].join("\n");
      fs.writeFileSync(md, `${header}\n\n${instructions}\n`, "utf-8");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/skills/:id", (req, res) => {
    try {
      const skillPath = resolveSafeSkillPath(req.params.id);
      if (!fs.existsSync(skillPath)) return res.status(404).json({ error: "Skill not found" });
      fs.rmSync(skillPath, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: "Internal server error" });
    }
  });

  app.post("/api/skills/import", (req, res) => {
    const finishImport = (filePath: string) => {
      try {
        const id = importSkillFile(filePath);
        res.json({ ok: true, id });
      } catch (e: any) {
        res.status(400).json({ error: "Internal server error" });
      }
    };

    if (process.send) {
      // Electron: open a file picker, then import the selected SKILL.md / README.md
      const requestId = Math.random().toString(36).substring(2, 15);
      pendingChooseSkillRequests.set(requestId, (result) => {
        if (result.cancelled) res.json({ cancelled: true });
        else if (result.path) finishImport(result.path);
        else res.status(500).json({ error: "No file selected" });
      });
      setTimeout(() => {
        if (pendingChooseSkillRequests.has(requestId)) {
          const cb = pendingChooseSkillRequests.get(requestId);
          if (cb) cb({ cancelled: true });
          pendingChooseSkillRequests.delete(requestId);
        }
      }, 5 * 60 * 1000);
      process.send({ type: "choose-file", requestId, filters: [{ name: "Skill Markdown Files (*.md)", extensions: ["md"] }] });
    } else {
      res.json({ cancelled: true, note: "Skill import requires the Electron shell" });
    }
  });

  // ============================================================
  // Code index & search
  // ============================================================
  app.post("/api/code-index", async (req, res) => {
    try {
      const { workspacePath } = req.body || {};
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return res.status(400).json({ error: "Invalid workspace path" });
      }
      const idx = await buildIndex(workspacePath);
      saveIndex(idx);
      res.json({ ok: true, chunks: idx.chunks.length, updatedAt: idx.updatedAt });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/code-search", async (req, res) => {
    try {
      const { workspacePath, query, limit = 10, strategy = "hybrid" } = req.body || {};
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return res.status(400).json({ error: "Invalid workspace path" });
      }
      if (!query) return res.status(400).json({ error: "query is required" });
      const idx = await ensureIndex(workspacePath);
      const results = await searchIndex(idx, query, limit, strategy);
      res.json({ results: results.map((r) => ({ ...r.chunk, score: r.score })) });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================================
  // Checkpoints / Rewind
  // ============================================================
  app.get("/api/checkpoints", (req, res) => {
    const taskId = (req.query.taskId as string) || "";
    if (!taskId) return res.status(400).json({ error: "taskId is required" });
    const cps = listCheckpoints(taskId).map((c) => ({
      turn: c.turn,
      createdAt: c.createdAt,
      prompt: c.prompt,
      messageCount: c.messageCount,
      fileCount: c.files.length,
      files: c.files.map((f) => ({ path: f.path, existedBefore: f.existedBefore })),
    }));
    res.json({ checkpoints: cps });
  });

  app.post("/api/checkpoints/rewind", (req, res) => {
    const { taskId, turn, scope = "both" } = req.body || {};
    if (!taskId || typeof turn !== "number") {
      return res.status(400).json({ error: "taskId and turn (number) are required" });
    }
    if (scope !== "code" && scope !== "conversation" && scope !== "both") {
      return res.status(400).json({ error: "scope must be 'code', 'conversation', or 'both'" });
    }

    const plan = planRewind(taskId, turn, scope);
    if ("error" in plan) return res.status(404).json({ error: plan.error });

    const fileResult = executeRewind(plan);
    const state = loadTaskState(taskId);
    let conversationRewound = false;
    if (state && (scope === "conversation" || scope === "both")) {
      const targetCount = plan.checkpoint.messageCount;
      if (targetCount > 0 && state.messages.length > targetCount) {
        state.messages = state.messages.slice(0, targetCount);
      }
      state.phase = "plan";
      state.metadata.replanReason = `[Rewind] Conversation rewound to turn ${turn} (${plan.checkpoint.createdAt ? new Date(plan.checkpoint.createdAt).toLocaleString() : ""}). Mutations reverted.`;
      saveTaskState(state);
      conversationRewound = true;
    }

    if (!fileResult.ok) {
      return res.status(500).json({ ok: false, error: fileResult.error || "Rewind failed", restored: fileResult.restored, deleted: fileResult.deleted, skipped: fileResult.skipped, conversationRewound });
    }
    res.json({
      ok: true,
      turn,
      scope,
      restored: fileResult.restored,
      deleted: fileResult.deleted,
      skipped: fileResult.skipped,
      conversationRewound,
      checkpointCount: listCheckpoints(taskId).length,
    });
  });

  app.delete("/api/checkpoints", (req, res) => {
    const taskId = (req.query.taskId as string) || "";
    if (!taskId) return res.status(400).json({ error: "taskId is required" });
    deleteCheckpointsForConversation(taskId);
    res.json({ ok: true });
  });

  // ============================================================
  // Tasks
  // ============================================================
  app.get("/api/tasks", (_req, res) => {
    res.json(listTaskStates());
  });

  app.get("/api/tasks/archived", (_req, res) => {
    res.json(listArchivedTaskStates());
  });

  app.get("/api/tasks/:taskId", (req, res) => {
    const state = loadTaskState(req.params.taskId);
    if (!state) return res.status(404).json({ error: "Task not found" });
    const steps = state.steps.map((s) => ({
      ...s,
      toolCalls: (s.toolCalls || []).map((id) => {
        const r = state.results.find((x) => x.toolCallId === id);
        return r ? { name: r.name, arguments: r.arguments, result: r.output } : { name: id, arguments: "" };
      }),
    }));
    res.json({ ...state, steps, metadata: state.metadata });
  });

  app.delete("/api/tasks/:taskId", (req, res) => {
    deleteTaskState(req.params.taskId);
    res.json({ ok: true });
  });

  app.post("/api/tasks/:taskId/restore", (req, res) => {
    const ok = restoreTaskState(req.params.taskId);
    if (!ok) return res.status(404).json({ error: "Task not found" });
    res.json({ ok: true, message: "Task restored" });
  });

  app.post("/api/tasks/:taskId/answer", async (req, res) => {
    const { answer } = req.body || {};
    const taskId = req.params.taskId;
    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(400).json({ error: "answer is required" });
    }
    const state = loadTaskState(taskId);
    if (!state) return res.status(404).json({ error: "Task not found" });

    const ask = getPendingAsk(taskId);
    const askMeta = state.metadata?.pendingAsk as { question?: string; options?: string[] } | undefined;
    if (ask) {
      answerPendingAsk(taskId, answer.trim());
    }

    // Inject the user's answer as a system message so the resumed task sees it.
    if (state.messages) {
      const question = askMeta?.question || ask?.question || "the question";
      state.messages.push({
        role: "system",
        content: `[User answered] Question: ${question}\nAnswer: ${answer.trim()}\nContinue the task based on this answer.`,
      });
    }
    if (state.metadata) delete state.metadata.pendingAsk;
    state.phase = "execute";
    saveTaskState(state);

    resumeTaskInBackground(taskId).catch((e) => log("error", "[Tasks] Answer-resume failed:", e));
    res.json({ ok: true, message: "Answer recorded, task resuming" });
  });

  app.delete("/api/tasks/:taskId/hard", (req, res) => {
    hardDeleteTaskState(req.params.taskId);
    deleteCheckpointsForConversation(req.params.taskId);
    res.json({ ok: true });
  });

  app.post("/api/tasks/:taskId/resume", (req, res) => {
    const state = loadTaskState(req.params.taskId);
    if (!state) return res.status(404).json({ error: "Task not found" });
    clearRecoveryFlag(req.params.taskId);
    resumeTaskInBackground(req.params.taskId).catch((e) => log("error", "[Tasks] Resume failed:", e));
    res.json({ ok: true, message: "Task resumed" });
  });

  app.get("/api/tasks/recovery/interrupted", (_req, res) => {
    res.json({ ok: true, tasks: listRecoverableTasks() });
  });

  // ============================================================
  // Eval
  // ============================================================
  app.get("/api/eval/dataset", (_req, res) => {
    ensureSampleDataset();
    res.json({ tasks: loadDataset() });
  });

  app.get("/api/eval/results", (_req, res) => {
    res.json({ results: loadResults() });
  });

  app.post("/api/eval/run/:taskId", (req, res) => {
    const task = loadDataset().find((t) => t.id === req.params.taskId);
    if (!task) return res.status(404).json({ error: "Eval task not found" });
    const result = evaluateTask(task);
    appendResult(result);
    res.json(result);
  });

  // ============================================================
  // MCP tools list (for the chat dropdown)
  // ============================================================
  app.get("/api/mcp/tools", (_req, res) => {
    res.json(getAllMCPTools());
  });

  // ============================================================
  // Provider connection test
  // ============================================================
  app.post("/api/test-provider", async (req, res) => {
    try {
      const { providerId } = req.body || {};
      const provider = getProvider(providerId);
      if (!provider) return res.status(404).json({ error: "Provider not found" });
      const apiKey = getApiKey(providerId);
      if (!apiKey) return res.json({ ok: false, error: "No API key configured for this provider" });
      const health = await checkProviderHealth(provider, apiKey);
      if (health.ok) {
        res.json({ ok: true, model: provider.models[0]?.id, latencyMs: health.latencyMs });
      } else {
        res.json({ ok: false, error: health.error || "Connection failed" });
      }
    } catch (e: any) {
      res.json({ ok: false, error: "Operation failed" });
    }
  });

  // ============================================================
  // Embedding health check
  // ============================================================
  app.get("/api/health/embeddings", async (_req, res) => {
    try {
      res.json(await checkEmbeddingHealth());
    } catch (e: any) {
      res.json({ ok: false, providerId: "", model: "", latencyMs: 0, error: e.message });
    }
  });

  // ============================================================
  // Provider health checks (for the provider list UI)
  // ============================================================
  app.get("/api/health/providers", async (_req, res) => {
    try {
      const out: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};
      await Promise.all(getAllProviders().map(async (p) => {
        const key = getApiKey(p.id);
        if (!key) { out[p.id] = { ok: true, latencyMs: 0, error: "No API key configured" }; return; }
        const h = await checkProviderHealth(p, key);
        out[p.id] = { ok: h.ok, latencyMs: h.latencyMs, error: h.error };
      }));
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================================
  // Delete a custom provider
  // ============================================================
  app.delete("/api/custom-providers/:id", (req, res) => {
    const cfg = loadConfig();
    const before = cfg.customProviders?.length || 0;
    cfg.customProviders = (cfg.customProviders || []).filter((p) => p.id !== req.params.id);
    let cleaned = cfg.customProviders.length !== before;
    // Purge stale state tied to this provider id so it stops showing up:
    // discovered model lists (e.g. a leftover "longcat-2.0") and stored keys.
    if (cfg.discoveredModels && cfg.discoveredModels[req.params.id]) {
      delete cfg.discoveredModels[req.params.id];
      cleaned = true;
    }
    if (cfg.providerKeys && cfg.providerKeys[req.params.id]) {
      delete cfg.providerKeys[req.params.id];
      cleaned = true;
    }
    if (!cleaned) {
      return res.status(404).json({ error: "Custom provider not found" });
    }
    saveConfig(cfg);
    res.json({ ok: true, message: `Provider ${req.params.id} removed (including cached models and stored key)` });
  });
}
