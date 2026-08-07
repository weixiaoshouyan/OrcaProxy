import React, { useState, useEffect, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { api } from './api';
import { LayoutDashboard, MessageSquare, MonitorPlay, Box, Settings, Activity, Sun, Moon, PanelLeftOpen, PanelLeftClose, GraduationCap } from 'lucide-react';
import { translate as t, getLanguage } from './i18n';
import type { Language } from './i18n';

import { PageSkeleton } from './components/Skeleton';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Chat = lazy(() => import('./pages/Chat'));
const Apps = lazy(() => import('./pages/Apps'));
const Providers = lazy(() => import('./pages/Providers'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Logs = lazy(() => import('./pages/Logs'));
const Skills = lazy(() => import('./pages/Skills'));
const Profiles = lazy(() => import('./pages/Profiles'));
const McpPermissions = lazy(() => import('./pages/McpPermissions'));
const CodeSearch = lazy(() => import('./pages/CodeSearch'));
const EvalDashboard = lazy(() => import('./pages/EvalDashboard'));
const Tasks = lazy(() => import('./pages/Tasks'));

function Sidebar({ 
  isDark, 
  toggleTheme, 
  lang,
  isCollapsed,
  toggleCollapse,
  accent,
  setAccent,
  theme,
  setTheme
}: { 
  isDark: boolean, 
  toggleTheme: () => void, 
  lang: Language,
  isCollapsed: boolean,
  toggleCollapse: () => void,
  accent: string,
  setAccent: (a: string) => void,
  theme: string,
  setTheme: (t: string) => void
}) {
  const navItems = [
    { name: t('menu.dashboard', lang), path: '/dashboard', icon: LayoutDashboard },
    { name: t('menu.chat', lang), path: '/chat', icon: MessageSquare },
    { name: t('menu.apps', lang), path: '/apps', icon: MonitorPlay },
    { name: t('menu.providers', lang), path: '/providers', icon: Box },
    { name: t('menu.skills', lang), path: '/skills', icon: GraduationCap },
    { name: t('menu.settings', lang), path: '/settings', icon: Settings },
    { name: t('menu.logs', lang), path: '/logs', icon: Activity },
  ];

  return (
    <div className={`h-full bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border-base)] flex flex-col transition-all duration-300 shrink-0 ${
      isCollapsed ? 'w-[72px]' : 'w-[240px]'
    }`}>
      {/* Header */}
      <div className={`p-4 border-b border-[var(--color-border-base)] flex items-center justify-between gap-2 ${
        isCollapsed ? 'flex-col py-6' : 'flex-row'
      }`}>
        {!isCollapsed ? (
          <div>
            <h1 className="text-xl font-extrabold text-[var(--color-primary)] flex items-center gap-2 tracking-tight">
              <Box className="w-6 h-6 shrink-0" /> Orca
            </h1>
            <div className="text-xs text-[var(--color-text-muted)] mt-1.5 font-medium">Universal Proxy v2.1.0</div>
          </div>
        ) : (
          <Box className="w-6 h-6 text-[var(--color-primary)]" />
        )}
        <button 
          onClick={toggleCollapse}
          className={`p-1.5 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-base)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer ${
            isCollapsed ? 'mt-2' : ''
          }`}
          title={isCollapsed ? (lang === 'en' ? 'Expand' : '展开') : (lang === 'en' ? 'Collapse' : '收起')}
        >
          {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
      
      {/* Navigation */}
      <div className="flex-1 py-5 px-3 space-y-1 overflow-y-auto">
        {!isCollapsed && (
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold px-3 mb-3">
            Menu
          </div>
        )}
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center rounded-xl text-[13px] font-medium transition-all duration-200 ${
                isCollapsed ? 'justify-center p-2.5 w-10 h-10 mx-auto' : 'gap-3 px-3 py-2.5'
              } ${
                isActive 
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold shadow-sm' 
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`
            }
            title={isCollapsed ? item.name : undefined}
          >
            <item.icon className="w-[18px] h-[18px] shrink-0" />
            {!isCollapsed && <span>{item.name}</span>}
          </NavLink>
        ))}
      </div>
      
      {/* Bottom Settings & Status */}
      <div className="p-4 border-t border-[var(--color-border-base)] space-y-3">
        <button 
          onClick={toggleTheme}
          className={`flex items-center rounded-xl text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-all duration-200 ${
            isCollapsed ? 'w-10 h-10 justify-center mx-auto' : 'w-full justify-between px-3 py-2.5'
          }`}
          title={isCollapsed ? (lang === 'en' ? 'Toggle theme' : '切换主题') : undefined}
        >
          {isCollapsed ? (
            isDark ? <Moon className="w-[18px] h-[18px]" /> : <Sun className="w-[18px] h-[18px]" />
          ) : (
            <>
              <div className="flex items-center gap-3">
                {isDark ? <Moon className="w-[18px] h-[18px]" /> : <Sun className="w-[18px] h-[18px]" />}
                <span>{t('sidebar.appearance', lang)}</span>
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-bg-base)] px-2 py-0.5 rounded-md border border-[var(--color-border-base)]">
                {isDark ? 'DARK' : 'LIGHT'}
              </div>
            </>
          )}
        </button>

        {!isCollapsed && (
          <div className="flex items-center gap-1.5 px-1 pt-0.5">
            {[
              { id: 'green', cls: 'bg-green-500' },
              { id: 'blue', cls: 'bg-blue-500' },
              { id: 'purple', cls: 'bg-purple-500' },
              { id: 'amber', cls: 'bg-amber-500' },
              { id: 'rose', cls: 'bg-rose-500' },
              { id: 'teal', cls: 'bg-teal-500' },
              { id: 'slate', cls: 'bg-slate-500' },
              { id: 'nocturne', cls: 'bg-indigo-500' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => setAccent(c.id)}
                className={`w-5 h-5 rounded-full ${c.cls} transition-all cursor-pointer ${
                  accent === c.id ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-base)] ring-[var(--color-text-secondary)] scale-110' : 'opacity-60 hover:opacity-100'
                }`}
                title={c.id}
              />
            ))}
          </div>
        )}

        {/* Theme presets */}
        {!isCollapsed && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border-base)]">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold px-1 pb-2">
              {lang === 'en' ? 'Theme' : '主题'}
            </div>
            <div className="grid grid-cols-2 gap-1.5 px-1">
              {[
                { id: 'classic', label: lang === 'en' ? 'Classic' : '经典' },
                { id: 'dracula', label: 'Dracula' },
                { id: 'nord', label: 'Nord' },
                { id: 'catppuccin', label: 'Catppuccin' },
                { id: 'one-dark', label: 'One Dark' },
                { id: 'midnight', label: 'Midnight' },
                { id: 'solarized', label: 'Solarized' },
              ].map((th) => (
                <button
                  key={th.id}
                  onClick={() => setTheme(th.id)}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                    theme === th.id
                      ? 'bg-[var(--color-primary)]/15 border-[var(--color-primary)]/50 text-[var(--color-primary)]'
                      : 'bg-[var(--color-bg-base)] border-[var(--color-border-base)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  {th.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div 
          className={`flex items-center rounded-xl bg-[var(--color-bg-base)] border border-[var(--color-border-base)] ${
            isCollapsed ? 'w-10 h-10 justify-center mx-auto' : 'px-3 py-2 gap-2.5'
          }`}
          title={isCollapsed ? (lang === 'en' ? 'Service Running' : '服务运行中') : undefined}
        >
          <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse shrink-0"></span>
          {!isCollapsed && (
            <span className="text-xs font-semibold text-green-600 dark:text-green-400">
              {t('sidebar.running', lang)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AppContent({
  isDark,
  toggleTheme,
  lang,
  setLang,
  isCollapsed,
  toggleCollapse,
  accent,
  setAccent,
  theme,
  setTheme
}: {
  isDark: boolean,
  toggleTheme: () => void,
  lang: Language,
  setLang: (lang: Language) => void,
  isCollapsed: boolean,
  toggleCollapse: () => void,
  accent: string,
  setAccent: (a: string) => void,
  theme: string,
  setTheme: (t: string) => void
}) {
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith('/chat');

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-bg-base)] transition-colors duration-300">
      <Sidebar 
        isDark={isDark} 
        toggleTheme={toggleTheme} 
        lang={lang} 
        isCollapsed={isCollapsed}
        toggleCollapse={toggleCollapse}
        accent={accent}
        setAccent={setAccent}
        theme={theme}
        setTheme={setTheme}
      />
      <main className={`flex-1 text-[var(--color-text-primary)] h-full min-w-0 transition-all duration-300 ${
        isChatRoute ? 'p-0 overflow-hidden' : 'px-10 py-8 overflow-y-auto'
      }`}>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/dashboard" element={<Dashboard lang={lang} />} />
            <Route path="/chat" element={<Chat lang={lang} />} />
            <Route path="/apps" element={<Apps lang={lang} />} />
            <Route path="/providers" element={<Providers lang={lang} />} />
            <Route path="/skills" element={<Skills lang={lang} />} />
            <Route path="/settings" element={<SettingsPage lang={lang} setLang={setLang} />} />
            <Route path="/logs" element={<Logs lang={lang} />} />
            <Route path="/profiles" element={<Profiles />} />
            <Route path="/mcp-permissions" element={<McpPermissions />} />
            <Route path="/code-search" element={<CodeSearch />} />
            <Route path="/eval" element={<EvalDashboard />} />
            <Route path="/tasks" element={<Tasks />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}


// Error Boundary component for catching render errors
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40, fontFamily: 'system-ui, sans-serif',
          color: 'var(--color-error)',
          background: 'var(--color-bg-base)',
          minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ maxWidth: 500, textAlign: 'center' }}>
            <h2 style={{ fontSize: 24, marginBottom: 8, fontWeight: 700, color: 'var(--color-text-primary)' }}>Application Error</h2>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
              An unexpected error occurred. Your data is safe — try reloading.
            </p>
            <pre style={{
              whiteSpace: 'pre-wrap', fontSize: 12, textAlign: 'left',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-bg-card)',
              padding: 16, borderRadius: 12, marginBottom: 20, maxHeight: 200, overflow: 'auto',
              border: '1px solid var(--color-border-base)',
            }}>
              {this.state.error?.message || 'Unknown error'}
            </pre>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.hash = '#/'; window.location.reload(); }}
              style={{ padding: '10px 28px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [lang, setLang] = useState<Language>(getLanguage);

  const [accent, setAccent] = useState(() => {
    return localStorage.getItem('orca_accent') || 'green';
  });

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('orca_theme') || 'classic';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
    localStorage.setItem('orca_accent', accent);
  }, [accent]);

  useEffect(() => {
    if (theme === 'classic') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    localStorage.setItem('orca_theme', theme);
  }, [theme]);

  const selectTheme = (t: string) => {
    setTheme(t);
    if (t === 'classic') return;
    if (['dracula', 'one-dark', 'midnight'].includes(t)) {
      setIsDark(true);
    } else if (['nord', 'catppuccin', 'solarized'].includes(t)) {
      setIsDark(false);
    }
  };

  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem('orca_sidebar_collapsed') === 'true';
  });

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('orca_sidebar_collapsed', String(next));
      return next;
    });
  };

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      api.post('/api/theme', { theme: 'dark' }).catch(() => {});
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      api.post('/api/theme', { theme: 'light' }).catch(() => {});
    }
  }, [isDark]);

  useEffect(() => {
    api.get('/api/config').then(res => {
      if (res.data && res.data.language) {
        const backendLang = res.data.language;
        if (backendLang === 'en' || backendLang === 'zh') {
          setLang(backendLang);
          localStorage.setItem('language', backendLang);
        }
      }
    }).catch(console.error);
  }, []);

  return (
    <ErrorBoundary><HashRouter>
      <AppContent 
        isDark={isDark}
        toggleTheme={() => setIsDark(!isDark)}
        lang={lang}
        setLang={setLang}
        isCollapsed={isCollapsed}
        toggleCollapse={toggleCollapse}
        accent={accent}
        setAccent={setAccent}
        theme={theme}
        setTheme={selectTheme}
      />
    </HashRouter></ErrorBoundary>
  );
}

export default App;
