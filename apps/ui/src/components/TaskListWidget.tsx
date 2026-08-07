import { memo, useState } from 'react';
import { CheckCircle, Circle, Loader, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';

interface TaskItem {
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

function TaskListWidgetInner({ tasks }: { tasks: TaskItem[] }) {
  const [expanded, setExpanded] = useState(true);
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const hasFailed = failed > 0;
  const allDone = completed === total;

  return (
    <div className={`my-4 border rounded-xl backdrop-blur-sm shadow-sm max-w-xl animate-in fade-in duration-300 ${
      hasFailed ? 'border-red-200/50 dark:border-red-800/30 bg-red-50/30 dark:bg-red-950/20' :
      allDone ? 'border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/30 dark:bg-emerald-950/20' :
      'border-[var(--color-border-base)] bg-gray-50/50 dark:bg-slate-900/40'
    }`}>
      {/* Header */}
      <div 
        className="flex items-center justify-between p-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {running > 0 && <Loader className="w-4 h-4 text-[var(--color-primary)] animate-spin" />}
          {allDone && <CheckCircle className="w-4 h-4 text-emerald-500" />}
          {hasFailed && !running && <AlertCircle className="w-4 h-4 text-red-500" />}
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-primary)]">
            {running > 0 ? `执行中 (${running} 个任务)` :
             allDone ? '所有任务已完成' :
             hasFailed ? `${failed} 个任务失败` :
             '任务清单'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[var(--color-text-muted)] font-medium">
            {completed}/{total} ({percent}%)
          </span>
          {expanded ? <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />}
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="px-4 pb-2">
        <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full flex">
            <div 
              className="bg-emerald-500 transition-all duration-500" 
              style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
            />
            <div 
              className="bg-red-500 transition-all duration-500" 
              style={{ width: `${total > 0 ? (failed / total) * 100 : 0}%` }}
            />
            <div 
              className="bg-[var(--color-primary)] transition-all duration-500 animate-pulse" 
              style={{ width: `${total > 0 ? (running / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Task list */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {tasks.map((task, idx) => {
            const isCompleted = task.status === 'completed';
            const isRunning = task.status === 'running';
            const isFailed = task.status === 'failed';
            const isPending = task.status === 'pending';

            return (
              <div 
                key={idx} 
                className={`flex items-start gap-3 p-2.5 rounded-lg transition-all duration-300 ${
                  isRunning 
                    ? 'bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/10 shadow-sm' 
                    : isFailed
                    ? 'bg-red-500/5 border border-red-500/10'
                    : 'border border-transparent'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isCompleted && (
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  )}
                  {isRunning && (
                    <Loader className="w-4 h-4 text-[var(--color-primary)] animate-spin" />
                  )}
                  {isFailed && (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  )}
                  {isPending && (
                    <Circle className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                  )}
                </div>
                <div className={`text-xs leading-relaxed flex-1 ${
                  isCompleted 
                    ? 'text-[var(--color-text-muted)] line-through decoration-gray-400 dark:decoration-gray-600' 
                    : isFailed
                    ? 'text-red-600 dark:text-red-400'
                    : isRunning ? 'text-[var(--color-text-primary)] font-semibold' : 'text-[var(--color-text-secondary)]'
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

export const TaskListWidget = memo(TaskListWidgetInner);
