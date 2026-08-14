// ============================================================
// src/routes/chat.ts
// POST /v1/chat/completions — Route registration
// Agent loop logic lives in agent/loop.ts
// ============================================================

import express from "express";
import path from "path";
import fs from "fs";
import { loadConfig, resolveModel } from "../providers";
import { resolveHealthyModel } from "../services/health";
import { log } from "../utils/log";
import { incrementRequests, incrementErrors } from "../utils/stats";
import { parseFrontmatter, SKILLS_DIR, resolveSafeSkillPath } from "../services/skills";
import { accumulateCost, qualifyModel } from "../services/billing";
import { computeCacheKey, getCachedResponse, replayStreamResponse } from "../cache";
import { injectAgentTools, buildAgentPrompt, buildCodebaseContext } from "../agent/tools";
import { runAgentTask, runPassthroughProxy } from "../agent/engine";
import { mkChunk } from "../agent/loop";
import type { ChatMessage, ToolDefinition } from "../agent/types";

// P1-10: cap concurrent agent tasks. Beyond this many simultaneous agent
// requests (each an independent 60-round loop), the provider key and the
// workspace get hammered and the tasks slow each other down.
const MAX_CONCURRENT_AGENT_TASKS = 3;
let activeAgentRequests = 0;

export function registerChatRoute(app: express.Application): void {
  app.post("/v1/chat/completions", async (req, res) => {
    req.socket.setTimeout(0);
    const startTime = Date.now();
    incrementRequests("chat");

    const body = req.body as {
      model: string;
      messages: ChatMessage[];
      tools?: ToolDefinition[];
      stream?: boolean;
      temperature?: number;
      max_tokens?: number;
      top_p?: number;
      tool_choice?: unknown;
      activeSkillId?: string;
      useAgent?: boolean;
      workspacePath?: string;
      resumeTaskId?: string;
      taskId?: string;
    };
    const activeSkillId = body.activeSkillId || "";
    const useAgent = body.useAgent;

    // Resolve target model (with profile + health fallback + tool routing)
    const toolNames = (body.tools || []).map((t) => t.function?.name).filter(Boolean);
    const resolvedTarget = await resolveHealthyModel(body.model, resolveModel, undefined, toolNames);

    // Compress messages if context is too large (agent mode only — passthrough must not mutate messages)
    let messages: ChatMessage[] = [...(body.messages || [])];
    if (useAgent !== undefined) {
      const { compressContextIfNeeded } = await import("../agent/compression");
      messages = await compressContextIfNeeded(messages, resolvedTarget);
    }

    // Persistent Caching Check
    let cacheKey: string | null = null;
    const canUseResponseCache = body.useAgent === undefined && !body.activeSkillId && !body.workspacePath && !body.tool_choice && !body.tools;
    if (loadConfig().cacheEnabled && canUseResponseCache) {
      cacheKey = computeCacheKey({ ...body, _providerId: resolvedTarget.provider.id });
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        log("info", `[Cache] Hit cache for key ${cacheKey}`);
        const { incrementInterceptedRequests } = await import("../utils/stats");
        incrementInterceptedRequests();
        const promptTok = cached.usage?.prompt_tokens || 0;
        // Cache replay served the entire response from disk; the completion was
        // never regenerated, so only bill the (fully-cached) prompt.
        accumulateCost(qualifyModel(resolvedTarget.provider.id, cached.model || body.model), promptTok, 0, promptTok);

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
      let skillPath: string;
      try {
        skillPath = resolveSafeSkillPath(activeSkillId);
      } catch (e: any) {
        log("warn", `[Chat] Invalid activeSkillId rejected: ${e.message}`);
        return res.status(400).json({ error: "Invalid activeSkillId" });
      }
      const skillFile = path.join(skillPath, "SKILL.md");
      if (fs.existsSync(skillFile)) {
        try {
          const text = fs.readFileSync(skillFile, "utf-8");
          const parsed = parseFrontmatter(text);
          const skillSystemPrompt = `[Active Agent Skill: ${parsed.name}]\nInstructions:\n${parsed.body}`;
          const systemMsgIdx = messages.findIndex((m) => m.role === "system");
          if (systemMsgIdx >= 0) {
            messages[systemMsgIdx] = {
              role: "system",
              content: (messages[systemMsgIdx].content || "") + "\n\n" + skillSystemPrompt
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
      const agentPrompt = buildAgentPrompt(useAgent, body.workspacePath);
      const codebaseContext = buildCodebaseContext(body.workspacePath || "");
      const fullPrompt = codebaseContext ? `${agentPrompt}\n\n${codebaseContext}` : agentPrompt;
      const systemMsgIdx = messages.findIndex((m) => m.role === "system");
      if (systemMsgIdx >= 0) {
        messages[systemMsgIdx] = {
          role: "system",
          content: (messages[systemMsgIdx].content || "") + "\n\n" + fullPrompt
        };
      } else {
        messages.unshift({ role: "system", content: fullPrompt });
      }
    }

    // Language alignment constraint (agent mode only — passthrough must not inject system prompts)
    if (useAgent !== undefined) {
      const langConstraint = `\n\n[Language Alignment Constraint]\nIMPORTANT: You MUST think and respond in the exact same language that the user uses to ask questions. If you have a hidden reasoning field (reasoning_content), do your thinking there and NEVER output <think> or <thinking> tags in your visible reply. Otherwise you may reason inside <think>...</think> tags, with the same language rule. If the user writes in Chinese, write your reasoning and responses in Chinese. If the user writes in English, write your reasoning and responses in English. Keep language alignment consistent at all times.\n重要：你必须使用与用户提问完全相同的语言进行思考和回复。如果你有隐藏的推理字段（reasoning_content），请在推理字段中思考，绝不要在你的可见回复中输出 <think> 或 <thinking> 标签；否则你可以用 <think>...</think> 标签思考，同样必须保持语言一致。如果用户使用中文提问，你的思考过程和回复都必须使用中文。如果用户使用英文提问，你的思考和回复必须使用英文。时刻保持语言一致。`;

      const finalSystemMsgIdx = messages.findIndex((m) => m.role === "system");
      if (finalSystemMsgIdx >= 0) {
        messages[finalSystemMsgIdx] = {
          role: "system",
          content: (messages[finalSystemMsgIdx].content || "") + langConstraint
        };
      } else {
        messages.unshift({ role: "system", content: langConstraint });
      }
    }

    // Collect Tools: Active Skill scripts + MCP tools + built-in workspace & skill tools
    const tools: ToolDefinition[] = [...(body.tools || [])];
    injectAgentTools(tools, useAgent, body.workspacePath);

    // Load Balancing and Disaster Recovery Fallback Loop
    const mainProviderId = resolvedTarget.provider.id;
    const fallbackIds = loadConfig().fallbackProviderIds || [];
    const providersToTry = [mainProviderId, ...fallbackIds.filter((id) => id !== mainProviderId)];

    let lastError: Error | unknown = new Error("No provider succeeded");
    for (const provId of providersToTry) {
      const { getProvider, getApiKey } = await import("../providers");
      const provider = getProvider(provId);
      if (!provider) continue;
      const apiKey = getApiKey(provId);
      if (!apiKey) continue;

      const resolved = {
        provider,
        model: provId === resolvedTarget.provider.id ? resolvedTarget.model : body.model,
        apiKey
      };

      const isNative = provider.models.some((m) => m.id === resolved.model);
      if (!isNative && provider.models.length > 0) {
        resolved.model = provider.models[0].id;
      }

      // P1-6: When the primary provider failed and we fell back to a backup,
      // surface the switch to the client so the switch is never silent.
      const isFallback = provId !== resolvedTarget.provider.id;
      if (isFallback) {
        log("info", `[Route] Fallback: ${resolvedTarget.provider.id} -> ${provider.id} (model ${resolved.model})`);
        if (body.stream !== false) {
          try {
            const note = `[${resolvedTarget.provider.id} 不可用，已自动切换到 ${provider.id}]`;
            const noteChunk = mkChunk(null, resolved.model, `\n\n> ⚠️ ${note}\n\n`, null);
            res.write("data: " + JSON.stringify(noteChunk) + "\n\n");
          } catch { /* stream already gone — fallback still proceeds */ }
        }
      }

      try {
        log("info", `[Route] Attempting route ${body.model} -> ${provider.id}/${resolved.model}`);
        if (useAgent === undefined) {
          // Clean pass-through: no agent transformations, no tool_calls swallowing
          await runPassthroughProxy(res, body, resolved, messages, tools, startTime, cacheKey);
        } else {
          // P1-10: concurrency cap for agent tasks (passthrough stays unlimited).
          if (activeAgentRequests >= MAX_CONCURRENT_AGENT_TASKS) {
            log("warn", `[Route] Agent concurrency limit reached (${activeAgentRequests}/${MAX_CONCURRENT_AGENT_TASKS})`);
            if (!res.headersSent) {
              return res.status(429).json({
                error: {
                  message: `已有 ${activeAgentRequests} 个 Agent 任务在运行（上限 ${MAX_CONCURRENT_AGENT_TASKS}）。请等待其中一个完成，或从任务页停止/删除后再试。`,
                  type: "concurrency_limit",
                },
              });
            }
            return;
          }
          activeAgentRequests++;
          try {
            await runAgentTask(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey);
          } finally {
            activeAgentRequests--;
          }
        }
        return;
      } catch (err) {
        log("warn", `[Route] Provider ${provId} failed:`, err);
        lastError = err;
        if (res.headersSent) {
          log("info", `[Route] Headers already sent. Aborting route fallback logic.`);
          // Always terminate the response, even mid-stream — a task exception
          // must not leave the client waiting forever for a terminal event.
          if (!res.writableEnded) {
            try {
              const errText = `\n\n[Proxy Execution Error: ${String(err)}]\n`;
              const errorChunk = mkChunk(null, "error-handler", errText, "error");
              res.write("data: " + JSON.stringify(errorChunk) + "\n\n");
              res.write("data: [DONE]\n\n");
            } catch { /* socket already dead */ }
            try { res.end(); } catch { /* already closed */ }
          }
          break;
        }
      }
    }

    // All providers failed
    incrementErrors();
    log("error", `[Route] All routes failed. Last error:`, lastError);
    if (!res.headersSent) {
      res.status(502).json({ error: { message: `All routing paths failed. Last error: ${String(lastError)}`, type: "proxy_error" } });
    } else if (!res.writableEnded) {
      const errText = `\n\n[Proxy Execution Error: ${String(lastError)}]\n`;
      const errorChunk = mkChunk(null, "error-handler", errText, "error");
      try {
        res.write("data: " + JSON.stringify(errorChunk) + "\n\n");
        res.write("data: [DONE]\n\n");
      } catch { /* socket already dead */ }
      try { res.end(); } catch { /* already closed */ }
    }
  });
}
