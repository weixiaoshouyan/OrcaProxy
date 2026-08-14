/**
 * Unit tests for providers.ts security guards — isSafeRoutingPattern.
 * Routing patterns are user-supplied regexes evaluated against request inputs
 * on every request; catastrophic patterns must be rejected up front.
 */
import { test, expect } from "./runner";

const { isSafeRoutingPattern } = require("../providers");

test("isSafeRoutingPattern accepts plain simple patterns", () => {
  expect(isSafeRoutingPattern("codex")).toBe(true);
  expect(isSafeRoutingPattern("chat")).toBe(true);
  expect(isSafeRoutingPattern("api/.*")).toBe(true);
  expect(isSafeRoutingPattern("(codex|chat)")).toBe(true);
});

test("isSafeRoutingPattern rejects nested quantifier groups", () => {
  expect(isSafeRoutingPattern("(a+)+")).toBe(false);
  expect(isSafeRoutingPattern("(a*)*")).toBe(false);
  expect(isSafeRoutingPattern("(a|a)+")).toBe(false);
  expect(isSafeRoutingPattern("(a+){2,}")).toBe(false);
});

test("isSafeRoutingPattern rejects alternation groups with trailing quantifier (ReDoS)", () => {
  // Classic catastrophic backtracking: (a|aa)+$ hangs on long 'a' runs.
  expect(isSafeRoutingPattern("(a|aa)+$")).toBe(false);
  expect(isSafeRoutingPattern("(x|y)*")).toBe(false);
  expect(isSafeRoutingPattern("(ab|ba)+")).toBe(false);
});

test("isSafeRoutingPattern rejects quantifier chains and bad inputs", () => {
  expect(isSafeRoutingPattern("a++")).toBe(false);
  expect(isSafeRoutingPattern("a*+")).toBe(false);
  expect(isSafeRoutingPattern("")).toBe(false);
  expect(isSafeRoutingPattern("a")).toBe(false); // too short (< 2 chars)
  expect(isSafeRoutingPattern(123 as unknown as string)).toBe(false);
  expect(isSafeRoutingPattern("x".repeat(101))).toBe(false); // too long
});

console.log("\n✅ All providers security tests passed!");
