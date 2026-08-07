import { useState, memo, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, CheckCircle, XCircle, Loader, Eye, Clock, Copy, Search, ListTree, FileText } from 'lucide-react';
import type { Language } from '../i18n';

interface ToolBlock {
  type: 'tool';
  toolName: string;
  content: string;
  status: 'running' | 'done' | 'error';
  startTime?: number;
  endTime?: number;
}

interface ToolExecutionBlockProps {
  block: ToolBlock;
  lang: Language;
  onFileOp: (toolName: string, content: string) => void;
}

const READ_ONLY_TOOLS = new Set([
  'read_workspace_file',
  'list_directory',
  'list_workspace_files',
  'search_grep',
  'glob_files',
  'semantic_search_code',
  'get_skill_details',
  'list_available_skills',
  'git_status',
  'git_log',
]);

const SHELL_OUTPUT_LINES = 10;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function iconForTool(toolName: string) {
  if (toolName.startsWith('run_terminal')) return Terminal;
  if (toolName.startsWith('read') || toolName.startsWith('write') || toolName.startsWith('patch') || toolName.startsWith('multi') || toolName.startsWith('batch')) return FileText;
  if (toolName.startsWith('search') || toolName.startsWith('grep')) return Search;
  if (toolName.startsWith('list')) return ListTree;
  return Terminal;
}

function renderDiffContent(content: string, isRunning: boolean) {
  if (!content) {
    return <span className="text-slate-500 italic">{isRunning ? 'Establishing pipeline with agent daemon...' : 'Output was empty'}</span>;
  }

  const lines = content.split('\n');
  const hasDiffIndicators = lines.some(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));

  if (!hasDiffIndicators) {
    return <span className="text-[#a6e3a1] whitespace-pre">{content}</span>;
  }

  return (
    <div className="flex flex-col font-mono text-[11px] leading-relaxed">
      {lines.map((line, idx) => {
        let className = "text-slate-300";
        let bgStyle = "";

        if (line.startsWith('+')) {
          className = "text-[#a6e3a1] font-semibold";
          bgStyle = "bg-emerald-500/10 border-l-2 border-emerald-500 pl-1.5";
        } else if (line.startsWith('-')) {
          className = "text-[#f38ba8] font-semibold";
          bgStyle = "bg-red-500/10 border-l-2 border-red-500 pl-1.5";
        } else if (line.startsWith('@@')) {
          className = "text-[#89b4fa] font-bold";
          bgStyle = "bg-[#89b4fa]/5 pl-1.5";
        } else {
          className = "text-slate-300 pl-2";
        }

        return (
          <div key={idx} className={`${className} ${bgStyle}`}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

export const ToolExecutionBlock = memo(function ToolExecutionBlock({ block, lang, onFileOp }: ToolExecutionBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAllOutput, setShowAllOutput] = useState(false);
  const [copied, setCopied] = useState(false);
  const isRunning = block.status === 'running';
  const isError = block.status === 'error';
  const isDone = block.status === 'done';
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const isReadOnly = READ_ONLY_TOOLS.has(block.toolName);

  // 运行时计时器
  useEffect(() => {
    if (isRunning) {
      const start = block.startTime || Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - start);
      }, 100);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      setElapsed(block.endTime && block.startTime ? block.endTime - block.startTime : 0);
    }
  }, [isRunning, block.startTime, block.endTime]);

  // 只读工具完成后自动折叠
  useEffect(() => {
    if (isReadOnly && isDone) setIsExpanded(false);
  }, [isReadOnly, isDone]);

  // Ctrl/Cmd+B 展开当前 shell 输出（最近的 shell 卡片）
  useEffect(() => {
    if (block.toolName !== 'run_terminal_command') return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsExpanded(true);
        setShowAllOutput(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [block.toolName]);

  const statusIcon = isRunning ? (
    <Loader className="w-4 h-4 text-yellow-500 animate-spin" />
  ) : isError ? (
    <XCircle className="w-4 h-4 text-red-500" />
  ) : (
    <CheckCircle className="w-4 h-4 text-green-500" />
  );

  const statusText = isRunning ? (lang === 'en' ? 'Running...' : '执行中..') :
    isError ? (lang === 'en' ? 'Error' : '错误') :
    (lang === 'en' ? 'Done' : '已完成');

  const isFileOp = ['read_workspace_file', 'write_workspace_file', 'patch_workspace_file'].includes(block.toolName);
  const ToolIcon = iconForTool(block.toolName);

  const contentLines = block.content.split('\n');
  const truncated = contentLines.length > SHELL_OUTPUT_LINES && !showAllOutput;
  const displayContent = truncated ? contentLines.slice(0, SHELL_OUTPUT_LINES).join('\n') : block.content;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(block.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`my-3 border rounded-xl overflow-hidden transition-all duration-300 ${
      isRunning ? 'border-yellow-300/40 dark:border-yellow-700/40 bg-yellow-50/20 dark:bg-yellow-950/10' :
      isError ? 'border-red-300/40 dark:border-red-700/40 bg-red-50/20 dark:bg-red-950/10' :
      'border-green-300/40 dark:border-green-700/40 bg-green-50/20 dark:bg-green-950/10 tool-block-done'
    }`}>
      <div className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <ToolIcon className="w-4 h-4 text-[var(--color-text-muted)]" />
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          {block.toolName}
        </span>
        <div className="flex items-center gap-1.5">
          {statusIcon}
          <span className={`text-[10px] font-medium ${
            isRunning ? 'text-yellow-600 dark:text-yellow-400' :
            isError ? 'text-red-600 dark:text-red-400' :
            'text-green-600 dark:text-green-400'
          }`}>
            {statusText}
          </span>
        </div>
        {/* 执行时间 */}
        {(isRunning || isDone || isError) && elapsed > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
            <Clock className="w-3 h-3" />
            {formatDuration(elapsed)}
          </span>
        )}
        {/* 输出行数摘要（未展开时） */}
        {isDone && contentLines.length > 1 && !isExpanded && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hidden sm:inline">
            {contentLines.length} {lang === 'en' ? 'lines' : '行'}
          </span>
        )}
        <div className="flex-1" />
        {/* 复制按钮 */}
        {isDone && block.content && (
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            title={lang === 'en' ? 'Copy output' : '复制输出'}
          >
            {copied ? (
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            )}
          </button>
        )}
        {isFileOp && isDone && (
          <button
            onClick={(e) => { e.stopPropagation(); onFileOp(block.toolName, block.content); }}
            className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            title={lang === 'en' ? 'View file' : '查看文件'}
          >
            <Eye className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          </button>
        )}
        <button className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors">
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {isExpanded && (
        <div className="p-4 font-mono text-[12px] leading-relaxed overflow-x-auto animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-3 select-none">
            <span className="text-emerald-500 font-bold">$</span>
            <span className="text-[var(--color-text-secondary)]">{block.toolName}</span>
          </div>
          <div className="overflow-x-auto bg-[var(--color-bg-sidebar)] p-4 rounded-lg border border-[var(--color-border-base)] font-mono select-text text-[var(--color-text-primary)]">
            {renderDiffContent(displayContent, isRunning)}
          </div>
          {truncated && (
            <button
              onClick={() => setShowAllOutput(true)}
              className="mt-2 text-[11px] px-2.5 py-1 rounded-md bg-[var(--color-bg-hover)] text-[var(--color-primary)] hover:bg-[var(--color-bg-hover)]/80 transition-colors cursor-pointer"
            >
              {lang === 'en' ? `Show all ${contentLines.length} lines` : `显示全部 ${contentLines.length} 行`}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
