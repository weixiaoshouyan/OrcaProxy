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
    <div className={`my-3 border rounded-xl overflow-hidden transition-all duration-300 ${
      isRunning 
        ? 'border-blue-200/40 dark:border-blue-800/30 shadow-sm' 
        : 'border-blue-200/20 dark:border-blue-900/20'
    }`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none transition-colors duration-200 ${
        isRunning ? 'bg-blue-50/50 dark:bg-blue-950/30' : 'bg-blue-50/30 dark:bg-blue-950/20'
      }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isRunning ? (
          <Brain className="w-4 h-4 text-blue-500 animate-pulse" />
        ) : (
          <Zap className="w-4 h-4 text-blue-400" />
        )}
        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
          {lang === 'en' ? 'Thinking' : '思考过程'}
        </span>
        {isRunning && (
          <>
            <span className="text-[10px] text-blue-500/70 animate-pulse ml-1">
              {lang === 'en' ? '...' : '进行中..'}
            </span>
            <span className="text-[10px] text-blue-400/60 font-mono ml-1">
              {formatTime(elapsed)}
            </span>
          </>
        )}
        {!isRunning && elapsed > 0 && (
          <span className="text-[10px] text-blue-400/60 font-mono ml-1">
            {formatTime(elapsed)}
          </span>
        )}
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
          <ChevronDown className={`w-4 h-4 text-blue-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {isExpanded && (
        <div className="think-block-content p-4 text-xs font-mono whitespace-pre-wrap text-gray-600 dark:text-gray-300 leading-relaxed max-h-[400px] overflow-y-auto bg-white/30 dark:bg-slate-950/20 border-t border-blue-200/20 dark:border-blue-900/20">
          {cleanedContent || (lang === 'en' ? 'Thinking...' : '正在思考..')}
        </div>
      )}
    </div>
  );
}

export const ThinkingBlock = memo(ThinkingBlockInner);
