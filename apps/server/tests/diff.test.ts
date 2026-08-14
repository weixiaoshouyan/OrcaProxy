/**
 * Unit tests for utils/diff.ts — line diff used in write-tool results.
 */
import { test, expect } from "./runner";

const { computeDiff, diffStats } = require("../utils/diff");

test("computeDiff returns empty for identical texts", () => {
  expect(computeDiff("a\nb\nc", "a\nb\nc")).toBe("");
});

test("computeDiff detects added lines", () => {
  const diff = computeDiff("a\nc", "a\nb\nc");
  expect(diff).toContain("+b");
  expect(diff).toContain("@@");
  expect(diff.includes("-b")).toBe(false);
});

test("computeDiff detects removed lines", () => {
  const diff = computeDiff("a\nb\nc", "a\nc");
  expect(diff).toContain("-b");
  expect(diff.includes("+b")).toBe(false);
});

test("computeDiff handles replacement in the middle of a large file", () => {
  const before = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const after = before.replace("line 50", "line 50 changed");
  const diff = computeDiff(before, after);
  expect(diff).toContain("-line 50");
  expect(diff).toContain("+line 50 changed");
  // Common prefix/suffix trimmed: the diff must NOT contain the first or last lines.
  expect(diff.includes("-line 0")).toBe(false);
  expect(diff.includes("-line 99")).toBe(false);
});

test("computeDiff caps output lines and notes truncation", () => {
  const before = Array.from({ length: 500 }, (_, i) => `old ${i}`).join("\n");
  const after = Array.from({ length: 500 }, (_, i) => `new ${i}`).join("\n");
  const diff = computeDiff(before, after, { maxLines: 40 });
  const lines = diff.split("\n");
  expect(lines.length).toBeLessThanOrEqual(42);
  expect(diff).toContain("truncated");
});

test("computeDiff degrades gracefully for huge middles (no hang)", () => {
  const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
  const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
  const start = Date.now();
  const diff = computeDiff(before, after, { maxMiddle: 10000 });
  expect(Date.now() - start).toBeLessThan(2000);
  // Replace-all fallback: deletes come first (within the 120-line cap), and
  // the truncation note must be present because the adds fall outside it.
  expect(diff).toContain("-a0");
  expect(diff).toContain("truncated");
});

test("diffStats reports added/removed counts", () => {
  expect(diffStats("a\nb", "a\nb\nc")).toEqual({ added: 1, removed: 0, changed: true });
  expect(diffStats("a\nb", "a")).toEqual({ added: 0, removed: 1, changed: true });
  expect(diffStats("x", "x")).toEqual({ added: 0, removed: 0, changed: false });
  expect(diffStats("", "hello")).toEqual({ added: 1, removed: 0, changed: true });
});

console.log("\n✅ All diff tests passed!");
