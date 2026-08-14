/**
 * TodoShelf — live task summary pinned above the composer (Reasonix
 * PromptShelf-style): two-level todo list with progress + current step.
 */
import { ListTodo, CheckCircle, Loader, Clock, ChevronDown } from 'lucide-react';
import type { Language } from '../../i18n';

interface TodoShelfProps {
  lang: Language;
  tasks: any[];
  done: number;
  total: number;
  isTaskRunning: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function TodoShelf({ lang, tasks, done, total, isTaskRunning, collapsed, onToggleCollapsed }: TodoShelfProps) {
  return (
    <div className="border border-[var(--color-border-base)] rounded-xl bg-[var(--color-bg-card)] shadow-[var(--shadow-xs)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-[var(--color-bg-hover)]/40 transition-colors" onClick={onToggleCollapsed}>
        <ListTodo className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" />
        <span className="text-[11px] font-bold text-[var(--color-text-primary)]">
          {lang === 'en' ? 'Tasks' : '任务'}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-bold">
          {done}/{total}
        </span>
        <span className="flex-1 min-w-0">
          {(() => {
            const running = tasks.find(t => t.status === 'in_progress' || t.status === 'running');
            if (running) return <span className="text-[11px] text-[var(--color-text-secondary)] truncate">⏳ {running.activeForm || running.content || running.description}</span>;
            if (isTaskRunning) return <span className="text-[11px] text-[var(--color-text-muted)] truncate">{lang === 'en' ? 'Running...' : '执行中...'}</span>;
            return <span className="text-[11px] text-[var(--color-text-muted)] truncate">{lang === 'en' ? 'All done' : '全部完成'}</span>;
          })()}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
      </div>
      {!collapsed && (
        <div className="px-3 pb-2 max-h-36 overflow-y-auto space-y-0.5 border-t border-[var(--color-border-base)]/60 pt-1.5">
          {tasks.slice(0, 8).map((task, idx) => {
            const status = task.status || 'pending';
            const isSub = task.level === 1;
            const label = status === 'in_progress' && task.activeForm ? task.activeForm : (task.content || task.description);
            return (
              <div key={idx} className={`flex items-center gap-2 py-0.5 ${isSub ? 'pl-4' : ''}`}>
                {status === 'completed' && <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />}
                {status === 'in_progress' && <Loader className="w-3 h-3 text-[var(--color-primary)] animate-spin shrink-0" />}
                {status === 'pending' && <Clock className="w-3 h-3 text-[var(--color-text-muted)] opacity-50 shrink-0" />}
                <span className={`text-[11px] truncate ${status === 'completed' ? 'text-[var(--color-text-muted)] line-through opacity-70' : status === 'in_progress' ? 'text-[var(--color-text-primary)] font-semibold' : isSub ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)] font-semibold'}`}>
                  {label}
                </span>
              </div>
            );
          })}
          {total > 8 && (
            <div className="text-[10px] text-[var(--color-text-muted)] text-center pt-0.5 opacity-60">
              +{total - 8} {lang === 'en' ? 'more' : '更多'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
