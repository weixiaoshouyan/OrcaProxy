// ============================================================
// src/transform.ts
// Protocol transformation: Responses API <-> Chat Completions API
// Used by Codex CLI proxying
// ============================================================

import { randomUUID } from "crypto";

// ---- Types ----------------------------------------------------------------

export interface ResponsesRequest {
  model: string;
  input: string | InputItem[];
  instructions?: string;
  tools?: ResponsesTool[];
  stream?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  store?: boolean;
  metadata?: Record<string, unknown>;
  previous_response_id?: string;
  parallel_tool_calls?: boolean;
  response_format?: unknown;
  [key: string]: unknown;
}

interface InputItem {
  type?: string;
  role?: string;
  content?: string | ContentPart[];
  name?: string;
  call_id?: string;
  arguments?: string;
  output?: string;
  [key: string]: unknown;
}

interface ContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface ResponsesTool {
  type?: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  [key: string]: unknown;
}

interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

// ---- Input conversion -----------------------------------------------------

function extractTextContent(content: string | ContentPart[] | undefined): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "input_text" || part.type === "output_text") return part.text || "";
        if (part.type === "text") return part.text || "";
        return "";
      })
      .join("");
  }
  return String(content);
}

function mapRole(role: string): string {
  if (role === "developer") return "system";
  return role;
}

function convertInputItem(item: InputItem): ChatMessage | ChatMessage[] | null {
  if (item.type === "function_call_output") {
    return {
      role: "tool",
      tool_call_id: item.call_id || "",
      content: typeof item.output === "string" ? item.output : JSON.stringify(item.output),
    };
  }

  if (item.type === "function_call") {
    return {
      role: "assistant",
      content: null as unknown as string,
      tool_calls: [{
        id: item.call_id || `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        type: "function",
        function: { name: item.name || "", arguments: item.arguments || "{}" },
      }],
    };
  }

  const role = item.role;
  if (role === "user" || role === "assistant" || role === "system" || role === "developer") {
    const msg: ChatMessage = { role: mapRole(role), content: extractTextContent(item.content) };
    // Preserve reasoning_content for DeepSeek reasoning models
    if ((item as any).reasoning_content) {
      (msg as any).reasoning_content = (item as any).reasoning_content;
    }
    return msg;
  }

  if (item.type === "message") {
    return { role: mapRole(role || "user"), content: extractTextContent(item.content) };
  }

  return null;
}

function convertInput(body: ResponsesRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (body.instructions) {
    messages.push({ role: "system", content: body.instructions });
  }
  if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
    return messages;
  }
  for (const item of body.input) {
    const msg = convertInputItem(item);
    if (msg) {
      if (Array.isArray(msg)) messages.push(...msg);
      else messages.push(msg);
    }
  }
  return messages;
}

function convertTools(tools: ResponsesTool[] | undefined): ChatTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools
    .filter((t) => t.type === "function" || t.name)
    .map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters, strict: t.strict },
    }));
}

// ---- Main request transformer ---------------------------------------------

export function transformRequest(body: ResponsesRequest, modelOverride?: string): ChatRequest {
  const model = modelOverride || body.model;
  const messages = convertInput(body);
  const tools = convertTools(body.tools);

  const chatReq: ChatRequest = { model, messages, stream: true };
  if (tools) chatReq.tools = tools;
  if (body.temperature !== undefined) chatReq.temperature = body.temperature;
  if (body.top_p !== undefined) chatReq.top_p = body.top_p;
  if (body.max_output_tokens !== undefined) chatReq.max_tokens = body.max_output_tokens;

  return chatReq;
}

// ---- Streaming response transformation ------------------------------------

export interface StreamState {
  responseId: string;
  itemId: string;
  model: string;
  fullText: string;
  reasoningContent: string;
  started: boolean;
  toolCalls: Map<number, { id: string; name: string; arguments: string; fcId: string }>;
  finishReason: string | null;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number; input_tokens_details?: { cached_tokens: number } } | null;
}

export function createStreamState(model: string): StreamState {
  return {
    responseId: `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    itemId: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    model,
    fullText: "",
    reasoningContent: "",
    started: false,
    toolCalls: new Map(),
    finishReason: null,
    usage: null,
  };
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function generateStartEvents(state: StreamState): string {
  const now = Math.floor(Date.now() / 1000);
  let out = "";
  out += sse("response.created", {
    type: "response.created",
    response: { id: state.responseId, object: "response", created_at: now, status: "in_progress", model: state.model, output: [], usage: null },
  });
  out += sse("response.in_progress", {
    type: "response.in_progress",
    response: { id: state.responseId, object: "response", created_at: now, status: "in_progress", model: state.model, output: [], usage: null },
  });
  out += sse("response.output_item.added", {
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "message", id: state.itemId, role: "assistant", status: "in_progress", content: [] },
  });
  out += sse("response.content_part.added", {
    type: "response.content_part.added",
    output_index: 0, content_index: 0,
    part: { type: "output_text", text: "" },
  });
  state.started = true;
  return out;
}

export function processChunk(state: StreamState, chunk: Record<string, unknown>): string {
  let out = "";
  const rawUsage = chunk.usage as Record<string, any> | undefined;
  if (rawUsage) {
    state.usage = {
      input_tokens: rawUsage.prompt_tokens || 0,
      output_tokens: rawUsage.completion_tokens || 0,
      total_tokens: rawUsage.total_tokens || ((rawUsage.prompt_tokens || 0) + (rawUsage.completion_tokens || 0)),
      ...(rawUsage.prompt_tokens_details?.cached_tokens !== undefined ? { input_tokens_details: { cached_tokens: rawUsage.prompt_tokens_details.cached_tokens } } : {}),
    };
  }

  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length === 0) return out;

  const choice = choices[0];
  const delta = (choice.delta || {}) as Record<string, unknown>;
  const finishReason = choice.finish_reason as string | null;
  if (finishReason) state.finishReason = finishReason;

  if (!state.started) out += generateStartEvents(state);

  // Track reasoning_content separately for DeepSeek
  const reasoningContent = delta.reasoning_content as string | undefined;
  if (reasoningContent) {
    state.reasoningContent += reasoningContent;
  }

  const content = (delta.content || delta.reasoning_content) as string | undefined;
  if (content) {
    state.fullText += content;
    out += sse("response.output_text.delta", {
      type: "response.output_text.delta", output_index: 0, content_index: 0, delta: content,
    });
  }

  const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
  if (toolCalls) {
    for (const tc of toolCalls) {
      const idx = tc.index as number;
      const fn = (tc.function || {}) as Record<string, unknown>;
      if (!state.toolCalls.has(idx)) {
        const newFcId = `fc_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        state.toolCalls.set(idx, {
          id: (tc.id as string) || `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          name: (fn.name as string) || "", arguments: "", fcId: newFcId,
        });
        const tcData = state.toolCalls.get(idx)!;
        out += sse("response.output_item.added", {
          type: "response.output_item.added", output_index: idx,
          item: { type: "function_call", id: tcData.fcId, call_id: tcData.id, name: tcData.name, arguments: "", status: "in_progress" },
        });
      }
      const tcData = state.toolCalls.get(idx)!;
      if (fn.name) tcData.name = fn.name as string;
      if (fn.arguments) {
        tcData.arguments += fn.arguments as string;
        out += sse("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta", output_index: idx, delta: fn.arguments,
        });
      }
    }
  }
  return out;
}

