// frontend/src/components/AgentStatusBar.tsx
// 顶部 Agent 状态条 - 一眼看出 Agent 在做什么
import React, { useState } from 'react';
import { Bot, Loader, CheckCircle, AlertCircle, Maximize2, Minimize2, ChevronRight, Terminal } from 'lucide-react';
import type { TaskStep } from '../api';
import { useShortcuts } from '../hooks/useShortcuts';

export type AgentStatus = 'idle' | 'thinking' | 'tool' | 'paused' | 'error' | 'success';

export interface AgentState {
  status: AgentStatus;
  goal?: string;
  steps: TaskStep[];
  currentTool?: { name: string; arguments: string };
  latencyMs?: number;
  error?: string;
}

interface Props {
  state: AgentState;
  onStop?: () => void;
  onResume?: () => void;
  onOpenTaskPanel?: () => void;
}

export function AgentStatusBar({ state, onStop, onResume, onOpenTaskPanel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const completed = state.steps.filter(s => s.status === 'completed').length;
  const total = state.steps.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  useShortcuts([
    {
      key: '.',
      ctrl: true,
      handler: () => setExpanded(p => !p),
      preventDefault: true,
    },
  ]);

  if (state.status === 'idle' && total === 0) return null;

  const statusConfig: Record<AgentStatus, { color: string; bg: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
    idle: { color: 'text-gray-500', bg: 'bg-gray-500/10 border-gray-500/20', label: '空闲', icon: Bot },
    thinking: { color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/20', label: '思考中', icon: Loader },
    tool: { color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', label: '执行工具', icon: Terminal },
    paused: { color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', label: '已暂停', icon: AlertCircle },
    error: { color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20', label: '出错', icon: AlertCircle },
    success: { color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', label: '完成', icon: CheckCircle },
  };

  const cfg = statusConfig[state.status];
  const Icon = cfg.icon;
  const isAnimating = state.status === 'thinking' || state.status === 'tool';

  return (
    <div
      className={`border-b border-[var(--color-border-base)] bg-[var(--color-bg-card)] transition-all duration-300 ${
        expanded ? 'shadow-sm' : ''
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-2 select-none">
        {/* 状态徽章 */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${cfg.bg} ${cfg.color}`}>
          <Icon className={`w-3.5 h-3.5 ${isAnimating ? 'animate-spin' : ''}`} />
          <span>{cfg.label}</span>
        </div>

        {/* 目标 */}
        {state.goal && (
          <div className="text-xs text-[var(--color-text-secondary)] truncate flex-1 min-w-0" title={state.goal}>
            <span className="font-semibold text-[var(--color-text-primary)]">目标:</span> {state.goal}
          </div>
        )}

        {/* 进度 */}
        {total > 0 && (
          <button
            onClick={() => setExpanded(p => !p)}
            className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <span className="tabular-nums">{completed}/{total}</span>
            <div className="w-16 h-1.5 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  state.status === 'error' ? 'bg-red-500' :
                  state.status === 'paused' ? 'bg-amber-500' :
                  isAnimating ? 'bg-blue-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums">{percent}%</span>
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}

        {/* 动作按钮 */}
        {onStop && (state.status === 'thinking' || state.status === 'tool') && (
          <button
            onClick={onStop}
            className="px-2 py-1 text-xs font-bold text-red-500 hover:bg-red-500/10 border border-red-500/30 rounded transition-colors"
          >
            停止
          </button>
        )}
        {onResume && state.status === 'paused' && (
          <button
            onClick={onResume}
            className="px-2 py-1 text-xs font-bold text-emerald-500 hover:bg-emerald-500/10 border border-emerald-500/30 rounded transition-colors"
          >
            继续
          </button>
        )}

        {onOpenTaskPanel && (
          <button
            onClick={onOpenTaskPanel}
            className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title="查看任务面板"
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* 展开：最近执行步骤 */}
      {expanded && state.steps.length > 0 && (
        <div className="px-4 pb-3 max-h-48 overflow-y-auto border-t border-[var(--color-border-base)]/50">
          <div className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider pt-2 pb-1">最近步骤</div>
          <div className="space-y-1">
            {state.steps.slice(-5).reverse().map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {step.status === 'completed' && <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />}
                {step.status === 'running' && <Loader className="w-3 h-3 text-blue-500 animate-spin shrink-0" />}
                {step.status === 'pending' && <div className="w-3 h-3 rounded-full border border-gray-400 shrink-0" />}
                {step.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />}
                <span className={`truncate flex-1 ${
                  step.status === 'completed' ? 'text-[var(--color-text-muted)] line-through opacity-70' :
                  step.status === 'running' ? 'text-[var(--color-text-primary)] font-semibold' :
                  step.status === 'failed' ? 'text-red-500' :
                  'text-[var(--color-text-secondary)]'
                }`}>
                  {step.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
