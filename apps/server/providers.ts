// ============================================================
// src/providers.ts
// Multi-provider registry for Chinese LLM APIs
// ============================================================

export interface ProviderModel {
  id: string;
  name: string;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  apiKey?: string;
  models: ProviderModel[];
  openaiCompatible: boolean;
  description: string;
}

export const BUILTIN_PROVIDERS: Provider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    openaiCompatible: true,
    description: "\u6DF1\u5EA6\u6C42\u7D22 - \u9AD8\u6027\u4EF7\u6BD4\u63A8\u7406\u6A21\u578B",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true },
    ],
  },
  {
    id: "qwen",
    name: "\u901A\u4E49\u5343\u95EE",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    openaiCompatible: true,
    description: "\u963F\u91CC\u4E91\u901A\u4E49\u5343\u95EE\u7CFB\u5217\u6A21\u578B",
    models: [
      { id: "qwen-turbo", name: "Qwen Turbo" },
      { id: "qwen-plus", name: "Qwen Plus" },
      { id: "qwen-max", name: "Qwen Max" },
      { id: "qwen-long", name: "Qwen Long", maxTokens: 10000 },
    ],
  },
  {
    id: "zhipu",
    name: "\u667A\u8C31AI",
    baseUrl: "https://open.bigmodel.cn/api/paas",
    apiKeyEnv: "ZHIPU_API_KEY",
    openaiCompatible: true,
    description: "\u667A\u8C31 GLM \u7CFB\u5217\u6A21\u578B",
    models: [
      { id: "glm-4-flash", name: "GLM-4 Flash" },
      { id: "glm-4", name: "GLM-4" },
      { id: "glm-4-long", name: "GLM-4 Long" },
    ],
  },
  {
    id: "moonshot",
    name: "\u6708\u4E4B\u6697\u9762",
    baseUrl: "https://api.moonshot.cn",
    apiKeyEnv: "MOONSHOT_API_KEY",
    openaiCompatible: true,
    description: "Moonshot / Kimi \u7CFB\u5217\u6A21\u578B",
    models: [
      { id: "moonshot-v1-8k", name: "Moonshot V1 8K" },
      { id: "moonshot-v1-32k", name: "Moonshot V1 32K" },
      { id: "moonshot-v1-128k", name: "Moonshot V1 128K" },
    ],
  },
  {
    id: "baichuan",
    name: "\u767E\u5DDD\u667A\u80FD",
    baseUrl: "https://api.baichuan-ai.com",
    apiKeyEnv: "BAICHUAN_API_KEY",
    openaiCompatible: true,
    description: "\u767E\u5DDD\u5927\u6A21\u578B",
    models: [
      { id: "Baichuan4", name: "Baichuan 4" },
      { id: "Baichuan3-Turbo", name: "Baichuan 3 Turbo" },
    ],
  },
  {
    id: "yi",
    name: "\u96F6\u4E00\u4E07\u7269",
    baseUrl: "https://api.lingyiwanwu.com",
    apiKeyEnv: "YI_API_KEY",
    openaiCompatible: true,
    description: "Yi / \u96F6\u4E00\u4E07\u7269\u7CFB\u5217\u6A21\u578B",
    models: [
      { id: "yi-large", name: "Yi Large" },
      { id: "yi-medium", name: "Yi Medium" },
      { id: "yi-spark", name: "Yi Spark" },
    ],
  },
  {
    id: "doubao",
    name: "\u8C46\u5305",
    baseUrl: "https://ark.cn-beijing.volces.com/api",
    apiKeyEnv: "DOUBAO_API_KEY",
    openaiCompatible: true,
    description: "\u706B\u5C71\u5F15\u64CE\u8C46\u5305\u5927\u6A21\u578B",
    models: [
      { id: "doubao-pro-4k", name: "Doubao Pro 4K" },
      { id: "doubao-pro-32k", name: "Doubao Pro 32K" },
      { id: "doubao-pro-128k", name: "Doubao Pro 128K" },
    ],
  },
  {
    id: "siliconflow",
    name: "\u7845\u57FA\u6D41\u52A8",
    baseUrl: "https://api.siliconflow.cn",
    apiKeyEnv: "SILICONFLOW_API_KEY",
    openaiCompatible: true,
    description: "SiliconFlow - \u591A\u6A21\u578B\u805A\u5408\u5E73\u53F0",
    models: [
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
      { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
      { id: "meta-llama/Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B" },
    ],
  },
  {
    id: "longcat",
    name: "\u7f8e\u56e2\u9f99\u732b LongCat",
    // 注意：baseUrl 已包含 /openai/v1，网关会自动识别并避免重复追加 /v1。
    baseUrl: "https://api.longcat.chat/openai/v1",
    apiKeyEnv: "LONGCAT_API_KEY",
    openaiCompatible: true,
    description: "\u7f8e\u56e2 LongCat \u9f99\u732b\u5927\u6a21\u578b (\u539f\u751f OpenAI \u517c\u5bb9\uff0c\u6bcf\u65e5\u514d\u8d39\u989d\u5ea6)",
    models: [
      { id: "LongCat-Flash-Chat", name: "LongCat Flash Chat" },
      { id: "LongCat-Flash-Thinking", name: "LongCat Flash Thinking", reasoning: true },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    apiKeyEnv: "OPENAI_API_KEY",
    openaiCompatible: true,
    description: "OpenAI GPT \u7CFB\u5217\u6A21\u578B",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    openaiCompatible: false,
    description: "Claude \u7CFB\u5217\u6A21\u578B",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
    ],
  },
];
import path from "path";
import fs from "fs";
import { resolveBaseDir, migrateLegacyDataFile } from "./utils/base-dir";
import { atomicWriteFileSync } from "./utils/helpers";

