/**
 * ThinkingBlock — collapsible "思考过程" row with elapsed timer.
 */
import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import type { Language } from '../../i18n';
import { cleanThinkTags } from '../../utils/chat-render';

export function ThinkingBlock({ content, status, lang }: { content: string; status?: 'done' | 'running'; lang: Language }) {
  const [isExpanded, setIsExpanded] = useState(status === 'running');
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const cleanedContent = cleanThinkTags(content);

  // Expand/collapse on status transitions. setState here is intentional and
  // guarded by the status change — the react-hooks/set-state-in-effect rule
  // is too strict for this one-shot UI sync.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (status === 'running') {
      setIsExpanded(true);
      if (startRef.current === null) startRef.current = Date.now();
    } else if (status === 'done') {
      setIsExpanded(false);
      if (startRef.current !== null) setElapsed(Math.round((Date.now() - startRef.current) / 1000));
      startRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - (startRef.current || 0)) / 1000)), 1000);
    return () => clearInterval(t);
  }, [status]);

  const timeStr = elapsed > 0 ? `${elapsed}s` : '';

  return (
    <div className="flex items-start gap-2.5 py-1 px-1 text-[var(--color-text-muted)]">
      <Clock className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${status === 'running' ? 'text-[var(--color-primary)] animate-pulse' : ''}`} />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[11px] select-none hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
        >
          {lang === 'en' ? 'Thinking' : '思考过程'}
          {status === 'running' ? '…' : ''}
          {timeStr ? ` · ${timeStr}` : ''}
        </button>
        {isExpanded && (
          <div className="mt-1 text-[11px] font-mono leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)] max-h-60 overflow-y-auto select-text">
            {cleanedContent || (lang === 'en' ? 'Thinking...' : '正在思考...')}
          </div>
        )}
      </div>
    </div>
  );
}
