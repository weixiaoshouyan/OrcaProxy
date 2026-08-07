import { useState, useEffect } from 'react';
import { Terminal, Monitor, Code2, CheckCircle2, PlayCircle, Settings, Power } from 'lucide-react';
import { api } from '../api';
import type { Language } from '../i18n';
import type { ProviderInfo } from '../types';
import { useToast } from '../components/Toast';
import type { LucideIcon } from 'lucide-react';

interface AppsProps {
  lang: Language;
}

interface DiscoveredApp {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  path: string;
  isCustomPath?: boolean;
  icon: LucideIcon;
  color: string;
}

export default function Apps({ lang }: AppsProps) {
  const [apps, setApps] = useState<DiscoveredApp[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedApp, setSelectedApp] = useState<DiscoveredApp | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const toast = useToast();
  const [appOverrides, setAppOverrides] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('app_provider_overrides') || '{}');
    } catch {
      return {};
    }
  });

  const refreshAppsList = (updatedAppId?: string) => {
    api.get('/api/apps').then(res => {
      const rawApps: Array<Omit<DiscoveredApp, 'icon' | 'color'>> = res.data;
      const mappedApps: DiscoveredApp[] = rawApps.map((app) => ({
        ...app,
        icon: app.id === 'claude' || app.id.includes('desktop') ? Monitor : (app.id === 'cursor' || app.id === 'trae' || app.id === 'vscode' || app.id === 'cline' || app.id === 'roo-code' ? Code2 : Terminal),
        color: app.id.includes('claude') ? 'bg-orange-500' : (app.id === 'cursor' ? 'bg-blue-600' : (app.id === 'trae' ? 'bg-indigo-500' : (app.id === 'cline' ? 'bg-amber-600' : (app.id === 'roo-code' ? 'bg-purple-600' : 'bg-green-500'))))
      }));
      setApps(mappedApps);
      if (updatedAppId) {
        const updated = mappedApps.find((a) => a.id === updatedAppId);
        if (updated) setSelectedApp(updated);
      }
    }).catch(console.error);
  };

  useEffect(() => {
    refreshAppsList();

    api.get('/api/providers').then(res => {
      setProviders(res.data as ProviderInfo[]);
    }).catch(console.error);
  }, []);

  const handleLaunch = async (id: string) => {
    try {
      const providerId = appOverrides[id] || '';
      const payload = providerId ? { providerId } : {};

      const res = await api.post(`/api/apps/${id}/launch`, payload);
      toast.success(res.data.message || (lang === 'en' ? `Launched successfully! Proxy injected.` : `成功唤醒！已自动注入代理环境。`));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((lang === 'en' ? `Launch failed: ` : `唤醒失败: `) + msg);
    }
  };

  const openConfigModal = (app: DiscoveredApp) => {
    setSelectedApp(app);
    setIsConfigOpen(true);
  };

  const saveOverrideConfig = (providerId: string) => {
    if (!selectedApp) return;
    const newOverrides = { ...appOverrides };
    if (providerId) {
      newOverrides[selectedApp.id] = providerId;
    } else {
      delete newOverrides[selectedApp.id];
    }
    setAppOverrides(newOverrides);
    localStorage.setItem('app_provider_overrides', JSON.stringify(newOverrides));
    setIsConfigOpen(false);
  };

  const handleChooseAppPath = async () => {
    if (!selectedApp) return;
    try {
      const res = await api.post(`/api/apps/${selectedApp.id}/choose-path`);
      if (res.data.cancelled) return;
      if (res.data.ok && res.data.path) {
        refreshAppsList(selectedApp.id);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((lang === 'en' ? 'Failed to select path: ' : '自选路径失败: ') + msg);
    }
  };

  const handleClearAppPath = async () => {
    if (!selectedApp) return;
    const confirmMsg = lang === 'en' 
      ? 'Are you sure you want to clear the custom path and restore default system detection?' 
      : '您确定要清除该应用的自定义路径并恢复系统默认检测吗？';
    if (confirm(confirmMsg)) {
      try {
        await api.delete(`/api/apps/${selectedApp.id}/path`);
        refreshAppsList(selectedApp.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
      }
    }
  };

  return (
    <div className="animate-in fade-in duration-500 max-w-5xl">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">{lang === 'en' ? 'App Integrations (Apps)' : '应用管理 (Apps)'}</h2>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1.5">
          {lang === 'en' ? 'Automatically scan and manage local AI applications on your computer for plug-and-play experience.' : '自动扫描并接管您电脑上的本地 AI 工具，实现真正的零配置使用。'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {apps.map((app, i) => {
          const overridenProviderId = appOverrides[app.id];
          const overridenProvider = providers.find(p => p.id === overridenProviderId);
          
          return (
            <div key={i} className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl overflow-hidden group hover:border-[var(--color-primary)]/40 transition-colors flex flex-col">
              <div className="p-6 pb-5 flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md ${app.color}`}>
                    <app.icon className="w-6 h-6" />
                  </div>
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                    app.installed 
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20' 
                      : 'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border-base)]'
                  }`}>
                    {app.installed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                    {app.installed ? (lang === 'en' ? 'Installed' : '已安装') : (lang === 'en' ? 'Not Detected' : '未检测到')}
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">{app.name}</h3>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed h-[60px]">{app.description}</p>
                
                <div className="mt-4 p-3 rounded-xl bg-[var(--color-bg-base)] border border-[var(--color-border-base)]/50">
                  <div className="text-xs text-[var(--color-text-muted)] font-semibold mb-1">{lang === 'en' ? 'Mapping / Node Binding' : '接口映射 / 绑定节点'}</div>
                  <div className="text-xs font-semibold text-[var(--color-text-primary)]">
                    {overridenProvider 
                      ? (lang === 'en' ? `Bound: ${overridenProvider.name}` : `独立绑定: ${overridenProvider.name}`) 
                      : (lang === 'en' ? 'Follow System' : '跟随系统 (激活的主节点)')}
                  </div>
                  <code className="text-[10px] font-mono text-[var(--color-text-muted)] block mt-1.5 break-all max-h-12 overflow-y-auto">{app.path || (lang === 'en' ? 'Path not resolved' : '未获取到执行路径')}</code>
                </div>
              </div>
              
              <div className="border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50 p-4 flex gap-3">
                <button 
                  onClick={() => handleLaunch(app.id)}
                  disabled={!app.installed}
                  className="flex-1 flex items-center justify-center gap-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:bg-gray-500 disabled:opacity-50 text-white py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-[var(--color-primary)]/20 cursor-pointer"
                >
                  <PlayCircle className="w-4 h-4" /> {lang === 'en' ? 'Launch App' : '启动应用'}
                </button>
                <button 
                  onClick={() => openConfigModal(app)}
                  className="p-2 border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)] rounded-xl text-[var(--color-text-secondary)] transition-colors cursor-pointer" 
                  title={lang === 'en' ? 'Configure App Settings' : '配置应用设置'}
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* --- App Configuration Modal --- */}
      {isConfigOpen && selectedApp && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Settings className="w-5 h-5 text-[var(--color-primary)]" />
                {lang === 'en' ? `Configure ${selectedApp.name} Environment` : `配置 ${selectedApp.name} 运行环境`}
              </h3>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">{lang === 'en' ? 'Bind Upstream Provider' : '绑定运行提供商'}</label>
                <select 
                  defaultValue={appOverrides[selectedApp.id] || ''}
                  id="app-provider-select"
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl outline-none focus:border-[var(--color-primary)] text-sm transition-colors"
                >
                  <option value="">{lang === 'en' ? 'Follow System Default' : '跟随系统默认 (当前主激活节点)'}</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
                  {lang === 'en' 
                    ? 'Once set, when launching this app from here, its traffic will be forced through the selected provider, overriding system settings and routing rules.' 
                    : '设定后，当通过此界面启动该应用时，该应用内的流量将强行路由至选定的提供商，不受全局激活节点和路由规则影响。'}
                </p>
              </div>

              <div className="border-t border-[var(--color-border-base)]/55 pt-4">
                <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">
                  {lang === 'en' ? 'Custom Executable / Config Path' : '自定义可执行程序 / 配置文件路径'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    placeholder={lang === 'en' ? 'System default detection' : '未设置自定义路径，将使用系统默认检测'}
                    value={selectedApp.path || ''}
                    className="flex-1 px-3 py-2 bg-[var(--color-bg-sidebar)] border border-[var(--color-border-base)] rounded-xl text-xs font-mono text-[var(--color-text-secondary)] outline-none overflow-x-auto truncate"
                    title={selectedApp.path || ''}
                  />
                  <button
                    type="button"
                    onClick={handleChooseAppPath}
                    className="px-3.5 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-xl text-xs font-bold shadow-sm cursor-pointer transition-all shrink-0"
                  >
                    {lang === 'en' ? 'Browse...' : '自选路径...'}
                  </button>
                </div>
                {selectedApp.isCustomPath && (
                  <button
                    type="button"
                    onClick={handleClearAppPath}
                    className="mt-2 text-xs font-bold text-red-500 hover:text-red-600 cursor-pointer flex items-center gap-1 transition-colors"
                  >
                    {lang === 'en' ? 'Restore Default Detection' : '清除自定义路径 (恢复系统默认检测)'}
                  </button>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/30 flex justify-end gap-3">
              <button 
                onClick={() => setIsConfigOpen(false)}
                className="px-4 py-2 border border-[var(--color-border-base)] rounded-xl text-sm font-semibold hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button 
                onClick={() => {
                  const select = document.getElementById('app-provider-select') as HTMLSelectElement;
                  saveOverrideConfig(select.value);
                }}
                className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl text-sm font-semibold shadow-sm transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Save Settings' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
