// ============================================================
// tests/todo.test.ts
// Reasonix-style todo state machine tests
// ============================================================

import {
  validateTodos,
  advanceTodos,
  matchTodoStep,
  todoCounts,
  todoReceipt,
  renderTodoLine,
  parsePlanTodos,
  repairTodos,
} from "../agent/todo";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name} ${detail}`); }
}

// ---- validateTodos ----

const flat = [
  { content: "Install deps", status: "completed" as const },
  { content: "Build UI", status: "in_progress" as const },
  { content: "Package", status: "pending" as const },
];

check("valid serial list passes", validateTodos(flat).ok);

check(
  "two in_progress rejected",
  !validateTodos([
    { content: "A", status: "in_progress" as const },
    { content: "B", status: "in_progress" as const },
  ]).ok
);

check(
  "completed after pending rejected",
  !validateTodos([
    { content: "A", status: "pending" as const },
    { content: "B", status: "completed" as const },
  ]).ok
);

check(
  "phase completed with unfinished sub-steps rejected",
  !validateTodos([
    { content: "Phase", status: "completed" as const, level: 0 },
    { content: "Sub", status: "pending" as const, level: 1 },
  ]).ok
);

check(
  "phase completed after sub-steps done passes",
  validateTodos([
    { content: "Phase", status: "completed" as const, level: 0 },
    { content: "Sub", status: "completed" as const, level: 1 },
  ]).ok
);

check("empty list is valid", validateTodos([]).ok);

// ---- advanceTodos ----

const advanced = advanceTodos([
  { content: "A", status: "completed" as const },
  { content: "B", status: "in_progress" as const },
  { content: "C", status: "pending" as const },
]);
check("current item completed after advance", advanced[1].status === "completed");
check("next pending promoted", advanced[2].status === "in_progress");

const phaseAdvance = advanceTodos([
  { content: "Phase", status: "in_progress" as const, level: 0 },
  { content: "Sub1", status: "pending" as const, level: 1 },
  { content: "Sub2", status: "pending" as const, level: 1 },
]);
check("phase with pending sub-steps promotes first sub-step", phaseAdvance[0].status === "completed" && phaseAdvance[1].status === "in_progress" && phaseAdvance[2].status === "pending");

// ---- matchTodoStep ----

const todos = [
  { content: "Install deps", status: "pending" as const },
  { content: "Build frontend", status: "pending" as const },
];
check("match by index", matchTodoStep(todos, "", 2) === 1);
check("match by exact title", matchTodoStep(todos, "Build frontend") === 1);
check("match by fuzzy title", matchTodoStep(todos, "build front") === 1);
check("no match", matchTodoStep(todos, "nothing here") === -1);

// ---- counts / receipt / render ----

const c = todoCounts(flat);
check("counts", c.total === 3 && c.completed === 1 && c.inProgress === 1 && c.pending === 1);
check("receipt text", todoReceipt(flat) === "Todos updated: 3 total — 1 completed, 1 in progress, 1 pending.");
const line = renderTodoLine(flat);
check("render line has progress", line.includes("[1/3]") && line.includes("Build UI"));

// ---- parsePlanTodos (two-level plan) ----

const planText = `1. Install dependencies
   - Run npm install
   - Verify node_modules present
2. Build the frontend
   - Run npm run build
   - Confirm dist output exists
3. Ship`;

const parsed = parsePlanTodos(planText);
check("two-level plan parsed: 7 items", parsed.length === 7, `got ${parsed.length}`);
check("phase level 0", parsed[0].level === 0 && parsed[0].content === "Install dependencies");
check("sub-step level 1", parsed[1].level === 1 && parsed[1].content === "Run npm install");
check("last phase no sub-steps", parsed[6].level === 0 && parsed[6].content === "Ship");

const badPlan = parsePlanTodos("# Heading only\n\nSome text without list markers");
check("heading not parsed as phase", badPlan.every((t) => !t.content.startsWith("#")));

// ---- repairTodos (auto-fix common protocol violations) ----

const multiProgress = repairTodos([
  { content: "A", status: "in_progress" as const },
  { content: "B", status: "in_progress" as const },
  { content: "C", status: "pending" as const },
]);
check("repair: multiple in_progress demoted", multiProgress.items.filter((t) => t.status === "in_progress").length === 1
  && multiProgress.items[1].status === "pending"
  && multiProgress.notes.length >= 1, `notes=${multiProgress.notes.length}`);
check("repair: result validates", validateTodos(multiProgress.items).ok);

const outOfOrder = repairTodos([
  { content: "A", status: "completed" as const },
  { content: "B", status: "pending" as const },
  { content: "C", status: "completed" as const },
]);
check("repair: out-of-order completed demoted", outOfOrder.items[2].status === "pending"
  && outOfOrder.items[0].status === "completed" && validateTodos(outOfOrder.items).ok);

const prematurePhase = repairTodos([
  { content: "Phase", status: "completed" as const, level: 0 },
  { content: "Sub", status: "pending" as const, level: 1 },
]);
check("repair: phase with unfinished subs demoted", prematurePhase.items[0].status === "pending"
  && validateTodos(prematurePhase.items).ok);

const clean = repairTodos([
  { content: "A", status: "completed" as const },
  { content: "B", status: "in_progress" as const },
]);
check("repair: valid list untouched", clean.notes.length === 0 && clean.items.length === 2
  && clean.items[1].status === "in_progress");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
