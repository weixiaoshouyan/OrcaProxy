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
import { accumulateCost } from "../services/billing";
import { computeCacheKey, getCachedResponse, replayStreamResponse } from "../cache";
import { injectAgentTools, buildAgentPrompt, buildCodebaseContext } from "../agent/tools";
import { executeAgentCompletions, mkChunk } from "../agent/loop";
import type { ChatMessage, ToolDefinition } from "../agent/types";

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

    // Compress messages if context is too large
    let messages: ChatMessage[] = [...(body.messages || [])];
    const { compressContextIfNeeded } = await import("../agent/compression");
    messages = await compressContextIfNeeded(messages, resolvedTarget);

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
        accumulateCost(cached.model || body.model, promptTok, 0, promptTok);

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

    // Language alignment constraint
    const langConstraint = `\n\n[Language Alignment Constraint]\nIMPORTANT: You MUST think (inside <think> tags) and respond in the exact same language that the user uses to ask questions. If the user writes in Chinese, write your reasoning and responses in Chinese. If the user writes in English, write your reasoning and responses in English. Keep language alignment consistent at all times.\n重要：你必须使用与用户提问完全相同的语言进行思考（在 <think> 标签内）和回复。如果用户使用中文提问，你的思考过程和回复都必须使用中文。如果用户使用英文提问，你的思考和回复必须使用英文。时刻保持语言一致。`;

    const finalSystemMsgIdx = messages.findIndex((m) => m.role === "system");
    if (finalSystemMsgIdx >= 0) {
      messages[finalSystemMsgIdx] = {
        role: "system",
        content: (messages[finalSystemMsgIdx].content || "") + langConstraint
      };
    } else {
      messages.unshift({ role: "system", content: langConstraint });
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

      try {
        log("info", `[Route] Attempting route ${body.model} -> ${provider.id}/${resolved.model}`);
        await executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey);
        return;
      } catch (err) {
        log("warn", `[Route] Provider ${provId} failed:`, err);
        lastError = err;
        if (res.headersSent) {
          log("info", `[Route] Headers already sent. Aborting route fallback logic.`);
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
      res.write("data: " + JSON.stringify(errorChunk) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });
}
