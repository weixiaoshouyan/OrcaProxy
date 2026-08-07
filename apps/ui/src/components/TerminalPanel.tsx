// TerminalPanel.tsx — Live terminal-style output panel for agent commands.
// Pulls the active task's run_terminal_command results from the API and
// renders them like a real terminal session (command + stdout/stderr).
import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, X, Trash2, Copy, Loader } from 'lucide-react';
import { api } from '../api';
import type { Language } from '../i18n';

interface CommandEntry {
  id: string;
  command: string;
  output: string;
  success: boolean;
}

interface TaskResultRecord {
  name: string;
  toolCallId?: string;
  arguments?: string;
  output?: string;
}

interface TaskDetailResponse {
  results?: TaskResultRecord[];
}

interface TerminalPanelProps {
  taskId: string | null;
  lang: Language;
}

const POLL_MS = 4000;

function parseCommandArg(argString: string): string {
  try {
    const obj = JSON.parse(argString);
    return String(obj?.command || obj?.cmd || obj?.script || '');
  } catch {
    return '';
  }
}

function looksLikeError(output: string): boolean {
  return /^Error:|\[Execution Error\]|failed|command not found|non-zero exit/i.test(output.slice(0, 200));
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ taskId, lang }) => {
  const [entries, setEntries] = useState<CommandEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const load = useCallback(async () => {
    if (!taskId) {
      setEntries([]);
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.get(`/api/tasks/${taskId}`);
      const results: TaskResultRecord[] = (data as TaskDetailResponse)?.results || [];
      const commands = results
        .filter((r) => r.name === 'run_terminal_command')
        .map((r: TaskResultRecord, idx: number) => ({
          id: r.toolCallId || `${idx}`,
          command: parseCommandArg(r.arguments || ''),
          output: String(r.output || ''),
          success: !looksLikeError(String(r.output || '')) && !String(r.output || '').startsWith('Error:'),
        }));
      setEntries(commands);
    } catch {
      // keep last entries on transient failures
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (taskId !== lastTaskIdRef.current) {
      lastTaskIdRef.current = taskId;
      setEntries([]);
    }
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load, taskId]);

  const clear = () => setEntries([]);

  const copyAll = () => {
    const text = entries.map((e) => `$ ${e.command}\n${e.output}`).join('\n\n');
    if (text) navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 mb-2 bg-[#0b0e14] dark:bg-[#0b0e14] rounded-lg border border-[var(--color-border-base)] shrink-0">
        <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-gray-300">
          <Terminal className="w-3 h-3 text-emerald-400" />
          <span className="font-semibold">{lang === 'en' ? 'Terminal' : '终端'}</span>
          <span className="text-gray-500">
            {entries.length > 0 ? `${entries.length} ${lang === 'en' ? 'cmd' : '命令'}` : ''}
          </span>
          {loading && <Loader className="w-2.5 h-2.5 animate-spin text-gray-500" />}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={copyAll} className="p-1 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer" title={lang === 'en' ? 'Copy all' : '复制全部'}>
            <Copy className="w-3 h-3" />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer" title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '▾' : '▸'}
          </button>
          <button onClick={clear} className="p-1 text-gray-400 hover:text-red-400 transition-colors cursor-pointer" title={lang === 'en' ? 'Clear' : '清空'}>
            <Trash2 className="w-3 h-3" />
          </button>
          <X className="w-3 h-3 text-gray-500 ml-0.5" />
        </div>
      </div>

      {/* Output area */}
      {expanded && (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-[#0b0e14] rounded-lg border border-[var(--color-border-base)] p-2 font-mono text-[10.5px] leading-relaxed min-h-0"
        >
          {entries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-600 select-none gap-1">
              <Terminal className="w-6 h-6 opacity-30" />
              <span className="text-[10px]">
                {lang === 'en'
                  ? taskId ? 'No commands executed yet.' : 'Select a task to view its terminal output.'
                  : taskId ? '还没有执行过命令。' : '选择任务查看其终端输出。'}
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((e) => (
                <div key={e.id} className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <span className="text-gray-600 select-none">❯</span>
                    <span className="font-semibold whitespace-pre-wrap break-all">{e.command || '(no command)'}</span>
                    <span className={`text-[9px] px-1 rounded ${e.success ? 'text-emerald-500/80' : 'text-red-400'}`}>
                      {e.success ? '✓' : '✗'}
                    </span>
                  </div>
                  <pre className={`whitespace-pre-wrap break-all pl-4 text-gray-300 ${e.success ? '' : 'text-red-300'}`}>
                    {e.output || <span className="text-gray-600 italic">(no output)</span>}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TerminalPanel;
