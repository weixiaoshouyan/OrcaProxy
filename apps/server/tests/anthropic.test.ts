/**
 * Unit tests for anthropic.ts — Anthropic Messages API ↔ OpenAI transformation
 */
import { test, expect } from "./runner";

const { transformAnthropicRequest, createAnthropicStreamState, processAnthropicChunk, generateAnthropicEndEvents, createAnthropicToOpenAIState, processAnthropicToOpenAIChunk, openAIMessagesToAnthropic } = require("../anthropic");

test("transformAnthropicRequest converts basic request", () => {
  const body = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
  };
  const result = transformAnthropicRequest(body);
  expect(result.model).toBe("claude-3-5-sonnet-20241022");
  expect(result.stream).toBe(true);
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].role).toBe("user");
});

test("transformAnthropicRequest handles system prompt", () => {
  const body: any = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hello" }],
  };
  const result = transformAnthropicRequest(body);
  expect(result.messages[0].role).toBe("system");
  expect(result.messages[0].content).toBe("You are a helpful assistant.");
});

test("transformAnthropicRequest preserves temperature and top_p", () => {
  const body: any = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Test" }],
    temperature: 0.3,
    top_p: 0.8,
  };
  const result = transformAnthropicRequest(body);
  expect(result.temperature).toBe(0.3);
  expect(result.top_p).toBe(0.8);
});

test("createAnthropicStreamState initializes", () => {
  const state = createAnthropicStreamState("claude-3-5-sonnet-20241022");
  expect(state.model).toBe("claude-3-5-sonnet-20241022");
  expect(state.fullText).toBe("");
  expect(state.stopReason).toBeNull();
});

test("processAnthropicChunk handles OpenAI text delta", () => {
  const state = createAnthropicStreamState("claude-3-5-sonnet-20241022");
  const chunk: any = {
    choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
  };
  const result = processAnthropicChunk(state, chunk);
  expect(result).toContain('"text":"Hello"');
});

test("createAnthropicToOpenAIState initializes", () => {
  const state = createAnthropicToOpenAIState("gpt-4o");
  expect(state.model).toBe("gpt-4o");
  expect(state.fullText).toBe("");
});

test("processAnthropicToOpenAIChunk handles message start", () => {
  const state = createAnthropicToOpenAIState("gpt-4o");
  const chunk: any = {
    type: "message_start",
    message: {
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  };
  const result = processAnthropicToOpenAIChunk(state, chunk);
  expect(state.usage).toBeTruthy();
});

test("processAnthropicToOpenAIChunk accumulates text", () => {
  const state = createAnthropicToOpenAIState("gpt-4o");
  processAnthropicToOpenAIChunk(state, {
    type: "content_block_delta",
    delta: { type: "text_delta", text: "Hello " },
  });
  processAnthropicToOpenAIChunk(state, {
    type: "content_block_delta",
    delta: { type: "text_delta", text: "World" },
  });
  expect(state.fullText).toBe("Hello World");
});

test("generateAnthropicEndEvents produces done event", () => {
  const state = createAnthropicStreamState("claude-3-5-sonnet-20241022");
  state.fullText = "Hello";
  state.stopReason = "stop";
  state.usage = { input_tokens: 5, output_tokens: 3, total_tokens: 8 };
  const result = generateAnthropicEndEvents(state);
  expect(result).toContain("stop_reason");
  expect(result).toContain("usage");
});

test("transformAnthropicRequest handles mixed text+tool_use in assistant message", () => {
  const body: any = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{
      role: "assistant",
      content: [
        { type: "text", text: "Let me help you with that." },
        { type: "tool_use", id: "tool_1", name: "read_file", input: { path: "test.ts" } },
      ],
    }],
  };
  const result = transformAnthropicRequest(body);
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].role).toBe("assistant");
  expect(result.messages[0].content).toBe("Let me help you with that.");
  expect(result.messages[0].tool_calls).toBeTruthy();
  expect(result.messages[0].tool_calls.length).toBe(1);
  expect(result.messages[0].tool_calls[0].function.name).toBe("read_file");
});

test("transformAnthropicRequest handles multiple tool_use in single assistant message", () => {
  const body: any = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{
      role: "assistant",
      content: [
        { type: "tool_use", id: "tool_1", name: "read_file", input: { path: "a.ts" } },
        { type: "tool_use", id: "tool_2", name: "write_file", input: { path: "b.ts" } },
      ],
    }],
  };
  const result = transformAnthropicRequest(body);
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].role).toBe("assistant");
  expect(result.messages[0].tool_calls.length).toBe(2);
});

