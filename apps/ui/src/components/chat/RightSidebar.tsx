/**
 * RightSidebar — the right panel (tasks / files / git / terminal tabs).
 *
 * Pure presentational module: renders the tab header with the resize handle,
 * the live task plan (two-level Reasonix-style), the workspace file explorer
 * with search + attach/open actions, the git status/commit panel and the
 * terminal tab. All state lives in the Chat page; this component only renders
 * and forwards user actions.
 */
import React from 'react';
import {
  Activity, CheckCircle, ChevronDown, Clock, Eye, FileText, Folder, FolderGit2,
  FolderOpen, GitBranch, Loader, Paperclip, Search, Terminal, X,
} from 'lucide-react';
import type { Language } from '../../i18n';
import type { SidebarTab } from '../../types/chat';
import type { WorkspaceItem } from '../../types';
import TerminalPanel from '../TerminalPanel';

/** Git status snapshot shape (matches the page's polled state). */
export interface RightSidebarGitInfo {
  branch: string;
  changes: number;
  untracked: number;
  status: string;
  lastCommit: string;
  modifiedFiles?: { status: string; filepath: string }[];
}

export interface RightSidebarProps {
  lang: Language;
  width: number;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  // Tasks tab
  displayTasks: any[];
  displayDone: number;
  displayTotal: number;
  displayProgress: number;
  liveTaskPhase: string;
  isTaskRunning: boolean;
  // Files tab
  modifiedFiles: { path: string; action: string; time: string }[];
  onClearModifiedFiles: () => void;
  modifiedFilesExpanded: boolean;
  onToggleModifiedFiles: () => void;
  fileSearchQuery: string;
  onFileSearchChange: (v: string) => void;
  onOpenFile: (filePath: string) => void;
  workspaceFilesExpanded: boolean;
  onToggleWorkspaceFiles: () => void;
  /** getFilteredItems() result computed by the page. */
  workspaceItems: { item: WorkspaceItem; depth: number }[];
  expandedPaths: Record<string, boolean>;
  loadingFolders: Record<string, boolean>;
  onToggleFolder: (subPath: string) => void;
  onAttachFile: (item: WorkspaceItem) => void;
  // Git tab
  gitInfo: RightSidebarGitInfo;
  commitMessage: string;
  onCommitMessageChange: (v: string) => void;
  committing: boolean;
  onGitCommit: (e: React.FormEvent) => void;
  /** Fill the composer with a canned prompt (diff / commit suggestion). */
  onQuickFill: (text: string) => void;
  // Terminal tab
  activeTaskId: string | null;
}

