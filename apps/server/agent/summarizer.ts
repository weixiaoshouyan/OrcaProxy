// ============================================================
// src/agent/summarizer.ts
// Summarize oversized tool outputs before putting them into context
// ============================================================

import { log } from "../utils/log";
import { buildProbeUrl } from "../services/health";
import type { Provider } from "../providers";

const SUMMARY_THRESHOLD_CHARS = 2_500;
const SUMMARY_MAX_TOKENS = 512;

function pickSummaryModel(provider: Provider): string {
  // Prefer a small/cheap non-reasoning model if the provider exposes one.
  const candidates = provider.models.filter((m) => !m.reasoning && (m.id.includes("turbo") || m.id.includes("flash") || m.id.includes("lite") || m.id.includes("mini")));
  if (candidates.length) return candidates[0].id;
  const nonReasoning = provider.models.find((m) => !m.reasoning);
  return nonReasoning?.id || provider.models[0]?.id || "";
}

export async function maybeSummarize(
  text: string,
  provider: Provider,
  apiKey: string,
  hint?: string
): Promise<string> {
  if (text.length <= SUMMARY_THRESHOLD_CHARS) return text;

  const model = pickSummaryModel(provider);
  if (!model || !apiKey) {
    // Fallback: keep the head and tail if we cannot summarize via LLM.
    const head = text.slice(0, 1_200);
    const tail = text.slice(-800);
    return `${head}\n\n... [${text.length - head.length - tail.length} chars omitted] ...\n\n${tail}`;
  }

  const targetUrl = buildProbeUrl(provider.baseUrl, "/chat/completions");
  const prompt = hint
    ? `Summarize the following tool output for the task "${hint}". Keep facts, paths, errors, and numbers; remove noise.\n\n${text}`
    : `Summarize the following tool output concisely. Keep important facts, file paths, errors, and numbers.\n\n${text}`;

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You summarize tool outputs for an autonomous coding agent. Be concise and preserve actionable details." },
          { role: "user", content: prompt },
        ],
        max_tokens: SUMMARY_MAX_TOKENS,
        temperature: 0.2,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as any;
    const summary = data?.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new Error("Empty summary");
    return `[Summarized from ${text.length} chars]\n${summary}`;
  } catch (e) {
    log("warn", "[Summarizer] Failed to summarize output:", e);
    const head = text.slice(0, 1_200);
    const tail = text.slice(-800);
    return `${head}\n\n... [${text.length - head.length - tail.length} chars omitted] ...\n\n${tail}`;
  }
}
