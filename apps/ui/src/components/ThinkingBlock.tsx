import { useState, memo, useEffect, useRef } from 'react';
import { Brain, ChevronDown, Zap } from 'lucide-react';
import type { Language } from '../i18n';

interface ThinkingBlockProps {
  content: string;
  status: 'running' | 'done';
  lang: Language;
}

function ThinkingBlockInner({ content, status, lang }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunning = status === 'running';
  const cleanedContent = content.trim();

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 100);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [isRunning]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className={`my-3 border rounded-xl overflow-hidden transition-all duration-300 shadow-[var(--shadow-xs)] ${
      isRunning 
        ? 'border-[color-mix(in_srgb,var(--color-primary)_35%,var(--color-border-base))]' 
        : 'border-[var(--color-border-base)]'
    }`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none transition-colors duration-200 ${
        isRunning ? 'bg-[color-mix(in_srgb,var(--color-primary)_8%,var(--color-bg-card))]' : 'bg-[var(--color-bg-card)]'
      }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isRunning ? (
          <Brain className="w-4 h-4 text-[var(--color-primary)] animate-pulse" />
        ) : (
          <Zap className="w-4 h-4 text-[var(--color-text-muted)]" />
        )}
        <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
          {lang === 'en' ? 'Thinking' : '思考过程'}
        </span>
        {isRunning && (
          <>
            <span className="text-[10px] text-[var(--color-primary)]/70 animate-pulse ml-1">
              {lang === 'en' ? '...' : '进行中..'}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono ml-1">
              {formatTime(elapsed)}
            </span>
          </>
        )}
        {!isRunning && elapsed > 0 && (
          <span className="text-[10px] text-[var(--color-text-muted)] font-mono ml-1">
            {formatTime(elapsed)}
          </span>
        )}
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors">
          <ChevronDown className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {isExpanded && (
        <div className="think-block-content p-4 text-xs font-mono whitespace-pre-wrap text-[var(--color-text-secondary)] leading-relaxed max-h-[400px] overflow-y-auto bg-[var(--color-bg-base)]/50 border-t border-[var(--color-border-base)]">
          {cleanedContent || (lang === 'en' ? 'Thinking...' : '正在思考..')}
        </div>
      )}
    </div>
  );
}

export const ThinkingBlock = memo(ThinkingBlockInner);
