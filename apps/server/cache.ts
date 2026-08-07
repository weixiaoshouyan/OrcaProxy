import fs from "fs";
import path from "path";
import crypto from "crypto";
import { atomicWriteFileSync } from "./utils/helpers";

interface CacheEntry {
  response: any;
  timestamp: number;
  lastAccessed: number;
}

interface CacheData {
  [key: string]: CacheEntry;
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 1000;

let _cache: CacheData = null as any;

const _isElectron = !!process.env.ORCA_BASE_DIR;
const _devDir = path.join(__dirname, "..");
const _portableDir = __dirname;
const BASE_DIR = _isElectron ? process.env.ORCA_BASE_DIR! : (fs.existsSync(path.join(_portableDir, "public")) ? _portableDir : _devDir);
const CACHE_PATH = path.join(BASE_DIR, "data", "cache.json");

function evictExpiredEntries(): number {
  const now = Date.now();
  let expired = 0;
  for (const key of Object.keys(_cache)) {
    if (now - _cache[key].timestamp > CACHE_TTL) {
      delete _cache[key];
      expired++;
    }
  }
  return expired;
}

function evictLRU(): number {
  const keys = Object.keys(_cache);
  if (keys.length <= MAX_ENTRIES) return 0;
  // Sort by lastAccessed ascending, remove oldest
  const sorted = keys.sort((a, b) => _cache[a].lastAccessed - _cache[b].lastAccessed);
  const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES);
  for (const key of toRemove) {
    delete _cache[key];
  }
  return toRemove.length;
}

function cleanupCache(): void {
  const expired = evictExpiredEntries();
  const evicted = evictLRU();
  if (expired > 0 || evicted > 0) {
    console.log(`[Cache] Cleaned up: ${expired} expired, ${evicted} LRU evicted`);
    saveCache();
  }
}

// Upgrade old cache format (no lastAccessed field)
function upgradeCacheFormat(): void {
  let changed = false;
  for (const key of Object.keys(_cache)) {
    const entry = _cache[key];
    if (typeof (entry as any).lastAccessed !== "number") {
      (entry as any).lastAccessed = entry.timestamp || Date.now();
      changed = true;
    }
  }
  if (changed) {
    console.log("[Cache] Upgraded cache format with lastAccessed timestamps");
    saveCache();
  }
}

function getCache(): CacheData {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      _cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    } else {
      _cache = {};
    }
  } catch {
    _cache = {};
  }
  upgradeCacheFormat();
  cleanupCache();
  return _cache;
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    atomicWriteFileSync(CACHE_PATH, JSON.stringify(_cache, null, 2));
  } catch (e) {
    console.error("Failed to save cache file:", e);
  }
}

export function computeCacheKey(body: any): string {
  // Normalize messages for consistent caching regardless of API format
  const normalizeMessages = (msgs: any[]): any[] => {
    if (!msgs) return [];
    return msgs.map((m: any) => {
      // Handle Anthropic content blocks (array of {type, text})
      if (Array.isArray(m.content)) {
        return {
          role: m.role,
          content: m.content
            .filter((b: any) => b.type === "text" || b.type === "input_text" || b.type === "output_text")
            .map((b: any) => b.text || "")
            .join("")
        };
      }
      return { role: m.role, content: m.content || "" };
    });
  };

  const keyObj = {
    model: body.model,
    providerId: body._providerId || "",
    profileId: body._profileId || "",
    messages: normalizeMessages(body.messages),
    stream: !!body.stream,
    temperature: body.temperature ?? 0.7,
    max_tokens: body.max_tokens ?? 0,
    top_p: body.top_p ?? 1.0,
    tools: (body.tools || []).map((t: any) => ({
      name: t.function?.name || t.name,
      description: t.function?.description || t.description || ""
    })),
  };
  const str = JSON.stringify(keyObj);
  return crypto.createHash("sha256").update(str).digest("hex");
}

export function getCachedResponse(key: string): any | null {
  const cache = getCache();
  const entry = cache[key];
  if (!entry) return null;
  // Check TTL
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    delete cache[key];
    saveCache();
    return null;
  }
  // Update access time for LRU tracking
  entry.lastAccessed = Date.now();
  return entry.response;
}

export function setCachedResponse(key: string, response: any): void {
  const cache = getCache();
  cache[key] = {
    response,
    timestamp: Date.now(),
    lastAccessed: Date.now(),
  };
  // Enforce max entries cap (will trigger LRU eviction on next getCache)
  if (Object.keys(cache).length > MAX_ENTRIES * 1.1) {
    evictLRU();
  }
  saveCache();
}

// Manually purge expired or LRU entries (called from admin API)
export function purgeCache(): { expired: number; evicted: number } {
  const expired = evictExpiredEntries();
  const evicted = evictLRU();
  saveCache();
  return { expired, evicted };
}

// Get cache stats
export function getCacheStats(): { entries: number; sizeBytes: number } {
  const cache = getCache();
  const keys = Object.keys(cache);
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(CACHE_PATH).size; } catch { /* ignore */ }
  return { entries: keys.length, sizeBytes };
}

// Simulates a streaming response for cached completions
export async function replayStreamResponse(
  res: any,
  fullText: string,
  model: string,
  onDone: () => void
) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const id = "chatcmpl-" + Date.now();
  const created = Math.floor(Date.now() / 1000);

  // Split full text into small chunks to simulate typing speed.
  // Batching 4 chunks per tick at 10ms keeps the effect without the
  // multi-minute stalls a word-per-30ms replay caused on long answers.
  const words = fullText.split(/(\s+)/);
  const BATCH = 4;
  const TICK_MS = 10;
  let index = 0;
  let closed = false;
  let doneCalled = false;

  const done = () => {
    if (doneCalled) return;
    doneCalled = true;
    onDone();
  };

  const interval = setInterval(() => {
    if (closed) {
      clearInterval(interval);
      done();
      return;
    }
    if (index >= words.length) {
      clearInterval(interval);
    try {
      if (!res.writableEnded) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (e) { console.error("Failed to write final SSE event:", e); }
      done();
      return;
    }
    for (let b = 0; b < BATCH && index < words.length; b++) {
      const chunkContent = words[index];
      const chunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: { content: chunkContent },
            finish_reason: null,
          },
        ],
      };
      try {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (_) {
        closed = true;
        clearInterval(interval);
        return;
      }
      index++;
    }
  }, TICK_MS);

  res.on("close", () => {
    closed = true;
    clearInterval(interval);
    done();
  });
}
