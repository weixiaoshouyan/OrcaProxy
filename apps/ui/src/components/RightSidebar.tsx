/**
 * Right sidebar panel for Chat page.
 * Contains Tasks, Files explorer, and Git tabs.
 *
 * Extracted from Chat.tsx to reduce component size.
 * All data is received as props — the component is purely presentational.
 */

import React, { useMemo, useCallback } from 'react';
import {
  Activity,
  FileText,
  GitBranch,
  FolderGit2,
  CheckCircle,
  Loader,
  Clock,
  Search,
  X,
  Folder,
  FolderOpen,
  Paperclip,
  Eye,
} from 'lucide-react';
import type {
  GitInfo,
  ModifiedFileEntry,
  TaskListItem,
  WorkspaceItem,
} from '../types';
import type { Language } from '../i18n';

interface RightSidebarProps {
  lang: Language;
  isOpen: boolean;
  width: number;
  activeTab: 'tasks' | 'files' | 'git';
  onTabChange: (tab: 'tasks' | 'files' | 'git') => void;
  onResizeStart: (e: React.MouseEvent) => void;

  // Tasks tab
  taskList: TaskListItem[];
  isTaskRunning: boolean;

  // Files tab
  modifiedFiles: ModifiedFileEntry[];
  onClearModifiedFiles: () => void;
  onOpenFile: (filePath: string) => void;
  onAttachFile: (item: WorkspaceItem) => void;
  folderContents: Record<string, WorkspaceItem[]>;
  expandedPaths: Record<string, boolean>;
  loadingFolders: Record<string, boolean>;
  onToggleFolder: (subPath: string) => void;
  fileSearchQuery: string;
  onFileSearchChange: (query: string) => void;

  // Git tab
  gitInfo: GitInfo;
  commitMessage: string;
  onCommitMessageChange: (msg: string) => void;
  onCommit: () => void;
  committing: boolean;
  onAppendInput: (text: string) => void;
  onTextareaFocus: () => void;
}

