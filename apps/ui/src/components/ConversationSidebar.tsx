import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, MessageSquare, Trash2, Loader, Search } from 'lucide-react';
import { api } from '../api';
import type { Language } from '../i18n';
import type { Conversation } from '../types';
import { useToast } from '../components/Toast';

interface ConversationSidebarProps {
  lang: Language;
  conversations: Conversation[];
  activeId: string;
  loadingChats: Record<string, boolean>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function ConversationSidebar({
  lang,
  conversations,
  activeId,
  loadingChats,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: ConversationSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRename = useCallback(async (id: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await api.patch(`/api/conversations/${id}`, { title: editTitle.trim() });
      onRename(id, editTitle.trim());
      setEditingId(null);
    } catch {
      toast.error('Failed to rename conversation');
    }
  }, [editTitle, onRename, toast]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  return (
    <div className="w-[220px] shrink-0 border-r border-[var(--color-border-base)] bg-[var(--color-bg-sidebar)] flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[var(--color-border-base)]">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] transition-colors"
        >
          <Plus className="w-4 h-4" />
          {lang === 'en' ? 'New Chat' : 'New Chat'}
        </button>
      </div>

      {/* Search */}
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={lang === 'en' ? 'Search...' : 'Search...'}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--color-bg-input)] border border-[var(--color-border-base)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredConversations.length === 0 ? (
          <div className="text-xs text-[var(--color-text-muted)] text-center py-4">
            {searchQuery ? (lang === 'en' ? 'No results' : 'No results') : (lang === 'en' ? 'No conversations' : 'No conversations')}
          </div>
        ) : (
          filteredConversations.map(conv => (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                activeId === conv.id
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
              }`}
              onClick={() => onSelect(conv.id)}
            >
              {loadingChats[conv.id] ? (
                <Loader className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              )}
              {editingId === conv.id ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onBlur={() => handleRename(conv.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(conv.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="flex-1 text-xs bg-transparent border-b border-[var(--color-primary)] outline-none"
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 text-xs truncate">{conv.title}</span>
              )}
              <button
                onClick={e => {
                  e.stopPropagation();
                  setEditingId(conv.id);
                  setEditTitle(conv.title);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--color-bg-hover)] transition-all"
                title={lang === 'en' ? 'Rename' : 'Rename'}
              >
                <PenSquareIcon className="w-3 h-3" />
              </button>
              <button
                onClick={e => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/10 hover:text-red-500 transition-all"
                title={lang === 'en' ? 'Delete' : 'Delete'}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PenSquareIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      style={props.style}
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 1 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}
