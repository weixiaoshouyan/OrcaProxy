// ============================================================
// src/agent/compression.ts
// Context compression: dynamic threshold, layered strategy, message pairing
// ============================================================

import { log } from "../utils/log";
import { buildProbeUrl } from "../services/health";

// Model-specific context window sizes (in tokens) — updated regularly
const MODEL_CONTEXT_SIZES: Record<string, number> = {
  "gpt-4": 8192, "gpt-4-32k": 32768, "gpt-4-turbo": 128000,
  "gpt-4o": 128000, "gpt-4o-mini": 128000,
  "gpt-4.1": 1000000, "gpt-4.1-mini": 1000000, "gpt-4.1-nano": 1000000,
  "o1": 200000, "o1-mini": 200000,
  "claude-3-opus": 200000, "claude-3-sonnet": 200000, "claude-3-haiku": 200000,
  "claude-3.5-sonnet": 200000, "claude-3-5-haiku": 200000, "claude-3.5-haiku": 200000,
  "claude-sonnet-4": 200000, "claude-opus-4": 200000,
  "deepseek-v4-flash": 128000, "deepseek-v4-pro": 65536,
  "deepseek-chat": 128000, "deepseek-reasoner": 65536,
  "deepseek-v3": 128000, "deepseek-r1": 128000,
  "gemini-1.5-pro": 1000000, "gemini-1.5-flash": 1000000,
  "gemini-2.0-flash": 1000000, "gemini-2.5-pro": 1000000,
  "qwen": 131072, "llama-3": 128000,
};

function getModelContextLimit(model: string): number {
  const modelLower = model.toLowerCase();
  // 1) Exact match first (most reliable).
  if (MODEL_CONTEXT_SIZES[modelLower] !== undefined) return MODEL_CONTEXT_SIZES[modelLower];
  // 2) Longest-key prefix match. Sorting by descending key length prevents a
  //    short key like "gpt-4" from hijacking "gpt-4o" / "gpt-4.1". The boundary
  //    guard ensures "gpt-4" only matches "gpt-4" / "gpt-4-..." and not "gpt-4o".
  const sortedKeys = Object.keys(MODEL_CONTEXT_SIZES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const k = key.toLowerCase();
    const boundary = /^[.\-_/]$/;
    if (
      modelLower === k ||
      (modelLower.startsWith(k) && (modelLower.length === k.length || boundary.test(modelLower[k.length] ?? ""))) ||
      (k.startsWith(modelLower) && (k.length === modelLower.length || boundary.test(k[modelLower.length] ?? "")))
    ) {
      return MODEL_CONTEXT_SIZES[key];
    }
  }
  return 128000;
}

const estimateTokens = (text: string): number => {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7F) {
      count += 2.5;
    } else if (code === 0x09 || code === 0x0A || code === 0x0D) {
      count += 1;
    } else if (code < 0x20) {
      count += 0.5;
    } else {
      count += 0.25;
    }
  }
  return Math.round(count);
};

/**
 * Estimate tokens per message more accurately by separating
 * content tokens from structural overhead (role, tool_call_id, etc.)
 */
export function estimateMessageTokens(msg: any): number {
  let tokens = 4;
  if (typeof msg.content === "string") {
    tokens += estimateTokens(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.text) tokens += estimateTokens(part.text);
    }
  } else if (msg.content === null) {
    tokens += 1;
  }
  if (msg.role) tokens += estimateTokens(msg.role) + 2;
  if (msg.tool_call_id) tokens += estimateTokens(msg.tool_call_id) + 2;
  if (msg.name) tokens += estimateTokens(msg.name) + 2;
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += 8;
      if (tc.id) tokens += estimateTokens(tc.id);
      if (tc.function?.name) tokens += estimateTokens(tc.function.name) + 2;
      if (tc.function?.arguments) tokens += estimateTokens(tc.function.arguments) + 2;
    }
  }
  return tokens;
}

/**
 * Build tool_call_id → message index map for pairing validation.
 */
export function buildToolPairMap(messages: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.tool_calls && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        map.set(tc.id, i);
      }
    }
  }
  return map;
}

