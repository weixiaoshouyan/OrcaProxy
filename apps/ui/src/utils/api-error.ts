/**
 * Unified API error handling.
 *
 * - Axios response interceptor for centralized error transformation.
 * - ErrorCode enum for consistent error classification.
 * - ApiError class that carries status, code, and user-friendly message.
 * - Toast integration via a global error event.
 */

import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { ApiErrorResponse } from '../types';

// ── Error codes ────────────────────────────────────────────────────────

export const ErrorCode = {
  NETWORK: 'NETWORK',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER_ERROR: 'SERVER_ERROR',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── ApiError ───────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(
    message: string,
    status: number,
    code: ErrorCode,
    detail?: string
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  /** True if this is a transient error worth retrying */
  get retryable(): boolean {
    return (
      this.code === ErrorCode.NETWORK ||
      this.code === ErrorCode.RATE_LIMIT ||
      this.code === ErrorCode.SERVER_ERROR ||
      this.code === ErrorCode.TIMEOUT
    );
  }

  toUserMessage(lang: 'zh' | 'en' = 'zh'): string {
    const messages: Record<ErrorCode, { zh: string; en: string }> = {
      [ErrorCode.NETWORK]: {
        zh: '网络连接失败，请检查网络后重试',
        en: 'Network connection failed, please check your connection',
      },
      [ErrorCode.UNAUTHORIZED]: {
        zh: '认证失败，请检查 API 密钥或本地令牌',
        en: 'Authentication failed, please check your API key or local token',
      },
      [ErrorCode.FORBIDDEN]: {
        zh: '没有权限执行此操作',
        en: 'You do not have permission to perform this action',
      },
      [ErrorCode.NOT_FOUND]: {
        zh: '请求的资源不存在',
        en: 'The requested resource was not found',
      },
      [ErrorCode.RATE_LIMIT]: {
        zh: '请求过于频繁，请稍后重试',
        en: 'Too many requests, please try again later',
      },
      [ErrorCode.SERVER_ERROR]: {
        zh: '服务器内部错误',
        en: 'Internal server error',
      },
      [ErrorCode.TIMEOUT]: {
        zh: '请求超时',
        en: 'Request timed out',
      },
      [ErrorCode.CANCELLED]: {
        zh: '请求已取消',
        en: 'Request was cancelled',
      },
      [ErrorCode.UNKNOWN]: {
        zh: this.detail || this.message || '未知错误',
        en: this.detail || this.message || 'Unknown error',
      },
    };
    return messages[this.code][lang];
  }
}

// ── Interceptor logic ──────────────────────────────────────────────────

/**
 * Classify an Axios error into an ApiError.
 * Exported for testing and for use in catch blocks.
 */
export function classifyAxiosError(err: AxiosError<ApiErrorResponse>): ApiError {
  // Cancelled request
  if (err.code === 'ERR_CANCELED' || err.name === 'CanceledError') {
    return new ApiError('Request cancelled', 0, ErrorCode.CANCELLED);
  }

  // No response → network / timeout
  if (!err.response) {
    const isTimeout =
      err.code === 'ECONNABORTED' ||
      err.code === 'ETIMEDOUT' ||
      (err.message && err.message.toLowerCase().includes('timeout'));
    return new ApiError(
      isTimeout ? 'Request timed out' : 'Network error',
      0,
      isTimeout ? ErrorCode.TIMEOUT : ErrorCode.NETWORK,
      err.message
    );
  }

  const { status, data } = err.response;
  const detail = data?.error || data?.message;

  let code: ErrorCode;
  switch (status) {
    case 401:
      code = ErrorCode.UNAUTHORIZED;
      break;
    case 403:
      code = ErrorCode.FORBIDDEN;
      break;
    case 404:
      code = ErrorCode.NOT_FOUND;
      break;
    case 429:
      code = ErrorCode.RATE_LIMIT;
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      code = ErrorCode.SERVER_ERROR;
      break;
    default:
      code = ErrorCode.UNKNOWN;
  }

  return new ApiError(
    `HTTP ${status}`,
    status,
    code,
    detail || err.message
  );
}

/**
 * Install response and request interceptors on an axios instance.
 * Returns a cleanup function that ejects the interceptors.
 *
 * Usage:
 *   const cleanup = setupApiInterceptors(api, (apiError) => { ... });
 *   // later: cleanup();
 */
export function setupApiInterceptors(
  instance: {
    interceptors: {
      request: {
        use: (
          onFulfilled?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig,
          onRejected?: (err: unknown) => unknown
        ) => number;
        eject: (id: number) => void;
      };
      response: {
        use: (
          onFulfilled?: (res: AxiosResponse) => AxiosResponse,
          onRejected?: (err: unknown) => unknown
        ) => number;
        eject: (id: number) => void;
      };
    };
  },
  onError?: (error: ApiError, config?: InternalAxiosRequestConfig) => void
): () => void {
  const responseInterceptor = instance.interceptors.response.use(
    (response: AxiosResponse) => response,
    (error: unknown) => {
      // Re-wrap as ApiError
      const apiError =
        error && typeof error === 'object' && 'isAxiosError' in error
          ? classifyAxiosError(error as AxiosError<ApiErrorResponse>)
          : new ApiError(
              error instanceof Error ? error.message : String(error),
              0,
              ErrorCode.UNKNOWN
            );

      // Silently ignore cancellations — those are intentional user actions
      if (apiError.code !== ErrorCode.CANCELLED) {
        // First 401 without any known token: ask the user for the local token
        // (covers non-Electron runs where the browser has no cookie yet).
        if (
          apiError.code === ErrorCode.UNAUTHORIZED &&
          !sessionStorage.getItem('orca_token') &&
          typeof window !== 'undefined' &&
          !(window as any).__orcaTokenPromptShown
        ) {
          (window as any).__orcaTokenPromptShown = true;
          const t = window.prompt(
            '需要本地令牌（LOCAL_AUTH_TOKEN）：\n请在服务器启动日志中查找，或打开 data/.token 复制内容。'
          );
          if (t && t.trim()) {
            sessionStorage.setItem('orca_token', t.trim());
            window.location.reload();
          } else {
            (window as any).__orcaTokenPromptShown = false;
          }
        }
        if (onError) {
          const errCfg = (error as AxiosError)?.config;
          onError(apiError, errCfg as InternalAxiosRequestConfig | undefined);
        } else {
          console.error('[API Error]', apiError.toUserMessage(), apiError.detail);
        }
      }

      return Promise.reject(apiError);
    }
  );

  const requestInterceptor = instance.interceptors.request.use(
    (config) => config,
    (error) => Promise.reject(error)
  );

  return () => {
    instance.interceptors.request.eject(requestInterceptor);
    instance.interceptors.response.eject(responseInterceptor);
  };
}
