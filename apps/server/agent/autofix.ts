// ============================================================
// src/agent/autofix.ts
// Auto-fix loop: detect lint/test errors → fix → re-verify
// Inspired by Claude Code's auto-fix and Aider's lint-fix cycle
// ============================================================

import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { log } from "../utils/log";

export interface LintError {
  file: string;
  line: number;
  column?: number;
  rule: string;
  message: string;
  severity: "error" | "warning";
}

export interface TestError {
  file: string;
  testName: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface FixResult {
  fixed: boolean;
  errors: LintError[];
  rawOutput: string;
  attempts: number;
}

/**
 * Parse TypeScript compiler errors from tsc output
 */
export function parseTscOutput(output: string): LintError[] {
  const errors: LintError[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(\w+):\s+(.+)$/);
    if (match) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        rule: match[4],
        message: match[5],
        severity: "error"
      });
    }
  }
  return errors;
}

/**
 * Parse ESLint JSON output
 */
export function parseEslintOutput(output: string): LintError[] {
  const errors: LintError[] = [];
  try {
    const results = JSON.parse(output);
    for (const file of results) {
      for (const msg of file.messages || []) {
        errors.push({
          file: file.filePath,
          line: msg.line,
          column: msg.column,
          rule: msg.ruleId || "unknown",
          message: msg.message,
          severity: msg.severity === 2 ? "error" : "warning"
        });
      }
    }
  } catch {
    const lines = output.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s+\S+)?$/);
      if (match) {
        errors.push({
          file: "",
          line: parseInt(match[1]),
          column: parseInt(match[2]),
          rule: "parse-error",
          message: match[4],
          severity: match[3] as "error" | "warning"
        });
      }
    }
  }
  return errors;
}

/**
 * Parse Jest/Vitest test output for failures
 */
function parseTestOutput(output: string): TestError[] {
  const errors: TestError[] = [];
  const lines = output.split("\n");

  let currentFile = "";
  let currentTest = "";

  for (const line of lines) {
    const fileMatch = line.match(/^\s*(FAIL|PASS)\s+(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[2].trim();
    }

    const testMatch = line.match(/^\s+✕\s+(.+)$/) || line.match(/^\s+×\s+(.+)$/);
    if (testMatch) {
      currentTest = testMatch[1].trim();
    }

    if (currentTest && line.includes("Error:")) {
      errors.push({
        file: currentFile,
        testName: currentTest,
        message: line.trim(),
      });
    }
  }
  return errors;
}

/**
 * Detect available linting tools in the workspace
 */
export function detectLintTools(workspacePath: string): {
  tsc: boolean;
  eslint: boolean;
  prettier: boolean;
  npmTest: boolean;
} {
  const pkgPath = path.join(workspacePath, "package.json");
  let pkg: any = {};
  try {
    if (fs.existsSync(pkgPath)) pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch { /* ignore */ }

  return {
    tsc: fs.existsSync(path.join(workspacePath, "tsconfig.json")),
    eslint: !!pkg.scripts?.lint || fs.existsSync(path.join(workspacePath, ".eslintrc.js"))
      || fs.existsSync(path.join(workspacePath, ".eslintrc.json"))
      || fs.existsSync(path.join(workspacePath, "eslint.config.js")),
    prettier: !!pkg.scripts?.format || fs.existsSync(path.join(workspacePath, ".prettierrc")),
    npmTest: !!pkg.scripts?.test && pkg.scripts.test !== "echo \"Error: no test specified\"",
  };
}

/**
 * Run linting and return structured errors
 */
export function runLintCheck(workspacePath: string): { errors: LintError[]; rawOutput: string } {
  const tools = detectLintTools(workspacePath);
  const allErrors: LintError[] = [];
  let rawOutput = "";

  if (tools.tsc) {
    try {
      const output = execSync("npx tsc --noEmit --pretty false", {
        cwd: workspacePath, encoding: "utf-8", timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"]
      });
      rawOutput += output;
    } catch (e: any) {
      const output = (e.stdout || "") + (e.stderr || "");
      rawOutput += output;
      allErrors.push(...parseTscOutput(output));
    }
  }

  if (tools.eslint) {
    try {
      const output = execSync("npx eslint . --format json --quiet", {
        cwd: workspacePath, encoding: "utf-8", timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"]
      });
      rawOutput += output;
    } catch (e: any) {
      const output = (e.stdout || "") + (e.stderr || "");
      rawOutput += output;
      allErrors.push(...parseEslintOutput(output));
    }
  }

  return { errors: allErrors, rawOutput };
}

/**
 * Run tests and return structured failures
 */
export function runTestCheck(workspacePath: string): { errors: TestError[]; rawOutput: string } {
  const tools = detectLintTools(workspacePath);
  if (!tools.npmTest) return { errors: [], rawOutput: "No test script configured" };

  try {
    const output = execSync("npm test -- --reporter=verbose 2>&1", {
      cwd: workspacePath, encoding: "utf-8", timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { errors: [], rawOutput: output };
  } catch (e: any) {
    const output = (e.stdout || "") + (e.stderr || "");
    const errors = parseTestOutput(output);
    return { errors, rawOutput: output };
  }
}

/**
 * Format lint errors for the agent to understand and fix
 */
export function formatErrorsForAgent(errors: LintError[], maxErrors = 10): string {
  if (errors.length === 0) return "No lint errors found.";

  const sliced = errors.slice(0, maxErrors);
  const lines = sliced.map((e) =>
    `- ${e.file}:${e.line}${e.column ? ":" + e.column : ""} [${e.rule}] ${e.message}`
  );

  const truncated = errors.length > maxErrors
    ? `\n... and ${errors.length - maxErrors} more errors`
    : "";

  return `Lint Errors (${errors.length} total):\n${lines.join("\n")}${truncated}`;
}

/**
 * Format test errors for the agent
 */
export function formatTestErrorsForAgent(errors: TestError[], maxErrors = 5): string {
  if (errors.length === 0) return "All tests passed.";

  const sliced = errors.slice(0, maxErrors);
  const lines = sliced.map((e) =>
    `- ${e.file} > ${e.testName}: ${e.message.slice(0, 200)}`
  );

  return `Test Failures (${errors.length} total):\n${lines.join("\n")}`;
}
