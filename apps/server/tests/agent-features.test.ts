/**
 * Unit tests for new agent features: reflection, tool-cache, subagent, events
 * Run: npx ts-node src/tests/agent-features.test.ts
 */
import { test, expect } from "./runner";

// ---- Tool Cache tests ----
const { getCachedToolResult, setCachedToolResult, CACHEABLE_TOOLS, invalidateCache } = require("../services/tool-cache");

test("CACHEABLE_TOOLS contains expected tools", () => {
  expect(CACHEABLE_TOOLS.has("read_workspace_file")).toBe(true);
  expect(CACHEABLE_TOOLS.has("search_grep")).toBe(true);
  expect(CACHEABLE_TOOLS.has("glob_files")).toBe(true);
  expect(CACHEABLE_TOOLS.has("write_workspace_file")).toBe(false);
  expect(CACHEABLE_TOOLS.has("run_terminal_command")).toBe(false);
});

test("tool cache stores and retrieves results", () => {
  invalidateCache();
  const args = { relativeFilePath: "test.ts" };
  setCachedToolResult("read_workspace_file", args, "file content here");
  const cached = getCachedToolResult("read_workspace_file", args);
  expect(cached).toBe("file content here");
});

test("tool cache returns null for cache miss", () => {
  invalidateCache();
  const result = getCachedToolResult("read_workspace_file", { relativeFilePath: "nonexistent.ts" });
  expect(result).toBeNull();
});

test("tool cache returns null for non-cacheable tools", () => {
  invalidateCache();
  const args = { command: "ls" };
  setCachedToolResult("run_terminal_command", args, "output");
  const result = getCachedToolResult("run_terminal_command", args);
  expect(result).toBeNull();
});

test("getCacheStats tracks hit rate", () => {
  invalidateCache();
  getCachedToolResult("read_workspace_file", { relativeFilePath: "miss.ts" }); // +1 miss
  setCachedToolResult("read_workspace_file", { relativeFilePath: "hit.ts" }, "data");
  getCachedToolResult("read_workspace_file", { relativeFilePath: "hit.ts" }); // +1 hit
  const stats = require("../services/tool-cache").getCacheStats();
  expect(stats.hits).toBe(1);
  expect(stats.misses).toBe(1);
  expect(stats.hitRate).toBe(0.5);
});

// ---- SubAgent tests ----
const { partitionToolCalls } = require("../agent/subagent");

test("partitionToolCalls creates correct batches", () => {
  const toolCalls = [
    { id: "1", function: { name: "read", arguments: "{}" } },
    { id: "2", function: { name: "read", arguments: "{}" } },
    { id: "3", function: { name: "read", arguments: "{}" } },
    { id: "4", function: { name: "read", arguments: "{}" } },
  ];
  const tasks = partitionToolCalls(toolCalls);
  expect(tasks.length).toBe(2);
  expect(tasks[0].toolCalls.length).toBe(3);
  expect(tasks[1].toolCalls.length).toBe(1);
});

test("partitionToolCalls gives tasks correct IDs", () => {
  const toolCalls = [
    { id: "1", function: { name: "read", arguments: "{}" } },
  ];
  const tasks = partitionToolCalls(toolCalls);
  expect(tasks[0].id).toBe("subagent_0");
  expect(tasks[0].status).toBe("pending");
});

// ---- Events tests ----
const { createAgentEvent, formatAgentEvent } = require("../agent/events");

test("createAgentEvent creates valid event", () => {
  const event = createAgentEvent("step_complete", "task-123", { stepId: "step-1" });
  expect(event.type).toBe("step_complete");
  expect(event.taskId).toBe("task-123");
  expect(event.data.stepId).toBe("step-1");
  expect(event.timestamp).toBeGreaterThan(0);
});

test("formatAgentEvent produces valid SSE format", () => {
  const event = createAgentEvent("tool_start", "task-123", { toolName: "read" });
  const sse = formatAgentEvent(event);
  expect(sse.startsWith("event: agent_event\ndata: ")).toBe(true);
  expect(sse).toContain('"type":"tool_start"');
  expect(sse).toContain('"taskId":"task-123"');
});

// ---- Compression tests ----
const { estimateMessageTokens, ensureToolPairing, dropOrphanedToolResults } = require("../agent/compression");

test("estimateMessageTokens counts basic message", () => {
  const tokens = estimateMessageTokens({ role: "user", content: "Hello world" });
  expect(tokens).toBeGreaterThan(0);
  expect(tokens).toBeLessThan(100);
});

test("estimateMessageTokens handles tool_calls", () => {
  const tokens = estimateMessageTokens({
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }]
  });
  expect(tokens).toBeGreaterThan(20);
});

test("estimateMessageTokens handles array content", () => {
  const tokens = estimateMessageTokens({
    role: "user",
    content: [{ type: "text", text: "Hello" }, { type: "text", text: "World" }]
  });
  expect(tokens).toBeGreaterThan(0);
});

test("ensureToolPairing expands start to include assistant tool calls", () => {
  const messages = [
    { role: "assistant", content: null, tool_calls: [{ id: "call_a", type: "function", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_a", content: "result" },
    { role: "user", content: "next" },
  ];
  const start = ensureToolPairing(messages, 1);
  expect(start).toBe(0);
});

test("dropOrphanedToolResults removes tool messages without matching assistant", () => {
  const messages = [
    { role: "tool", tool_call_id: "ghost", content: "orphaned" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_b", type: "function", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_b", content: "kept" },
    { role: "user", content: "next" },
  ];
  const cleaned = dropOrphanedToolResults(messages);
  expect(cleaned.length).toBe(3);
  expect(cleaned.some((m: any) => m.tool_call_id === "ghost")).toBe(false);
  expect(cleaned.some((m: any) => m.tool_call_id === "call_b")).toBe(true);
});

console.log("\n✅ All agent feature tests passed!");
