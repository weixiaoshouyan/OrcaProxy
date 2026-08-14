// ============================================================
// src/agent/reflection.ts
// Reflection / Self-Critique mechanism for agent error recovery
// ============================================================

import { log } from "../utils/log";
import { buildProbeUrl } from "../services/health";
import { fetchWithRetry } from "./loop";
import type { TaskState, ToolResultRecord } from "./task-state";
import type { Provider } from "../providers";

export interface ReflectionResult {
  analysis: string;
  suggestions: string[];
  shouldRetry: boolean;
  retryStrategy?: string;
}

const REFLECTION_MAX_TOKENS = 600;

/** Local fallback analysis synthesized from the failed tool outputs — used
 *  when the reflection LLM call itself fails, so the model still receives
 *  concrete (not boilerplate) feedback. */
function synthesizeFallback(taskState: TaskState, failedRecords: ToolResultRecord[]): ReflectionResult {
  const details = failedRecords.slice(0, 3).map((r) => {
    const firstErr = r.output.split("\n").find((l) => /error|failed|exception|exit code/i.test(l)) || r.output.slice(0, 120);
    return `- ${r.name}: ${firstErr.trim().slice(0, 140)}`;
  }).join("\n");
  return {
    analysis: `Reflection model call failed — local fallback. ${failedRecords.length} tool execution(s) failed:\n${details || "- (no details)"}`,
    suggestions: [
      "Re-read the failing file/command output and correct the exact cause (quoting, paths, syntax) before retrying",
      "Prefer a different approach than repeating the same tool+arguments",
    ],
    shouldRetry: true,
  };
}

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
        stream: false, // explicit: some gateways default to streaming and resp.json() then fails
        messages: [
          { role: "system", content: "You are a precise self-reflecting agent. Output ONLY valid JSON, no markdown fences." },
          { role: "user", content: prompt },
        ],
      };
    }

    // fetchWithRetry: SSRF guard + retry on 429/5xx + 60s timeout (reflection
    // runs mid-task; a slow gateway must not stall the loop forever).
    const resp = await fetchWithRetry(targetUrl, { method: "POST", headers, body: JSON.stringify(body) }, 2, 1000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json() as any;

    let content: string;
    if (isAnthropic) {
      content = data.content?.[0]?.text || "";
    } else {
      content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || "";
    }

    // Strip markdown fences if present
    content = content.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();

    // Find the first JSON object in the response (models sometimes prepend
    // prose even when told not to).
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    const jsonText = jsonStart >= 0 && jsonEnd > jsonStart ? content.slice(jsonStart, jsonEnd + 1) : content;

    const parsed = JSON.parse(jsonText);
    return {
      analysis: parsed.analysis || "Unknown failure",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      shouldRetry: parsed.shouldRetry !== false,
      retryStrategy: parsed.retryStrategy || undefined,
    };
  } catch (e) {
    // Log the concrete reason (status/network) so the failure is diagnosable,
    // then fall back to a locally-synthesized analysis instead of a useless
    // "Automatic reflection unavailable" placeholder.
    log("warn", "[Reflection] Model call failed, using local fallback:", e);
    return synthesizeFallback(taskState, failedRecords);
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
