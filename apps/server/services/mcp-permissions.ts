// ============================================================
// src/services/mcp-permissions.ts
// Allowlist / approval gate for MCP write tools
// ============================================================

import { loadConfig, saveConfig } from "../providers";
import { log } from "../utils/log";

export interface McpPermissions {
  requireApproval: boolean;
  allowedTools: string[];
}

export interface PendingApproval {
  taskId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
  requestedAt: number;
}

const pendingApprovals = new Map<string, PendingApproval>();

export function getMcpPermissions(): McpPermissions {
  const cfg = loadConfig();
  return cfg.mcpPermissions || { requireApproval: false, allowedTools: [] };
}

export function setMcpPermissions(perms: McpPermissions): void {
  const cfg = loadConfig();
  cfg.mcpPermissions = {
    requireApproval: !!perms.requireApproval,
    allowedTools: Array.isArray(perms.allowedTools) ? perms.allowedTools : [],
  };
  saveConfig(cfg);
}

export function isMcpToolAllowed(toolName: string): boolean {
  const perms = getMcpPermissions();
  if (!perms.requireApproval) return true;
  return perms.allowedTools.includes(toolName);
}

export function addAllowedMcpTool(toolName: string): void {
  const perms = getMcpPermissions();
  if (!perms.allowedTools.includes(toolName)) {
    perms.allowedTools.push(toolName);
    setMcpPermissions(perms);
    log("info", `[MCP] Added ${toolName} to allowlist`);
  }
}

export function removeAllowedMcpTool(toolName: string): void {
  const perms = getMcpPermissions();
  perms.allowedTools = perms.allowedTools.filter((t) => t !== toolName);
  setMcpPermissions(perms);
}

export function requestMcpApproval(pending: PendingApproval): void {
  pendingApprovals.set(`${pending.taskId}:${pending.toolCallId}`, pending);
  log("info", `[MCP] Approval requested for ${pending.toolName} in task ${pending.taskId}`);
}

export function approveMcpTool(taskId: string, toolCallId: string): boolean {
  const key = `${taskId}:${toolCallId}`;
  const pending = pendingApprovals.get(key);
  if (!pending) return false;
  addAllowedMcpTool(pending.toolName);
  pendingApprovals.delete(key);
  return true;
}

export function rejectMcpApproval(taskId: string, toolCallId: string): boolean {
  return pendingApprovals.delete(`${taskId}:${toolCallId}`);
}

export function getPendingApprovals(): PendingApproval[] {
  return Array.from(pendingApprovals.values()).sort((a, b) => b.requestedAt - a.requestedAt);
}

export function clearPendingApprovals(taskId?: string): void {
  if (taskId) {
    for (const key of pendingApprovals.keys()) {
      if (key.startsWith(`${taskId}:`)) pendingApprovals.delete(key);
    }
  } else {
    pendingApprovals.clear();
  }
}
