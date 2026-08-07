// frontend/src/hooks/useAgentStream.ts
// Agent 实时事件流（SSE）：订阅 GET /api/agent/stream
// 后端事件协议见 apps/server/agent/events.ts（16 种下划线命名事件）
import { useEffect, useRef, useState, useCallback } from 'react';

export type AgentEventType =
  | 'task_start'
  | 'task_plan'
  | 'step_start'
  | 'step_complete'
  | 'step_fail'
  | 'tool_start'
  | 'tool_result'
  | 'tool_error'
  | 'reflection'
  | 'verification'
  | 'context_compression'
  | 'task_complete'
  | 'task_error'
  | 'usage'
  | 'checkpoint'
  | 'text_delta'
  // 兼容保留（后端目前不发送）
  | 'log'
  | 'ping';

export interface AgentEvent {
  type: AgentEventType;
  taskId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

interface Options {
  url?: string;
  autoConnect?: boolean;
  onEvent?: (e: AgentEvent) => void;
  reconnectDelay?: number;
}

/**
 * Agent 实时事件流（SSE）
 * 后端暴露 GET /api/agent/stream，事件名为 `agent_event`（命名事件），
 * 必须用 addEventListener('agent_event') 接收——onmessage 只能收到默认事件。
 * 连接失败或断开时降级为调用方自行轮询（返回 fallback=true）。
 */
export function useAgentStream(opts: Options = {}) {
  const {
    url = '/api/agent/stream',
    autoConnect = true,
    onEvent,
    reconnectDelay = 3000,
  } = opts;

  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<AgentEvent | null>(null);
  const [fallback, setFallback] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const closedRef = useRef(false);
  const reconnectTimerRef = useRef<any>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (closedRef.current) return;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setFallback(false);
      };

      es.onerror = () => {
        setConnected(false);
        // 浏览器 EventSource 默认会自动重连，这里仅做兜底
        if (es.readyState === EventSource.CLOSED) {
          if (!fallback) setFallback(true);
          if (!closedRef.current) {
            reconnectTimerRef.current = setTimeout(connect, reconnectDelay);
          }
        }
      };

      // 后端以命名事件 `event: agent_event` 发送（见 events.ts formatAgentEvent）
      const handleEvent = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as AgentEvent;
          setLastEvent(data);
          onEventRef.current?.(data);
        } catch {
          // ignore
        }
      };
      es.addEventListener('agent_event', handleEvent);
      // 兼容默认事件（部分代理/中间件会改写 event 字段）
      es.onmessage = handleEvent;
    } catch {
      setFallback(true);
    }
  }, [url, fallback, reconnectDelay]);

  useEffect(() => {
    if (!autoConnect) return;
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      eventSourceRef.current?.close();
    };
  }, [connect, autoConnect]);

  const subscribe = useCallback((handler: (e: AgentEvent) => void) => {
    onEventRef.current = handler;
  }, []);

  return { connected, fallback, lastEvent, reconnect: connect, subscribe };
}
