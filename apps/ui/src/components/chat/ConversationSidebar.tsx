/**
 * ConversationSidebar — left history panel of the chat page.
 *
 * Pure presentational module: renders the active-workspace card (with its
 * overflow menu), the conversation search box, new-chat button, export/import
 * row and the conversation list. All state lives in the Chat page; this
 * component only forwards user actions through its props.
 */
import React from 'react';
import { X, Loader, Trash2, Download, Upload } from 'lucide-react';
import { translate as t } from '../../i18n';
import type { Language } from '../../i18n';
import type { Conversation } from '../../types/chat';

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

export interface ConversationSidebarProps {
  lang: Language;
  /** Sidebar pixel width (owned by the page). */
  width: number;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  activeWorkspace: { id: string; name: string; path: string; initial: string } | null;
  workspaceMenuOpen: boolean;
  onToggleWorkspaceMenu: () => void;
  onCloseWorkspaceMenu: () => void;
  onEditWorkspace: () => void;
  onEnableWorkspace: () => void;
  onClearNotifications: () => void;
  onCloseWorkspace: () => void;
  convSearch: string;
  onConvSearchChange: (v: string) => void;
  onNewChat: () => void;
  activeChat: Conversation | null;
  /** Conversations already filtered by the active workspace. */
  filteredConversations: Conversation[];
  /** Total conversations across workspaces (controls JSON export). */
  totalConversations: number;
  loadingChats: Record<string, boolean>;
  activeId: string;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string, e: React.MouseEvent) => void;
  onExportMarkdown: () => void;
  onExportJSON: () => void;
  onImportJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function ConversationSidebar(props: ConversationSidebarProps) {
  const {
    lang, width, onResizeMouseDown, activeWorkspace, workspaceMenuOpen,
    onToggleWorkspaceMenu, onCloseWorkspaceMenu, onEditWorkspace, onEnableWorkspace,
    onClearNotifications, onCloseWorkspace, convSearch, onConvSearchChange,
    onNewChat, activeChat, filteredConversations, totalConversations,
    loadingChats, activeId, onSelectChat, onDeleteChat,
    onExportMarkdown, onExportJSON, onImportJSON,
  } = props;

  return (
    <div
      style={{ width: `${width}px` }}
      className="relative flex flex-col gap-3.5 border-r border-[var(--color-border-base)] pr-4 h-full shrink-0 pt-1"
    >
      {/* Resize Handle */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--color-primary)]/40 active:bg-[var(--color-primary)]/60 transition-colors z-30"
        title="Drag to resize / 拖动调整大小"
      />
      {activeWorkspace && (
        <div className="px-2 select-none flex flex-col gap-0.5 relative">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-[var(--color-text-primary)] truncate">
              {activeWorkspace.name}
            </span>
            <button
              onClick={onToggleWorkspaceMenu}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1"
              title={lang === 'en' ? 'Workspace Menu' : '工作区菜单'}
            >
              <span className="text-lg font-bold leading-none">...</span>
            </button>
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)] truncate font-mono" title={activeWorkspace.path}>
            {activeWorkspace.path}
          </div>

          {workspaceMenuOpen && (
            <div
              className="orca-popover absolute top-8 right-0 z-50 w-40 py-1 text-left"
              onMouseLeave={onCloseWorkspaceMenu}
            >
              <div
                onClick={onEditWorkspace}
                className="px-4 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] cursor-pointer"
              >
                {lang === 'en' ? 'Edit' : '编辑'}
              </div>
              <div
                onClick={onEnableWorkspace}
                className="px-4 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] cursor-pointer"
              >
                {lang === 'en' ? 'Enable Workspace' : '启用工作区'}
              </div>
              <div
                onClick={onClearNotifications}
                className="px-4 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] cursor-pointer"
              >
                {lang === 'en' ? 'Clear Notifications' : '清除通知'}
              </div>
              <div className="border-t border-[var(--color-border-base)] my-1" />
              <div
                onClick={onCloseWorkspace}
                className="px-4 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-red-500 cursor-pointer"
              >
                {lang === 'en' ? 'Close' : '关闭'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conversation Search */}
      <div className="relative">
        <input
          type="text"
          value={convSearch}
          onChange={(e) => onConvSearchChange(e.target.value)}
          placeholder={lang === 'en' ? 'Search conversations...' : '搜索会话...'}
          className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/40 focus:ring-1 focus:ring-[var(--color-primary)]/20 transition-all"
        />
        {convSearch && (
          <button
            onClick={() => onConvSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <button
        onClick={onNewChat}
        className="flex items-center justify-center gap-1.5 w-full py-2 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] hover:border-[color-mix(in_srgb,var(--color-primary)_40%,var(--color-border-base))] hover:text-[var(--color-primary)] text-[var(--color-text-primary)] text-sm font-semibold rounded-xl shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow-sm)] transition-all cursor-pointer mt-1"
      >
        <PenSquareIcon className="w-4 h-4 opacity-70" />
        <span>{lang === 'en' ? 'New Chat' : '新建会话'}</span>
      </button>

      {/* Export / Import row */}
      <div className="flex gap-1 mt-1">
        <button
          onClick={onExportMarkdown}
          disabled={!activeChat}
          title={lang === 'en' ? 'Export as Markdown' : '导出 Markdown'}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-xs rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3 h-3" />
          <span>MD</span>
        </button>
        <button
          onClick={onExportJSON}
          disabled={totalConversations === 0}
          title={lang === 'en' ? 'Export all as JSON' : '导出全部 JSON'}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-xs rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3 h-3" />
          <span>JSON</span>
        </button>
        <label
          title={lang === 'en' ? 'Import JSON' : '导入 JSON'}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-xs rounded-lg transition-all cursor-pointer"
        >
          <Upload className="w-3 h-3" />
          <span>{lang === 'en' ? 'Import' : '导入'}</span>
          <input type="file" accept=".json" onChange={onImportJSON} className="hidden" />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 pr-1 mt-2">
        {(convSearch ? filteredConversations.filter(c =>
          c.title.toLowerCase().includes(convSearch.toLowerCase()) ||
          c.messages.some(m => m.content.toLowerCase().includes(convSearch.toLowerCase()))
        ) : filteredConversations).map(chat => {
          const isActive = chat.id === activeId;
          const isChatLoading = loadingChats[chat.id];
          return (
            <div
              key={chat.id}
              onClick={() => onSelectChat(chat.id)}
              className={`orca-conv-item ${isActive ? 'orca-conv-item-active' : ''} group flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium cursor-pointer transition-all ${
                isActive
                  ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] font-semibold shadow-[var(--shadow-xs)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]/70'
              }`}
            >
              <div className="truncate flex-1 pr-2">
                <div className="text-[13px] flex items-center gap-1.5">
                  {isChatLoading && <Loader className="w-3 h-3 animate-spin text-[#24818d] shrink-0" />}
                  <span className="truncate">{chat.title}</span>
                </div>
                {chat.messages.length > 0 && (
                  <div className="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5 pl-[1px]">
                    {chat.messages[chat.messages.length - 1].content?.substring(0, 30).replace(/[\n\r]/g, ' ') || ''}
                  </div>
                )}
              </div>
              <button
                onClick={(e) => onDeleteChat(chat.id, e)}
                className="opacity-0 group-hover:opacity-100 hover:text-red-500 text-gray-400 transition-opacity p-0.5"
                title={t('chat.delete.tooltip', lang)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
