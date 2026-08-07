import { useEffect, useState } from 'react';
import { getEvalDataset, getEvalResults, runEvalTask, type EvalTask, type EvalResult } from '../api';
import { Beaker, Play, CheckCircle, XCircle, Clock, AlertCircle, BarChart3 } from 'lucide-react';
import { getLanguage } from '../i18n';

export default function EvalDashboardPage() {
  const lang = getLanguage();
  const [tasks, setTasks] = useState<EvalTask[]>([]);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const [d, r] = await Promise.all([getEvalDataset(), getEvalResults()]);
      setTasks(d.tasks);
      setResults(r.results);
    } catch (e: unknown) {
      setMessage(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runTask = async (taskId: string) => {
    setRunning(taskId);
    setMessage('');
    try {
      const result = await runEvalTask(taskId);
      setResults((prev) => [...prev.filter((r) => r.taskId !== taskId), result]);
      setMessage(`${result.taskId}: ${result.passed ? (lang === 'en' ? 'passed' : '通过') : (lang === 'en' ? 'failed' : '失败')} (${result.score}/${result.total})`);
    } catch (e: unknown) {
      setMessage(String(e));
    } finally {
      setRunning(null);
    }
  };

  const passRate = results.length
    ? Math.round((results.filter((r) => r.passed).length / results.length) * 100)
    : 0;

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
            <Beaker className="w-6 h-6 text-[var(--color-primary)]" />
            {lang === 'en' ? 'Agent Evaluation' : 'Agent 评估'}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {lang === 'en'
              ? 'SWE-bench-style task evaluation dashboard.'
              : 'SWE-bench 风格的任务评估看板。'}
          </p>
        </div>

        {message && (
          <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg ${message.includes('failed') || message.includes('失败') ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
            <AlertCircle className="w-4 h-4" />
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl p-5 flex items-center gap-4">
            <BarChart3 className="w-8 h-8 text-[var(--color-primary)]" />
            <div>
              <div className="text-2xl font-bold text-[var(--color-text-primary)]">{tasks.length}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{lang === 'en' ? 'Tasks' : '任务数'}</div>
            </div>
          </div>
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl p-5 flex items-center gap-4">
            <CheckCircle className="w-8 h-8 text-emerald-500" />
            <div>
              <div className="text-2xl font-bold text-[var(--color-text-primary)]">{passRate}%</div>
              <div className="text-xs text-[var(--color-text-muted)]">{lang === 'en' ? 'Pass Rate' : '通过率'}</div>
            </div>
          </div>
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl p-5 flex items-center gap-4">
            <Clock className="w-8 h-8 text-[var(--color-text-secondary)]" />
            <div>
              <div className="text-2xl font-bold text-[var(--color-text-primary)]">{results.length}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{lang === 'en' ? 'Runs' : '运行次数'}</div>
            </div>
          </div>
        </div>

        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border-base)] bg-[var(--color-bg-hover)] font-semibold text-[var(--color-text-primary)]">
            {lang === 'en' ? 'Tasks' : '任务列表'}
          </div>
          <div className="divide-y divide-[var(--color-border-base)]">
            {tasks.map((task) => {
              const latest = results.filter((r) => r.taskId === task.id).sort((a, b) => b.durationMs - a.durationMs)[0];
              return (
                <div key={task.id} className="p-5 flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--color-text-primary)]">{task.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)] truncate">{task.prompt}</div>
                    <div className="flex items-center gap-2 pt-1">
                      {latest && (
                        <span className={`text-xs px-2 py-0.5 rounded ${latest.passed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
                          {latest.passed ? <CheckCircle className="w-3 h-3 inline mr-1" /> : <XCircle className="w-3 h-3 inline mr-1" />}
                          {latest.score}/{latest.total}
                        </span>
                      )}
                      <span className="text-xs text-[var(--color-text-muted)]">{task.criteria.length} {lang === 'en' ? 'criteria' : '判定条件'}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => runTask(task.id)}
                    disabled={running === task.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
                  >
                    {running === task.id ? <Clock className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    {lang === 'en' ? 'Run' : '运行'}
                  </button>
                </div>
              );
            })}
            {tasks.length === 0 && (
              <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
                {lang === 'en' ? 'No evaluation tasks configured.' : '未配置评估任务。'}
              </div>
            )}
          </div>
        </div>

        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border-base)] bg-[var(--color-bg-hover)] font-semibold text-[var(--color-text-primary)]">
            {lang === 'en' ? 'Recent Results' : '最近结果'}
          </div>
          <div className="divide-y divide-[var(--color-border-base)]">
            {results.slice().reverse().slice(0, 20).map((r, i) => (
              <div key={`${r.taskId}:${i}`} className="p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                  {r.passed ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                  {r.taskId}
                  <span className="text-xs text-[var(--color-text-muted)] font-normal ml-2">{r.score}/{r.total} · {r.durationMs}ms</span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-text-muted)] space-y-0.5">
                  {r.details.map((d, idx) => (
                    <div key={idx} className={`${d.passed ? 'text-emerald-600' : 'text-red-600'}`}>
                      {d.criterion.type}: {d.passed ? '✓' : '✗'} {d.note.slice(0, 200)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {results.length === 0 && (
              <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
                {lang === 'en' ? 'No results yet.' : '暂无结果。'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