test("transformAnthropicRequest handles tool_result blocks", () => {
  const body: any = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tool_1", content: "file content here" },
      ],
    }],
  };
  const result = transformAnthropicRequest(body);
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].role).toBe("tool");
  expect(result.messages[0].tool_call_id).toBe("tool_1");
  expect(result.messages[0].content).toBe("file content here");
});

// ---- openAIMessagesToAnthropic (agent loop → Anthropic Messages API) ----

test("openAIMessagesToAnthropic extracts system text and user message", () => {
  const { system, messages } = openAIMessagesToAnthropic([
    { role: "system", content: "You are Orca." },
    { role: "user", content: "Hello" },
  ]);
  expect(system).toBe("You are Orca.");
  expect(messages.length).toBe(1);
  expect(messages[0].role).toBe("user");
  expect(messages[0].content).toBe("Hello");
});

test("openAIMessagesToAnthropic converts assistant tool_calls to tool_use blocks", () => {
  const { messages } = openAIMessagesToAnthropic([
    {
      role: "assistant",
      content: "Let me read that.",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "read_workspace_file", arguments: JSON.stringify({ relativeFilePath: "src/a.ts" }) } }],
    },
  ]);
  expect(messages.length).toBe(1);
  expect(messages[0].role).toBe("assistant");
  const blocks = messages[0].content as any[];
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks[0].type).toBe("text");
  expect(blocks[1].type).toBe("tool_use");
  expect(blocks[1].name).toBe("read_workspace_file");
  expect(blocks[1].input.relativeFilePath).toBe("src/a.ts");
});

test("openAIMessagesToAnthropic converts tool results to user tool_result blocks and merges consecutive", () => {
  const { messages } = openAIMessagesToAnthropic([
    { role: "tool", tool_call_id: "call_1", content: "file content A" },
    { role: "tool", tool_call_id: "call_2", content: "file content B" },
  ]);
  // Consecutive tool results MUST merge into a single user message —
  // Anthropic rejects non-alternating roles.
  expect(messages.length).toBe(1);
  expect(messages[0].role).toBe("user");
  const blocks = messages[0].content as any[];
  expect(blocks.length).toBe(2);
  expect(blocks[0].type).toBe("tool_result");
  expect(blocks[0].tool_use_id).toBe("call_1");
  expect(blocks[1].tool_use_id).toBe("call_2");
  expect(blocks[1].content).toBe("file content B");
});

test("openAIMessagesToAnthropic merges consecutive user texts", () => {
  const { messages } = openAIMessagesToAnthropic([
    { role: "user", content: "Part one" },
    { role: "user", content: "Part two" },
  ]);
  expect(messages.length).toBe(1);
  expect(messages[0].content).toContain("Part one");
  expect(messages[0].content).toContain("Part two");
});

test("openAIMessagesToAnthropic full agent round-trip alternates roles", () => {
  const { messages } = openAIMessagesToAnthropic([
    { role: "system", content: "sys" },
    { role: "user", content: "Fix the bug" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "write_workspace_file", arguments: "{\"relativeFilePath\":\"a.ts\",\"content\":\"x\"}" } }] },
    { role: "tool", tool_call_id: "c1", content: "Success" },
    { role: "assistant", content: "Done." },
  ]);
  expect(messages.length).toBe(4); // user, assistant(tool_use), user(tool_result), assistant(text)
  expect(messages.map((m: any) => m.role).join(",")).toBe("user,assistant,user,assistant");
  const assistantBlocks = messages[1].content as any[];
  expect(assistantBlocks[0].type).toBe("tool_use");
  expect(assistantBlocks[0].input.relativeFilePath).toBe("a.ts");
});

test("openAIMessagesToAnthropic malformed tool arguments degrade to empty input", () => {
  const { messages } = openAIMessagesToAnthropic([
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "foo", arguments: "{truncated" } }] },
  ]);
  const blocks = messages[0].content as any[];
  expect(blocks[0].type).toBe("tool_use");
  expect(blocks[0].input).toEqual({});
});

console.log("\n✅ All anthropic tests passed!");