export function generateEndEvents(state: StreamState): string {
  let out = "";
  if (!state.started) out += generateStartEvents(state);

  if (state.toolCalls.size > 0) {
    for (const [idx, tc] of state.toolCalls) {
      out += sse("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done", output_index: idx, arguments: tc.arguments,
      });
      out += sse("response.output_item.done", {
        type: "response.output_item.done", output_index: idx,
        item: { type: "function_call", id: tc.fcId, call_id: tc.id, name: tc.name, arguments: tc.arguments, status: "completed" },
      });
    }
  } else {
    out += sse("response.content_part.done", {
      type: "response.content_part.done", output_index: 0, content_index: 0,
      part: { type: "output_text", text: state.fullText },
    });
    out += sse("response.output_item.done", {
      type: "response.output_item.done", output_index: 0,
      item: { type: "message", id: state.itemId, role: "assistant", status: "completed",
        content: [{ type: "output_text", text: state.fullText }] },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const output = state.toolCalls.size > 0
    ? Array.from(state.toolCalls.values()).map((tc) => ({
        type: "function_call", id: tc.fcId,
        call_id: tc.id, name: tc.name, arguments: tc.arguments, status: "completed",
      }))
    : [{ type: "message", id: state.itemId, role: "assistant", status: "completed",
        content: [{ type: "output_text", text: state.fullText }],
        ...(state.reasoningContent ? { reasoning_content: state.reasoningContent } : {}) }];

  out += sse("response.completed", {
    type: "response.completed",
    response: {
      id: state.responseId, object: "response", created_at: now, status: "completed",
      model: state.model, output,
      usage: state.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    },
  });
  return out;
}

export function formatError(statusCode: number, message: string): string {
  return sse("error", { type: "error", code: statusCode, message, param: null,  });
}
