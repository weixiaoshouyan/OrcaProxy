import { useEffect, useState } from 'react';
import {
  getMcpPermissions, setMcpPermissions, approveMcpTool, rejectMcpApproval,
  clearPendingApprovals, type McpPermissions as McpPermissionsType, type PendingApproval,
} from '../api';
import { Shield, Plus, Trash2, Check, X, AlertCircle, Clock } from 'lucide-react';
import { getLanguage } from '../i18n';

export default function McpPermissionsPage() {
  const lang = getLanguage();
  const [perms, setPerms] = useState<McpPermissionsType>({ requireApproval: false, allowedTools: [] });
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [newTool, setNewTool] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const data = await getMcpPermissions();
      setPerms(data.permissions);
      setPending(data.pending);
    } catch (e: unknown) {
      setMessage(String(e));
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const save = async (next: McpPermissionsType) => {
    setLoading(true);
    try {
      const data = await setMcpPermissions(next);
      setPerms(data.permissions);
      setMessage(lang === 'en' ? 'Settings saved' : '设置已保存');
    } catch (e: unknown) {
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  };

  const addTool = () => {
    const name = newTool.trim();
    if (!name) return;
    if (perms.allowedTools.includes(name)) {
      setMessage(lang === 'en' ? 'Tool already in allowlist' : '工具已在白名单中');
      return;
    }
    save({ ...perms, allowedTools: [...perms.allowedTools, name] });
    setNewTool('');
  };

  const removeTool = (name: string) => {
    save({ ...perms, allowedTools: perms.allowedTools.filter((t) => t !== name) });
  };

  const handleApprove = async (taskId: string, toolCallId: string) => {
    try {
      const data = await approveMcpTool(taskId, toolCallId);
      setPending(data.pending);
      setMessage(lang === 'en' ? 'Tool approved' : '工具已批准');
    } catch (e: unknown) {
      setMessage(String(e));
    }
  };

  const handleReject = async (taskId: string, toolCallId: string) => {
    try {
      const data = await rejectMcpApproval(taskId, toolCallId);
      setPending(data.pending);
    } catch (e: unknown) {
      setMessage(String(e));
    }
  };

  const handleClear = async () => {
    try {
      const data = await clearPendingApprovals();
      setPending(data.pending);
    } catch (e: unknown) {
      setMessage(String(e));
    }
  };

  const formatTool = (name: string) => {
    const parts = name.split('__');
    if (parts.length >= 3) return `${parts[1]} / ${parts.slice(2).join('__')}`;
    return name;
  };

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <Shield className="w-6 h-6 text-[var(--color-primary)]" />
              {lang === 'en' ? 'MCP Permissions' : 'MCP 权限控制'}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              {lang === 'en'
                ? 'Approve or whitelist MCP write tools before they run.'
                : '在 MCP 写工具执行前进行审批或加入白名单。'}
            </p>
          </div>
        </div>

        {message && (
          <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg ${message.includes('error') || message.includes('失败') ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
            <AlertCircle className="w-4 h-4" />
            {message}
          </div>
        )}

        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {lang === 'en' ? 'Approval Gate' : '审批门控'}
            </h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <span className="text-sm text-[var(--color-text-secondary)]">
                {lang === 'en' ? 'Require approval for MCP tools' : 'MCP 工具需要审批'}
              </span>
              <button
                onClick={() => save({ ...perms, requireApproval: !perms.requireApproval })}
                className={`relative w-11 h-6 rounded-full transition-colors ${perms.requireApproval ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-bg-hover)]'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${perms.requireApproval ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              {lang === 'en' ? 'Allowed Tools (whitelist)' : '允许的工具（白名单）'}
            </label>
            <div className="flex flex-wrap gap-2">
              {perms.allowedTools.length === 0 && (
                <span className="text-sm text-[var(--color-text-muted)]">
                  {lang === 'en' ? 'No tools whitelisted yet.' : '暂无白名单工具。'}
                </span>
              )}
              {perms.allowedTools.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-xs"
                >
                  {formatTool(t)}
                  <button
                    onClick={() => removeTool(t)}
                    className="hover:text-red-500"
                    title={lang === 'en' ? 'Remove' : '移除'}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <input
                value={newTool}
                onChange={(e) => setNewTool(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTool()}
                placeholder="e.g. mcp__filesystem__write_file"
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
              />
              <button
                onClick={addTool}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {lang === 'en' ? 'Add' : '添加'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {lang === 'en' ? 'Pending Approvals' : '待审批请求'}
            </h2>
            {pending.length > 0 && (
              <button
                onClick={handleClear}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                {lang === 'en' ? 'Clear all' : '清除全部'}
              </button>
            )}
          </div>

          {pending.length === 0 && (
            <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
              {lang === 'en' ? 'No pending approvals.' : '暂无待审批请求。'}
            </div>
          )}

          <div className="space-y-3">
            {pending.map((p) => (
              <div
                key={`${p.taskId}:${p.toolCallId}`}
                className="border border-[var(--color-border-base)] rounded-lg p-4 bg-[var(--color-bg-base)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                      <Shield className="w-4 h-4 text-[var(--color-primary)]" />
                      {formatTool(p.toolName)}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(p.requestedAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)] mt-1 truncate" title={p.arguments}>
                      Task: {p.taskId}
                    </div>
                    <pre className="mt-2 text-[11px] bg-[var(--color-bg-card)] p-2 rounded border border-[var(--color-border-base)] text-[var(--color-text-secondary)] overflow-auto max-h-32">
                      {p.arguments}
                    </pre>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleApprove(p.taskId, p.toolCallId)}
                      className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                      title={lang === 'en' ? 'Approve & add to whitelist' : '批准并加入白名单'}
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleReject(p.taskId, p.toolCallId)}
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20"
                      title={lang === 'en' ? 'Reject' : '拒绝'}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