/**
 * Ensure tool_result messages are always paired with their tool_calls.
 * Expands keepStart backwards to include assistant messages that made called tools.
 */
export function ensureToolPairing(messages: any[], keepStart: number): number {
  const toolMap = buildToolPairMap(messages);
  let start = keepStart;
  let expanded = true;

  while (expanded) {
    expanded = false;
    for (let i = start; i < messages.length; i++) {
      const m = messages[i];
      if (m.tool_call_id && typeof m.tool_call_id === "string") {
        const assistantIdx = toolMap.get(m.tool_call_id);
        if (assistantIdx !== undefined && assistantIdx < start) {
          start = assistantIdx;
          expanded = true;
          log("debug", `[Compression] Paired tool_call_id ${m.tool_call_id} (assistant idx ${assistantIdx}) with tool result at idx ${i}`);
          break;
        }
      }
    }
  }

  return start;
}

/**
 * Remove tool-result messages whose tool_call_id no longer has a matching
 * assistant message in the kept window (e.g. dropped by an earlier summary).
 * An orphaned `tool` message is invalid at the API and wastes context.
 */
export function dropOrphanedToolResults(messages: any[]): any[] {
  const toolMap = buildToolPairMap(messages);
  return messages.filter((m) => {
    if (m.tool_call_id && typeof m.tool_call_id === "string") {
      return toolMap.has(m.tool_call_id);
    }
    return true;
  });
}

/**
 * Compress conversation context when it exceeds the model's effective limit.
 * Uses layered strategy:
 *   - Level 1: Always preserve system messages
 *   - Level 2: Keep last N messages + any paired tool_calls
 *   - Level 3: AI-summarize the middle section
 *   - Level 4: Discard trivial confirmations (OK/yes/no)
 */
