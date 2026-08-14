// TerminalPanel.tsx — Live terminal-style output panel for agent commands.
// Pulls the active task's run_terminal_command results from the API and
// renders them like a real terminal session (command + stdout/stderr).
import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, Trash2, Copy, Loader, RotateCw } from 'lucide-react';
import { api } from '../api';
import type { Language } from '../i18n';

interface CommandEntry {
  id: string;
  command: string;
  output: string;
  success: boolean;
  running?: boolean;
}

interface TaskResultRecord {
  name: string;
  toolCallId?: string;
  arguments?: string;
  output?: string;
}

interface TaskDetailResponse {
  workspacePath?: string;
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
  const workspacePathRef = useRef<string>('');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const load = useCallback(async (gen?: number) => {
    if (!taskId) {
      setEntries([]);
      return;
    }
    const targetId = taskId;
    const myGen = gen ?? loadGenRef.current;
    try {
      setLoading(true);
      const { data } = await api.get(`/api/tasks/${targetId}`);
      // Stale-response guard: if the task changed or the panel unmounted while
      // this request was in flight, drop the result — otherwise a late
      // response overwrites the newer task's output (a race corrected only by
      // the next 4s poll) or calls setState on an unmounted component.
      if (myGen !== loadGenRef.current || targetId !== lastTaskIdRef.current) return;
      const task = data as TaskDetailResponse;
      if (task.workspacePath) workspacePathRef.current = task.workspacePath;
      const results: TaskResultRecord[] = task?.results || [];
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
      if (myGen === loadGenRef.current) setLoading(false);
    }
  }, [taskId]);

  // Generation counter: every effect (re)run and every cleanup invalidates all
  // in-flight loads, so no stale response can land after a task switch/unmount.
  const loadGenRef = useRef(0);

  // P1-8: rerun a failed command directly from the panel (reuses the same
  // sandboxed executor the agent uses, so the dangerous-command blacklist
  // still applies).
  const rerun = useCallback(async (entry: CommandEntry) => {
    const ws = workspacePathRef.current;
    if (!ws) return;
    setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, running: true } : e)));
    try {
      const { data } = await api.post('/api/workspace/run-command', {
        command: entry.command,
        workspacePath: ws,
      });
      setEntries(prev => prev.map(e => (e.id === entry.id
        ? { ...e, output: data.output || '', success: !data.blocked && !looksLikeError(data.output || ''), running: false }
        : e)));
    } catch (e) {
      setEntries(prev => prev.map(e => (e.id === entry.id
        ? { ...e, output: String(e), success: false, running: false }
        : e)));
    }
  }, []);

  useEffect(() => {
    // Bump the generation FIRST: any in-flight load from the previous task is
    // now stale and will be dropped by the load() guard.
    loadGenRef.current++;
    if (taskId !== lastTaskIdRef.current) {
      lastTaskIdRef.current = taskId;
      setEntries([]);
    }
    const gen = loadGenRef.current;
    const first = window.setTimeout(() => { void load(gen); }, 0);
    const interval = window.setInterval(() => { void load(gen); }, POLL_MS);
    return () => {
      loadGenRef.current++;
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
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer" title={expanded ? (lang === 'en' ? 'Collapse' : '收起') : (lang === 'en' ? 'Expand' : '展开')}>
            {expanded ? '▾' : '▸'}
          </button>
          <button onClick={clear} className="p-1 text-gray-400 hover:text-red-400 transition-colors cursor-pointer" title={lang === 'en' ? 'Clear' : '清空'}>
            <Trash2 className="w-3 h-3" />
          </button>
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
                <div key={e.id} className="space-y-0.5 group/entry">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <span className="text-gray-600 select-none">❯</span>
                    <span className="font-semibold whitespace-pre-wrap break-all">{e.command || (lang === 'en' ? '(no command)' : '(无命令)')}</span>
                    <span className={`text-[9px] px-1 rounded ${e.success ? 'text-emerald-500/80' : 'text-red-400'}`}>
                      {e.running ? '…' : (e.success ? '✓' : '✗')}
                    </span>
                    {/* P1-8: rerun a failed command in-place */}
                    {!e.success && !e.running && (
                      <button
                        onClick={() => void rerun(e)}
                        className="p-0.5 text-gray-500 hover:text-emerald-400 transition-colors cursor-pointer opacity-0 group-hover/entry:opacity-100"
                        title={lang === 'en' ? 'Rerun command' : '重新执行命令'}
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <pre className={`whitespace-pre-wrap break-all pl-4 text-gray-300 ${e.success ? '' : 'text-red-300'}`}>
                    {e.output || <span className="text-gray-600 italic">{lang === 'en' ? '(no output)' : '(无输出)'}</span>}
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
