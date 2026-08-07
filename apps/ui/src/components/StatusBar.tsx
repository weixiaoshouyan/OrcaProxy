// StatusBar.tsx — Slim operational status bar under the chat column.
// Shows model, workspace, git state, context usage and cache hit rate at a glance.
import React, { useEffect, useState, useRef } from 'react';
import { GitBranch, Activity, Cpu, CheckCircle2, AlertTriangle, Circle } from 'lucide-react';

export interface StatusBarProps {
  model: string;
  workspaceName: string;
  workspacePath: string;
  git: {
    branch: string;
    changes: number;
    untracked: number;
    status: string;
    lastCommit: string;
  };
  contextUsed: number;
  contextTotal: number;
  contextPercent: number;
  cacheRate: number | null;
  taskRunning: boolean;
  lang: 'zh' | 'en';
}

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  workspaceName,
  workspacePath,
  git,
  contextUsed,
  contextTotal,
  contextPercent,
  cacheRate,
  taskRunning,
  lang,
}) => {
  const [elapsed, setElapsed] = useState(0);
  const runningRef = useRef(taskRunning);

  useEffect(() => {
    if (taskRunning && !runningRef.current) setElapsed(0);
    runningRef.current = taskRunning;
    if (!taskRunning) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [taskRunning]);

  const fmtElapsed = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  };

  const ctxColor = contextPercent > 85 ? 'text-red-500' : contextPercent > 60 ? 'text-yellow-500' : 'text-emerald-500';
  const gitColor = git.status === 'dirty' ? 'text-amber-500' : git.status === 'no-repo' ? 'text-[var(--color-text-muted)]' : 'text-emerald-500';

  return (
    <div className="shrink-0 flex items-center gap-4 px-3 py-1.5 mb-3 rounded-lg bg-[var(--color-bg-card)]/60 border border-[var(--color-border-base)]/60 text-[10.5px] font-mono text-[var(--color-text-muted)] select-none overflow-x-auto whitespace-nowrap">
      <span className="flex items-center gap-1.5 min-w-0">
        <Cpu className="w-3 h-3 text-amber-500 shrink-0" />
        <span className="truncate max-w-[160px]" title={model}>{model}</span>
      </span>
      <span className="text-[var(--color-border-base)]">|</span>
      <span className="flex items-center gap-1.5 min-w-0" title={workspacePath}>
        <Circle className="w-2.5 h-2.5 text-blue-500 fill-blue-500/30 shrink-0" />
        <span className="truncate max-w-[140px]">{workspaceName}</span>
      </span>
      <span className="text-[var(--color-border-base)]">|</span>
      <span className="flex items-center gap-1.5" title={git.lastCommit}>
        <GitBranch className="w-3 h-3 shrink-0" />
        <span className={gitColor}>{git.branch}</span>
        {git.status === 'dirty' && (
          <span className="text-amber-500">+{git.changes} ~{git.untracked}</span>
        )}
        {git.status === 'clean' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
        {git.status === 'no-repo' && <span>no-repo</span>}
      </span>
      <span className="text-[var(--color-border-base)]">|</span>
      <span className="flex items-center gap-1.5" title={`${contextUsed.toLocaleString()} / ${contextTotal.toLocaleString()} tokens`}>
        <Activity className={`w-3 h-3 shrink-0 ${ctxColor}`} />
        <span className={ctxColor}>{contextPercent}%</span>
        {cacheRate !== null && (
          <span className={cacheRate >= 50 ? 'text-emerald-500' : cacheRate >= 20 ? 'text-yellow-500' : 'text-red-500'}>
            cache {cacheRate}%
          </span>
        )}
      </span>
      <span className="text-[var(--color-border-base)]">|</span>
      <span className={`flex items-center gap-1.5 ${taskRunning ? 'text-blue-500' : ''}`}>
        {taskRunning ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span>{lang === 'en' ? 'running' : '运行中'} {fmtElapsed(elapsed)}</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-3 h-3 text-[var(--color-text-muted)]" />
            <span>{lang === 'en' ? 'idle' : '空闲'}</span>
          </>
        )}
      </span>
      {contextPercent > 85 && (
        <span className="flex items-center gap-1 text-red-500 font-bold">
          <AlertTriangle className="w-3 h-3" />
          {lang === 'en' ? 'NEAR LIMIT' : '接近上限'}
        </span>
      )}
    </div>
  );
};

export default StatusBar;