export async function compressContextIfNeeded(messages: any[], resolved: any): Promise<any[]> {
  if (!resolved?.provider?.baseUrl || !resolved?.apiKey) {
    log("warn", "[Context Compression] Cannot compress: missing provider baseUrl or apiKey");
    return messages;
  }

  // Dynamic threshold: 80% of model context window, min 8K.
  // NOTE: previously capped at 128000 which silently truncated 1M-context
  // models (gpt-4.1, gemini-1.5-pro, ...). We now honor the real window.
  const contextLimit = Math.floor(getModelContextLimit(resolved.model) * 0.80);
  const threshold = Math.max(8000, contextLimit);

  const totalTokens = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  if (totalTokens <= threshold) {
    return messages;
  }

  log("info", `[Context Compression] ${totalTokens} tokens exceeds ${threshold} (model: ${resolved.model}). Compacting...`);

  const systemMessages = messages.filter((m: any) => m.role === "system");
  const activeMessages = messages.filter((m: any) => m.role !== "system");

  if (activeMessages.length < 8) {
    return messages;
  }

  // Layer 2: Keep last BASE_KEEP messages, expand to include paired tool_calls
  const BASE_KEEP = 6;
  let keepStart = Math.max(0, activeMessages.length - BASE_KEEP);
  keepStart = ensureToolPairing(activeMessages, keepStart);

  const toCompress = activeMessages.slice(0, keepStart);
  const toKeep = activeMessages.slice(keepStart);

  // Layer 4: Filter out trivial confirmation messages from compress target
  const meaningful = toCompress.filter((m: any) => {
    if (typeof m.content === "string") {
      const trimmed = m.content.trim();
      if (/^(ok|done|yes|no|sure|好的|嗯|行|可以|对|没错)$/i.test(trimmed) && trimmed.length < 10) return false;
    }
    return true;
  });

  if (meaningful.length === 0) {
    // Nothing meaningful to compress, just return system + recent
    return [...systemMessages, ...dropOrphanedToolResults(toKeep)];
  }

  // Layer 3: AI Summary
  const summaryPrompt = "Please analyze the following conversation history and write a dense, concise summary. Highlight what tasks have been completed, what is in progress, any active file paths, and key decisions made. Keep the summary under 500 words.";

  const conversationText = meaningful.map((m: any) => {
    let contentStr = "";
    if (typeof m.content === "string") contentStr = m.content;
    else if (Array.isArray(m.content)) contentStr = m.content.map((c: any) => c.text || JSON.stringify(c)).join("\n");
    else if (m.tool_calls) contentStr = `Calls tools: ${m.tool_calls.map((tc: any) => tc.function.name).join(", ")}`;
    return `[${m.role.toUpperCase()}]: ${contentStr}`;
  }).join("\n\n");

  try {
    const baseUrl = resolved.provider.baseUrl.replace(/\/+$/, "");
    const isAnthropic = resolved.provider.id === "anthropic";
    
    let targetUrl: string;
    let headers: Record<string, string>;
    let compressionBody: any;

    let compressionModel = resolved.model;
    if (resolved.provider.id === "deepseek" && compressionModel === "deepseek-v4-pro") {
      compressionModel = "deepseek-v4-flash";
    } else if (resolved.provider.id === "deepseek" && compressionModel === "deepseek-reasoner") {
      compressionModel = "deepseek-chat";
    } else if (resolved.provider.id === "qwen" && compressionModel === "qwen-max") {
      compressionModel = "qwen-plus";
    } else if (compressionModel.toLowerCase().includes("reasoner") || compressionModel.toLowerCase().includes("r1") || compressionModel.toLowerCase().includes("o1") || compressionModel.toLowerCase().includes("o3")) {
      const nonReasoning = resolved.provider.models.find((m: any) => !m.reasoning && !m.id.toLowerCase().includes("reasoner") && !m.id.toLowerCase().includes("r1") && !m.id.toLowerCase().includes("o1") && !m.id.toLowerCase().includes("o3"));
      if (nonReasoning) {
        compressionModel = nonReasoning.id;
      }
    }

    if (isAnthropic) {
      targetUrl = buildProbeUrl(baseUrl, "/messages");
      headers = { "Content-Type": "application/json", "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" };
      compressionBody = {
        model: compressionModel,
        max_tokens: 800,
        temperature: 0.3,
        system: "You are a helpful assistant that summarizes conversation logs concisely.",
        messages: [
          { role: "user", content: `${summaryPrompt}\n\nCONVERSATION:\n${conversationText}` }
        ],
      };
    } else {
      targetUrl = buildProbeUrl(baseUrl, "/chat/completions");
      headers = { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` };
      compressionBody = {
        model: compressionModel,
        messages: [
          { role: "system", content: "You are a helpful assistant that summarizes conversation logs concisely." },
          { role: "user", content: `${summaryPrompt}\n\nCONVERSATION:\n${conversationText}` }
        ],
        max_tokens: 800,
        temperature: 0.3
      };
    }

    log("info", `[Context Compression] Requesting summary...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);
    try {
      const resp = await fetch(targetUrl, {
        method: "POST", headers,
        body: JSON.stringify(compressionBody),
        signal: controller.signal
      });

      if (!resp.ok) throw new Error(`Compression upstream returned ${resp.status}`);
      const data = await resp.json() as any;
      // Parse both OpenAI and Anthropic response formats
      let summary: string | undefined;
      if (data.choices?.[0]?.message?.content) {
        summary = data.choices[0].message.content;
      } else if (data.content?.[0]?.text) {
        summary = data.content[0].text;
      }

      if (summary) {
        log("info", `[Context Compression] Summarized ${toCompress.length} messages → kept ${toKeep.length}.`);
        const summaryMessage = {
          role: "system",
          content: `[System Note: Below is a compacted summary of the conversation history prior to the last few turns. Refer to this summary for context on what has already been done.]\n\n${summary}`
        };
        return [...systemMessages, summaryMessage, ...dropOrphanedToolResults(toKeep)];
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      log("warn", "[Context Compression] Request timed out after 40s.");
    } else {
      log("warn", `[Context Compression] Failed:`, err);
    }
  }

  // Fallback: truncation with pairing
  log("info", `[Context Compression] Falling back to truncation (keeping last ${toKeep.length + 6} messages).`);
  const fallbackStart = ensureToolPairing(activeMessages, Math.max(0, activeMessages.length - 12));
  const fallbackMsgs = dropOrphanedToolResults(activeMessages.slice(fallbackStart));

  return [...systemMessages, ...fallbackMsgs];
}
