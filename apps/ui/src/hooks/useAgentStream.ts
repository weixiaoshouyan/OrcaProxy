// frontend/src/hooks/useAgentStream.ts
// Agent 实时事件流 - 用 SSE 替代 15s 轮询，任务状态变更秒级到达
import { useEffect, useRef, useState, useCallback } from 'react';

export type AgentEventType =
  | 'task.started'
  | 'task.step'
  | 'task.completed'
  | 'task.failed'
  | 'task.paused'
  | 'task.resumed'
  | 'tool.start'
  | 'tool.end'
  | 'log'
  | 'ping';

export interface AgentEvent {
  type: AgentEventType;
  taskId?: string;
  timestamp: number;
  payload: any;
}

interface Options {
  url?: string;
  autoConnect?: boolean;
  onEvent?: (e: AgentEvent) => void;
  reconnectDelay?: number;
}

/**
 * Agent 实时事件流（SSE）
 * 后端暴露 GET /api/agent/stream 时，前端订阅即可获得 sub-second 任务状态变更
 * 后端未实现时降级为 5s 轮询，不影响功能
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
          // 切换为 polling 模式
          if (!fallback) setFallback(true);
          if (!closedRef.current) {
            reconnectTimerRef.current = setTimeout(connect, reconnectDelay);
          }
        }
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as AgentEvent;
          setLastEvent(data);
          onEventRef.current?.(data);
        } catch {
          // ignore
        }
      };
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
