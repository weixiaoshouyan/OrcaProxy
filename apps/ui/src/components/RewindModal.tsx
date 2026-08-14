// RewindModal.tsx — checkpoint-based workspace rewind UI.
// Mirrors Reasonix's UndoRewindBanner: pick a turn checkpoint and restore
// code files and/or the conversation to that state. Backed by the existing
// /api/checkpoints endpoints.
import { useEffect, useState } from 'react';
import { History, Undo2, FileText, MessageSquare, X, RefreshCw, Check } from 'lucide-react';
import { api } from '../api';
import type { Language } from '../i18n';

export interface CheckpointSummary {
  turn: number;
  createdAt: number;
  prompt: string;
  messageCount: number;
  fileCount: number;
  files: { path: string; existedBefore: boolean }[];
}

interface Props {
  open: boolean;
  taskId: string | null;
  onClose: () => void;
  onRewound: (summary: { restored: number; deleted: number; conversationRewound: boolean }) => void;
  lang: Language;
}

type Scope = 'both' | 'code' | 'conversation';

export default function RewindModal({ open, taskId, onClose, onRewound, lang }: Props) {
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>('both');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const isEn = lang === 'en';

  useEffect(() => {
    if (!open || !taskId) return;
    setMessage(null);
    setLoading(true);
    setRewinding(false);
    setScope('both');
    api.get('/api/checkpoints', { params: { taskId } })
      .then(res => {
        const cps: CheckpointSummary[] = res.data?.checkpoints || [];
        setCheckpoints(cps);
        // Default to the most recent checkpoint for quick undo.
        setSelectedTurn(cps.length > 0 ? cps[cps.length - 1].turn : null);
      })
      .catch(() => setCheckpoints([]))
      .finally(() => setLoading(false));
  }, [open, taskId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const doRewind = async () => {
    if (!taskId || selectedTurn === null || rewinding) return;
    setRewinding(true);
    setMessage(null);
    try {
      const res = await api.post('/api/checkpoints/rewind', { taskId, turn: selectedTurn, scope });
      const d = res.data || {};
      if (d.ok) {
        const summary = { restored: d.restored || 0, deleted: d.deleted || 0, conversationRewound: !!d.conversationRewound };
        setMessage({ ok: true, text: isEn
          ? `Rewound to turn ${selectedTurn} — ${summary.restored} file(s) restored${summary.deleted ? `, ${summary.deleted} removed` : ''}${summary.conversationRewound ? ', conversation truncated' : ''}.`
          : `已回滚至第 ${selectedTurn} 轮 — 恢复 ${summary.restored} 个文件${summary.deleted ? `，删除 ${summary.deleted} 个` : ''}${summary.conversationRewound ? '，会话已截断' : ''}。` });
        onRewound(summary);
      } else {
        setMessage({ ok: false, text: d.error || (isEn ? 'Rewind failed' : '回滚失败') });
      }
    } catch (e: any) {
      setMessage({ ok: false, text: String(e?.response?.data?.error || e?.message || e) });
    } finally {
      setRewinding(false);
    }
  };

  const fmtTime = (ts: number) => new Date(ts).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[92vw] max-h-[80vh] bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl shadow-[var(--shadow-lg)] overflow-hidden animate-in zoom-in-95 fade-in duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border-base)] shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <History className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-[var(--color-text-primary)]">
              {isEn ? 'Rewind Workspace' : '回滚工作区'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer"
            title={isEn ? 'Close' : '关闭'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="h-32 flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {isEn ? 'Loading checkpoints...' : '正在加载检查点...'}
            </div>
          ) : checkpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
              <History className="w-8 h-8 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-xs text-[var(--color-text-muted)]">
                {isEn
                  ? 'No checkpoints yet. Agent tasks with file changes create them automatically.'
                  : '暂无检查点。执行过文件改动的 Agent 任务会自动生成。'}
              </p>
            </div>
          ) : (
            <>
              {/* Checkpoint list */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] select-none">
                  {isEn ? 'Checkpoints (newest at bottom)' : '检查点（越新越靠下）'}
                </div>
                {checkpoints.map((cp) => {
                  const isActive = cp.turn === selectedTurn;
                  return (
                    <button
                      key={cp.turn}
                      onClick={() => setSelectedTurn(cp.turn)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        isActive
                          ? 'border-[color-mix(in_srgb,var(--color-primary)_50%,var(--color-border-base))] bg-[var(--color-primary)]/5 shadow-[var(--shadow-xs)]'
                          : 'border-[var(--color-border-base)] hover:border-[var(--color-primary)]/30 hover:bg-[var(--color-bg-hover)]/40'
                      }`}
                    >
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]'}`}>
                        <Undo2 className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
                          <span className="font-mono">#{cp.turn}</span>
                          <span className="text-[10.5px] text-[var(--color-text-muted)] font-mono">{fmtTime(cp.createdAt)}</span>
                        </div>
                        <div className="text-[11px] text-[var(--color-text-secondary)] truncate mt-0.5">{cp.prompt || '—'}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]">
                          <FileText className="w-3 h-3" /> {cp.fileCount}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]">
                          <MessageSquare className="w-3 h-3" /> {cp.messageCount}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Scope selector */}
              <div className="pt-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2 select-none">
                  {isEn ? 'Rewind scope' : '回滚范围'}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: 'both', label: isEn ? 'Code + Chat' : '代码 + 会话' },
                    { id: 'code', label: isEn ? 'Code only' : '仅代码' },
                    { id: 'conversation', label: isEn ? 'Chat only' : '仅会话' },
                  ] as { id: Scope; label: string }[]).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setScope(s.id)}
                      className={`px-2 py-2 rounded-lg text-[11.5px] font-semibold border transition-all cursor-pointer ${
                        scope === s.id
                          ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border-base)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/40'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {message && (
                <div className={`text-xs px-3 py-2 rounded-lg ${message.ok ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
                  {message.text}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/40 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-[var(--color-text-muted)] select-none">
            {isEn ? 'Restores files from the chosen turn' : '将文件恢复到所选轮次的状态'}
          </span>
          <button
            onClick={doRewind}
            disabled={!selectedTurn || rewinding || checkpoints.length === 0}
            className="orca-btn-primary px-5 py-2 rounded-lg text-xs font-bold text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:shadow-none"
          >
            {rewinding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {rewinding ? (isEn ? 'Rewinding...' : '回滚中...') : (isEn ? 'Rewind to #' + selectedTurn : `回滚至 #${selectedTurn}`)}
          </button>
        </div>
      </div>
    </div>
  );
}
