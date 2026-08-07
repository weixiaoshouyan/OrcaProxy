// ============================================================
// src/services/tool-cache.ts
// LRU cache for read-only tool call results
// Prevents redundant file reads, searches, and API calls
// ============================================================

import crypto from "crypto";
import path from "path";
import { log } from "../utils/log";

interface CacheEntry {
  result: string;
  timestamp: number;
  accessCount: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 200;

const cache = new Map<string, CacheEntry>();
let hits = 0;
let misses = 0;

function computeKey(toolName: string, args: Record<string, unknown>, workspacePath?: string): string {
  // Workspace is part of the key: the same arguments can produce different
  // results in different workspaces (files, env, cwd).
  const scope = workspacePath ? path.resolve(workspacePath) : "";
  const str = `${toolName}:${scope}:${JSON.stringify(args)}`;
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

export function getCachedToolResult(toolName: string, args: Record<string, unknown>, workspacePath?: string): string | null {
  const key = computeKey(toolName, args, workspacePath);
  const entry = cache.get(key);
  if (!entry) {
    misses++;
    return null;
  }

  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(key);
    misses++;
    return null;
  }

  hits++;
  entry.accessCount++;
  log("debug", `[ToolCache] Hit for ${toolName} (accessed ${entry.accessCount}x)`);
  return entry.result;
}

export function setCachedToolResult(toolName: string, args: Record<string, unknown>, result: string, workspacePath?: string): void {
  if (!CACHEABLE_TOOLS.has(toolName)) return;
  if (cache.size >= MAX_ENTRIES) {
    evictLRU();
  }
  const key = computeKey(toolName, args, workspacePath);
  cache.set(key, { result, timestamp: Date.now(), accessCount: 1 });
}

function evictLRU(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of cache) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

export function invalidateCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}

export function getCacheStats(): { entries: number; hitRate: number; hits: number; misses: number } {
  const total = hits + misses;
  return { entries: cache.size, hitRate: total > 0 ? hits / total : 0, hits, misses };
}

// Only these tools are safe to cache (read-only, deterministic)
export const CACHEABLE_TOOLS = new Set([
  "read_workspace_file",
  "list_workspace_files",
  "list_directory",
  "search_grep",
  "glob_files",
  "list_available_skills",
  "get_skill_details",
  "semantic_search_code",
]);
