/**
 * Shared TypeScript type definitions for the Orca frontend.
 * Replaces `any` usage across pages and components.
 */

// ── Stats ──────────────────────────────────────────────────────────────

export interface RequestStats {
  totalRequests: number;
  interceptedRequests: number;
  tokens: number;
  totalTokens: number;
  totalCost: number;
}

// ── Billing ────────────────────────────────────────────────────────────

export interface BillingDayEntry {
  total: number;
  cached: number;
  uncached: number;
}

/** keyed by date string "YYYY-MM-DD", value is model →entry */
export type BillingData = Record<string, Record<string, number | BillingDayEntry>>;

export interface BillingTableRow {
  date: string;
  model: string;
  total: number;
  cached: number;
  uncached: number;
}

// ── Config ─────────────────────────────────────────────────────────────

export interface AppConfig {
  activeProviderId?: string;
  providerKeys?: Record<string, string>;
  customProviders?: unknown[];
  modelOverrides?: Record<string, string>;
  port?: number;
  logLevel?: string;
  theme?: 'dark' | 'light';
  language?: 'zh' | 'en';
  projectDir?: string;
  autoStart?: boolean;
  cacheEnabled?: boolean;
  healthCheckEnabled?: boolean;
  embeddingProviderId?: string;
  embeddingModel?: string;
  fallbackProviderIds?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  modelPricing?: Record<string, PricingConfig>;
  autoSyncInterval?: string;
  defaultTemperature?: number;
  routingRules?: RoutingRule[];
  discoveredModels?: Record<string, Array<{ id: string; name: string }>>;
}

export interface RoutingRule {
  pattern: string;
  providerId: string;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface PricingConfig {
  inputPrice: number;
  outputPrice: number;
  cachedInputPrice?: number;
}

// ── Provider ───────────────────────────────────────────────────────────

export interface ProviderModel {
  id: string;
  name: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  apiKeyEnv?: string;
  models: ProviderModel[];
}

// ── Skill ──────────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description: string;
  category?: string;
  path?: string;
}

// ── MCP Tool ───────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  serverName?: string;
  inputSchema?: Record<string, unknown>;
}

// ── Task ───────────────────────────────────────────────────────────────

export interface ResumableTask {
  id: string;
  title?: string;
  chatId?: string;
  phase?: string;
}

// ── Chat ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: string;
  content: string;
  timestamp?: string;
}

export interface Conversation {
  id: string;
  workspaceId?: string;
  title: string;
  preset: string;
  quality: string;
  model: string;
  messages: ChatMessage[];
}

export interface ModelOption {
  id: string;
  name: string;
  providerName: string;
}

// ── Workspace ──────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  path: string;
  initial: string;
}

// ── Workspace file explorer ────────────────────────────────────────────

export interface WorkspaceItem {
  name: string;
  relativePath: string;
  absolutePath: string;
  isDirectory: boolean;
  size?: number;
}

// ── Git ────────────────────────────────────────────────────────────────

export interface GitModifiedFile {
  status: string;
  filepath: string;
}

export interface GitInfo {
  branch: string;
  changes: number;
  untracked: number;
  status: string;
  lastCommit: string;
  modifiedFiles: GitModifiedFile[];
}

export interface ModifiedFileEntry {
  path: string;
  action: string;
  time: string;
}

// ── Context tokens ─────────────────────────────────────────────────────

export interface ContextTokenInfo {
  used: number;
  total: number;
  percent: number;
}

// ── Task list ──────────────────────────────────────────────────────────

export interface TaskListItem {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'done';
  description: string;
}

// ── API Error ──────────────────────────────────────────────────────────

export interface ApiErrorResponse {
  error?: string;
  message?: string;
  code?: string;
}