export const RightSidebar = React.memo(function RightSidebar({
  lang,
  isOpen,
  width,
  activeTab,
  onTabChange,
  onResizeStart,
  taskList,
  isTaskRunning,
  modifiedFiles,
  onClearModifiedFiles,
  onOpenFile,
  onAttachFile,
  folderContents,
  expandedPaths,
  loadingFolders,
  onToggleFolder,
  fileSearchQuery,
  onFileSearchChange,
  gitInfo,
  commitMessage,
  onCommitMessageChange,
  onCommit,
  committing,
  onAppendInput,
  onTextareaFocus,
}: RightSidebarProps) {
  // Compute visible file items
  const getVisibleItems = useCallback(() => {
    const list: { item: WorkspaceItem; depth: number }[] = [];
    const addFolder = (subPath: string, depth: number) => {
      const items = folderContents[subPath] || [];
      for (const item of items) {
        list.push({ item, depth });
        if (item.isDirectory && expandedPaths[item.relativePath]) {
          addFolder(item.relativePath, depth + 1);
        }
      }
    };
    addFolder('', 0);
    return list;
  }, [folderContents, expandedPaths]);

  const filteredItems = useMemo(() => {
    const query = fileSearchQuery.trim().toLowerCase();
    if (!query) return getVisibleItems();
    const matches: { item: WorkspaceItem; depth: number }[] = [];
    const seen = new Set<string>();
    Object.keys(folderContents).forEach((subPath) => {
      (folderContents[subPath] || []).forEach((item) => {
        if (!item.isDirectory && item.name.toLowerCase().includes(query)) {
          if (!seen.has(item.absolutePath)) {
            seen.add(item.absolutePath);
            matches.push({ item, depth: 0 });
          }
        }
      });
    });
    return matches;
  }, [fileSearchQuery, folderContents, getVisibleItems]);

  if (!isOpen) {
    return (
      <div
        style={{ width: '0px' }}
        className="relative flex flex-col h-full shrink-0 transition-all duration-300 ease-out overflow-hidden"
      />
    );
  }

  return (
    <div
      style={{ width: `${width}px` }}
      className="relative flex flex-col h-full shrink-0 transition-all duration-300 ease-out border-l border-[var(--color-border-base)] pl-4"
    >
      {/* Resize Handle */}
      <div
        onMouseDown={onResizeStart}
        className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--color-primary)]/40 active:bg-[var(--color-primary)]/60 transition-colors z-30"
        title="Drag to resize"
      />

      {/* Sidebar Header with Tabs */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--color-border-base)] shrink-0">
        <div className="flex items-center gap-0.5 bg-[var(--color-bg-hover)] rounded-lg p-0.5">
          <button
            onClick={() => onTabChange('tasks')}
            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              activeTab === 'tasks'
                ? 'bg-white dark:bg-slate-800 text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Activity className="w-3 h-3" />
            <span>{lang === 'en' ? 'Tasks' : '任务'}</span>
            {taskList.length > 0 && (
              <span
                className={`text-[10px] font-bold px-1 rounded ${
                  isTaskRunning ? 'bg-blue-500 text-white' : 'bg-emerald-500 text-white'
                }`}
              >
                {taskList.filter((t) => t.status === 'completed').length}/{taskList.length}
              </span>
            )}
          </button>
          <button
            onClick={() => onTabChange('files')}
            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              activeTab === 'files'
                ? 'bg-white dark:bg-slate-800 text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <FileText className="w-3 h-3" />
            <span>{lang === 'en' ? 'Files' : '文件'}</span>
            {modifiedFiles.length > 0 && (
              <span className="text-[10px] font-bold px-1 rounded bg-amber-500 text-white">
                {modifiedFiles.length}
              </span>
            )}
          </button>
          <button
            onClick={() => onTabChange('git')}
            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              activeTab === 'git'
                ? 'bg-white dark:bg-slate-800 text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <GitBranch className="w-3 h-3" />
            <span>Git</span>
            {gitInfo.status === 'dirty' && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            )}
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Tasks Tab */}
        {activeTab === 'tasks' && (
          <div className="space-y-3 px-1 py-2">
            {taskList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[180px] text-center px-4">
                <Activity className="w-8 h-8 text-[var(--color-text-muted)] mb-2 opacity-50" />
                <p className="text-xs text-[var(--color-text-muted)]">
                  {lang === 'en' ? 'No active tasks' : '暂无活跃任务'}
                </p>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1 opacity-70">
                  {lang === 'en' ? 'Start a build session' : '启动 Build 模式后显示'}
                </p>
              </div>
            ) : (
              <>
                <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[var(--color-text-secondary)]">
                    <span>{lang === 'en' ? 'Progress' : '进度'}</span>
                    <span className="font-mono text-[var(--color-primary)]">
                      {taskList.filter((t) => t.status === 'completed').length}/{taskList.length}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isTaskRunning ? 'bg-blue-500' : 'bg-emerald-500'
                      }`}
                      style={{
                        width: `${
                          taskList.length > 0
                            ? (taskList.filter((t) => t.status === 'completed').length /
                                taskList.length) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-0.5">
                  {taskList.slice(0, 8).map((task, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-1.5 rounded text-[11px] hover:bg-[var(--color-bg-hover)] transition-colors"
                    >
                      <span className="shrink-0">
                        {task.status === 'completed' && (
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                        )}
                        {task.status === 'running' && (
                          <Loader className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                        )}
                        {task.status === 'pending' && (
                          <Clock className="w-3.5 h-3.5 text-gray-400 opacity-60" />
                        )}
                      </span>
                      <span
                        className={`flex-1 truncate leading-tight ${
                          task.status === 'completed'
                            ? 'text-[var(--color-text-muted)] line-through opacity-70'
                            : task.status === 'running'
                              ? 'text-[var(--color-text-primary)] font-semibold'
                              : 'text-[var(--color-text-secondary)]'
                        }`}
                      >
                        {task.description}
                      </span>
                    </div>
                  ))}
                  {taskList.length > 8 && (
                    <p className="text-[10px] text-[var(--color-text-muted)] text-center pt-1 opacity-60">
                      +{taskList.length - 8} {lang === 'en' ? 'more tasks' : '更多任务'}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Files Tab */}
        {activeTab === 'files' && (
          <div className="flex flex-col h-full px-1 py-2 gap-2">
            <div className="relative shrink-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={fileSearchQuery}
                onChange={(e) => onFileSearchChange(e.target.value)}
                placeholder={lang === 'en' ? 'Search files...' : '搜索文件...'}
                className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded pl-7 pr-3 py-1.5 text-[11px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/40 transition-colors font-sans"
              />
              {fileSearchQuery && (
                <button
                  onClick={() => onFileSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Modified files */}
              {modifiedFiles.length > 0 && !fileSearchQuery && (
                <div className="mb-2">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] px-1 mb-1">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3 text-amber-500" />
                      {lang === 'en' ? 'Modified' : '修改'}
                      <span className="text-amber-500 font-mono normal-case">
                        ({modifiedFiles.length})
                      </span>
                    </span>
                    <button
                      onClick={onClearModifiedFiles}
                      className="text-[9px] text-gray-400 hover:text-red-500 transition-colors cursor-pointer font-semibold uppercase"
                    >
                      {lang === 'en' ? 'Clear' : '清除'}
                    </button>
                  </div>
                  <div className="space-y-0.5 max-h-[100px] overflow-y-auto">
                    {modifiedFiles.slice(0, 10).map((file, idx) => (
                      <div
                        key={idx}
                        onClick={() => onOpenFile(file.path)}
                        className="flex items-center gap-1.5 p-1 rounded text-[10.5px] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
                      >
                        <FileText className="w-3 h-3 text-amber-500 shrink-0 opacity-80" />
                        <span
                          className="font-mono text-[var(--color-text-secondary)] truncate flex-1"
                          title={file.path}
                        >
                          {file.path}
                        </span>
                        <Eye className="w-2.5 h-2.5 text-gray-400 opacity-60 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Workspace file tree */}
              <div>
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] px-1 mb-1">
                  <Folder className="w-3 h-3 text-blue-500" />
                  <span>{lang === 'en' ? 'Workspace' : '工作区'}</span>
                </div>
                <div className="space-y-0 font-mono text-[10.5px]">
                  {filteredItems.length === 0 ? (
                    <div className="text-[10px] text-[var(--color-text-muted)] italic py-2 px-2">
                      {lang === 'en' ? 'No files found' : '没有找到文件'}
                    </div>
                  ) : (
                    filteredItems.map(({ item, depth }) => {
                      const isExpanded = !!expandedPaths[item.relativePath];
                      const isLoading = !!loadingFolders[item.relativePath];
                      const ext = item.name.split('.').pop()?.toLowerCase();
                      let iconColor = 'text-gray-400';
                      if (item.isDirectory) {
                        iconColor = 'text-blue-500';
                      } else if (ext === 'js' || ext === 'ts' || ext === 'tsx' || ext === 'jsx') {
                        iconColor = 'text-amber-500';
                      } else if (ext === 'css' || ext === 'html' || ext === 'scss') {
                        iconColor = 'text-sky-500';
                      } else if (ext === 'py' || ext === 'go' || ext === 'rs') {
                        iconColor = 'text-emerald-500';
                      } else if (ext === 'md' || ext === 'json') {
                        iconColor = 'text-purple-500';
                      }

                      return (
                        <div
                          key={item.absolutePath}
                          style={{ paddingLeft: `${depth * 8 + 2}px` }}
                          onClick={() =>
                            item.isDirectory
                              ? onToggleFolder(item.relativePath)
                              : onOpenFile(item.absolutePath)
                          }
                          className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
                        >
                          <span className="shrink-0">
                            {item.isDirectory ? (
                              isExpanded ? (
                                <FolderOpen className={`w-3 h-3 ${iconColor}`} />
                              ) : (
                                <Folder className={`w-3 h-3 ${iconColor}`} />
                              )
                            ) : (
                              <FileText className={`w-3 h-3 ${iconColor}`} />
                            )}
                          </span>
                          <span
                            className="truncate text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                            title={item.name}
                          >
                            {item.name}
                          </span>
                          {isLoading && (
                            <Loader className="w-2.5 h-2.5 text-[var(--color-primary)] animate-spin shrink-0 ml-1" />
                          )}
                          {!item.isDirectory && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAttachFile(item);
                              }}
                              className="ml-auto opacity-0 hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-opacity"
                              title={lang === 'en' ? 'Attach to context' : '添加到上下文'}
                            >
                              <Paperclip className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Git Tab */}
        {activeTab === 'git' && (
          <div className="px-1 py-2">
            {gitInfo.status === 'no-repo' ? (
              <div className="flex flex-col items-center justify-center h-[180px] text-center px-4">
                <FolderGit2 className="w-8 h-8 text-[var(--color-text-muted)] mb-2 opacity-50" />
                <p className="text-xs text-[var(--color-text-muted)]">
                  {lang === 'en' ? 'Not a git repository' : '非 Git 仓库'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <GitBranch className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" />
                      <span className="text-[11px] font-bold font-mono text-[var(--color-text-primary)] truncate">
                        {gitInfo.branch}
                      </span>
                    </div>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 ${
                        gitInfo.status === 'clean'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {gitInfo.status === 'clean' ? '\u2713 clean' : '\u25CF dirty'}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 pt-1 border-t border-[var(--color-border-base)]/50">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[var(--color-text-muted)] uppercase">
                        {lang === 'en' ? 'Modified' : '修改'}
                      </span>
                      <span
                        className={`text-[11px] font-bold font-mono ${
                          gitInfo.changes > 0 ? 'text-amber-500' : 'text-emerald-500'
                        }`}
                      >
                        {gitInfo.changes}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[var(--color-text-muted)] uppercase">
                        {lang === 'en' ? 'New' : '新增'}
                      </span>
                      <span
                        className={`text-[11px] font-bold font-mono ${
                          gitInfo.untracked > 0 ? 'text-amber-500' : 'text-emerald-500'
                        }`}
                      >
                        {gitInfo.untracked}
                      </span>
                    </div>
                  </div>

                  <div
                    className="text-[9px] text-[var(--color-text-muted)] truncate pt-1 border-t border-[var(--color-border-base)]/50"
                    title={gitInfo.lastCommit}
                  >
                    {lang === 'en' ? 'Last: ' : '最近: '}
                    {gitInfo.lastCommit || '\u2014'}
                  </div>
                </div>

                {gitInfo.modifiedFiles && gitInfo.modifiedFiles.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-1">
                      {lang === 'en' ? 'Changes' : '文件更改'} ({gitInfo.modifiedFiles.length})
                    </div>
                    <div className="space-y-0.5">
                      {gitInfo.modifiedFiles.slice(0, 5).map((file, idx) => {
                        const isUntracked = file.status.includes('?');
                        const isDeleted = file.status.includes('D');
                        const isAdded = file.status.includes('A');
                        let badgeStyle = 'text-amber-500';
                        if (isUntracked) badgeStyle = 'text-gray-500';
                        else if (isDeleted) badgeStyle = 'text-red-500';
                        else if (isAdded) badgeStyle = 'text-emerald-500';
                        return (
                          <div
                            key={idx}
                            onClick={() => onOpenFile(file.filepath)}
                            className="flex items-center gap-1.5 p-1 rounded text-[10.5px] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
                          >
                            <span
                              className={`font-mono font-bold w-3 text-center shrink-0 ${badgeStyle}`}
                            >
                              {file.status.trim() || 'M'}
                            </span>
                            <span
                              className="font-mono text-[var(--color-text-secondary)] truncate flex-1"
                              title={file.filepath}
                            >
                              {file.filepath}
                            </span>
                          </div>
                        );
                      })}
                      {gitInfo.modifiedFiles.length > 5 && (
                        <div className="text-[9px] text-[var(--color-text-muted)] text-center pt-1 opacity-60">
                          +{gitInfo.modifiedFiles.length - 5}{' '}
                          {lang === 'en' ? 'more' : '更多'}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5 pt-2 border-t border-[var(--color-border-base)]/50">
                  {gitInfo.status === 'dirty' && (
                    <>
                      <input
                        type="text"
                        value={commitMessage}
                        onChange={(e) => onCommitMessageChange(e.target.value)}
                        placeholder={lang === 'en' ? 'Commit message...' : '提交说明...'}
                        className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded px-2 py-1.5 text-[10.5px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/40 transition-colors font-sans"
                      />
                      <button
                        type="button"
                        onClick={onCommit}
                        disabled={committing || !commitMessage.trim()}
                        className="w-full py-1.5 text-[11px] font-semibold rounded bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-400 disabled:opacity-60 text-white transition-colors cursor-pointer"
                      >
                        {committing
                          ? lang === 'en'
                            ? 'Committing...'
                            : '提交中...'
                          : lang === 'en'
                            ? 'Stage & Commit'
                            : '暂存并提交'}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      onAppendInput(
                        lang === 'en'
                          ? 'Show git diff and suggest a commit message for current changes'
                          : '请帮我查看当前的 git diff，并建议一个合适的 commit message'
                      );
                      onTextareaFocus();
                    }}
                    className="w-full py-1.5 text-[10.5px] font-semibold rounded bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 hover:bg-[var(--color-primary)]/20 text-[var(--color-primary)] transition-colors cursor-pointer"
                  >
                    {lang === 'en' ? '\u{1F916} Ask AI to review changes' : '\u{1F916} 让 AI 审查变更'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