export function RightSidebar(props: RightSidebarProps) {
  const {
    lang, width, onResizeMouseDown, tab, onTabChange,
    displayTasks, displayDone, displayTotal, displayProgress, liveTaskPhase, isTaskRunning,
    modifiedFiles, onClearModifiedFiles, modifiedFilesExpanded, onToggleModifiedFiles,
    fileSearchQuery, onFileSearchChange, onOpenFile,
    workspaceFilesExpanded, onToggleWorkspaceFiles, workspaceItems,
    expandedPaths, loadingFolders, onToggleFolder, onAttachFile,
    gitInfo, commitMessage, onCommitMessageChange, committing, onGitCommit, onQuickFill,
    activeTaskId,
  } = props;

  return (
    <div
      style={{ width: `${width}px` }}
      className="relative flex flex-col border-l border-[var(--color-border-base)] pl-4 h-full shrink-0"
    >
      {/* Resize Handle */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--color-primary)]/40 active:bg-[var(--color-primary)]/60 transition-colors z-30"
        title="Drag to resize"
      />

      {/* Sidebar Header with Tabs & Collapse */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--color-border-base)] shrink-0">
        <div className="flex items-center gap-0.5 bg-[var(--color-bg-hover)]/70 rounded-xl p-0.5">
          <button
            onClick={() => onTabChange('tasks')}
            className={`px-2.5 py-1.5 rounded-[10px] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              tab === 'tasks'
                ? 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Activity className="w-3 h-3" />
            <span>{lang === 'en' ? 'Tasks' : '任务'}</span>
            {displayTotal > 0 && (
              <span className={`text-[10px] font-bold px-1 rounded ${
                isTaskRunning ? 'bg-blue-500 text-white' : 'bg-emerald-500 text-white'
              }`}>
                {displayDone}/{displayTotal}
              </span>
            )}
          </button>
          <button
            onClick={() => onTabChange('files')}
            className={`px-2.5 py-1.5 rounded-[10px] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              tab === 'files'
                ? 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <FileText className="w-3 h-3" />
            <span>{lang === 'en' ? 'Files' : '文件'}</span>
            {modifiedFiles.length > 0 && (
              <span className="text-[10px] font-bold px-1 rounded bg-amber-500 text-white">{modifiedFiles.length}</span>
            )}
          </button>
          <button
            onClick={() => onTabChange('git')}
            className={`px-2.5 py-1.5 rounded-[10px] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              tab === 'git'
                ? 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <GitBranch className="w-3 h-3" />
            <span>Git</span>
            {gitInfo.status === 'dirty' && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            )}
          </button>
          <button
            onClick={() => onTabChange('terminal')}
            className={`px-2.5 py-1.5 rounded-[10px] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              tab === 'terminal'
                ? 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Terminal className="w-3 h-3 text-emerald-500" />
            <span>{lang === 'en' ? 'Terminal' : '终端'}</span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Tasks Tab */}
        {tab === 'tasks' && (
          <div className="space-y-3">
            {displayTotal === 0 ? (
              <div className="flex flex-col items-center justify-center h-[200px] text-center px-4">
                <Activity className="w-10 h-10 text-[var(--color-text-muted)] mb-3 opacity-40" />
                <p className="text-xs text-[var(--color-text-muted)]">
                  {lang === 'en'
                    ? 'No active tasks. Start a build session to see tasks here.'
                    : '暂无活跃任务。启动 Build 模式后会在此显示任务列表。'}
                </p>
              </div>
            ) : (
              <>
                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                    <span>{lang === 'en' ? 'Overall Progress' : '总体进度'}</span>
                    {liveTaskPhase && (
                      <span className="font-mono uppercase tracking-wider text-[var(--color-primary)]">{liveTaskPhase}</span>
                    )}
                    <span className="font-mono">{displayProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
                    <div
                      className="orca-progress-bar h-full rounded-full transition-all duration-700"
                      style={{ width: `${displayProgress}%` }}
                    />
                  </div>
                </div>

                {/* Task Items — two-level plan: phases (level 0) with
                    indented sub-steps (level 1) */}
                <div className="space-y-0.5">
                  {displayTasks.map((task: any, idx: number) => {
                    const isPhase = task.level === 0;
                    const isSub = task.level === 1;
                    const status = task.status || 'pending';
                    const isCurrent = status === 'in_progress';
                    const label = isCurrent && task.activeForm ? task.activeForm : task.content;
                    return (
                      <div
                        key={`${isPhase ? 'p' : 's'}-${idx}`}
                        className={`flex items-start gap-2.5 p-2 rounded-lg text-xs transition-colors ${
                          isSub ? 'ml-4' : ''
                        } ${
                          isCurrent
                            ? 'bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30'
                            : 'hover:bg-[var(--color-bg-hover)]'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          {status === 'completed' && (
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                          )}
                          {isCurrent && (
                            <Loader className="w-4 h-4 text-blue-500 animate-spin" />
                          )}
                          {status === 'pending' && (
                            <Clock className={`w-4 h-4 ${isPhase ? 'text-[var(--color-text-muted)]' : 'text-gray-400'}`} />
                          )}
                        </div>
                        <span className={`flex-1 leading-relaxed ${
                          isPhase ? 'font-bold text-[var(--color-text-primary)]' : ''
                        } ${
                          status === 'completed'
                            ? 'text-[var(--color-text-muted)] line-through'
                            : isCurrent
                              ? 'text-blue-700 dark:text-blue-300 font-semibold'
                              : 'text-[var(--color-text-secondary)]'
                        }`}>
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Files / Explorer Tab */}
        {tab === 'files' && (
          <div className="flex flex-col h-full space-y-4 px-1 pb-4">
            {/* File Search */}
            <div className="relative shrink-0 mx-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-[var(--color-text-muted)]">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                value={fileSearchQuery}
                onChange={(e) => onFileSearchChange(e.target.value)}
                placeholder={lang === 'en' ? 'Search files...' : '搜索文件...'}
                className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg pl-8 pr-7 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/40 focus:ring-1 focus:ring-[var(--color-primary)]/20 transition-all font-sans"
              />
              {fileSearchQuery && (
                <button
                  onClick={() => onFileSearchChange('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Session Modified Files List */}
            {!fileSearchQuery && (
              <div className="border-b border-[var(--color-border-base)] pb-3 shrink-0 mx-1">
                <div
                  onClick={onToggleModifiedFiles}
                  className="flex items-center justify-between text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-text-primary)] select-none mb-1.5"
                >
                  <div className="flex items-center gap-1">
                    <ChevronDown className={`w-3 h-3 transition-transform ${modifiedFilesExpanded ? '' : '-rotate-90'}`} />
                    <span>{lang === 'en' ? 'Modified in Session' : '本会话已修改'}</span>
                    {modifiedFiles.length > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500 text-white font-mono ml-1">
                        {modifiedFiles.length}
                      </span>
                    )}
                  </div>
                  {modifiedFiles.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearModifiedFiles();
                      }}
                      className="text-[10px] text-gray-400 hover:text-red-500 transition-colors cursor-pointer capitalize font-semibold normal-case"
                    >
                      {lang === 'en' ? 'Clear' : '清除'}
                    </button>
                  )}
                </div>

                {modifiedFilesExpanded && (
                  <div className="space-y-0.5 max-h-[140px] overflow-y-auto pr-0.5">
                    {modifiedFiles.length === 0 ? (
                      <div className="text-[11px] text-[var(--color-text-muted)] italic py-1 px-4">
                        {lang === 'en' ? 'No files modified yet' : '暂无修改文件'}
                      </div>
                    ) : (
                      modifiedFiles.map((file, idx) => (
                        <div
                          key={idx}
                          onClick={() => onOpenFile(file.path)}
                          className="flex items-center gap-2 p-1.5 rounded-lg text-xs hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer group/file"
                        >
                          <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-[10.5px] text-[var(--color-text-primary)] truncate group-hover/file:text-[var(--color-primary)] transition-colors" title={file.path}>
                              {file.path}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[9px] px-1 py-0.1 rounded bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-semibold font-mono">
                                {file.action}
                              </span>
                              <span className="text-[9px] text-[var(--color-text-muted)]">{file.time}</span>
                            </div>
                          </div>
                          <Eye className="w-3 h-3 text-gray-400 opacity-0 group-hover/file:opacity-100 transition-opacity" />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Workspace Files Explorer */}
            <div className="flex-1 flex flex-col min-h-0 mx-1">
              <div
                onClick={onToggleWorkspaceFiles}
                className="flex items-center justify-between text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-text-primary)] select-none mb-1.5"
              >
                <div className="flex items-center gap-1">
                  <ChevronDown className={`w-3 h-3 transition-transform ${workspaceFilesExpanded ? '' : '-rotate-90'}`} />
                  <span>{lang === 'en' ? 'Workspace Explorer' : '项目资源管理器'}</span>
                </div>
              </div>

              {workspaceFilesExpanded && (
                <div className="flex-1 overflow-y-auto pr-0.5 space-y-0.5 font-mono text-[11.5px] select-none">
                  {workspaceItems.length === 0 ? (
                    <div className="text-[11px] text-[var(--color-text-muted)] italic py-2 px-4">
                      {lang === 'en' ? 'No files found' : '没有找到文件'}
                    </div>
                  ) : (
                    workspaceItems.map(({ item, depth }) => {
                      const isExpanded = !!expandedPaths[item.relativePath];
                      const isLoading = !!loadingFolders[item.relativePath];

                      let iconColor = 'text-gray-400 dark:text-gray-500';
                      if (item.isDirectory) {
                        iconColor = 'text-blue-500 dark:text-blue-400';
                      } else {
                        const ext = item.name.split('.').pop()?.toLowerCase();
                        if (ext === 'js' || ext === 'ts' || ext === 'tsx' || ext === 'jsx') {
                          iconColor = 'text-amber-500 dark:text-amber-400';
                        } else if (ext === 'css' || ext === 'html' || ext === 'scss') {
                          iconColor = 'text-sky-500 dark:text-sky-400';
                        } else if (ext === 'py' || ext === 'go' || ext === 'rs') {
                          iconColor = 'text-emerald-500 dark:text-emerald-400';
                        } else if (ext === 'md' || ext === 'json') {
                          iconColor = 'text-purple-500 dark:text-purple-400';
                        }
                      }

                      return (
                        <div
                          key={item.absolutePath}
                          style={{ paddingLeft: `${depth * 10 + 4}px` }}
                          onClick={() => item.isDirectory ? onToggleFolder(item.relativePath) : onOpenFile(item.absolutePath)}
                          className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer group/item"
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="shrink-0">
                              {item.isDirectory ? (
                                isExpanded ? (
                                  <FolderOpen className={`w-3.5 h-3.5 ${iconColor}`} />
                                ) : (
                                  <Folder className={`w-3.5 h-3.5 ${iconColor}`} />
                                )
                              ) : (
                                <FileText className={`w-3.5 h-3.5 ${iconColor}`} />
                              )}
                            </span>

                            <span className="truncate text-[var(--color-text-secondary)] group-hover/item:text-[var(--color-text-primary)] transition-colors" title={item.name}>
                              {item.name}
                            </span>

                            {isLoading && (
                              <Loader className="w-3 h-3 text-[var(--color-primary)] animate-spin shrink-0" />
                            )}
                          </div>

                          {!item.isDirectory && (
                            <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity pl-1 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAttachFile(item);
                                }}
                                className="p-1 rounded hover:bg-[var(--color-bg-card)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
                                title={lang === 'en' ? 'Attach to prompt context' : '添加到输入上下文'}
                              >
                                <Paperclip className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenFile(item.absolutePath);
                                }}
                                className="p-1 rounded hover:bg-[var(--color-bg-card)] text-[var(--color-text-muted)] hover:text-emerald-500 transition-colors cursor-pointer"
                                title={lang === 'en' ? 'Open file locally' : '本地打开文件'}
                              >
                                <Eye className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Git Tab */}
        {tab === 'git' && (
          <div className="space-y-4">
            {gitInfo.status === 'no-repo' ? (
              <div className="flex flex-col items-center justify-center h-[200px] text-center px-4">
                <FolderGit2 className="w-10 h-10 text-[var(--color-text-muted)] mb-3 opacity-40" />
                <p className="text-xs text-[var(--color-text-muted)]">
                  {lang === 'en' ? 'Not a git repository.' : '当前工作区不是 Git 仓库。'}
                </p>
              </div>
            ) : (
              <>
                {/* Branch Info */}
                <div className="bg-[var(--color-bg-hover)] rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-[var(--color-primary)]" />
                    <span className="text-sm font-bold font-mono text-[var(--color-text-primary)]">{gitInfo.branch}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex flex-col">
                      <span className="text-[var(--color-text-muted)]">{lang === 'en' ? 'Modified' : '已修改'}</span>
                      <span className={`font-bold font-mono text-sm ${gitInfo.changes > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {gitInfo.changes}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[var(--color-text-muted)]">{lang === 'en' ? 'Untracked' : '未跟踪'}</span>
                      <span className={`font-bold font-mono text-sm ${gitInfo.untracked > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {gitInfo.untracked}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status Badge */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                    gitInfo.status === 'clean'
                      ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                  }`}>
                    {gitInfo.status === 'clean' ? '✓ Clean' : '● Dirty'}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[200px]" title={gitInfo.lastCommit}>
                    {lang === 'en' ? 'Last commit' : '最近提交'}: {gitInfo.lastCommit}
                  </span>
                </div>

                {/* Modified Files List in Git */}
                {gitInfo.modifiedFiles && gitInfo.modifiedFiles.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
                      {lang === 'en' ? 'Changed Files' : '文件改动列表'}
                    </span>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-[var(--color-border-base)] rounded-lg p-1.5 bg-white/40 dark:bg-slate-900/40">
                      {gitInfo.modifiedFiles.map((file, idx) => {
                        const isUntracked = file.status.includes('?');
                        const isDeleted = file.status.includes('D');
                        const isAdded = file.status.includes('A');

                        let badgeColor = 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300';
                        if (isUntracked) badgeColor = 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
                        else if (isDeleted) badgeColor = 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300';
                        else if (isAdded) badgeColor = 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300';

                        return (
                          <div
                            key={idx}
                            onClick={() => onOpenFile(file.filepath)}
                            className="flex items-center justify-between text-[11px] font-mono py-1 px-1.5 hover:bg-[var(--color-bg-hover)] rounded cursor-pointer group/gitfile"
                          >
                            <span className="truncate flex-1 text-[var(--color-text-secondary)] mr-2 group-hover/gitfile:text-[var(--color-primary)] transition-colors" title={file.filepath}>
                              {file.filepath}
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold shrink-0 ${badgeColor}`}>
                              {file.status.trim() || 'M'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Git Commit Form */}
                {gitInfo.status === 'dirty' && (
                  <form onSubmit={onGitCommit} className="space-y-2 border-t border-[var(--color-border-base)] pt-3 mt-2">
                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
                      {lang === 'en' ? 'Commit Changes' : '提交改动'}
                    </span>
                    <input
                      type="text"
                      value={commitMessage}
                      onChange={(e) => onCommitMessageChange(e.target.value)}
                      placeholder={lang === 'en' ? 'Commit message...' : '提交说明...'}
                      required
                      className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/40 focus:ring-1 focus:ring-[var(--color-primary)]/20 transition-all font-sans"
                    />
                    <button
                      type="submit"
                      disabled={committing}
                      className="w-full py-2 text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-400 text-white transition-colors cursor-pointer text-center shadow-sm"
                    >
                      {committing
                        ? (lang === 'en' ? 'Committing...' : '提交中...')
                        : (lang === 'en' ? 'Stage & Commit' : '暂存并提交')}
                    </button>
                  </form>
                )}

                {/* Quick Actions */}
                <div className="flex gap-2 border-t border-[var(--color-border-base)] pt-3 mt-2">
                  <button
                    onClick={() => onQuickFill(lang === 'en' ? 'Show me the git diff' : '请帮我查看当前的 git diff')}
                    className="flex-1 py-2 text-xs font-semibold rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border-base)] hover:bg-white dark:hover:bg-slate-800 text-[var(--color-text-primary)] transition-colors cursor-pointer text-center"
                    title={lang === 'en' ? 'Ask agent to show git diff' : '请智能体显示 git diff'}
                  >
                    {lang === 'en' ? 'Show Diff' : '查看改动'}
                  </button>
                  <button
                    onClick={() => onQuickFill(lang === 'en' ? 'Summarize the recent git changes and suggest a commit message' : '请总结最近的 git 改动并建议一个 commit message')}
                    className="flex-1 py-2 text-xs font-semibold rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 hover:bg-[var(--color-primary)]/20 text-[var(--color-primary)] transition-colors cursor-pointer text-center"
                    title={lang === 'en' ? 'Ask agent for commit suggestion' : '请智能体建议 commit'}
                  >
                    {lang === 'en' ? 'Suggest Commit' : '提交建议'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Terminal Tab */}
        {tab === 'terminal' && (
          <div className="h-full">
            <TerminalPanel taskId={activeTaskId} lang={lang} />
          </div>
        )}
      </div>
    </div>
  );
}
