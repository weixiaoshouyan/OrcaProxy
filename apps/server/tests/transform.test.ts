/**
 * Unit tests for transform.ts — OpenAI Responses API ↔ Chat Completions transformation
 * Run: npx ts-node src/tests/transform.test.ts
 */
import { test, expect } from "./runner";

// We test the pure transformation functions
const { transformRequest, createStreamState, processChunk, generateEndEvents } = require("../transform");

test("transformRequest converts basic Responses request to Chat request", () => {
  const body = {
    model: "gpt-4o",
    input: [{ role: "user", content: "Hello" }],
  };
  const result = transformRequest(body);
  expect(result.model).toBe("gpt-4o");
  expect(result.stream).toBe(true);
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].role).toBe("user");
  expect(result.messages[0].content).toBe("Hello");
});

test("transformRequest preserves temperature and top_p", () => {
  const body = {
    model: "gpt-4o",
    input: [{ role: "user", content: "Test" }],
    temperature: 0.5,
    top_p: 0.9,
  };
  const result = transformRequest(body);
  expect(result.temperature).toBe(0.5);
  expect(result.top_p).toBe(0.9);
});

test("transformRequest handles model override", () => {
  const body = {
    model: "gpt-4o",
    input: [{ role: "user", content: "Test" }],
  };
  const result = transformRequest(body, "deepseek-chat");
  expect(result.model).toBe("deepseek-chat");
});

test("transformRequest converts max_output_tokens to max_tokens", () => {
  const body: any = {
    model: "gpt-4o",
    input: [{ role: "user", content: "Test" }],
    max_output_tokens: 4096,
  };
  const result = transformRequest(body);
  expect(result.max_tokens).toBe(4096);
});

test("createStreamState initializes correctly", () => {
  const state = createStreamState("gpt-4o");
  expect(state.model).toBe("gpt-4o");
  expect(state.fullText).toBe("");
  expect(state.started).toBe(false);
  expect(state.finishReason).toBeNull();
  expect(state.responseId).toBeTruthy();
  expect(state.itemId).toBeTruthy();
});

test("processChunk handles text content delta", () => {
  const state = createStreamState("gpt-4o");
  const chunk = {
    choices: [{
      index: 0,
      delta: { content: "Hello" },
      finish_reason: null,
    }],
  };
  const result = processChunk(state, chunk);
  expect(state.fullText).toBe("Hello");
  // Should emit response created + output item added + content part added events
  expect(result).toContain("response.created");
  expect(result).toContain("Hello");
});

test("processChunk accumulates multiple text chunks", () => {
  const state = createStreamState("gpt-4o");
  processChunk(state, { choices: [{ index: 0, delta: { content: "Hello " }, finish_reason: null }] });
  processChunk(state, { choices: [{ index: 0, delta: { content: "World" }, finish_reason: null }] });
  expect(state.fullText).toBe("Hello World");
});

test("generateEndEvents produces done event with usage", () => {
  const state = createStreamState("gpt-4o");
  state.fullText = "Hello World";
  state.finishReason = "stop";
  state.usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
  const result = generateEndEvents(state);
  expect(result).toContain("response.completed");
  expect(result).toContain("response.completed");
  expect(result).toContain("total_tokens");
});

console.log("\n✅ All transform tests passed!");
