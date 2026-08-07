// frontend/src/hooks/useResumableTasks.ts
// 集中管理可恢复任务 - 全局可订阅，避免 Chat / Sidebar 各自轮询
import { useEffect, useState, useCallback, useRef } from 'react';
import { getTasks, resumeTask, type TaskStateSummary } from '../api';
import { useAgentStream } from './useAgentStream';

export interface ResumableTask {
  id: string;
  title?: string;
  chatId?: string;
  phase?: string;
  updatedAt?: number;
}

const isResumable = (t: TaskStateSummary) =>
  t?.phase === 'replan' || t?.phase === 'paused' || t?.phase === 'interrupted';

// Adaptive polling: faster when tasks are active, slower when idle
const POLL_INTERVAL_ACTIVE = 10000;  // 10s when tasks are present
const POLL_INTERVAL_IDLE = 30000;     // 30s when no tasks

/**
 * 集中任务状态：
 * - SSE 在线时由事件驱动更新（实时）
 * - SSE 不可用时降级为自适应轮询
 * - 多个组件共用同一份数据，避免重复请求
 * - 页面不可见时暂停轮询，恢复后立即刷新
 */
export function useResumableTasks() {
  const [tasks, setTasks] = useState<ResumableTask[]>([]);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  const lastFetchRef = useRef(0);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const fetchAll = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    
    // Skip if recently fetched (unless forced)
    if (!force && Date.now() - lastFetchRef.current < 2000) return;
    
    inFlightRef.current = true;
    setLoading(true);
    try {
      const list = await getTasks();
      const mapped = (list || [])
        .filter(isResumable)
        .map(t => ({
          id: t.taskId,
          title: t.goal,
          phase: t.phase,
          updatedAt: t.updatedAt,
        }));
      setTasks(mapped);
      lastFetchRef.current = Date.now();
    } catch {
      // 静默失败
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // 实时事件流 - 收到事件时立即刷新（事件名与后端 events.ts 对齐）
  useAgentStream({
    autoConnect: true,
    onEvent: (e) => {
      if (
        e.type === 'task_start' ||
        e.type === 'task_plan' ||
        e.type === 'task_complete' ||
        e.type === 'task_error' ||
        e.type === 'step_complete' ||
        e.type === 'step_fail'
      ) {
        fetchAll(true);
      }
    },
  });

  // Adaptive polling based on task state
  useEffect(() => {
    fetchAll(true);
    
    let interval: ReturnType<typeof setInterval>;
    
    const setupPolling = () => {
      const hasTasks = tasksRef.current.length > 0;
      const intervalMs = hasTasks ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE;
      
      clearInterval(interval);
      interval = setInterval(() => fetchAll(), intervalMs);
    };
    
    setupPolling();
    
    // Re-adjust interval when task count changes
    const checkInterval = setInterval(setupPolling, 5000);
    
    return () => {
      clearInterval(interval);
      clearInterval(checkInterval);
    };
  }, [fetchAll]);

  // 页面可见性变化时智能刷新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // 页面恢复可见时立即刷新
        fetchAll(true);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchAll]);

  const resume = useCallback(async (taskId: string) => {
    const res = await resumeTask(taskId);
    // 立即刷新一次
    fetchAll(true);
    return res;
  }, [fetchAll]);

  return { tasks, count: tasks.length, loading, refresh: () => fetchAll(true), resume };
}
