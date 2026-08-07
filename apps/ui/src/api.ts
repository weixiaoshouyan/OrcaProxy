import axios from 'axios';
import { setupApiInterceptors, ApiError, ErrorCode } from './utils/api-error';

export { ApiError, ErrorCode };

// Token extraction: URL query string → sessionStorage → empty.
// With the HttpOnly cookie approach, the browser sends the cookie automatically
// on same-origin requests. The x-local-token header is kept as a belt-and-suspenders fallback.
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');
if (urlToken) {
  sessionStorage.setItem('orca_token', urlToken);
}
const token = urlToken || sessionStorage.getItem('orca_token') || '';

const isDev = window.location.port === '5173';
const API_BASE_URL = isDev ? 'http://127.0.0.1:18080' : window.location.origin;

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { 'x-local-token': token } : {})
  }
});

// Global toast dispatch on API errors (non-cancelled)
setupApiInterceptors(api, (apiError) => {
  console.error('[API Error]', apiError.toUserMessage(), apiError.detail);
  // Dispatch a global event that Toast providers can listen for
  window.dispatchEvent(
    new CustomEvent('orca:api-error', {
      detail: {
        message: apiError.toUserMessage(),
        code: apiError.code,
        status: apiError.status,
      },
    })
  );
});

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
  fallbackProviderIds?: string[];
}

export async function getProfiles(): Promise<{ profiles: Record<string, Profile>; activeProfileId?: string }> {
  const { data } = await api.get('/api/profiles');
  return data;
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const { data } = await api.post('/api/profiles', profile);
  return data.profile;
}

export async function activateProfile(id: string): Promise<{ ok: boolean; activeProfileId: string }> {
  const { data } = await api.post(`/api/profiles/${id}/activate`);
  return data;
}

export async function deleteProfile(id: string): Promise<void> {
  await api.delete(`/api/profiles/${id}`);
}

export async function getProviderHealth(): Promise<Record<string, { ok: boolean; latencyMs: number; error?: string }>> {
  const { data } = await api.get('/api/health/providers');
  return data;
}

// Tasks API
export interface TaskStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  toolCalls?: { name: string; arguments: string; result?: string }[];
}

export interface TaskStateSummary {
  taskId: string;
  goal: string;
  phase: string;
  updatedAt: number;
  deletedAt?: number;
}

export interface TaskState {
  taskId: string;
  goal: string;
  phase: string;
  workspacePath: string;
  steps: TaskStep[];
  updatedAt: number;
  metadata?: {
    originalRequest?: unknown;
    resumeError?: string;
    resumeOutput?: string;
    [key: string]: unknown;
  };
}

export async function getTasks(): Promise<TaskStateSummary[]> {
  const { data } = await api.get('/api/tasks');
  return data;
}

export async function getArchivedTasks(): Promise<TaskStateSummary[]> {
  const { data } = await api.get('/api/tasks/archived');
  return data;
}

export async function restoreTask(taskId: string): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post(`/api/tasks/${taskId}/restore`);
  return data;
}

export async function hardDeleteTask(taskId: string): Promise<void> {
  await api.delete(`/api/tasks/${taskId}/hard`);
}

export async function answerTask(taskId: string, answer: string): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post(`/api/tasks/${taskId}/answer`, { answer });
  return data;
}

export async function getTask(taskId: string): Promise<TaskState> {
  const { data } = await api.get(`/api/tasks/${taskId}`);
  return data;
}

export async function deleteTask(taskId: string): Promise<void> {
  await api.delete(`/api/tasks/${taskId}`);
}

export async function resumeTask(taskId: string): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post(`/api/tasks/${taskId}/resume`);
  return data;
}

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

export async function getMcpPermissions(): Promise<{ permissions: McpPermissions; pending: PendingApproval[] }> {
  const { data } = await api.get('/api/mcp/permissions');
  return data;
}

export async function setMcpPermissions(perms: McpPermissions): Promise<{ ok: boolean; permissions: McpPermissions }> {
  const { data } = await api.put('/api/mcp/permissions', perms);
  return data;
}

export async function approveMcpTool(taskId: string, toolCallId: string): Promise<{ ok: boolean; pending: PendingApproval[] }> {
  const { data } = await api.post('/api/mcp/approve', { taskId, toolCallId });
  return data;
}

