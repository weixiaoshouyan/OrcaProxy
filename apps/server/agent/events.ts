// ============================================================
// src/agent/events.ts
// Structured SSE events for real-time agent progress tracking
// ============================================================

export type AgentEventType =
  | "task_start"
  | "task_plan"
  | "step_start"
  | "step_complete"
  | "step_fail"
  | "tool_start"
  | "tool_result"
  | "tool_error"
  | "reflection"
  | "verification"
  | "context_compression"
  | "task_complete"
  | "task_error"
  | "usage"
  | "checkpoint"
  | "text_delta";

export interface AgentEvent {
  type: AgentEventType;
  taskId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export function createAgentEvent(
  type: AgentEventType,
  taskId: string,
  data: Record<string, unknown> = {}
): AgentEvent {
  return { type, taskId, timestamp: Date.now(), data };
}

export function formatAgentEvent(event: AgentEvent): string {
  return `event: agent_event\ndata: ${JSON.stringify(event)}\n\n`;
}
