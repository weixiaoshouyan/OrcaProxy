// ============================================================
// src/utils/stats.ts
// Global statistics tracking for the proxy server
// ============================================================

export interface Stats {
  totalRequests: number;
  codexRequests: number;
  claudeRequests: number;
  chatRequests: number;
  interceptedRequests: number;
  errors: number;
  totalTokens: number;
  startTime: string;
  totalCost?: number;
}

export interface TokenSnapshot { time: string; tokens: number; requests: number; }

let _stats: Stats = {
  totalRequests: 0, codexRequests: 0, claudeRequests: 0,
  chatRequests: 0, interceptedRequests: 0, errors: 0, totalTokens: 0,
  startTime: new Date().toISOString(),
  totalCost: 0,
};

let _tokenHistory: TokenSnapshot[] = [];
const MAX_HISTORY = 60;

// Start periodic snapshots
let _interval: ReturnType<typeof setInterval> | null = null;

export function startTokenHistory(): void {
  if (_interval) return;
  _interval = setInterval(() => {
    const now = new Date().toISOString();
    _tokenHistory.push({ time: now, tokens: _stats.totalTokens, requests: _stats.totalRequests });
    if (_tokenHistory.length > MAX_HISTORY) _tokenHistory.shift();
  }, 10000);
}

export function stopTokenHistory(): void {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

export function getStats(): Stats { return _stats; }
export function getTokenHistory(): TokenSnapshot[] { return _tokenHistory; }

export function incrementRequests(type: "total" | "codex" | "claude" | "chat"): void {
  _stats.totalRequests++;
  if (type === "codex") _stats.codexRequests++;
  else if (type === "claude") _stats.claudeRequests++;
  else if (type === "chat") _stats.chatRequests++;
}

export function incrementErrors(): void { _stats.errors++; }
export function addTokens(n: number): void { _stats.totalTokens += n; }
export function addCost(amount: number): void { _stats.totalCost = (_stats.totalCost || 0) + amount; }
export function incrementInterceptedRequests(): void { _stats.interceptedRequests++; }
export function initStats(tokens: number, cost: number): void {
  _stats.totalTokens = tokens;
  _stats.totalCost = cost;
}
