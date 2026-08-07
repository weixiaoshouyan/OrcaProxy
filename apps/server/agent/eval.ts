// ============================================================
// src/agent/eval.ts
// Lightweight SWE-bench-style agent evaluation framework
// ============================================================

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { resolveBaseDir } from "../utils/base-dir";
import { log } from "../utils/log";

export interface EvalTask {
  id: string;
  name: string;
  prompt: string;
  workspacePath: string;
  criteria: EvalCriterion[];
  maxIterations?: number;
}

export interface EvalCriterion {
  type: "file_exists" | "file_contains" | "command_passes" | "command_output_contains";
  target: string;
  value?: string;
}

export interface EvalResult {
  taskId: string;
  passed: boolean;
  score: number;
  total: number;
  details: { criterion: EvalCriterion; passed: boolean; note: string }[];
  durationMs: number;
  taskStateId?: string;
}

const EVAL_DIR = path.join(resolveBaseDir(__dirname, 2), "data", "eval");
if (!fs.existsSync(EVAL_DIR)) fs.mkdirSync(EVAL_DIR, { recursive: true });

function datasetPath(): string {
  return path.join(EVAL_DIR, "dataset.json");
}

function resultsPath(): string {
  return path.join(EVAL_DIR, "results.json");
}

export function loadDataset(): EvalTask[] {
  try {
    const p = datasetPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf-8")).tasks || [];
  } catch (e) {
    log("error", `[Eval] Failed to load dataset:`, e);
    return [];
  }
}

export function saveDataset(tasks: EvalTask[]): void {
  try {
    fs.writeFileSync(datasetPath(), JSON.stringify({ tasks }, null, 2), "utf-8");
  } catch (e) {
    log("error", `[Eval] Failed to save dataset:`, e);
  }
}

function fileExists(workspacePath: string, target: string): boolean {
  return fs.existsSync(path.join(workspacePath, target));
}

function fileContains(workspacePath: string, target: string, value?: string): boolean {
  if (!value) return false;
  try {
    const content = fs.readFileSync(path.join(workspacePath, target), "utf-8");
    return content.includes(value);
  } catch {
    return false;
  }
}

function commandPasses(workspacePath: string, command: string): { ok: boolean; output: string } {
  try {
    const output = execSync(command, { cwd: workspacePath, encoding: "utf-8", timeout: 120000 });
    return { ok: true, output: output.slice(0, 2000) };
  } catch (e: any) {
    const stderr = e.stderr ? String(e.stderr).slice(0, 2000) : "";
    const stdout = e.stdout ? String(e.stdout).slice(0, 2000) : "";
    return { ok: false, output: `${stdout}\n${stderr}`.trim() };
  }
}

export function evaluateTask(task: EvalTask, taskStateId?: string): EvalResult {
  const start = Date.now();
  const details: EvalResult["details"] = [];
  let passedCount = 0;

  for (const criterion of task.criteria) {
    let passed = false;
    let note = "";
    switch (criterion.type) {
      case "file_exists":
        passed = fileExists(task.workspacePath, criterion.target);
        note = passed ? `File exists: ${criterion.target}` : `File missing: ${criterion.target}`;
        break;
      case "file_contains":
        passed = fileContains(task.workspacePath, criterion.target, criterion.value);
        note = passed
          ? `File ${criterion.target} contains expected value`
          : `File ${criterion.target} does not contain expected value`;
        break;
      case "command_passes":
        {
          const r = commandPasses(task.workspacePath, criterion.target);
          passed = r.ok;
          note = r.ok ? `Command passed: ${criterion.target}` : `Command failed: ${criterion.target}\n${r.output}`;
        }
        break;
      case "command_output_contains":
        {
          const r = commandPasses(task.workspacePath, criterion.target);
          passed = r.ok && criterion.value ? r.output.includes(criterion.value) : r.ok;
          note = passed
            ? `Command output contains expected value`
            : `Command output does not contain expected value`;
        }
        break;
    }
    if (passed) passedCount++;
    details.push({ criterion, passed, note });
  }

  return {
    taskId: task.id,
    passed: passedCount === task.criteria.length,
    score: passedCount,
    total: task.criteria.length,
    details,
    durationMs: Date.now() - start,
    taskStateId,
  };
}

export function loadResults(): EvalResult[] {
  try {
    if (!fs.existsSync(resultsPath())) return [];
    return JSON.parse(fs.readFileSync(resultsPath(), "utf-8")).results || [];
  } catch (e) {
    log("error", `[Eval] Failed to load results:`, e);
    return [];
  }
}

export function appendResult(result: EvalResult): void {
  try {
    const results = loadResults().filter((r) => r.taskId !== result.taskId);
    results.push(result);
    fs.writeFileSync(resultsPath(), JSON.stringify({ results, updatedAt: Date.now() }, null, 2), "utf-8");
  } catch (e) {
    log("error", `[Eval] Failed to save result:`, e);
  }
}

export function ensureSampleDataset(): void {
  if (fs.existsSync(datasetPath())) return;
  const sample: EvalTask[] = [
    {
      id: "hello-world-ts",
      name: "Create Hello World TypeScript",
      prompt: "Create a src/hello.ts file that exports a function hello(name: string) returning `Hello, ${name}!`. Also create a test file src/hello.test.ts that verifies hello('World') returns 'Hello, World!'.",
      workspacePath: path.join(EVAL_DIR, "sample-workspace"),
      criteria: [
        { type: "file_exists", target: "src/hello.ts" },
        { type: "file_contains", target: "src/hello.ts", value: "Hello," },
        { type: "file_exists", target: "src/hello.test.ts" },
      ],
    },
  ];
  saveDataset(sample);
  log("info", `[Eval] Created sample dataset with ${sample.length} task(s)`);
}
