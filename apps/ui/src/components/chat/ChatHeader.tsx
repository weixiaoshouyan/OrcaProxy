/**
 * ChatHeader — the chat-window header: title, mode/quality/model chips and
 * the rewind / shortcuts / sidebar toggles.
 */
import { Play, Eye, History, Keyboard, PanelRightOpen, PanelRightClose } from 'lucide-react';
import type { Language } from '../../i18n';
import type { Conversation } from '../../types/chat';

interface ChatHeaderProps {
  lang: Language;
  activeChat: Conversation;
  useAgent: boolean;
  presetName: string;
  qualityName: string;
  modelLabel: string;
  rightSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenRewind: () => void;
  onOpenShortcuts: () => void;
}

export function ChatHeader({ lang, activeChat, useAgent, presetName, qualityName, modelLabel, rightSidebarOpen, onToggleSidebar, onOpenRewind, onOpenShortcuts }: ChatHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between shrink-0 bg-[var(--color-bg-base)] border-b border-[var(--color-border-base)]/50 pb-3">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">{activeChat.title}</h2>
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--color-text-secondary)] select-none">
          <span className="inline-flex items-center gap-1 bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] px-2.5 py-0.5 rounded-full font-medium text-[10.5px] border border-[var(--color-border-base)]">
            {useAgent
              ? <Play className="w-2.5 h-2.5 text-emerald-500 fill-emerald-500/20" />
              : <Eye className="w-2.5 h-2.5 text-blue-500" />}
            {useAgent
              ? (lang === 'en' ? 'Agent Assistant (Build)' : '智能体助手 (Build)')
              : (presetName ? `${presetName} (Plan)` : 'Plan')}
          </span>
          <span className="inline-flex items-center bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] px-2.5 py-0.5 rounded-full font-medium text-[10.5px] border border-[var(--color-border-base)]">
            {qualityName}
          </span>
          <span className="font-mono text-[var(--color-text-muted)] text-[10.5px] truncate max-w-[200px] px-1">
            {modelLabel}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenRewind}
          className="p-1.5 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:border-amber-500/40 hover:text-amber-500 transition-all text-[var(--color-text-muted)] shadow-[var(--shadow-xs)] cursor-pointer"
          title={lang === 'en' ? 'Rewind workspace (checkpoints)' : '回滚工作区（检查点）'}
        >
          <History className="w-4 h-4" />
        </button>
        <button
          onClick={onOpenShortcuts}
          className="p-1.5 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:border-[color-mix(in_srgb,var(--color-primary)_40%,var(--color-border-base))] hover:text-[var(--color-primary)] transition-all text-[var(--color-text-muted)] shadow-[var(--shadow-xs)] cursor-pointer"
          title={lang === 'en' ? 'Keyboard shortcuts (?)' : '键盘快捷键 (?)'}
        >
          <Keyboard className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:border-[color-mix(in_srgb,var(--color-primary)_40%,var(--color-border-base))] hover:text-[var(--color-primary)] transition-all text-[var(--color-text-muted)] shadow-[var(--shadow-xs)] cursor-pointer"
          title={rightSidebarOpen ? (lang === 'en' ? 'Close sidebar' : '关闭侧边栏') : (lang === 'en' ? 'Open sidebar' : '打开侧边栏')}
        >
          {rightSidebarOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
