import { useEffect, useState } from 'react';
import { getTasks, getArchivedTasks, getTask, resumeTask, deleteTask, restoreTask, hardDeleteTask, type TaskStateSummary, type TaskState } from '../api';
import { ListTodo, RefreshCw, Trash2, AlertCircle, Play, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, Archive, Undo2 } from 'lucide-react';
import { getLanguage } from '../i18n';
import type { LucideIcon } from 'lucide-react';

export default function TasksPage() {
  const lang = getLanguage();
  const [tasks, setTasks] = useState<TaskStateSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<TaskState | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    setRefreshing(true);
    try {
      const data = showArchived ? await getArchivedTasks() : await getTasks();
      setTasks(data.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (e: unknown) {
      setMessage(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [showArchived]);

  const toggleExpand = async (taskId: string) => {
    const next = new Set(expanded);
    if (next.has(taskId)) {
      next.delete(taskId);
      if (selected?.taskId === taskId) setSelected(null);
    } else {
      next.add(taskId);
      try {
        const detail = await getTask(taskId);
        setSelected(detail);
      } catch (e: unknown) {
        setMessage(String(e));
      }
    }
    setExpanded(next);
  };

  const handleRetry = async (taskId: string) => {
    setRetrying(taskId);
    setMessage('');
    try {
      const result = await resumeTask(taskId);
      setMessage(result.message || (lang === 'en' ? 'Resume triggered' : '已触发续跑'));
      await load();
      if (expanded.has(taskId)) {
        const detail = await getTask(taskId);
        setSelected(detail);
      }
    } catch (e: unknown) {
      setMessage(String(e));
    } finally {
      setRetrying(null);
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      if (selected?.taskId === taskId) setSelected(null);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      await load();
    } catch (e: unknown) {
      setMessage(String(e));
    }
  };

  const handleRestore = async (taskId: string) => {
    try {
      const result = await restoreTask(taskId);
      setMessage(result.message || (lang === 'en' ? 'Task restored' : '任务已恢复'));
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      await load();
    } catch (e: unknown) {
      setMessage(String(e));
    }
  };

  const handleHardDelete = async (taskId: string) => {
    try {
      await hardDeleteTask(taskId);
      if (selected?.taskId === taskId) setSelected(null);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      await load();
    } catch (e: unknown) {
      setMessage(String(e));
    }
  };

  const switchTab = (archived: boolean) => {
    if (showArchived === archived) return;
    setShowArchived(archived);
    setSelected(null);
    setExpanded(new Set());
  };

  const phaseBadge = (phase: string) => {
    const map: Record<string, { icon: LucideIcon; className: string }> = {
      plan: { icon: Clock, className: 'bg-blue-500/10 text-blue-600' },
      execute: { icon: Play, className: 'bg-amber-500/10 text-amber-600' },
      verify: { icon: CheckCircle, className: 'bg-emerald-500/10 text-emerald-600' },
      replan: { icon: RefreshCw, className: 'bg-purple-500/10 text-purple-600' },
      pending_approval: { icon: AlertCircle, className: 'bg-orange-500/10 text-orange-600' },
      done: { icon: CheckCircle, className: 'bg-emerald-500/10 text-emerald-600' },
    };
    const { icon: Icon, className } = map[phase] || { icon: Clock, className: 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]' };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${className}`}>
        <Icon className="w-3 h-3" />
        {phase}
      </span>
    );
  };

  const hasResumeError = (t: TaskStateSummary) =>
    t.phase === 'replan' || t.phase === 'pending_approval';

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <ListTodo className="w-6 h-6 text-[var(--color-primary)]" />
              {lang === 'en' ? 'Agent Tasks' : 'Agent 任务'}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              {lang === 'en'
                ? 'Persisted agent tasks. Retry failed or paused tasks.'
                : '持久化的 Agent 任务。可重试失败或暂停的任务。'}
            </p>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] rounded-lg text-sm hover:text-[var(--color-text-primary)] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {lang === 'en' ? 'Refresh' : '刷新'}
          </button>
        </div>

        <div className="flex gap-2 items-center">
          <button
            onClick={() => switchTab(false)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border ${!showArchived ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border-[var(--color-border-base)]' : 'text-[var(--color-text-muted)] border-transparent'}`}
          >
            <ListTodo className="w-4 h-4" />
            {lang === 'en' ? 'Active' : '进行中'}
          </button>
          <button
            onClick={() => switchTab(true)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border ${showArchived ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border-[var(--color-border-base)]' : 'text-[var(--color-text-muted)] border-transparent'}`}
          >
            <Archive className="w-4 h-4" />
            {lang === 'en' ? 'History' : '历史'}
          </button>
        </div>

        {message && (
          <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg ${message.includes('error') || message.includes('失败') ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
            <AlertCircle className="w-4 h-4" />
            {message}
          </div>
        )}

        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl overflow-hidden">
          {tasks.length === 0 && (
            <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
              {lang === 'en' ? 'No tasks yet.' : '暂无任务。'}
            </div>
          )}
          <div className="divide-y divide-[var(--color-border-base)]">
            {tasks.map((t) => (
              <div key={t.taskId} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <button
                    onClick={() => toggleExpand(t.taskId)}
                    className="flex items-center gap-2 text-left min-w-0"
                  >
                    {expanded.has(t.taskId) ? <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />}
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{t.goal || t.taskId}</span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {showArchived && (
                      <button
                        onClick={() => handleRestore(t.taskId)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[var(--color-primary)] text-white rounded-md text-xs font-medium hover:opacity-90"
                        title={lang === 'en' ? 'Restore' : '恢复'}
                      >
                        <Undo2 className="w-3 h-3" />
                        {lang === 'en' ? 'Restore' : '恢复'}
                      </button>
                    )}
                    {phaseBadge(t.phase)}
                    {hasResumeError(t) && !showArchived && (
                      <button
                        onClick={() => handleRetry(t.taskId)}
                        disabled={retrying === t.taskId}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[var(--color-primary)] text-white rounded-md text-xs font-medium hover:opacity-90 disabled:opacity-50"
                      >
                        {retrying === t.taskId ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        {lang === 'en' ? 'Retry' : '重试'}
                      </button>
                    )}
                    {showArchived ? (
                      <button
                        onClick={() => handleHardDelete(t.taskId)}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-500"
                        title={lang === 'en' ? 'Delete permanently' : '永久删除'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDelete(t.taskId)}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-500"
                        title={lang === 'en' ? 'Delete (move to history)' : '删除（移入历史）'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {expanded.has(t.taskId) && selected?.taskId === t.taskId && (
                  <div className="mt-4 space-y-3 pl-6 border-l-2 border-[var(--color-border-base)]">
                    {selected.metadata?.resumeError && (
                      <div className="bg-red-500/10 text-red-600 rounded-lg p-3 text-xs">
                        <div className="font-semibold mb-1">{lang === 'en' ? 'Auto-resume failed' : '自动续跑失败'}</div>
                        <pre className="whitespace-pre-wrap font-mono">{selected.metadata.resumeError}</pre>
                      </div>
                    )}

                    {selected.metadata?.resumeOutput && (
                      <div className="bg-[var(--color-bg-base)] rounded-lg p-3 text-xs text-[var(--color-text-secondary)]">
                        <div className="font-semibold mb-1 text-[var(--color-text-primary)]">{lang === 'en' ? 'Last resume output' : '上次续跑输出'}</div>
                        <pre className="whitespace-pre-wrap font-mono max-h-60 overflow-auto">{selected.metadata.resumeOutput}</pre>
                      </div>
                    )}

                    <div className="space-y-2">
                      {selected.steps.map((step, i) => (
                        <div key={step.id} className="flex items-start gap-2 text-xs">
                          {step.status === 'completed' && <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />}
                          {step.status === 'failed' && <XCircle className="w-4 h-4 text-red-600 shrink-0" />}
                          {step.status === 'running' && <RefreshCw className="w-4 h-4 text-amber-600 shrink-0 animate-spin" />}
                          {step.status === 'pending' && <Clock className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />}
                          <div>
                            <div className="text-[var(--color-text-primary)]">{i + 1}. {step.description}</div>
                            {step.toolCalls && step.toolCalls.length > 0 && (
                              <div className="text-[var(--color-text-muted)] mt-0.5">
                                {step.toolCalls.map((tc) => tc.name).join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
