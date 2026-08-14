/**
 * MessageFooter — per-message meta row: mode · model · time, the per-task
 * token-usage badge (↑ in / ↓ out), and rollback/copy actions.
 */
import { CornerUpLeft, Copy } from 'lucide-react';
import type { Language } from '../../i18n';
import type { Message } from '../../types/chat';
import type { LiveUsage } from '../../store/stream-store';

interface MessageFooterProps {
  lang: Language;
  msg: Message;
  useAgent: boolean;
  modelLabel: string;
  lastUsage: LiveUsage | null;
  onRollback: () => void;
  onCopy: () => void;
}

export function MessageFooter({ lang, msg, useAgent, modelLabel, lastUsage, onRollback, onCopy }: MessageFooterProps) {
  return (
    <div className={`flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mt-1.5 px-1 select-none w-full gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
      <div className="flex items-center gap-1 font-medium">
        <span>{useAgent ? 'Build' : 'Plan'}</span>
        <span>·</span>
        <span className="truncate max-w-[150px]">{modelLabel}</span>
        <span>·</span>
        <span>{msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        {lastUsage && msg.role === 'assistant' && (
          <span
            className="ml-1 px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] border border-[var(--color-border-base)] font-mono text-[10px] text-[var(--color-text-muted)]"
            title={`${lang === 'en' ? 'Tokens' : 'Token 消耗'}: ↑ ${lastUsage.prompt.toLocaleString()} in${lastUsage.cached > 0 ? ` (${lastUsage.cached.toLocaleString()} cached)` : ''} / ↓ ${lastUsage.completion.toLocaleString()} out`}
          >
            ↑{lastUsage.prompt.toLocaleString()} ↓{lastUsage.completion.toLocaleString()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
        <button
          onClick={(e) => { e.stopPropagation(); onRollback(); }}
          className="hover:text-red-500 transition-colors p-0.5 cursor-pointer"
          title={lang === 'en' ? 'Rollback to this point' : '回滚/编辑'}
        >
          <CornerUpLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
          className="hover:text-[var(--color-text-primary)] transition-colors p-0.5 cursor-pointer"
          title={lang === 'en' ? 'Copy content' : '复制内容'}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