export interface Profile {
  id: string;
  name: string;
  description?: string;
  providerId: string;
  model?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  routingRules?: { pattern: string; providerId: string }[];
  toolRouting?: { pattern: string; providerId: string; model?: string }[];
  env?: Record<string, string>;
  fallbackProviderIds?: string[];
  isDefault?: boolean;
}

export interface RuntimeConfig {
  activeProviderId: string;
  activeProfileId?: string;
  providerKeys: Record<string, string>;
  customProviders: Provider[];
  profiles: Record<string, Profile>;
  modelOverrides: Record<string, string>;
  routingRules: { pattern: string; providerId: string }[];
  discoveredModels?: Record<string, ProviderModel[]>;
  port: number;
  logLevel: string;
  theme?: string;
  language?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  autoSyncInterval?: string;
  cacheEnabled?: boolean;
  healthCheckEnabled?: boolean;
  autoVerify?: boolean;
  fallbackProviderIds?: string[];
  modelPricing?: Record<string, { inputPrice: number; outputPrice: number; cachedInputPrice?: number }>;
  mcpServers?: Record<string, any>;
  mcpPermissions?: { requireApproval: boolean; allowedTools: string[] };
  embeddingProviderId?: string;
  embeddingModel?: string;
  appPaths?: Record<string, string>;
}

const _isPkg = !!(process as any).pkg;
const _isSEA = typeof (process as any).isSea !== "undefined" && (process as any).isSea;
const _isElectron = !!process.env.ORCA_BASE_DIR;
// Unified BASE_DIR: Electron → userData; pkg/SEA → executable dir;
// otherwise walk up to the project root (package.json). All runtime data now
// lives under <BASE_DIR>/data (was split across apps/data in dev mode).
const BASE_DIR = resolveBaseDir(__dirname, 2);
// One-time migration: older dev builds wrote config to apps/data/config.json.
migrateLegacyDataFile("config.json");
const CONFIG_PATH = path.join(BASE_DIR, "data", "config.json");

