/**
 * TaskListWidget — markdown task-list card with progress bar,
 * auto-collapse when done, dismissible.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Language } from '../../i18n';
import type { TaskItem } from '../../utils/chat-render';

export function TaskListWidget({ tasks, lang }: { tasks: TaskItem[]; lang: Language }) {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = total > 0 && completed === total;
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (allDone && !userToggledRef.current) setCollapsed(true);
    else if (running > 0 && !userToggledRef.current) setCollapsed(false);
  }, [allDone, running]);

  if (dismissed) return null;

  return (
    <div className="my-4 p-4 border border-[var(--color-border-base)] rounded-xl bg-[var(--color-bg-card)] shadow-[var(--shadow-xs)] max-w-xl animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => { userToggledRef.current = true; setCollapsed(!collapsed); }}>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-primary)]">
            {running > 0
              ? (lang === 'en' ? '⚡ Executing...' : '⚡ 任务执行中...')
              : (allDone
                ? (lang === 'en' ? '✅ Completed' : '✅ 任务已完成')
                : (lang === 'en' ? '📋 Task List' : '📋 任务清单'))}
          </span>
          <span className="text-xs font-mono text-[var(--color-text-muted)] font-medium">
            {completed}/{total} ({percent}%)
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
        </div>
        <div className="flex items-center gap-1">
          {allDone && (
            <button
              onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
              className="text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] px-2 py-1 rounded border border-[var(--color-border-base)] bg-[var(--color-bg-card)] transition-colors cursor-pointer"
              title={lang === 'en' ? 'Dismiss' : '关闭'}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-[var(--color-bg-hover)] rounded-full overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-500 ${running > 0 ? 'orca-progress-bar' : 'bg-[var(--color-primary)]'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {!collapsed && (
        <div className="space-y-2.5">
          {tasks.map((task, idx) => {
            const isCompleted = task.status === 'completed';
            const isRunning = task.status === 'running';

            return (
              <div
                key={idx}
                className={`flex items-start gap-3 p-2 rounded-lg transition-all duration-300 ${
                  isRunning
                    ? 'bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/10 shadow-sm'
                    : 'border border-transparent'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isCompleted && (
                    <span className="w-4 h-4 rounded-full bg-green-500 text-white flex items-center justify-center text-[10px] font-bold select-none shadow-sm">
                      ✓
                    </span>
                  )}
                  {isRunning && (
                    <span className="w-4 h-4 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center text-[10px] font-bold select-none animate-spin shadow-sm">
                      ↻
                    </span>
                  )}
                  {!isCompleted && !isRunning && (
                    <span className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600 bg-transparent flex items-center justify-center select-none" />
                  )}
                </div>
                <div className={`text-xs leading-relaxed ${
                  isCompleted
                    ? 'text-[var(--color-text-muted)] line-through decoration-gray-400 dark:decoration-gray-600'
                    : (isRunning ? 'text-[var(--color-text-primary)] font-semibold animate-pulse' : 'text-[var(--color-text-secondary)]')
                }`}>
                  {task.description}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
