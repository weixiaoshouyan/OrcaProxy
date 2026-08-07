// ============================================================
// src/services/health.ts
// Provider health checking + fallback resolution
// ============================================================

import { getProvider, type Provider, loadConfig, type Profile } from "../providers";
import { log } from "../utils/log";

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

interface CachedHealth {
  result: HealthResult;
  timestamp: number;
}

const HEALTH_CACHE_TTL_MS = 30_000;
const _healthCache = new Map<string, CachedHealth>();

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkProviderHealth(provider: Provider, apiKey: string): Promise<HealthResult> {
  const cacheKey = `${provider.id}:${provider.baseUrl}`;
  const cached = _healthCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < HEALTH_CACHE_TTL_MS) {
    return cached.result;
  }

  const start = Date.now();
  try {
    // Use the provider's model list endpoint as a lightweight probe.
    const probeUrl = buildProbeUrl(provider.baseUrl, "/models");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.id === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const resp = await fetchWithTimeout(probeUrl, { method: "GET", headers }, 8_000);
    const latencyMs = Date.now() - start;
    const result: HealthResult = resp.ok
      ? { ok: true, latencyMs }
      : { ok: false, latencyMs, error: `HTTP ${resp.status}` };

    _healthCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const result: HealthResult = { ok: false, latencyMs, error: err?.message || String(err) };
    _healthCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }
}

/**
 * Build a probe URL by intelligently appending a path suffix to the provider's
 * baseUrl. If baseUrl already ends with `/v1` (e.g. Ollama `http://host:11434/v1`
 * or LongCat `https://api.longcat.chat/openai/v1`), we do NOT append another
 * `/v1`. We only append the suffix (`/models`, `/chat/completions`, etc.).
 *
 * Examples:
 *   buildProbeUrl("https://api.deepseek.com", "/models")
 *     => "https://api.deepseek.com/v1/models"
 *   buildProbeUrl("https://api.longcat.chat/openai/v1", "/models")
 *     => "https://api.longcat.chat/openai/v1/models"
 *   buildProbeUrl("http://127.0.0.1:11434/v1/", "/models")
 *     => "http://127.0.0.1:11434/v1/models"
 */
export function buildProbeUrl(baseUrl: string, suffix: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  // If the baseUrl already ends with /v1 (case-insensitive), just append the suffix.
  if (/\/v\d+$/i.test(trimmedBase)) {
    return trimmedBase + suffix;
  }
  return trimmedBase + "/v1" + suffix;
}

export function clearHealthCache(providerId?: string): void {
  if (providerId) {
    for (const key of _healthCache.keys()) {
      if (key.startsWith(`${providerId}:`)) _healthCache.delete(key);
    }
  } else {
    _healthCache.clear();
  }
}

export async function resolveHealthyModel(
  requested: string,
  resolveFn: (model: string, profile?: Profile | null, tools?: string[]) => { provider: Provider; model: string; apiKey: string },
  profile?: Profile | null,
  tools?: string[]
): Promise<{ provider: Provider; model: string; apiKey: string }> {
  const cfg = loadConfig();
  const resolved = resolveFn(requested, profile, tools);

  if (!cfg.healthCheckEnabled) {
    return resolved;
  }

  const health = await checkProviderHealth(resolved.provider, resolved.apiKey);
  if (health.ok) return resolved;

  log("warn", `[Health] Provider ${resolved.provider.id} unhealthy: ${health.error}. Trying fallbacks.`);

  const fallbackIds = new Set<string>([
    ...(profile?.fallbackProviderIds || []),
    ...(cfg.fallbackProviderIds || []),
  ]);

  for (const fallbackId of fallbackIds) {
    const prov = getProvider(fallbackId);
    if (!prov) continue;
    const key = resolveApiKeyForProvider(prov, profile);
    const fh = await checkProviderHealth(prov, key);
    if (fh.ok) {
      log("info", `[Health] Fallback to provider ${fallbackId} (latency ${fh.latencyMs}ms)`);
      return { provider: prov, model: requested || profile?.model || prov.models[0]?.id || "", apiKey: key };
    }
  }

  // No healthy fallback; return original and let upstream fail with a clear log.
  return resolved;
}

export function resolveApiKeyForProvider(provider: Provider, profile?: Profile | null): string {
  if (profile?.providerId === provider.id) {
    if (profile.apiKey) return profile.apiKey;
    if (profile.apiKeyEnv && process.env[profile.apiKeyEnv]) return process.env[profile.apiKeyEnv]!;
  }
  if (provider.apiKeyEnv && process.env[provider.apiKeyEnv]) return process.env[provider.apiKeyEnv]!;
  if (provider.apiKey) return provider.apiKey;
  const cfg = loadConfig();
  return cfg.providerKeys[provider.id] || "";
}
