// ============================================================
// src/anthropic.ts
// Anthropic Messages API <-> OpenAI Chat Completions 转换器
// 用于适配 Claude 桌面端
// ============================================================

import { randomUUID } from "crypto";

// ---- Anthropic 类型定义 ----------------------------------------------------

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: { type: string; name?: string };
  metadata?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  source?: { type: string; media_type: string; data: string };
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

// ---- 转换: Anthropic Request -> OpenAI Chat Request ------------------------

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: OpenAITool[];
  stop?: string[];
}

interface OpenAIMessage {
  role: string;
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export function transformAnthropicRequest(body: AnthropicRequest): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [];

  // system -> system message
  if (body.system) {
    const sysText = typeof body.system === "string"
      ? body.system
      : body.system.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
    messages.push({ role: "system", content: sysText });
  }

  // messages
  for (const msg of body.messages) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Array content - group by message to preserve mixed text+tool_use structure
    if (msg.role === "assistant") {
      let textParts: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          textParts.push(block.text || "");
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id || `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            type: "function",
            function: {
              name: block.name || "",
              arguments: JSON.stringify(block.input || {}),
            },
          });
        }
      }

      // Emit a single assistant message with both text and tool_calls
      const textContent = textParts.join("\n").trim() || null;
      if (toolCalls.length > 0) {
        messages.push({ role: "assistant", content: textContent, tool_calls: toolCalls });
      } else {
        messages.push({ role: "assistant", content: textContent });
      }
    } else {
      // User role: each block becomes a separate message (original behavior)
      for (const block of msg.content) {
        if (block.type === "text" && msg.role === "user") {
          messages.push({ role: "user", content: block.text || "" });
        } else if (block.type === "tool_result") {
          const resultContent = typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content.filter((b) => b.type === "text").map((b) => b.text || "").join("\n")
              : JSON.stringify(block.content);
          messages.push({
            role: "tool",
            tool_call_id: block.tool_use_id || "",
            content: resultContent,
          });
        }
      }
    }
  }

  // tools
  const tools: OpenAITool[] | undefined = body.tools?.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  
  // Merge consecutive same-role messages (required by DeepSeek, Qwen, etc.)
  const merged: OpenAIMessage[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role && !msg.tool_call_id && !last.tool_call_id && !msg.tool_calls && !last.tool_calls) {
      // Merge text content
      const lastText = typeof last.content === 'string' ? last.content : '';
      const msgText = typeof msg.content === 'string' ? msg.content : '';
      last.content = (lastText + '\n' + msgText).trim();
    } else {
      merged.push(msg);
    }
  }


  const req: OpenAIChatRequest = {
    model: body.model,
    messages: merged,
    stream: body.stream !== false,
    max_tokens: body.max_tokens,
  };

  if (body.temperature !== undefined) req.temperature = body.temperature;
  if (body.top_p !== undefined) req.top_p = body.top_p;
  if (tools && tools.length > 0) req.tools = tools;
  if (body.stop_sequences) req.stop = body.stop_sequences;

  return req;
}

// ---- 流式响应转换: OpenAI SSE -> Anthropic SSE ----------------------------

export interface AnthropicStreamState {
  messageId: string;
  model: string;
  role: "assistant";
  fullText: string;
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
  contentBlockIndex: number;
  started: boolean;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

export function createAnthropicStreamState(model: string): AnthropicStreamState {
  return {
    messageId: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    model,
    role: "assistant",
    fullText: "",
    toolCalls: new Map(),
    contentBlockIndex: 0,
    started: false,
    inputTokens: 0,
    outputTokens: 0,
    stopReason: null,
  };
}

function anthropicSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function anthropicStartEvents(state: AnthropicStreamState): string {
  let out = "";
  out += anthropicSse("message_start", {
    type: "message_start",
    message: {
      id: state.messageId,
      type: "message",
      role: state.role,
      content: [],
      model: state.model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: state.inputTokens, output_tokens: 0 },
    },
  });
  out += anthropicSse("ping", { type: "ping" });
  state.started = true;
  return out;
}

export function processAnthropicChunk(
  state: AnthropicStreamState,
  chunk: Record<string, unknown>
): string {
  let out = "";

  if (!state.started) {
    out += anthropicStartEvents(state);
  }

  const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  if (usage) {
    if (usage.prompt_tokens) state.inputTokens = usage.prompt_tokens;
    if (usage.completion_tokens) state.outputTokens = usage.completion_tokens;
  }

  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length === 0) return out;

  const choice = choices[0];
  const delta = (choice.delta || {}) as Record<string, unknown>;
  const finishReason = choice.finish_reason as string | null;
  if (finishReason) {
    state.stopReason = finishReason === "tool_calls" ? "tool_use" : "end_turn";
  }

  // Text content only. reasoning_content (DeepSeek) is tracked separately and
  // must not be mixed into the normal text stream.
  const content = delta.content as string | undefined;
  if (content) {
    if (state.fullText.length === 0 && state.toolCalls.size === 0) {
      // Start a text content block
      out += anthropicSse("content_block_start", {
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: { type: "text", text: "" },
      });
    }
    state.fullText += content;
    out += anthropicSse("content_block_delta", {
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: { type: "text_delta", text: content },
    });
  }

  // Tool calls
  const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
  if (toolCalls) {
    for (const tc of toolCalls) {
      const idx = tc.index as number;
      const fn = (tc.function || {}) as Record<string, unknown>;

      if (!state.toolCalls.has(idx)) {
        // Close text block if open
        if (state.fullText.length > 0 && state.toolCalls.size === 0) {
          out += anthropicSse("content_block_stop", {
            type: "content_block_stop",
            index: state.contentBlockIndex,
          });
          state.contentBlockIndex++;
        }

        const callId = (tc.id as string) || `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        state.toolCalls.set(idx, { id: callId, name: (fn.name as string) || "", arguments: "" });

        out += anthropicSse("content_block_start", {
          type: "content_block_start",
          index: state.contentBlockIndex + idx,
          content_block: { type: "tool_use", id: callId, name: (fn.name as string) || "", input: {} },
        });
      }

