/**
 * ToolExecutionBlock — compact tool activity row (icon + action + target),
 * with an expandable output panel and inline diff view for file edits.
 */
import { useEffect, useRef, useState } from 'react';
import { Copy, FileDiff, PenLine, Play, Search, CheckCircle, Terminal } from 'lucide-react';
import type { Language } from '../../i18n';
import { parseDiffSection } from '../../utils/chat-render';

export interface ToolActivityBlockShape {
  content: string;
  toolName?: string;
  label?: string;
  status?: 'done' | 'running' | 'error';
  duration?: string;
}

/** Icon + past-tense action label per tool category. */
function toolActivityMeta(toolName: string, lang: Language): { icon: React.ReactNode; action: string } {
  const n = (toolName || '').toLowerCase();
  if (n.includes('write') || n.includes('edit') || n.includes('multi_edit') || n.includes('move')) {
    return { icon: <PenLine className="w-3.5 h-3.5 text-emerald-500" />, action: lang === 'en' ? 'Wrote' : '已写入' };
  }
  if (n.includes('terminal') || n === 'bash' || n.includes('run_terminal')) {
    return { icon: <Play className="w-3.5 h-3.5 text-blue-500" />, action: lang === 'en' ? 'Ran' : '已执行' };
  }
  if (n.includes('read') || n.includes('list') || n.includes('glob') || n.includes('search') || n.includes('explore')) {
    return { icon: <Search className="w-3.5 h-3.5 text-amber-500" />, action: lang === 'en' ? 'Explored' : '探索' };
  }
  if (n.includes('complete_step')) {
    return { icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />, action: lang === 'en' ? 'Signed off' : '签收' };
  }
  return { icon: <Terminal className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />, action: toolName || 'Tool' };
}

/** Colored diff rendering for tool output. */
function renderDiffContent(content: string, isRunning: boolean, lang: Language) {
  if (!content) {
    return <span className="text-slate-500 italic">{isRunning
      ? (lang === 'en' ? 'Establishing pipeline with agent daemon...' : '正在与智能体守护进程建立连接...')
      : (lang === 'en' ? 'Output was empty' : '输出为空')}</span>;
  }

  const lines = content.split('\n');
  const hasDiffIndicators = lines.some(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));

  if (!hasDiffIndicators) {
    return <span className="text-[#a6e3a1] whitespace-pre">{content}</span>;
  }

  return (
    <div className="flex flex-col font-mono text-[11px] leading-relaxed">
      {lines.map((line, idx) => {
        let className = "text-slate-300 pl-2";
        let bgStyle = "";

        if (line.startsWith('+++') || line.startsWith('---')) {
          className = "text-[#89b4fa] font-bold";
          bgStyle = "bg-[#89b4fa]/5 pl-1.5";
        } else if (line.startsWith('+')) {
          className = "text-[#a6e3a1] font-semibold";
          bgStyle = "bg-emerald-500/10 border-l-2 border-emerald-500 pl-1.5";
        } else if (line.startsWith('-')) {
          className = "text-[#f38ba8] font-semibold";
          bgStyle = "bg-red-500/10 border-l-2 border-red-500 pl-1.5";
        } else if (line.startsWith('@@')) {
          className = "text-[#89b4fa] font-bold";
          bgStyle = "bg-[#89b4fa]/5 pl-1.5";
        }

        return (
          <div key={idx} className={`${bgStyle} min-h-[18px] py-0.5 whitespace-pre-wrap select-text`}>
            <span className={className}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ToolExecutionBlock({ block, lang, onFileOp }: { block: ToolActivityBlockShape; lang: Language; onFileOp?: (name: string, content: string) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const isRunning = block.status === 'running';
  const isError = block.status === 'error' || (typeof block.content === 'string' && (block.content.startsWith('Error:') || block.content.includes('[Execution Error]')));
  const { icon, action } = toolActivityMeta(block.toolName || '', lang);
  const content = typeof block.content === 'string' ? block.content : '';

  // Finalize elapsed time on running → done/error transition (one-shot UI
  // sync inside an effect; guarded by prevRunningRef semantics).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (isRunning) {
      if (startRef.current === null) startRef.current = Date.now();
      const t = setInterval(() => setElapsed(Math.round((Date.now() - (startRef.current || 0)) / 1000)), 1000);
      return () => clearInterval(t);
    } else {
      if (startRef.current !== null) setElapsed(Math.round((Date.now() - startRef.current) / 1000));
      startRef.current = null;
    }
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning && onFileOp) {
      onFileOp(block.toolName || '', block.label || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, block.toolName]);

  const timeStr = elapsed > 0 ? `${elapsed}s` : '';
  const durationStr = block.duration || timeStr;
  const diffSection = parseDiffSection(content);
  const mainContent = diffSection ? content.slice(0, diffSection.startIndex).trimEnd() : '';

  const copyOutput = () => {
    if (!content) return;
    navigator.clipboard?.writeText(content).catch(() => { /* ignore */ });
  };

  return (
    <div className={`flex items-start gap-2.5 py-1.5 px-1 group ${isError ? 'text-red-500/90' : 'text-[var(--color-text-secondary)]'}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs select-none">
          <span className={`font-medium ${isRunning ? 'text-[var(--color-text-primary)]' : ''}`}>{action}</span>
          {block.label && (
            <span className="truncate max-w-[55%] font-mono text-[11px] text-[var(--color-text-muted)]">{block.label}</span>
          )}
          {diffSection && !isRunning && (
            <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] border border-[var(--color-border-base)]" title={diffSection.path}>
              <FileDiff className="w-3 h-3 text-[var(--color-text-muted)]" />
              <span className="text-emerald-400">+{diffSection.added}</span>
              <span className="text-red-400">−{diffSection.removed}</span>
            </span>
          )}
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {isRunning
              ? (lang === 'en' ? 'running…' : '执行中…')
              : isError
                ? (lang === 'en' ? 'failed' : '失败')
                : durationStr}
          </span>
          {!isRunning && content && (
            <span className="flex items-center gap-1.5">
              <button
                onClick={copyOutput}
                className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
                title={lang === 'en' ? 'Copy output' : '复制输出'}
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
              >
                {isExpanded ? (lang === 'en' ? 'hide' : '收起') : (lang === 'en' ? 'output' : '输出')}
              </button>
            </span>
          )}
        </div>
        {isExpanded && content && (
          <div className="mt-1.5 text-[11px] font-mono leading-relaxed text-[var(--color-text-secondary)] bg-[var(--color-bg-sidebar)] rounded-lg p-2.5 overflow-x-auto max-h-72 overflow-y-auto select-text">
            {diffSection ? (
              <>
                {mainContent && (
                  <pre className="whitespace-pre-wrap mb-2 text-[var(--color-text-secondary)]">{mainContent}</pre>
                )}
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] mb-1.5 select-none">
                  <FileDiff className="w-3 h-3" />
                  <span className="font-mono truncate">{diffSection.path}</span>
                  <span className="text-emerald-400">+{diffSection.added}</span>
                  <span className="text-red-400">−{diffSection.removed}</span>
                </div>
                {renderDiffContent(diffSection.body, false, lang)}
              </>
            ) : (
              <pre className="whitespace-pre-wrap">{renderDiffContent(content, false, lang)}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