function defaultConfig(): RuntimeConfig {
  return {
    activeProviderId: "deepseek",
    activeProfileId: undefined,
    providerKeys: {},
    customProviders: [],
    profiles: {},
    modelOverrides: {},
    routingRules: [],
    discoveredModels: {},
    port: 18080,
    logLevel: "info",
    theme: "dark",
    language: "zh",
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    autoSyncInterval: "never",
    cacheEnabled: true,
    healthCheckEnabled: true,
    // Off by default: autoVerify runs workspace package.json scripts (npm
    // test / lint / build, npx tsc) synchronously after every write round —
    // blocking the event loop for minutes and executing untrusted scripts.
    // Opt in via config.autoVerify = true.
    autoVerify: false,
    fallbackProviderIds: [],
    appPaths: {},
    modelPricing: {
      "deepseek-v4-flash": { inputPrice: 1, outputPrice: 2, cachedInputPrice: 0.02 },
      "deepseek-v4-pro": { inputPrice: 3, outputPrice: 6, cachedInputPrice: 0.025 },
    },
    mcpServers: {},
  };
}

let _config: RuntimeConfig | null = null;

/** Validate and sanitize a loaded config object */
function validateConfig(raw: Record<string, unknown>): Partial<RuntimeConfig> {
  const cfg: Record<string, unknown> = {};
  if (typeof raw.activeProviderId === "string") cfg.activeProviderId = raw.activeProviderId;
  if (typeof raw.activeProfileId === "string" || raw.activeProfileId === undefined) cfg.activeProfileId = raw.activeProfileId;
  if (typeof raw.providerKeys === "object" && raw.providerKeys !== null && !Array.isArray(raw.providerKeys)) cfg.providerKeys = raw.providerKeys;
  if (Array.isArray(raw.customProviders)) cfg.customProviders = raw.customProviders;
  if (typeof raw.profiles === "object" && raw.profiles !== null && !Array.isArray(raw.profiles)) cfg.profiles = raw.profiles;
  if (typeof raw.modelOverrides === "object" && raw.modelOverrides !== null && !Array.isArray(raw.modelOverrides)) cfg.modelOverrides = raw.modelOverrides;
  if (Array.isArray(raw.routingRules)) cfg.routingRules = raw.routingRules;
  if (typeof raw.discoveredModels === "object" && raw.discoveredModels !== null && !Array.isArray(raw.discoveredModels)) cfg.discoveredModels = raw.discoveredModels;
  if (typeof raw.port === "number" && raw.port > 0 && raw.port < 65536) cfg.port = raw.port;
  if (typeof raw.logLevel === "string") cfg.logLevel = raw.logLevel;
  if (typeof raw.theme === "string") cfg.theme = raw.theme;
  if (typeof raw.language === "string") cfg.language = raw.language;
  if (typeof raw.defaultTemperature === "number") cfg.defaultTemperature = raw.defaultTemperature;
  if (typeof raw.defaultMaxTokens === "number") cfg.defaultMaxTokens = raw.defaultMaxTokens;
  if (typeof raw.autoSyncInterval === "string") cfg.autoSyncInterval = raw.autoSyncInterval;
  if (typeof raw.cacheEnabled === "boolean") cfg.cacheEnabled = raw.cacheEnabled;
  if (typeof raw.healthCheckEnabled === "boolean") cfg.healthCheckEnabled = raw.healthCheckEnabled;
  if (typeof raw.autoVerify === "boolean") cfg.autoVerify = raw.autoVerify;
  if (Array.isArray(raw.fallbackProviderIds)) cfg.fallbackProviderIds = raw.fallbackProviderIds;
  if (typeof raw.modelPricing === "object" && raw.modelPricing !== null && !Array.isArray(raw.modelPricing)) cfg.modelPricing = raw.modelPricing;
  if (typeof raw.mcpServers === "object" && raw.mcpServers !== null && !Array.isArray(raw.mcpServers)) cfg.mcpServers = raw.mcpServers;
  if (typeof raw.mcpPermissions === "object" && raw.mcpPermissions !== null && !Array.isArray(raw.mcpPermissions)) cfg.mcpPermissions = raw.mcpPermissions;
  if (typeof raw.embeddingProviderId === "string" || raw.embeddingProviderId === undefined) cfg.embeddingProviderId = raw.embeddingProviderId;
  if (typeof raw.embeddingModel === "string" || raw.embeddingModel === undefined) cfg.embeddingModel = raw.embeddingModel;
  if (typeof raw.appPaths === "object" && raw.appPaths !== null && !Array.isArray(raw.appPaths)) cfg.appPaths = raw.appPaths;
  return cfg as Partial<RuntimeConfig>;
}

