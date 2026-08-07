import { useEffect, useState } from 'react';
import { api, getProfiles, saveProfile, deleteProfile, activateProfile, type Profile } from '../api';
import { Box, Plus, Trash2, Check, GitBranch, Power } from 'lucide-react';
import { getLanguage } from '../i18n';
import { useToast } from '../components/Toast';

interface ProviderInfo {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

export default function ProfilesPage() {
  const lang = getLanguage();
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [activeProfileId, setActiveProfileId] = useState<string | undefined>(undefined);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [toolRoute, setToolRoute] = useState<{ pattern: string; providerId: string; model: string }>({ pattern: '', providerId: '', model: '' });
  const toast = useToast();

  const emptyProfile: Profile = {
    id: '',
    name: '',
    description: '',
    providerId: '',
    model: '',
    apiKey: '',
    apiKeyEnv: '',
    fallbackProviderIds: [],
  };

  const load = async () => {
    try {
      const [{ profiles, activeProfileId }, providerRes] = await Promise.all([
        getProfiles(),
        api.get('/api/providers'),
      ]);
      setProfiles(profiles);
      setActiveProfileId(activeProfileId);
      setProviders(providerRes.data || []);
    } catch (e: unknown) {
      toast.error('加载 Profile 失败', e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.id.trim() || !editing.name.trim() || !editing.providerId) {
      toast.error('ID、名称和 Provider 为必填项');
      return;
    }
    setLoading(true);
    try {
      const saved = await saveProfile({ ...editing, id: editing.id.trim() });
      setProfiles((prev) => ({ ...prev, [saved.id]: saved }));
      setEditing(null);
      toast.success('Profile 已保存', saved.name);
    } catch (e: unknown) {
      toast.error('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(lang === 'en' ? `Delete profile ${id}?` : `删除 Profile ${id}？`)) return;
    try {
      await deleteProfile(id);
      setProfiles((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeProfileId === id) setActiveProfileId(undefined);
      toast.success('Profile 已删除', id);
    } catch (e: unknown) {
      toast.error('删除失败', e instanceof Error ? e.message : String(e));
    }
  };

  const addToolRoute = () => {
    if (!toolRoute.pattern.trim() || !toolRoute.providerId) return;
    const next: Profile = {
      ...editing!,
      toolRouting: [...(editing?.toolRouting || []), { pattern: toolRoute.pattern.trim(), providerId: toolRoute.providerId, model: toolRoute.model.trim() || undefined }],
    };
    setEditing(next);
    setToolRoute({ pattern: '', providerId: '', model: '' });
  };

  const removeToolRoute = (idx: number) => {
    const next = [...(editing?.toolRouting || [])];
    next.splice(idx, 1);
    setEditing({ ...editing!, toolRouting: next });
  };

  const handleActivate = async (id: string) => {
    try {
      await activateProfile(id);
      setActiveProfileId(id);
      const p = profiles[id];
      toast.success('Profile 已激活', p?.name || id);
    } catch (e: any) {
      toast.error('激活失败', e?.response?.data?.error || e?.message);
    }
  };

  const selectedProvider = providers.find((p) => p.id === editing?.providerId);
  const profileList = Object.values(profiles);
  const activeProfile = activeProfileId ? profiles[activeProfileId] : undefined;

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <Box className="w-6 h-6 text-[var(--color-primary)]" />
              {lang === 'en' ? 'Profiles' : '配置档案'}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              {lang === 'en'
                ? 'One-click switch between provider + model + key combinations.'
                : '在 provider、模型、密钥组合之间一键切换。'}
            </p>
          </div>
          <button
            onClick={() => setEditing({ ...emptyProfile })}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            {lang === 'en' ? 'New Profile' : '新建 Profile'}
          </button>
        </div>

        {/* 快速切换激活 Profile */}
        {profileList.length > 0 && (
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl p-4 flex items-center gap-3 shadow-sm">
            <div className="flex items-center gap-2 shrink-0">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                activeProfile ? 'bg-emerald-500/10 text-emerald-500' : 'bg-gray-500/10 text-gray-500'
              }`}>
                <Power className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-muted)] font-medium">{lang === 'en' ? 'Active Profile' : '当前激活'}</div>
                <div className="text-sm font-bold text-[var(--color-text-primary)]">
                  {activeProfile?.name || (lang === 'en' ? 'None' : '未激活')}
                </div>
              </div>
            </div>
            <select
              value={activeProfileId || ''}
              onChange={e => e.target.value && handleActivate(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)] font-semibold focus:border-[var(--color-primary)] focus:outline-none cursor-pointer transition-colors"
            >
              <option value="" disabled>{lang === 'en' ? 'Select a profile to activate...' : '选择要激活的 Profile...'}</option>
              {profileList.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.providerId}{p.model ? ` · ${p.model}` : ''})</option>
              ))}
            </select>
          </div>
        )}

        {editing && (
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {editing.id && profiles[editing.id] ? (lang === 'en' ? 'Edit Profile' : '编辑 Profile') : (lang === 'en' ? 'New Profile' : '新建 Profile')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">ID</label>
                <input
                  value={editing.id}
                  disabled={!!profiles[editing.id]}
                  onChange={(e) => setEditing({ ...editing, id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)] disabled:opacity-50"
                  placeholder="e.g. claude-pro"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">{lang === 'en' ? 'Name' : '名称'}</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">Provider</label>
                <select
                  value={editing.providerId}
                  onChange={(e) => setEditing({ ...editing, providerId: e.target.value, model: '' })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
                >
                  <option value="">{lang === 'en' ? 'Select provider' : '选择 provider'}</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">{lang === 'en' ? 'Model' : '模型'}</label>
                <select
                  value={editing.model || ''}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
                >
                  <option value="">{lang === 'en' ? 'Default model' : '默认模型'}</option>
                  {selectedProvider?.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">API Key</label>
                <input
                  type="password"
                  value={editing.apiKey || ''}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)] font-mono"
                  placeholder={lang === 'en' ? 'Optional' : '可选'}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">API Key Env</label>
                <input
                  value={editing.apiKeyEnv || ''}
                  onChange={(e) => setEditing({ ...editing, apiKeyEnv: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
                  placeholder="e.g. ANTHROPIC_API_KEY"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">{lang === 'en' ? 'Description' : '描述'}</label>
                <input
                  value={editing.description || ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">{lang === 'en' ? 'Fallback Provider IDs (comma separated)' : 'Fallback Provider ID（逗号分隔）'}</label>
                <input
                  value={(editing.fallbackProviderIds || []).join(', ')}
                  onChange={(e) => setEditing({ ...editing, fallbackProviderIds: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1">
                  <GitBranch className="w-3 h-3" />
                  {lang === 'en' ? 'Tool Routing (regex pattern → provider/model)' : '工具路由（正则 → provider/model）'}
                </label>
                <div className="space-y-2">
                  {(editing.toolRouting || []).map((tr, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs bg-[var(--color-bg-base)] px-3 py-2 rounded-lg border border-[var(--color-border-base)]">
                      <span className="font-mono text-[var(--color-text-secondary)]">{tr.pattern}</span>
                      <span className="text-[var(--color-text-muted)]">→</span>
                      <span className="text-[var(--color-text-primary)]">{tr.providerId}{tr.model ? ` / ${tr.model}` : ''}</span>
                      <button onClick={() => removeToolRoute(idx)} className="ml-auto hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      placeholder="e.g. mcp__filesystem__.*"
                      value={toolRoute.pattern}
                      onChange={(e) => setToolRoute({ ...toolRoute, pattern: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)] font-mono"
                    />
                    <select
                      value={toolRoute.providerId}
                      onChange={(e) => setToolRoute({ ...toolRoute, providerId: e.target.value })}
                      className="px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
                    >
                      <option value="">{lang === 'en' ? 'Provider' : 'Provider'}</option>
                      {providers.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                    <input
                      placeholder={lang === 'en' ? 'Model (optional)' : '模型（可选）'}
                      value={toolRoute.model}
                      onChange={(e) => setToolRoute({ ...toolRoute, model: e.target.value })}
                      className="w-40 px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-base)] text-sm text-[var(--color-text-primary)]"
                    />
                    <button
                      onClick={addToolRoute}
                      className="flex items-center gap-1 px-3 py-2 bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] rounded-lg text-sm hover:text-[var(--color-text-primary)]"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {loading ? (lang === 'en' ? 'Saving...' : '保存中...') : (lang === 'en' ? 'Save' : '保存')}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] rounded-lg text-sm font-medium hover:text-[var(--color-text-primary)]"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profileList.length === 0 && (
            <div className="md:col-span-2 text-center py-12 text-[var(--color-text-muted)] text-sm">
              {lang === 'en' ? 'No profiles yet. Create one to switch providers quickly.' : '暂无 Profile，创建一个以快速切换 provider。'}
            </div>
          )}
          {profileList.map((p) => (
            <div
              key={p.id}
              className={`bg-[var(--color-bg-card)] border rounded-xl p-4 transition-all hover:shadow-md ${activeProfileId === p.id ? 'border-[var(--color-primary)] shadow-sm' : 'border-[var(--color-border-base)]'}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--color-text-primary)]">{p.name}</h3>
                    {activeProfileId === p.id && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
                        {lang === 'en' ? 'Active' : '已激活'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{p.description || p.id}</p>
                </div>
                <div className="flex items-center gap-1">
                  {activeProfileId !== p.id && (
                    <button
                      onClick={() => handleActivate(p.id)}
                      title={lang === 'en' ? 'Activate' : '激活'}
                      className="p-1.5 rounded-lg hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setEditing({ ...p })}
                    title={lang === 'en' ? 'Edit' : '编辑'}
                    className="p-1.5 rounded-lg hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    title={lang === 'en' ? 'Delete' : '删除'}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className="px-2 py-1 rounded-md bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]">{p.providerId}</span>
                {p.model && <span className="px-2 py-1 rounded-md bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]">{p.model}</span>}
                {p.apiKeyEnv && <span className="px-2 py-1 rounded-md bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]">env: {p.apiKeyEnv}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
