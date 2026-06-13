// ============================================================
// src/routes/chat.ts
// POST /v1/chat/completions — Core agent loop with streaming
// ============================================================

import express from "express";
import path from "path";
import fs from "fs";
import {
  loadConfig, saveConfig, getAllProviders, getProvider, getActiveProvider, getApiKey, resolveModel,
} from "../providers";
import { log } from "../utils/log";
import { getStats, incrementRequests, incrementErrors, addTokens, addCost } from "../utils/stats";
import { handleAgentToolCall } from "../services/tools";
import { parseFrontmatter } from "../services/skills";
import { accumulateCost, seedBillingFile } from "../services/billing";
import { computeCacheKey, getCachedResponse, setCachedResponse, replayStreamResponse } from "../cache";
import { injectAgentTools, buildAgentPrompt } from "../agent/tools";
import { compressContextIfNeeded } from "../agent/compression";
import { ensureToolPairing as compressEnsureToolPairing, buildToolPairMap } from "../agent/compression";

// Skills directory — imported from skills.ts
import { SKILLS_DIR } from "../services/skills";

export function registerChatRoute(app: express.Application): void {
  app.post("/v1/chat/completions", async (req, res) => {
    req.socket.setTimeout(0); // Disable socket timeout for streaming agent loop
    const startTime = Date.now();
    incrementRequests("chat");

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
        const { incrementInterceptedRequests } = require("../utils/stats");
        incrementInterceptedRequests();
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
          const systemMsgIdx = messages.findIndex((m: any) => m.role === "system");
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
      const agentPrompt = buildAgentPrompt(useAgent, body.workspacePath);
      const systemMsgIdx = messages.findIndex((m: any) => m.role === "system");
      if (systemMsgIdx >= 0) {
        messages[systemMsgIdx] = {
          role: "system",
          content: messages[systemMsgIdx].content + "\n\n" + agentPrompt
        };
      } else {
        messages.unshift({ role: "system", content: agentPrompt });
      }
    }

    // 强化中英文自动对齐策略
    const langConstraint = `\n\n[Language Alignment Constraint]\nIMPORTANT: You MUST think (inside <think> tags) and respond in the exact same language that the user uses to ask questions. If the user writes in Chinese, write your reasoning and responses in Chinese. If the user writes in English, write your reasoning and responses in English. Keep language alignment consistent at all times.\n重要：你必须使用与用户提问完全相同的语言进行思考（在 <think> 标签内）和回复。如果用户使用中文提问，你的思考过程和回复都必须使用中文。如果用户使用英文提问，你的思考和回复必须使用英文。时刻保持语言一致。`;
    
    const finalSystemMsgIdx = messages.findIndex((m: any) => m.role === "system");
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
    injectAgentTools(tools, useAgent, body.workspacePath);

    // Load Balancing and Disaster Recovery Fallback Loop
    const mainProviderId = resolvedTarget.provider.id;
    const fallbackIds = loadConfig().fallbackProviderIds || [];
    const providersToTry = [mainProviderId, ...fallbackIds.filter((id: string) => id !== mainProviderId)];

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
      const isNative = provider.models.some((m: any) => m.id === resolved.model);
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
}

// ---- Fetch with Retry Helper ----
async function fetchWithRetry(url: string, options: any, retries = 3, delay = 2000) {
  const timeoutMs = 180000; // 3 minutes timeout
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;

    try {
      const resp = await fetch(url, { ...options, signal });
      clearTimeout(timeoutId);

      if (resp.status === 429) {
        const retryAfter = resp.headers.get("retry-after");
        const wait = retryAfter ? parseInt(retryAfter) * 1000 : delay * Math.pow(2, i);
        log("warn", `[Chat] Upstream rate limited (429). Waiting ${wait}ms before retry ${i + 1}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      if (!resp.ok && resp.status >= 500) {
        const wait = delay * Math.pow(2, i);
        log("warn", `[Chat] Upstream server error (${resp.status}). Waiting ${wait}ms before retry ${i + 1}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      return resp;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "AbortError") {
        log("warn", `[Chat] Upstream request timed out (180s).`);
        if (i === retries - 1) throw new Error("Upstream request timed out after 3 minutes");
      } else {
        log("warn", `[Chat] Upstream fetch error: ${err.message}.`);
        if (i === retries - 1) throw err;
      }
      const wait = delay * Math.pow(2, i);
      log("warn", `[Chat] Waiting ${wait}ms before retry ${i + 1}/${retries}...`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw new Error("Failed to fetch after retries");
}

// ---- Core Agent Execution Loop ----
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
  const AGENT_MAX_DURATION_MS = 30 * 60 * 1000; // 30 minutes overall timeout for agent tasks

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

  // Overall agent timeout check
  if (Date.now() - startTime > AGENT_MAX_DURATION_MS && depth > 0) {
    const errMsg = `Agent task exceeded maximum duration (${AGENT_MAX_DURATION_MS / 60000} minutes)`;
    log("warn", `[Chat] ${errMsg}`);
    const timeoutChunk = mkChunk(null, resolved.model, `\n\n[${errMsg}. Task results so far are above.]\n`, "stop");
    res.write("data: " + JSON.stringify(timeoutChunk) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  // Build the request parameters
  // No default limit, no artificial overrides unless explicitly specified by the client request.
  const maxTokensParam = body.max_tokens ? { max_tokens: body.max_tokens } : {};

  const requestBody = {
    ...body,
    messages,
    ...maxTokensParam,
    ...(tools.length > 0 ? { tools } : {}),
  };
  
  delete requestBody.activeSkillId;
  delete requestBody.useAgent;
  delete requestBody.workspacePath;

  let targetUrl: string;
  let headers: Record<string, string>;
  let reqBodyText: string;

  if (resolved.provider.id === "anthropic") {
    targetUrl = resolved.provider.baseUrl + "/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" };
    const systemMsgs = messages.filter((m: any) => m.role === "system");
    const normalMsgs = messages.filter((m: any) => m.role !== "system");
    const systemText = systemMsgs.map((m: any) => m.content).join("\n");
    
    const anthropicBody: any = {
      model: resolved.model,
      max_tokens: body.max_tokens || 4096,
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
      if (typeof res.flushHeaders === "function") res.flushHeaders();
    }

    const fetchKeepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, 15000);

    let upstreamResp;
    try {
      upstreamResp = await fetchWithRetry(targetUrl, { method: "POST", headers, body: reqBodyText });
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
        retryCount = 0;
      } catch (readError) {
        log("warn", "[Chat] Stream read error:", readError);
        retryCount++;
        if (retryCount >= MAX_STREAM_RETRIES) {
          log("error", "[Chat] Max stream retries reached, aborting");
          break;
        }
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
            if (parsed.usage) finalUsage = parsed.usage;
            const choice = parsed.choices?.[0];
            if (choice) {
              if (choice.delta?.tool_calls) {
                if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
                  hasClosedThinkBlock = true;
                  const closeChunk = mkChunk(parsed, resolved.model, `\n</think>\n`);
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
                if (!hasOpenedThinkBlock) {
                  hasOpenedThinkBlock = true;
                  const openChunk = mkChunk(parsed, resolved.model, `<think>\n`);
                  res.write("data: " + JSON.stringify(openChunk) + "\n\n");
                  accumulatedText += "<think>\n";
                }
                const contentChunk = mkChunk(parsed, resolved.model, choice.delta.reasoning_content);
                res.write("data: " + JSON.stringify(contentChunk) + "\n\n");
                accumulatedText += choice.delta.reasoning_content;
              } else if (choice.delta?.content) {
                if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
                  hasClosedThinkBlock = true;
                  const closeChunk = mkChunk(parsed, resolved.model, `\n</think>\n`);
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
      try { await reader.cancel(); } catch (e) { log("warn", "Failed to cancel stream reader:", e); }
      return;
    }

    // Ensure think block is closed
    if (hasOpenedThinkBlock && !hasClosedThinkBlock) {
      hasClosedThinkBlock = true;
      const closeChunk = mkChunk(null, resolved.model, `\n</think>\n`);
      res.write("data: " + JSON.stringify(closeChunk) + "\n\n");
      accumulatedText += "\n</think>\n";
    }

    const toolCalls = accumulatedToolCalls.filter(Boolean);
    if (toolCalls.length > 0) {
      messages.push({ role: "assistant", tool_calls: toolCalls });

      const writeDelta = (text: string) => {
        const chunk = mkChunk(null, resolved.model, text);
        res.write("data: " + JSON.stringify(chunk) + "\n\n");
      };

      await executeToolsInParallel(toolCalls, writeDelta, messages, body.workspacePath, res, isClientGone);

      // Truncate messages if too large
      truncateMessagesIfNeeded(messages);

      // Re-compress context before recursion to prevent window overflow in long agent loops
      messages = await compressContextIfNeeded(messages, resolved);

      return executeAgentCompletions(req, res, body, resolved, messages, tools, useAgent, activeSkillId, startTime, cacheKey, depth + 1);
    } else {
      // Final success
      const promptTok = finalUsage?.prompt_tokens || 0;
      const compTok = finalUsage?.completion_tokens || 0;
      let cachedTok = 0;
      if (finalUsage?.prompt_tokens_details?.cached_tokens !== undefined) {
        cachedTok = finalUsage.prompt_tokens_details.cached_tokens;
      } else if (finalUsage?.input_token_details?.cache_read !== undefined) {
        cachedTok = finalUsage.input_token_details.cache_read;
      }
      accumulateCost(resolved.model, promptTok, compTok, cachedTok);

      const finalChunk = mkChunk(null, resolved.model, "", "stop");
      res.write("data: " + JSON.stringify(finalChunk) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
      log("info", `[Chat] Done ${Date.now() - startTime}ms`);
    }
  } else {
    // Non-streaming path
    let upstreamResp;
    try {
      upstreamResp = await fetchWithRetry(targetUrl, { method: "POST", headers, body: reqBodyText });
    } catch (e) {
      throw e;
    }
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
        if (isClientGone()) {
          log("info", "[Chat] Client disconnected during non-streaming tool execution, aborting.");
          return;
        }
        const tc = toolCalls[i];
        const workspacePath = body.workspacePath || "";
        const output = await handleAgentToolCall(tc, workspacePath);
        
        let toolContent = output;
        const isLastTool = i === toolCalls.length - 1;
        if (isLastTool) {
          toolContent += `\n\n[System Reminder: Please output the updated Task Plan at the beginning of your next response.]`;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
      }
      // Truncate and re-compress before recursion
      truncateMessagesIfNeeded(messages);
      messages = await compressContextIfNeeded(messages, resolved);
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

// Helper to build a chunk object
function mkChunk(parsed: any, model: string, content: string, finishReason: string | null = null): any {
  return {
    id: parsed?.id || ("chatcmpl-" + Date.now()),
    object: "chat.completion.chunk",
    created: parsed?.created || Math.floor(Date.now() / 1000),
    model: parsed?.model || model,
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }]
  };
}

// Tool categories for parallelism
const READ_ONLY_TOOLS = new Set(["read_workspace_file", "search_grep", "glob_files", "list_workspace_files", "list_available_skills", "get_skill_details"]);
const WRITE_TOOLS = new Set(["write_workspace_file", "patch_workspace_file", "run_terminal_command", "run_skill_script"]);

function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name) || name.startsWith("mcp__");
}

function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

// Execute tool calls: read-only tools run in parallel groups, writes run sequentially
async function executeToolsInParallel(
  toolCalls: any[],
  writeDelta: (text: string) => void,
  messages: any[],
  workspacePath: string,
  res: any,
  isClientGone: () => boolean
): Promise<void> {
  const MAX_TOOL_OUTPUT = 30 * 1024;
  
  // Group consecutive read-only tools for parallel execution
  const groups: any[][] = [];
  let currentGroup: any[] = [];
  
  for (const tc of toolCalls) {
    if (isReadOnlyTool(tc.function.name) && !isWriteTool(tc.function.name)) {
      currentGroup.push(tc);
    } else {
      if (currentGroup.length > 0) { groups.push(currentGroup); currentGroup = []; }
      groups.push([tc]); // write tools run solo
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);
  
  let globalIdx = 0;
  for (const group of groups) {
    if (isClientGone()) {
      log("info", "[Chat] Client disconnected, aborting tool execution.");
      break;
    }

    // Notify which tools are executing
    const names = group.map(tc => tc.function.name).join(", ");
    writeDelta(`\n\n> 🔧 **Agent Executing ${group.length > 1 ? `${group.length} tools in parallel` : "Tool"}:** \`${names}\`...\n`);
    
    const toolKeepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, 15000);
    
    let outputs: string[];
    try {
      // Execute group in parallel or sequentially
      if (group.length > 1 && group.every(tc => isReadOnlyTool(tc.function.name))) {
        // Parallel execution for read-only tools
        outputs = await Promise.all(group.map(tc => handleAgentToolCall(tc, workspacePath)));
      } else {
        // Sequential execution for write tools or single tools
        outputs = [];
        for (const tc of group) {
          if (isClientGone()) break;
          outputs.push(await handleAgentToolCall(tc, workspacePath));
        }
      }
    } finally {
      clearInterval(toolKeepAlive);
    }
    
    // Write outputs and push to messages
    for (let j = 0; j < group.length; j++) {
      const tc = group[j];
      const output = outputs[j] || "Error: No output";
      writeDelta(`\n\`\`\`\n${output}\n\`\`\`\n`);
      
      let toolContent = output;
      if (toolContent.length > MAX_TOOL_OUTPUT) {
        toolContent = toolContent.substring(0, MAX_TOOL_OUTPUT) + "\n\n[Output truncated to prevent request overflow]";
      }
      
      const isLastGlobally = globalIdx === toolCalls.length - 1;
      if (isLastGlobally) {
        toolContent += `\n\n[System Reminder: Please output the updated Task Plan (e.g. - [x] completed, - [/] in-progress, - [ ] pending) at the beginning of your next response, then continue executing the steps or summarize the results.]`;
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
      globalIdx++;
    }
  }
}

// Truncate messages array if too large — preserves tool pairing
function truncateMessagesIfNeeded(messages: any[]): void {
  let estimatedSize = 0;
  for (const msg of messages) {
    const contentLen = typeof msg.content === "string" ? msg.content.length : (msg.content ? JSON.stringify(msg.content).length : 0);
    estimatedSize += contentLen + 100;
    if (msg.tool_call_id) estimatedSize += msg.tool_call_id.length + 50;
    if (msg.tool_calls) estimatedSize += JSON.stringify(msg.tool_calls).length;
  }
  const MAX_MESSAGES_SIZE = 800 * 1024;
  if (estimatedSize > MAX_MESSAGES_SIZE) {
    log("warn", `[Chat] Messages array too large (~${Math.round(estimatedSize/1024)}KB), truncating older messages`);
    const systemMsg = messages.find((m: any) => m.role === "system");
    // Keep last 30 messages but expand backward to include paired tool_calls
    const activeMessages = messages.filter((m: any) => m.role !== "system");
    let keepStart = Math.max(0, activeMessages.length - 30);
    keepStart = compressEnsureToolPairing(activeMessages, keepStart);
    const recentMessages = activeMessages.slice(keepStart);
    messages.length = 0;
    if (systemMsg) messages.push(systemMsg);
    messages.push(...recentMessages);
    log("info", `[Chat] Truncated to ${messages.length} messages (paired: ${recentMessages.filter(m => m.tool_call_id).length} tool results)`);
  }
}
