// RewindPanel.tsx — Checkpoint-based workspace rewind UI.
// Mirrors Reasonix rewind UX: list turn checkpoints, two-step confirm, result banner.
import { useState, useEffect, useCallback } from 'react';
import { History, RotateCcw, ChevronDown, ChevronRight, X, FileText, FilePlus2, AlertTriangle, CheckCircle2, CornerUpLeft } from 'lucide-react';
import { api } from '../api';

interface CheckpointFile {
  path: string;
  existedBefore: boolean;
}

interface CheckpointSummary {
  turn: number;
  createdAt: number;
  prompt: string;
  messageCount: number;
  fileCount: number;
  files: CheckpointFile[];
}

interface RewindResult {
  ok: boolean;
  restored: string[];
  deleted: string[];
  skipped: string[];
  conversationRewound?: boolean;
  error?: string;
}

interface Props {
  taskId?: string | null;
  lang: 'zh' | 'en';
  onRewound?: (result: RewindResult) => void;
}

const MAX_FILES_SHOWN = 4;

export default function RewindPanel({ taskId, lang, onRewound }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null);
  const [confirmingTurn, setConfirmingTurn] = useState<number | null>(null);
  const [scope, setScope] = useState<'both' | 'code' | 'conversation'>('both');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<RewindResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/api/checkpoints?taskId=${encodeURIComponent(taskId)}`);
      setCheckpoints(data?.checkpoints || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load checkpoints');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (open && taskId) {
      const t = window.setTimeout(() => { void load(); }, 0);
      return () => window.clearTimeout(t);
    }
  }, [open, taskId, load]);

  const doRewind = async (turn: number) => {
    if (!taskId) return;
    setWorking(true);
    setError(null);
    try {
      const { data } = await api.post('/api/checkpoints/rewind', { taskId, turn, scope });
      setResult(data as RewindResult);
      setConfirmingTurn(null);
      onRewound?.(data as RewindResult);
      // Refresh after rewind (checkpoint may be pruned / turn removed from front)
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Rewind failed');
    } finally {
      setWorking(false);
    }
  };

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title={lang === 'en' ? 'Rewind workspace to a checkpoint' : '回退工作区到检查点'}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
          open
            ? 'bg-[var(--color-primary)]/15 border-[var(--color-primary)]/30 text-[var(--color-primary)]'
            : 'bg-[var(--color-bg-card)] border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]'
        }`}
      >
        <History className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">{lang === 'en' ? 'Rewind' : '回退'}</span>
        {checkpoints.length > 0 && (
          <span className="ml-0.5 px-1 rounded bg-[var(--color-primary)]/15 text-[var(--color-primary)]">{checkpoints.length}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg max-h-[75vh] flex flex-col rounded-xl bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-base)]">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-[var(--color-primary)]" />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {lang === 'en' ? 'Rewind workspace' : '回退工作区'}
                </span>
              </div>
              <button onClick={() => setOpen(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scope selector */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border-base)]/60">
              <span className="text-xs text-[var(--color-text-muted)]">{lang === 'en' ? 'Scope' : '范围'}:</span>
              {([
                ['both', lang === 'en' ? 'Code + Chat' : '代码 + 对话'],
                ['code', lang === 'en' ? 'Code only' : '仅代码'],
                ['conversation', lang === 'en' ? 'Chat only' : '仅对话'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setScope(value)}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    scope === value
                      ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                      : 'bg-[var(--color-bg-base)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Result banner */}
            {result && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-xs text-green-500">
                <div className="flex items-center gap-1.5 font-semibold mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Rewind complete' : '回退完成'}
                </div>
                <div className="text-[var(--color-text-secondary)] space-y-0.5">
                  {result.restored.length > 0 && <div>{lang === 'en' ? 'Restored' : '已恢复'}: {result.restored.slice(0, MAX_FILES_SHOWN).join(', ')}{result.restored.length > MAX_FILES_SHOWN ? ` +${result.restored.length - MAX_FILES_SHOWN}` : ''}</div>}
                  {result.deleted.length > 0 && <div>{lang === 'en' ? 'Deleted' : '已删除'}: {result.deleted.slice(0, MAX_FILES_SHOWN).join(', ')}{result.deleted.length > MAX_FILES_SHOWN ? ` +${result.deleted.length - MAX_FILES_SHOWN}` : ''}</div>}
                  {result.skipped.length > 0 && <div className="text-amber-500">{lang === 'en' ? 'Skipped (conflict)' : '跳过（冲突）'}: {result.skipped.length}</div>}
                  {result.conversationRewound && <div className="text-[var(--color-text-muted)]">{lang === 'en' ? 'Conversation was truncated to the checkpoint.' : '对话已截断到检查点。'}</div>}
                </div>
                <button
                  onClick={() => setResult(null)}
                  className="mt-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] underline underline-offset-2 cursor-pointer"
                >
                  {lang === 'en' ? 'Dismiss' : '知道了'}
                </button>
              </div>
            )}

            {error && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-500 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> {error}
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loading && <div className="text-xs text-[var(--color-text-muted)] text-center py-6">{lang === 'en' ? 'Loading checkpoints...' : '加载检查点中...'}</div>}
              {!loading && checkpoints.length === 0 && (
                <div className="text-center py-10 text-[var(--color-text-muted)]">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">{lang === 'en' ? 'No checkpoints yet. Checkpoints are captured when the agent modifies files.' : '暂无检查点。agent 修改文件时会自动记录检查点。'}</p>
                </div>
              )}
              {checkpoints.map((cp, idx) => {
                const isLatest = idx === checkpoints.length - 1;
                const expanded = expandedTurn === cp.turn;
                const confirming = confirmingTurn === cp.turn;
                return (
                  <div key={cp.turn} className="rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        onClick={() => setExpandedTurn(expanded ? null : cp.turn)}
                        className="flex items-center gap-1.5 flex-1 text-left cursor-pointer group"
                      >
                        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-muted)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />}
                        <span className="text-xs font-mono text-[var(--color-primary)]">#{cp.turn}</span>
                        <span className="text-xs text-[var(--color-text-secondary)] flex-1 truncate">{cp.prompt || (lang === 'en' ? '(no prompt)' : '（无提示词）')}</span>
                      </button>
                      <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(cp.createdAt)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] whitespace-nowrap">{cp.fileCount} {lang === 'en' ? 'files' : '文件'}</span>
                      {isLatest && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 whitespace-nowrap">{lang === 'en' ? 'latest' : '最新'}</span>}
                    </div>

                    {expanded && (
                      <div className="px-3 pb-2">
                        <div className="max-h-32 overflow-y-auto space-y-0.5 mb-2">
                          {cp.files.slice(0, MAX_FILES_SHOWN).map((f) => (
                            <div key={f.path} className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] font-mono truncate">
                              {f.existedBefore ? <FileText className="w-3 h-3 shrink-0" /> : <FilePlus2 className="w-3 h-3 shrink-0 text-amber-500" />}
                              <span className="truncate">{f.path}</span>
                            </div>
                          ))}
                          {cp.files.length > MAX_FILES_SHOWN && (
                            <div className="text-[10px] text-[var(--color-text-muted)]">+{cp.files.length - MAX_FILES_SHOWN} more</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!confirming ? (
                            <button
                              onClick={() => setConfirmingTurn(cp.turn)}
                              className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20 transition-all cursor-pointer"
                            >
                              {lang === 'en' ? 'Rewind here' : '回退到此'}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => doRewind(cp.turn)}
                                disabled={working}
                                className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-all cursor-pointer"
                              >
                                {working ? (lang === 'en' ? 'Rewinding...' : '回退中...') : (lang === 'en' ? 'Confirm rewind' : '确认回退')}
                              </button>
                              <button
                                onClick={() => setConfirmingTurn(null)}
                                className="px-2.5 py-1.5 rounded-md text-xs bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
                              >
                                {lang === 'en' ? 'Cancel' : '取消'}
                              </button>
                            </>
                          )}
                          {!isLatest && !confirming && (
                            <span className="text-[10px] text-amber-500 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {lang === 'en' ? 'Restores workspace, truncates later turns' : '将恢复文件并丢弃之后的轮次'}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-2 border-t border-[var(--color-border-base)] flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <CornerUpLeft className="w-3 h-3" />
              {lang === 'en' ? 'Rewinding restores the workspace exactly as it was before that turn. Files changed since (by you or the agent) are kept.' : '回退会把工作区恢复到该轮之前的状态。之后被手动或 agent 修改过的文件将保留当前内容。'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