export function loadConfig(): RuntimeConfig {
  if (_config) return _config;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const validated = validateConfig(parsed);
    // Deep-merge model pricing: a user file that has no pricing entries (e.g.
    // `"modelPricing": {}` from an older UI) must not wipe out the built-in
    // rate card, or the pricing table would silently lose the default models.
    // User-entered entries still win over the defaults.
    validated.modelPricing = {
      ...defaultConfig().modelPricing,
      ...(validated.modelPricing || {}),
    };
    // One-time migration: drop discovered-model entries whose provider no
    // longer exists (custom provider deleted but stale scan results left
    // behind, e.g. a leftover "longcat-2.0"), and stale scan results for a
    // builtin provider whose key was removed. Both are leftovers from the
    // "discover models" flow in the UI, which never cleans up after itself.
    let discoveredChanged = false;
    if (validated.discoveredModels) {
      const knownIds = new Set([
        ...BUILTIN_PROVIDERS.map((p) => p.id),
        ...(validated.customProviders || []).map((p: Provider) => p.id),
      ]);
      for (const key of Object.keys(validated.discoveredModels)) {
        if (!knownIds.has(key)) {
          delete validated.discoveredModels[key];
          discoveredChanged = true;
        } else {
          const builtin = BUILTIN_PROVIDERS.find((b) => b.id === key);
          if (builtin) {
            const hasKey = !!(
              (validated.providerKeys as Record<string, string> | undefined)?.[key] ||
              builtin.apiKey ||
              (builtin.apiKeyEnv ? process.env[builtin.apiKeyEnv] || "" : "")
            );
            if (!hasKey) {
              delete validated.discoveredModels[key];
              discoveredChanged = true;
            }
          }
        }
      }
    }
    _config = { ...defaultConfig(), ...validated };
    if (discoveredChanged) saveConfig(_config);
  } catch {
    _config = defaultConfig();
    saveConfig(_config);
  }
  return _config;
}

export function saveConfig(cfg: RuntimeConfig): void {
  _config = cfg;
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    // Atomic write: a crash mid-write must never leave a truncated config.json
    // behind (a corrupt config silently resets the whole setup on next boot).
    atomicWriteFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error("Failed to save config:", e);
  }
}

export function getAllProviders(): Provider[] {
  const cfg = loadConfig();
  const discovered = cfg.discoveredModels || {};
  return [...BUILTIN_PROVIDERS, ...cfg.customProviders].map((p) => {
    // Only apply user-scanned model lists when the provider is actually
    // configured. A leftover scan result for a provider whose key was
    // removed (e.g. a deleted provider's "longcat-2.0") would otherwise
    // replace the builtin model list and show stale models on every screen.
    const isBuiltin = BUILTIN_PROVIDERS.some((b) => b.id === p.id);
    const hasKey = !!(
      cfg.providerKeys?.[p.id] ||
      (p as Provider).apiKey ||
      (p.apiKeyEnv ? process.env[p.apiKeyEnv] || "" : "")
    );
    if (discovered[p.id] && discovered[p.id].length > 0 && (!isBuiltin || hasKey)) {
      return { ...p, models: discovered[p.id] };
    }
    return p;
  });
}

// ---- Routing pattern safety ----
// Routing rules are user-supplied regexes evaluated against request inputs on
// every request. Reject patterns that enable catastrophic backtracking (ReDoS)
// or are otherwise unbounded before they reach `new RegExp`.

export function isSafeRoutingPattern(pattern: unknown): boolean {
  if (typeof pattern !== "string" || pattern.length < 2 || pattern.length > 100) return false;
  // A group containing a quantifier, followed by another quantifier:
  // (a+)+, (a*)*, (a|a)+, (a+){2,} — classic exponential backtracking.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  // Nested/unbounded quantifier chains: a++, a*+.
  if (/[+*][+*]/.test(pattern)) return false;
  return true;
}