      const tcData = state.toolCalls.get(idx)!;
      if (fn.name) tcData.name = fn.name as string;
      if (fn.arguments) {
        tcData.arguments += fn.arguments as string;
        out += anthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: state.contentBlockIndex + idx,
          delta: { type: "input_json_delta", partial_json: fn.arguments },
        });
      }
    }
  }

  return out;
}

export function generateAnthropicEndEvents(state: AnthropicStreamState): string {
  let out = "";

  if (!state.started) {
    out += anthropicStartEvents(state);
  }

  // Close all open content blocks
  if (state.toolCalls.size > 0) {
    for (let i = 0; i < state.toolCalls.size; i++) {
      out += anthropicSse("content_block_stop", {
        type: "content_block_stop",
        index: state.contentBlockIndex + i,
      });
    }
  } else {
    // Close text block
    out += anthropicSse("content_block_stop", {
      type: "content_block_stop",
      index: state.contentBlockIndex,
    });
  }

  out += anthropicSse("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: state.stopReason || "end_turn",
      stop_sequence: null,
    },
    usage: { output_tokens: state.outputTokens },
  });

  out += anthropicSse("message_stop", { type: "message_stop" });

  return out;
}

export function formatAnthropicError(statusCode: number, message: string): string {
  return anthropicSse("error", {
    type: "error",
    error: {
      type: statusCode >= 500 ? "api_error" : "invalid_request_error",
      message,
    },
  });
}
// ============================================================
// Anthropic SSE 鈫?OpenAI SSE conversion
// Used by /v1/chat/completions when target is Anthropic
// ============================================================

export interface AnthropicToOpenAIState {
  chatId: string;
  model: string;
  role: string;
  started: boolean;
  contentBlockType: string | null;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  fullText: string;
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
  currentBlockIndex: number;
}

export function createAnthropicToOpenAIState(model: string): AnthropicToOpenAIState {
  return {
    chatId: 'chatcmpl-' + randomUUID().replace(/-/g, '').slice(0, 24),
    model,
    role: 'assistant',
    started: false,
    contentBlockType: null,
    finishReason: null,
    inputTokens: 0,
    outputTokens: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    fullText: '',
    toolCalls: new Map(),
    currentBlockIndex: 0,
  };
}

function openaiSse(data: unknown): string {
  return 'data: ' + JSON.stringify(data) + '\n\n';
}

