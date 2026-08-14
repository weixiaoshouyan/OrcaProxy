import { useEffect, useState, lazy, Suspense } from 'react';
import { Box, LayoutDashboard, MonitorPlay, Settings, Activity, GraduationCap, Search, ListTodo, Shield, Users, FlaskConical, X, Save, Check, RefreshCw } from 'lucide-react';
import { translate as t } from '../i18n';
import type { Language } from '../i18n';
import type { AppConfig } from '../types';
import { api } from '../api';
import { useToast } from './Toast';
import GeneralSettingsForm from './GeneralSettingsForm';

// Lazy-load the page components so they render INSIDE the modal's right pane
// (no navigation, no full-screen takeover). Reuses the app's existing lazy chunks.
const Dashboard = lazy(() => import('../pages/Dashboard'));
const Providers = lazy(() => import('../pages/Providers'));
const Apps = lazy(() => import('../pages/Apps'));
const McpPermissions = lazy(() => import('../pages/McpPermissions'));
const Skills = lazy(() => import('../pages/Skills'));
const Tasks = lazy(() => import('../pages/Tasks'));
const CodeSearch = lazy(() => import('../pages/CodeSearch'));
const EvalDashboard = lazy(() => import('../pages/EvalDashboard'));
const Profiles = lazy(() => import('../pages/Profiles'));
const Logs = lazy(() => import('../pages/Logs'));

interface SettingsItem {
  path: string;
  /** i18n key for the display name (menu.*). */
  nameKey: string;
  desc: string;
  descEn: string;
  icon: typeof Box;
}

interface SettingsGroup {
  /** i18n key for the group label (menu.group.*); empty for the top group. */
  labelKey: string;
  items: SettingsItem[];
}