export function getProvider(id: string): Provider | undefined {
  return getAllProviders().find((p) => p.id === id);
}

export function getActiveProvider(): Provider {
  const cfg = loadConfig();
  const profile = getActiveProfile();
  if (profile) {
    return getProvider(profile.providerId) || BUILTIN_PROVIDERS[0];
  }
  return getProvider(cfg.activeProviderId) || BUILTIN_PROVIDERS[0];
}

export function getActiveProfile(): Profile | undefined {
  const cfg = loadConfig();
  if (!cfg.activeProfileId) return undefined;
  return cfg.profiles[cfg.activeProfileId];
}

export function getProfile(id: string): Profile | undefined {
  const cfg = loadConfig();
  return cfg.profiles[id];
}

/**
 * Apply profile-specific environment variables to process.env.
 * Callers are responsible for cleanup if isolation is required.
 */
export function applyProfileEnv(profile?: Profile | null): void {
  if (!profile?.env) return;
  for (const [key, value] of Object.entries(profile.env)) {
    process.env[key] = value;
  }
}

export function getApiKey(providerId: string, profile?: Profile | null): string {
  const cfg = loadConfig();
  if (profile?.providerId === providerId) {
    if (profile.apiKey) return profile.apiKey;
    if (profile.apiKeyEnv && process.env[profile.apiKeyEnv]) return process.env[profile.apiKeyEnv]!;
  }
  const dbKey = cfg.providerKeys[providerId];
  if (dbKey) return dbKey;
  const p = getProvider(providerId);
  if (p?.apiKeyEnv && process.env[p.apiKeyEnv]) {
    return process.env[p.apiKeyEnv]!;
  }
  if (p?.apiKey) return p.apiKey;
  return "";
}

