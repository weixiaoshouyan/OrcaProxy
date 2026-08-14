/**
 * NoticeCard — host/system notice card: stall guards, approval waits, hard
 * stops, turn refusals and ask questions render as distinct status cards
 * instead of blending into the transcript as plain text.
 */
import { Info, AlertTriangle, AlertCircle } from 'lucide-react';
import type { Language } from '../../i18n';

export type NoticeSeverity = 'info' | 'warning' | 'error';

export function NoticeCard({ content, severity, lang }: { content: string; severity: NoticeSeverity; lang: Language }) {
  const styles = {
    info: {
      border: 'border-sky-500/30',
      bg: 'bg-sky-500/[0.06]',
      icon: <Info className="w-4 h-4 text-sky-500 shrink-0" />,
      label: lang === 'en' ? 'Notice' : '提示',
    },
    warning: {
      border: 'border-amber-500/30',
      bg: 'bg-amber-500/[0.06]',
      icon: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
      label: lang === 'en' ? 'Attention' : '注意',
    },
    error: {
      border: 'border-red-500/30',
      bg: 'bg-red-500/[0.06]',
      icon: <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />,
      label: lang === 'en' ? 'Error' : '错误',
    },
  }[severity];

  // Strip the leading bracket marker so the card reads naturally:
  // "[Guard] 任务已暂停…" → body without "[Guard]".
  const body = content.replace(/^\s*>\s*/, '').replace(/^\s*\[(?:Guard|Waiting for|Continuing|Turn refused|Agent Stream Error|Orca)[^\]]*\]\s*/, '').trim();

  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border ${styles.border} ${styles.bg} my-1`}>
      {styles.icon}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-0.5">{styles.label}</div>
        <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">{body || content}</div>
      </div>
    </div>
  );
}
