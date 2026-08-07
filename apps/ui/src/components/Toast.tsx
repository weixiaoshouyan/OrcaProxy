// frontend/src/components/Toast.tsx
// 全局 Toast 通知组件 - 替代 alert() 提供更现代的提示体验
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  description?: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, description?: string, duration?: number) => void;
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 兜底：未包裹 Provider 时回退到 console.warn，避免页面崩溃
    return {
      toast: (t, m) => console[t === 'error' ? 'error' : 'warn'](m),
      success: (m) => console.log(m),
      error: (m) => console.error(m),
      info: (m) => console.info(m),
      warning: (m) => console.warn(m),
    };
  }
  return ctx;
}

const ICONS: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const COLORS: Record<ToastType, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  error: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300',
  info: 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-300',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue['toast']>((type, message, description, duration = 4000) => {
    const id = ++counterRef.current;
    setItems(prev => [...prev, { id, type, message, description, duration }]);
    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }
  }, [remove]);

  // Listen for global API errors and show as toast
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; code: string }>).detail;
      if (detail) {
        toast('error', detail.message, detail.code);
      }
    };
    window.addEventListener('orca:api-error', handler as EventListener);
    return () => window.removeEventListener('orca:api-error', handler as EventListener);
  }, [toast]);

  const value: ToastContextValue = {
    toast,
    success: (m, d) => toast('success', m, d),
    error: (m, d) => toast('error', m, d),
    info: (m, d) => toast('info', m, d),
    warning: (m, d) => toast('warning', m, d),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {items.map(item => {
          const Icon = ICONS[item.type];
          return (
            <div
              key={item.id}
              role="alert"
              className={`pointer-events-auto flex items-start gap-2.5 p-3 border rounded-xl shadow-lg backdrop-blur-md bg-white/95 dark:bg-slate-900/95 animate-in slide-in-from-right-4 fade-in duration-300 ${COLORS[item.type]}`}
            >
              <Icon className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--color-text-primary)] leading-tight">{item.message}</div>
                {item.description && (
                  <div className="text-xs mt-0.5 text-[var(--color-text-secondary)] leading-relaxed">{item.description}</div>
                )}
              </div>
              <button
                onClick={() => remove(item.id)}
                className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// 工具：把任意 async 函数包成 toast 形式，自动 loading + success/error
export function useAsyncAction() {
  const t = useToast();
  return useCallback(async <T,>(fn: () => Promise<T>, opts?: { successMsg?: string; errorMsg?: string }) => {
    try {
      const res = await fn();
      if (opts?.successMsg) t.success(opts.successMsg);
      return res;
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      const msg = err?.response?.data?.error || err?.message || (opts?.errorMsg ?? '操作失败');
      t.error(opts?.errorMsg ?? '操作失败', msg);
      throw e;
    }
  }, [t]);
}