const groups: SettingsGroup[] = [
  {
    labelKey: '',
    items: [
      {
        path: '/settings',
        nameKey: 'menu.general',
        desc: '端口、语言、缓存、外观等应用配置。',
        descEn: 'Port, language, cache, appearance and more.',
        icon: Settings,
      },
    ],
  },
  {
    labelKey: 'menu.group.stats',
    items: [
      {
        path: '/dashboard',
        nameKey: 'menu.dashboard',
        desc: '今日 Token 消耗、估算费用、请求趋势与拦截缓存统计。',
        descEn: 'Daily token usage, estimated cost, request trends and cache stats.',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    labelKey: 'menu.group.integration',
    items: [
      {
        path: '/providers',
        nameKey: 'menu.providers',
        desc: '配置上游模型供应商：API 密钥、模型路由、健康检查与模型同步。',
        descEn: 'Configure upstream providers: API keys, model routing, health checks and model sync.',
        icon: Box,
      },
      {
        path: '/apps',
        nameKey: 'menu.apps',
        desc: 'Codex CLI、Claude Desktop 与自定义 SDK 的接入指引。',
        descEn: 'Setup guides for Codex CLI, Claude Desktop and custom SDKs.',
        icon: MonitorPlay,
      },
      {
        path: '/mcp-permissions',
        nameKey: 'menu.mcp',
        desc: 'MCP 写工具的审批门禁与允许清单控制。',
        descEn: 'Approval gate and allowlist for MCP write tools.',
        icon: Shield,
      },
      {
        path: '/skills',
        nameKey: 'menu.skills',
        desc: '管理智能体技能库：安装、删除与查看技能详情。',
        descEn: 'Manage the agent skill library: install, delete and inspect skills.',
        icon: GraduationCap,
      },
    ],
  },
  {
    labelKey: 'menu.group.tasks',
    items: [
      {
        path: '/tasks',
        nameKey: 'menu.tasks',
        desc: '查看持久化的 Agent 任务，重试、恢复、归档或删除。',
        descEn: 'Browse persisted agent tasks; retry, resume, archive or delete.',
        icon: ListTodo,
      },
      {
        path: '/code-search',
        nameKey: 'menu.codeSearch',
        desc: '关键词与语义嵌入混合的代码库检索。',
        descEn: 'Keyword + semantic embedding hybrid codebase search.',
        icon: Search,
      },
      {
        path: '/eval',
        nameKey: 'menu.eval',
        desc: 'SWE-bench 风格的 Agent 评估面板。',
        descEn: 'SWE-bench style agent evaluation dashboard.',
        icon: FlaskConical,
      },
    ],
  },
  {
    labelKey: 'menu.group.ops',
    items: [
      {
        path: '/profiles',
        nameKey: 'menu.profiles',
        desc: '供应商/模型/密钥组合的配置档案，一键切换。',
        descEn: 'Provider + model + key profile combos with one-click switching.',
        icon: Users,
      },
      {
        path: '/logs',
        nameKey: 'menu.logs',
        desc: '请求审计日志：查看每次转发的模型、Token 与耗时。',
        descEn: 'Request audit logs: model, tokens and latency per request.',
        icon: Activity,
      },
    ],
  },
];

// Page components embedded into the right pane, keyed by their route path.
const pageComponents: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  '/dashboard': Dashboard,
  '/providers': Providers,
  '/apps': Apps,
  '/mcp-permissions': McpPermissions,
  '/skills': Skills,
  '/tasks': Tasks,
  '/code-search': CodeSearch,
  '/eval': EvalDashboard,
  '/profiles': Profiles,
  '/logs': Logs,
};

interface Props {
  open: boolean;
  onClose: () => void;
  lang: Language;
  isDark: boolean;
  toggleTheme: () => void;
  accent: string;
  setAccent: (a: string) => void;
  theme: string;
  setTheme: (t: string) => void;
}

/**
 * Settings center — two-pane dialog. Clicking ANY left item switches the right
 * pane inline (embedded page component); nothing navigates, nothing takes over
 * the whole window. General settings render an editable form with Save/Revert.
 */
export default function SettingsModal({ open, onClose, lang, isDark, toggleTheme, accent, setAccent, theme, setTheme }: Props) {
  const toast = useToast();
  const [activePath, setActivePath] = useState<string>('/settings');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isEn = lang === 'en';

  // Load config when the modal opens (general-settings pane).
  useEffect(() => {
    if (!open) return;
    api.get('/api/config').then(res => setConfig(res.data)).catch(() => setConfig(null));
  }, [open]);

  // Reset to General when the modal opens.
  useEffect(() => {
    if (open) setActivePath('/settings');
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      await api.post('/api/config', config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      toast.error(t('settings.save.failed', lang));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevert = () => {
    api.get('/api/config').then(res => setConfig(res.data)).catch(() => {});
  };

  const isGeneral = activePath === '/settings';
  const PageComp = pageComponents[activePath];

  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-[900px] max-w-[95vw] h-[660px] max-h-[88vh] bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl shadow-[var(--shadow-lg)] overflow-hidden animate-in zoom-in-95 fade-in duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-base)] shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="orca-gradient-tile w-7 h-7 rounded-lg flex items-center justify-center text-white">
              <Settings className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-[var(--color-text-primary)]">
              {isEn ? 'Settings' : '设置'}
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

        {/* Two-pane body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: category navigation */}
          <div className="w-52 shrink-0 border-r border-[var(--color-border-base)] overflow-y-auto py-3 px-2.5 space-y-0.5 bg-[var(--color-bg-base)]/40">
            {groups.map((group) => (
              <div key={group.labelKey || 'top'} className={group.labelKey ? 'mt-3.5' : ''}>
                {group.labelKey && (
                  <div className="px-2.5 pb-1 text-[9.5px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] select-none">
                    {t(group.labelKey, lang)}
                  </div>
                )}
                {group.items.map((item) => {
                  const isActive = item.path === activePath;
                  return (
                    <button
                      key={item.path}
                      onClick={() => setActivePath(item.path)}
                      className={`orca-conv-item ${isActive ? 'orca-conv-item-active' : ''} w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-medium transition-all cursor-pointer text-left ${
                        isActive
                          ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] font-semibold shadow-[var(--shadow-xs)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]/60 hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      <item.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`} />
                      <span className="truncate flex-1">{t(item.nameKey, lang)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Right: embedded content of the selected category */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 overflow-y-auto">
              {isGeneral ? (
                <div className="p-6">
                  {config ? (
                    <GeneralSettingsForm
                      config={config}
                      setConfig={setConfig}
                      lang={lang}
                      isDark={isDark}
                      toggleTheme={toggleTheme}
                      accent={accent}
                      setAccent={setAccent}
                      theme={theme}
                      setTheme={setTheme}
                    />
                  ) : (
                    <div className="h-40 flex items-center justify-center text-sm text-[var(--color-text-muted)] animate-pulse">
                      {isEn ? 'Loading configuration...' : '正在加载配置...'}
                    </div>
                  )}
                </div>
              ) : PageComp ? (
                <Suspense
                  fallback={
                    <div className="h-64 flex flex-col items-center justify-center gap-2 text-[var(--color-text-muted)]">
                      <div className="w-6 h-6 rounded-full border-2 border-[var(--color-border-base)] border-t-[var(--color-primary)] animate-spin" />
                      <span className="text-xs">{isEn ? 'Loading...' : '加载中...'}</span>
                    </div>
                  }
                >
                  <PageComp lang={lang} />
                </Suspense>
              ) : null}
            </div>

            {/* Save / Revert bar — only for the inline general-settings form */}
            {isGeneral && (
              <div className="px-6 py-3 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/40 flex items-center justify-between shrink-0">
                <span className="text-[10px] text-[var(--color-text-muted)] select-none">
                  {isEn ? 'Changes apply after clicking Save' : '点击保存后生效'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRevert}
                    className="px-4 py-2 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)] text-xs font-bold text-[var(--color-text-secondary)] transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> {t('settings.revert', lang)}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !config}
                    className={`orca-btn-primary px-5 py-2 rounded-lg text-xs font-bold text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:shadow-none ${saved ? '!bg-green-600' : ''}`}
                  >
                    {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                    {saved ? t('settings.save.success', lang) : (isSaving ? t('settings.saving', lang) : t('settings.save', lang))}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/40 text-[10px] text-[var(--color-text-muted)] select-none shrink-0">
          {isEn ? 'Everything is edited right here · ESC to close' : '所有设置都在这里直接完成 · ESC 关闭'}
        </div>
      </div>
    </div>
  );
}
