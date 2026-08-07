// ============================================================
// src/agent/types.ts
// Shared types for the agent system (messages, tools, models)
// ============================================================

import type { Provider } from "../providers";

// ---- Chat Message Types ----

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

// ---- Tool Types ----

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
  index?: number;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

// ---- Resolved Model ----

export interface ResolvedModel {
  provider: Provider;
  model: string;
  apiKey: string;
}

// ---- Usage / Token Info ----

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens: number;
  };
  input_token_details?: {
    cache_read: number;
  };
}

// ---- Stream Chunk Types ----

export interface StreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: StreamToolCallDelta[];
  };
  finish_reason: string | null;
}

export interface StreamToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface StreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: StreamChoice[];
  usage?: UsageInfo;
}

// ---- Non-streaming Response ----

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
  usage?: UsageInfo;
}

// ---- Anthropic Content Block (for normalization) ----

export interface AnthropicContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}
