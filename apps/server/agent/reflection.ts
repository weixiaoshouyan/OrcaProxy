// ============================================================
// src/agent/reflection.ts
// Reflection / Self-Critique mechanism for agent error recovery
// ============================================================

import { log } from "../utils/log";
import { buildProbeUrl } from "../services/health";
import type { TaskState, ToolResultRecord } from "./task-state";
import type { Provider } from "../providers";

export interface ReflectionResult {
  analysis: string;
  suggestions: string[];
  shouldRetry: boolean;
  retryStrategy?: string;
}

const REFLECTION_MAX_TOKENS = 600;

/**
 * Analyze tool execution failures and generate self-critique.
 * Called when verification fails to provide the model with
 * structured feedback on what went wrong and how to improve.
 */
export async function generateReflection(
  taskState: TaskState,
  failedRecords: ToolResultRecord[],
  provider: Provider,
  apiKey: string,
  model: string
): Promise<ReflectionResult> {
  const failedOutputs = failedRecords.map((r) =>
    `Tool: ${r.name}\nArguments: ${r.arguments}\nOutput: ${r.output.slice(0, 1000)}`
  ).join("\n\n");

  const prompt = `You are a self-reflecting coding agent. Analyze the following failed tool executions and provide a structured critique.

Task Goal: ${taskState.goal}

Current Plan:
${taskState.steps.map((s) => `- [${s.status === "completed" ? "x" : s.status === "failed" ? "!" : " "}] ${s.description}`).join("\n")}

Failed Executions:
${failedOutputs}

Provide your analysis in this exact JSON format (no other text):
{
  "analysis": "Brief root cause analysis of what went wrong",
  "suggestions": ["specific suggestion 1", "specific suggestion 2"],
  "shouldRetry": true/false,
  "retryStrategy": "Alternative approach to try"
}`;

  try {
    const isAnthropic = provider.id === "anthropic";
    const targetUrl = buildProbeUrl(provider.baseUrl, isAnthropic ? "/messages" : "/chat/completions");
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    let body: Record<string, unknown>;
    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model,
        max_tokens: REFLECTION_MAX_TOKENS,
        system: "You are a precise self-reflecting agent. Output ONLY valid JSON, no markdown fences.",
        messages: [{ role: "user", content: prompt }],
      };
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
      body = {
        model,
        max_tokens: REFLECTION_MAX_TOKENS,
        temperature: 0.3,
        messages: [
          { role: "system", content: "You are a precise self-reflecting agent. Output ONLY valid JSON, no markdown fences." },
          { role: "user", content: prompt },
        ],
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(targetUrl, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as any;

    let content: string;
    if (isAnthropic) {
      content = data.content?.[0]?.text || "";
    } else {
      content = data.choices?.[0]?.message?.content || "";
    }

    // Strip markdown fences if present
    content = content.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();

    const parsed = JSON.parse(content);
    return {
      analysis: parsed.analysis || "Unknown failure",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      shouldRetry: parsed.shouldRetry !== false,
      retryStrategy: parsed.retryStrategy || undefined,
    };
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    log("warn", "[Reflection] Failed to generate reflection:", e);
    return {
      analysis: "Automatic reflection unavailable",
      suggestions: ["Review the error output carefully", "Try a different approach"],
      shouldRetry: true,
    };
  }
}

/**
 * Build a reflection prompt to inject into the conversation
 * when replanning after failures.
 */
export function buildReflectionPrompt(reflection: ReflectionResult): string {
  const suggestions = reflection.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `[Self-Reflection]
Root Cause: ${reflection.analysis}
Suggestions:
${suggestions}
${reflection.retryStrategy ? `Recommended Strategy: ${reflection.retryStrategy}` : ""}
`;
}
