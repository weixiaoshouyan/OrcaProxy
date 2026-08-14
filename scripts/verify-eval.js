/* Framework-level eval verification (no LLM needed): creates the sample
 * workspace artifacts and runs evaluateTask against the sample dataset. */
const fs = require("fs");
const path = require("path");
const { evaluateTask, loadDataset } = require("../apps/server/agent/eval");

const ws = path.join(__dirname, "..", "data", "eval", "sample-workspace");
fs.mkdirSync(path.join(ws, "src"), { recursive: true });
fs.writeFileSync(path.join(ws, "src", "hello.ts"), "export function hello(name: string) { return `Hello, ${name}!`; }", "utf-8");
fs.writeFileSync(path.join(ws, "src", "hello.test.ts"), "import { hello } from './hello'; if (hello('World') !== 'Hello, World!') throw new Error('fail');", "utf-8");

const tasks = loadDataset();
if (tasks.length === 0) { console.error("FAIL: empty eval dataset"); process.exit(1); }
const result = evaluateTask(tasks[0]);
console.log(JSON.stringify({
  task: result.taskId,
  passed: result.passed,
  score: `${result.score}/${result.total}`,
  durationMs: result.durationMs,
  details: result.details.map((d) => (d.passed ? "PASS" : "FAIL") + " " + d.note),
}, null, 2));
process.exit(result.passed ? 0 : 1);
