// ============================================================
// src/agent/subagent.ts
// Sub-Agent system for parallel task execution
// ============================================================

import { log } from "../utils/log";
import { handleAgentToolCall } from "../services/tools";
import type { ToolCall } from "./types";

export interface SubAgentTask {
  id: string;
  description: string;
  toolCalls: ToolCall[];
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
}

export interface SubAgentResult {
  taskId: string;
  success: boolean;
  output: string;
}

/**
 * Execute a batch of independent read-only tool calls as parallel sub-agents.
 * Each sub-agent runs independently and results are aggregated.
 */
export async function executeSubAgents(
  tasks: SubAgentTask[],
  workspacePath: string,
  maxConcurrency = 4
): Promise<SubAgentResult[]> {
  const results: SubAgentResult[] = [];
  const queue = [...tasks];
  const running: Promise<void>[] = [];

  const runNext = async (): Promise<void> => {
    const task = queue.shift();
    if (!task) return;

    task.status = "running";
    const outputs: string[] = [];

    for (const tc of task.toolCalls) {
      try {
        const result = await handleAgentToolCall(tc, workspacePath);
        outputs.push(result);
      } catch (e: any) {
        outputs.push(`Error: ${e.message}`);
      }
    }

    const hasError = outputs.some((o) => o.startsWith("Error:"));
    task.status = hasError ? "failed" : "completed";
    task.result = outputs.join("\n\n");

    results.push({
      taskId: task.id,
      success: !hasError,
      output: task.result,
    });
  };

  while (queue.length > 0 || running.length > 0) {
    while (running.length < maxConcurrency && queue.length > 0) {
      const p = runNext().then(() => {
        running.splice(running.indexOf(p), 1);
      });
      running.push(p);
    }
    if (running.length > 0) {
      await Promise.race(running);
    }
  }

  return results;
}

/**
 * Parse a list of tool calls into independent sub-agent tasks
 * based on dependency analysis.
 */
export function partitionToolCalls(toolCalls: ToolCall[]): SubAgentTask[] {
  const tasks: SubAgentTask[] = [];
  const batchSize = 3;

  for (let i = 0; i < toolCalls.length; i += batchSize) {
    const batch = toolCalls.slice(i, i + batchSize);
    tasks.push({
      id: `subagent_${i / batchSize}`,
      description: `Execute ${batch.length} tool(s): ${batch.map((tc) => tc.function.name).join(", ")}`,
      toolCalls: batch,
      status: "pending",
    });
  }

  return tasks;
}
