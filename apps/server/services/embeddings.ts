// ============================================================
// src/services/embeddings.ts
// Provider-backed text embeddings for Workspace RAG
// ============================================================

import { loadConfig, getProvider, getApiKey, getActiveProfile } from "../providers";
import { log } from "../utils/log";
import { buildProbeUrl } from "./health";

const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: "text-embedding-3-small",
  deepseek: "deepseek-embedding",
  qwen: "text-embedding-v3",
  zhipu: "embedding-3",
  moonshot: "moonshot-v1-embedding",
  siliconflow: "BAAI/bge-m3",
};

export interface EmbeddingProvider {
  providerId: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export function getEmbeddingProvider(): EmbeddingProvider | undefined {
  const cfg = loadConfig();
  const profile = getActiveProfile();

  let providerId = cfg.embeddingProviderId || profile?.providerId || cfg.activeProviderId;
  let model = cfg.embeddingModel;

  const provider = getProvider(providerId);
  if (!provider) return undefined;

  const apiKey = getApiKey(provider.id, profile);
  if (!apiKey) return undefined;

  if (!model) {
    model = DEFAULT_EMBEDDING_MODELS[provider.id] || "text-embedding-3-small";
  }

  return { providerId: provider.id, model, apiKey, baseUrl: provider.baseUrl };
}

export async function embedTexts(texts: string[]): Promise<number[][] | undefined> {
  const ep = getEmbeddingProvider();
  if (!ep) return undefined;
  if (texts.length === 0) return [];

  const url = buildProbeUrl(ep.baseUrl, "/embeddings");
  const body = { input: texts, model: ep.model };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ep.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      log("warn", `[Embeddings] Provider ${ep.providerId} returned ${resp.status}: ${err.slice(0, 300)}`);
      return undefined;
    }

    const data = (await resp.json()) as any;
    const embeddings: number[][] = [];
    const items = data.data || [];
    for (const item of items) {
      if (Array.isArray(item.embedding)) embeddings.push(item.embedding);
    }

    if (embeddings.length !== texts.length) {
      log("warn", `[Embeddings] Mismatch: requested ${texts.length}, got ${embeddings.length}`);
    }

    return embeddings.length > 0 ? embeddings : undefined;
  } catch (e: any) {
    log("warn", `[Embeddings] Failed to fetch embeddings:`, e.message);
    return undefined;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  // Vectors must be the same dimension; mismatched dims produce an undefined
  // similarity, so return 0 rather than NaN.
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface EmbeddingHealthResult {
  ok: boolean;
  providerId: string;
  model: string;
  dimensions?: number;
  latencyMs: number;
  error?: string;
}

export async function checkEmbeddingHealth(): Promise<EmbeddingHealthResult> {
  const start = Date.now();
  const ep = getEmbeddingProvider();
  if (!ep) {
    return { ok: false, providerId: "", model: "", latencyMs: 0, error: "No embedding provider configured or API key missing" };
  }

  const url = buildProbeUrl(ep.baseUrl, "/embeddings");
  const body = { input: ["hello world"], model: ep.model };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ep.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return { ok: false, providerId: ep.providerId, model: ep.model, latencyMs: Date.now() - start, error: `${resp.status}: ${err.slice(0, 300)}` };
    }

    const data = (await resp.json()) as any;
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) {
      return { ok: false, providerId: ep.providerId, model: ep.model, latencyMs: Date.now() - start, error: "Invalid embedding response format" };
    }

    return { ok: true, providerId: ep.providerId, model: ep.model, dimensions: vec.length, latencyMs: Date.now() - start };
  } catch (e: any) {
    return { ok: false, providerId: ep.providerId, model: ep.model, latencyMs: Date.now() - start, error: e.message };
  }
}