export function resolveModel(
  requested: string,
  profile?: Profile | null,
  tools?: string[]
): { provider: Provider; model: string; apiKey: string } {
  const cfg = loadConfig();
  const activeProfile = profile ?? getActiveProfile();

  // If a profile is active, its provider/model form the base target.
  const activeProvider = activeProfile
    ? (getProvider(activeProfile.providerId) || getProvider(cfg.activeProviderId) || BUILTIN_PROVIDERS[0])
    : (getProvider(cfg.activeProviderId) || BUILTIN_PROVIDERS[0]);
  const activeProviderId = activeProvider.id;

  // Tool-based routing: if any tool name matches a profile.toolRouting rule,
  // route the request to the specified provider/model.
  if (tools && tools.length > 0 && activeProfile?.toolRouting) {
    for (const rule of activeProfile.toolRouting) {
      if (!isSafeRoutingPattern(rule.pattern)) continue;
      try {
        const regex = new RegExp(rule.pattern);
        if (tools.some((name) => regex.test(name))) {
          const prov = getProvider(rule.providerId) || activeProvider;
          const key = getApiKey(prov.id, activeProfile);
          if (key) {
            const model = rule.model || prov.models[0]?.id || requested;
            const isNative = prov.models.some(m => m.id === model);
            const finalModel = isNative ? model : (prov.models[0]?.id || model);
            return { provider: prov, model: finalModel, apiKey: key };
          }
        }
      } catch (e) {
        // ignore invalid regex
      }
    }
  }

  // Profile-level routing rules take precedence over global rules.
  const rules = [
    ...(activeProfile?.routingRules || []),
    ...(cfg.routingRules || []),
  ];
  for (const rule of rules) {
    if (!isSafeRoutingPattern(rule.pattern)) continue;
    try {
      const regex = new RegExp(rule.pattern);
      if (regex.test(requested)) {
        const prov = getProvider(rule.providerId);
        if (prov) {
          const key = getApiKey(prov.id, activeProfile);
          if (key) {
            const isNative = prov.models.some(m => m.id === requested);
            const finalModel = isNative ? requested : (prov.models[0]?.id || requested);
            return { provider: prov, model: finalModel, apiKey: key };
          }
        }
      }
    } catch (e) {
      // ignore invalid regex
    }
  }

  // Explicit "providerId/model" request (the UI stores provider-qualified ids
  // so the same model served by different providers can be addressed
  // unambiguously). If the provider prefix does not resolve to a configured
  // provider with a key, fall through — a bare vendor-qualified id like
  // siliconflow's "deepseek-ai/DeepSeek-V3" must still match by model id below.
  const slashIdx = requested.indexOf("/");
  if (slashIdx > 0) {
    const provId = requested.slice(0, slashIdx);
    const modelPart = requested.slice(slashIdx + 1);
    const prov = getProvider(provId);
    if (prov) {
      const key = getApiKey(prov.id, activeProfile);
      if (key) {
        const isNative = prov.models.some((m) => m.id === modelPart);
        const finalModel = isNative ? modelPart : (prov.models[0]?.id || modelPart);
        return { provider: prov, model: finalModel, apiKey: key };
      }
    }
  }

  // Model overrides (global)
  if (cfg.modelOverrides[requested]) {
    const mapped = cfg.modelOverrides[requested];
    const [provId, modelId] = mapped.includes("/") ? mapped.split("/", 2) : [activeProviderId, mapped];
    const prov = getProvider(provId) || activeProvider;
    return { provider: prov, model: modelId, apiKey: getApiKey(prov.id, activeProfile) };
  }

  // If profile specifies a default model and no specific model requested, use it.
  if (activeProfile?.model && !requested) {
    const key = getApiKey(activeProvider.id, activeProfile);
    return { provider: activeProvider, model: activeProfile.model, apiKey: key };
  }

  // Check active provider first (highest priority for matching models)
  const activeKey = getApiKey(activeProvider.id, activeProfile);
  if (activeKey) {
    for (const m of activeProvider.models) {
      if (m.id === requested) {
        return { provider: activeProvider, model: requested, apiKey: activeKey };
      }
    }
  }

  // Check all other configured providers
  for (const prov of getAllProviders()) {
    if (prov.id === activeProviderId) continue;
    if (!getApiKey(prov.id, activeProfile)) continue;
    for (const m of prov.models) {
      if (m.id === requested) {
        return { provider: prov, model: requested, apiKey: getApiKey(prov.id, activeProfile) };
      }
    }
  }

  // Smart fuzzy/partial model matching if no exact match found yet.
  // Boundary-aware: "gpt-4" must NOT match "gpt-4o" (only "gpt-4" / "gpt-4-..."),
  // while "gpt-4-32k" still matches "gpt-4". We require a clean separator
  // (".", "-", "_", "/") at the join point so short prefixes can't hijack
  // longer, more specific model ids.
  const boundary = /^[.\-_/]$/;
  const modelIdMatches = (reqId: string, mId: string): boolean => {
    if (reqId === mId) return true;
    if (mId.startsWith(reqId) && (mId.length === reqId.length || boundary.test(mId[reqId.length] ?? ""))) return true;
    if (reqId.startsWith(mId) && (reqId.length === mId.length || boundary.test(reqId[mId.length] ?? ""))) return true;
    return false;
  };
  for (const prov of getAllProviders()) {
    if (!getApiKey(prov.id, activeProfile)) continue;
    for (const m of prov.models) {
      const mId = m.id.toLowerCase();
      const reqId = requested.toLowerCase();
      if (modelIdMatches(reqId, mId)) {
        return { provider: prov, model: m.id, apiKey: getApiKey(prov.id, activeProfile) };
      }
    }
  }

  // Fall back to active provider, map model to its first model if not native
  if (activeKey) {
    const isNative = activeProvider.models.some(m => m.id === requested);
    const finalModel = isNative ? requested : (activeProvider.models.length > 0 ? activeProvider.models[0].id : requested);
    return { provider: activeProvider, model: finalModel, apiKey: activeKey };
  }

  // No provider available at all
  return { provider: activeProvider, model: requested, apiKey: "" };
}