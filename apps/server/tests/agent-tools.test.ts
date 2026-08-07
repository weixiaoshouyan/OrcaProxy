/**
 * Unit tests for git tools, autofix, codebase, and memory
 * Run: npx ts-node src/tests/agent-tools.test.ts
 */
import { test, expect } from "./runner";

// ---- Git Tools tests ----
const { getGitStatus, formatGitStatusForAgent } = require("../agent/git-tools");

test("getGitStatus detects non-git directory", () => {
  const status = getGitStatus("/tmp");
  expect(status.isRepo).toBe(false);
});

test("getGitStatus returns valid structure for git repo", () => {
  const status = getGitStatus(".");
  expect(typeof status.isRepo).toBe("boolean");
  expect(typeof status.branch).toBe("string");
  expect(Array.isArray(status.modified)).toBe(true);
  expect(Array.isArray(status.staged)).toBe(true);
  expect(Array.isArray(status.untracked)).toBe(true);
});

test("formatGitStatusForAgent formats non-repo", () => {
  const formatted = formatGitStatusForAgent({ isRepo: false, branch: "", ahead: 0, behind: 0, modified: [], staged: [], untracked: [], conflicted: [] });
  expect(formatted).toContain("Not a git repository");
});

test("formatGitStatusForAgent formats clean repo", () => {
  const formatted = formatGitStatusForAgent({ isRepo: true, branch: "main", ahead: 0, behind: 0, modified: [], staged: [], untracked: [], conflicted: [] });
  expect(formatted).toContain("main");
  expect(formatted).toContain("clean");
});

test("formatGitStatusForAgent shows modified files", () => {
  const formatted = formatGitStatusForAgent({ isRepo: true, branch: "main", ahead: 0, behind: 0, modified: ["src/index.ts"], staged: [], untracked: ["new.txt"], conflicted: [] });
  expect(formatted).toContain("Modified");
  expect(formatted).toContain("Untracked");
});

// ---- Autofix tests ----
const { parseTscOutput, parseEslintOutput, detectLintTools, formatErrorsForAgent } = require("../agent/autofix");

test("parseTscOutput extracts errors", () => {
  const output = "src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.";
  const errors = parseTscOutput(output);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors[0].file).toBe("src/index.ts");
  expect(errors[0].line).toBe(10);
  expect(errors[0].rule).toBe("TS2322");
});

test("parseTscOutput handles empty output", () => {
  const errors = parseTscOutput("");
  expect(errors.length).toBe(0);
});

test("parseEslintOutput parses JSON", () => {
  const output = JSON.stringify([{ filePath: "/project/src/index.ts", messages: [{ line: 5, column: 1, ruleId: "no-unused-vars", message: "'x' is assigned but never used", severity: 2 }] }]);
  const errors = parseEslintOutput(output);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors[0].rule).toBe("no-unused-vars");
});

test("detectLintTools returns structure", () => {
  const tools = detectLintTools(".");
  expect(typeof tools.tsc).toBe("boolean");
  expect(typeof tools.eslint).toBe("boolean");
  expect(typeof tools.prettier).toBe("boolean");
  expect(typeof tools.npmTest).toBe("boolean");
});

test("formatErrorsForAgent shows no errors message", () => {
  const formatted = formatErrorsForAgent([]);
  expect(formatted).toContain("No lint errors");
});

test("formatErrorsForAgent lists errors", () => {
  const errors = [
    { file: "src/index.ts", line: 10, column: 5, rule: "TS2322", message: "Type mismatch", severity: "error" as const }
  ];
  const formatted = formatErrorsForAgent(errors);
  expect(formatted).toContain("TS2322");
  expect(formatted).toContain("src/index.ts");
});

// ---- Codebase tests ----
const { generateRepoMap, findRelevantFiles } = require("../agent/codebase");

test("generateRepoMap returns structure", () => {
  const map = generateRepoMap(".", 10);
  expect(typeof map.totalFiles).toBe("number");
  expect(typeof map.totalLines).toBe("number");
  expect(typeof map.languages).toBe("object");
  expect(Array.isArray(map.importantFiles)).toBe(true);
  expect(typeof map.structure).toBe("string");
});

test("generateRepoMap handles empty path", () => {
  const map = generateRepoMap("", 10);
  expect(map.totalFiles).toBe(0);
});

test("findRelevantFiles returns matches", () => {
  const files = findRelevantFiles(".", "agent loop", 5);
  expect(Array.isArray(files)).toBe(true);
});

test("findRelevantFiles handles empty query", () => {
  const files = findRelevantFiles(".", "");
  expect(files.length).toBe(0);
});

// ---- Memory tests ----
import fs from "fs";
import os from "os";
import pathTmp from "path";
const { loadProjectRules, buildMemoryContext, isMemoryFile, listMemoryFiles, saveUserPreferences, loadUserPreferences } = require("../agent/memory");

test("saveUserPreferences then loadUserPreferences round-trips", () => {
  const dir = pathTmp.join(os.tmpdir(), `orca-mem-test-${Date.now()}`);
  fs.mkdirSync(pathTmp.join(dir, ".orca"), { recursive: true });
  const save = saveUserPreferences(dir, "Use 2 spaces for indentation.");
  expect(save.ok).toBe(true);
  expect(save.path).toBe(pathTmp.join(dir, ".orca", "preferences.md"));
  const loaded = loadUserPreferences(dir);
  expect(loaded).toContain("2 spaces");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadProjectRules returns empty for non-existent", () => {
  const rules = loadProjectRules("/nonexistent/path");
  expect(rules).toBe("");
});

test("buildMemoryContext returns empty for no memory", () => {
  const context = buildMemoryContext("/nonexistent/path");
  expect(context).toBe("");
});

test("isMemoryFile detects ORCA.md", () => {
  expect(isMemoryFile("ORCA.md")).toBe(true);
  expect(isMemoryFile(".orcarules")).toBe(true);
  expect(isMemoryFile("src/index.ts")).toBe(false);
});

test("listMemoryFiles returns array", () => {
  const files = listMemoryFiles(".");
  expect(Array.isArray(files)).toBe(true);
});

console.log("\n✅ All agent tools tests passed!");