export function processAnthropicToOpenAIChunk(
  state: AnthropicToOpenAIState,
  chunk: Record<string, unknown>
): string {
  const chunkType = chunk.type as string;
  if (!chunkType) return '';

  let out = '';
  const now = Math.floor(Date.now() / 1000);

  switch (chunkType) {
    case 'message_start': {
      const msg = (chunk.message || {}) as Record<string, unknown>;
      const usage = (msg.usage || {}) as Record<string, unknown>;
      if (usage.input_tokens) state.inputTokens = usage.input_tokens as number;
      state.usage.prompt_tokens = state.inputTokens;
      state.usage.total_tokens = state.inputTokens + state.outputTokens;
      state.started = true;
      out += openaiSse({
        id: state.chatId, object: 'chat.completion.chunk', created: now, model: state.model,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      });
      break;
    }
    case 'content_block_start': {
      const cb = (chunk.content_block || {}) as Record<string, unknown>;
      state.contentBlockType = cb.type as string || 'text';
      state.currentBlockIndex = (chunk.index as number) ?? state.currentBlockIndex;
      if (cb.type === 'tool_use') {
        const toolIdx = state.toolCalls.size;
        const callId = (cb.id as string) || ('toolu_' + randomUUID().replace(/-/g, '').slice(0, 24));
        state.toolCalls.set(toolIdx, { id: callId, name: (cb.name as string) || '', arguments: '' });
        out += openaiSse({
          id: state.chatId, object: 'chat.completion.chunk', created: now, model: state.model,
          choices: [{ index: 0, delta: { tool_calls: [{ index: toolIdx, id: callId, type: 'function', function: { name: cb.name || '', arguments: '' } }] }, finish_reason: null }],
        });
      }
      break;
    }
    case 'content_block_delta': {
      const delta = (chunk.delta || {}) as Record<string, unknown>;
      if (delta.type === 'text_delta' && delta.text) {
        state.fullText += delta.text as string;
        out += openaiSse({
          id: state.chatId, object: 'chat.completion.chunk', created: now, model: state.model,
          choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
        });
      } else if (delta.type === 'input_json_delta' && delta.partial_json) {
        // Emit as OpenAI tool_calls delta with partial arguments
        const toolIdx = state.toolCalls.size - 1;
        if (toolIdx >= 0 && state.toolCalls.has(toolIdx)) {
          const tc = state.toolCalls.get(toolIdx)!;
          tc.arguments += delta.partial_json as string;
          out += openaiSse({
            id: state.chatId, object: 'chat.completion.chunk', created: now, model: state.model,
            choices: [{ index: 0, delta: { tool_calls: [{ index: toolIdx, function: { arguments: delta.partial_json } }] }, finish_reason: null }],
          });
        }
      }
      break;
    }
    case 'content_block_stop': {
      state.contentBlockType = null;
      break;
    }
    case 'message_delta': {
      const delta = (chunk.delta || {}) as Record<string, unknown>;
      if (delta.stop_reason) {
        const sr = delta.stop_reason as string;
        state.finishReason = sr === 'end_turn' ? 'stop' : (sr === 'tool_use' ? 'tool_calls' : sr);
      }
      const usage = (chunk.usage || {}) as Record<string, unknown>;
      if (usage.output_tokens) state.outputTokens = usage.output_tokens as number;
      state.usage.completion_tokens = state.outputTokens;
      state.usage.total_tokens = state.inputTokens + state.outputTokens;
      break;
    }
    case 'message_stop': {
      // Final event - emit finish chunk
      const effectiveFinishReason = state.toolCalls.size > 0 ? 'tool_calls' : (state.finishReason || 'stop');
      out += openaiSse({
        id: state.chatId, object: 'chat.completion.chunk', created: now, model: state.model,
        choices: [{ index: 0, delta: {}, finish_reason: effectiveFinishReason }],
      });
      out += openaiSse({
        id: state.chatId, object: 'chat.completion.chunk', created: now, model: state.model,
        choices: [],
        usage: { prompt_tokens: state.inputTokens, completion_tokens: state.outputTokens, total_tokens: state.inputTokens + state.outputTokens },
      });
      out += 'data: [DONE]\n\n';
      break;
    }
    case 'ping':
    case 'error':
      break;
  }
  return out;
}

export function generateAnthropicToOpenAIEndEvents(state: AnthropicToOpenAIState): string {
  if (state.finishReason) return ''; // already emitted in message_stop
  const now = Math.floor(Date.now() / 1000);
  let out = '';
  out += openaiSse({
    id: state.chatId, object: 'chat.completion.chunk', created: now, model: state.model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });
  out += 'data: [DONE]\n\n';
  return out;
}