export async function rejectMcpApproval(taskId: string, toolCallId: string): Promise<{ ok: boolean; pending: PendingApproval[] }> {
  const { data } = await api.post('/api/mcp/reject', { taskId, toolCallId });
  return data;
}

export async function clearPendingApprovals(taskId?: string): Promise<{ ok: boolean; pending: PendingApproval[] }> {
  const { data } = await api.post('/api/mcp/clear-pending', { taskId });
  return data;
}

export interface CodeSearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  type: string;
  name?: string;
  score: number;
  content: string;
}

export async function indexCode(workspacePath: string): Promise<{ ok: boolean; chunks: number; updatedAt: number }> {
  const { data } = await api.post('/api/code-index', { workspacePath });
  return data;
}

export async function searchCode(
  workspacePath: string,
  query: string,
  limit?: number,
  strategy?: 'hybrid' | 'keyword' | 'embedding'
): Promise<{ query: string; results: CodeSearchResult[] }> {
  const { data } = await api.post('/api/code-search', { workspacePath, query, limit, strategy });
  return data;
}

// Embedding health
export interface EmbeddingHealthResult {
  ok: boolean;
  providerId: string;
  model: string;
  dimensions?: number;
  latencyMs: number;
  error?: string;
}

export async function getEmbeddingHealth(): Promise<EmbeddingHealthResult> {
  const { data } = await api.get('/api/health/embeddings');
  return data;
}

// Eval API
export interface EvalCriterion {
  type: 'file_exists' | 'file_contains' | 'command_passes' | 'command_output_contains';
  target: string;
  value?: string;
}

export interface EvalTask {
  id: string;
  name: string;
  prompt: string;
  workspacePath: string;
  criteria: EvalCriterion[];
  maxIterations?: number;
}

export interface EvalResultDetail {
  criterion: EvalCriterion;
  passed: boolean;
  note: string;
}

export interface EvalResult {
  taskId: string;
  passed: boolean;
  score: number;
  total: number;
  details: EvalResultDetail[];
  durationMs: number;
  taskStateId?: string;
}

export async function getEvalDataset(): Promise<{ tasks: EvalTask[] }> {
  const { data } = await api.get('/api/eval/dataset');
  return data;
}

export async function saveEvalDataset(tasks: EvalTask[]): Promise<{ ok: boolean; count: number }> {
  const { data } = await api.post('/api/eval/dataset', { tasks });
  return data;
}

export async function getEvalResults(): Promise<{ results: EvalResult[] }> {
  const { data } = await api.get('/api/eval/results');
  return data;
}

export async function runEvalTask(taskId: string): Promise<EvalResult> {
  const { data } = await api.post(`/api/eval/run/${taskId}`, {});
  return data;
}

// Audit log interfaces
export interface AuditEntry {
  timestamp: string;
  action: string;
  taskId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  result?: string;
  success: boolean;
  durationMs?: number;
}

export interface AuditStats {
  totalEntries: number;
  todayEntries: number;
  dirSize: number;
}

export async function getAuditLog(params?: { action?: string; taskId?: string; limit?: number }): Promise<AuditEntry[]> {
  const { data } = await api.get('/api/audit', { params });
  return data;
}

export async function getAuditStats(): Promise<AuditStats> {
  const { data } = await api.get('/api/audit/stats');
  return data;
}

// Helper for SSE streams
export async function fetchEventSource(
  url: string,
  body: Record<string, unknown>,
  onMessage: (data: string) => void,
  onDone: () => void,
  onError: (err: unknown) => void,
  signal?: AbortSignal
) {
  try {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-local-token': token } : {})
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) throw new Error("No reader");

    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Skip event: lines and comments
        if (trimmed.startsWith('event:') || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          const dataStr = trimmed.substring(6);
          try {
            onMessage(dataStr);
          } catch (e) {
            console.error("Parse error", e);
          }
        }
      }
    }
    
    // Process residual buffer if any
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
        const dataStr = trimmed.substring(6);
        try {
          onMessage(dataStr);
        } catch (e) {
          console.error("Parse error", e);
        }
      }
    }
    
    onDone();
  } catch (e) {
    onError(e);
  }
}
