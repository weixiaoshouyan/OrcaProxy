// ============================================================
// src/proxy/stream.ts
// Generic SSE stream processing helper
// ============================================================

import type { Request, Response as ExpressResponse } from "express";
import { log } from "../utils/log";
import { addTokens } from "../utils/stats";

export async function streamSSE(
  upstreamResp: any, /* node-fetch Response, not Express Response */
  req: Request,
  res: ExpressResponse,
  processFn: (state: any, chunk: Record<string, unknown>) => string,
  endFn: (state: any) => string,
  createStateFn: () => any,
  externalState?: any,
  errorFn?: (status: number, message: string) => string,
  onComplete?: (state: any) => void
) {
  const state = externalState || createStateFn();
  const reader = (upstreamResp.body as unknown as ReadableStream).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let clientDisconnected = false;
  let endEventsWritten = false;
  let writeBuffer = "";
  let flushScheduled = false;

  const defaultErrorFn = (status: number, message: string) =>
    `data: ${JSON.stringify({ type: "error", error: { type: status >= 500 ? "api_error" : "invalid_request_error", message } })}\n\n`;
  const writeError = errorFn || defaultErrorFn;

  req.on("close", () => { clientDisconnected = true; });

  const flushWrites = () => {
    flushScheduled = false;
    if (writeBuffer && !res.writableEnded) {
      res.write(writeBuffer);
      writeBuffer = "";
    }
  };

  const bufferedWrite = (data: string) => {
    writeBuffer += data;
    if (!flushScheduled) {
      flushScheduled = true;
      setImmediate(flushWrites);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || clientDisconnected) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") {
          if (!endEventsWritten) {
            const endEvents = endFn(state);
            if (endEvents) bufferedWrite(endEvents);
            endEventsWritten = true;
          }
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          try {
            const chunk = JSON.parse(trimmed.slice(6));
            const events = processFn(state, chunk);
            if (events) bufferedWrite(events);
          } catch { log("warn", "Failed to parse chunk"); }
        }
      }
    }
  } catch (streamErr) {
    log("error", "Stream error:", streamErr);
    if (!res.writableEnded) bufferedWrite(writeError(502, "Stream reading error"));
  }
  flushWrites();
  if (!res.writableEnded && !endEventsWritten) {
    const endEvents = endFn(state);
    if (endEvents) bufferedWrite(endEvents);
  }
  flushWrites();
  if (!res.writableEnded) res.end();
  if (state.usage) addTokens(state.usage.total_tokens || state.usage.output_tokens || 0);
  if (onComplete) {
    try { onComplete(state); } catch (e) { log("error", "Error in streamSSE onComplete:", e); }
  }
}

export function formatErrorSse(status: number, message: string): string {
  return `data: ${JSON.stringify({ type: "error", error: { type: status >= 500 ? "api_error" : "invalid_request_error", message } })}\n\n`;
}
