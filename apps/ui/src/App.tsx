import React, { useState, useEffect, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { Box, Sun, Moon, ArrowLeft } from 'lucide-react';
import { getLanguage } from './i18n';
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

function AppContent({
  isDark,
  toggleTheme,
  lang,
  setLang,
  accent,
  setAccent,
  theme,
  setTheme
}: {
  isDark: boolean,
  toggleTheme: () => void,
  lang: Language,
  setLang: (lang: Language) => void,
  accent: string,
  setAccent: (a: string) => void,
  theme: string,
  setTheme: (t: string) => void
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isChatRoute = location.pathname.startsWith('/chat');

  // Ctrl+, — jump to settings from anywhere (chat is the main interface).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        navigate('/settings');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--color-bg-base)] transition-colors duration-300">
      {/* 窗口拖拽条：titleBarStyle: 'hidden' 后必须提供 -webkit-app-region: drag 区域才能拖动窗口。
          左右按钮区为 no-drag。聊天页全屏时设置入口在聊天页左侧栏底部；设置页全屏打开后
          通过左侧的"返回聊天"回到主界面。 */}
      <div
        className="h-[38px] shrink-0 w-full flex items-center px-4 border-b border-[var(--color-border-base)] bg-[var(--color-bg-sidebar)]/80 backdrop-blur-xl select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <span className="orca-gradient-tile orca-sonar w-[22px] h-[22px] rounded-[7px] flex items-center justify-center text-white shrink-0">
            <Box className="w-3.5 h-3.5" />
          </span>
          <span className="orca-wordmark text-[13px] font-extrabold tracking-tight">
            Orca
            <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border-base)]">
              {lang === 'en' ? 'Agent' : '智能代理'}
            </span>
          </span>
          {!isChatRoute && (
            <button
              onClick={() => navigate('/chat')}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer border border-[var(--color-border-base)]"
              title={lang === 'en' ? 'Back to Chat' : '返回聊天'}
            >
              <ArrowLeft className="w-3 h-3" />
              <span>{lang === 'en' ? 'Chat' : '聊天'}</span>
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer"
            title={isDark ? (lang === 'en' ? 'Switch to light mode' : '切换到浅色模式') : (lang === 'en' ? 'Switch to dark mode' : '切换到深色模式')}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div className="flex flex-1 min-h-0">
        <main className={`flex-1 text-[var(--color-text-primary)] h-full min-w-0 transition-all duration-300 ${
          isChatRoute ? 'p-0 overflow-hidden' : 'px-10 py-8 overflow-y-auto'
        }`}>
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/dashboard" element={<Dashboard lang={lang} />} />
              <Route path="/chat" element={<Chat lang={lang} isDark={isDark} toggleTheme={toggleTheme} accent={accent} setAccent={setAccent} theme={theme} setTheme={setTheme} />} />
              <Route path="/apps" element={<Apps lang={lang} />} />
              <Route path="/providers" element={<Providers lang={lang} />} />
              <Route path="/settings" element={<SettingsPage lang={lang} setLang={setLang} isDark={isDark} toggleTheme={toggleTheme} accent={accent} setAccent={setAccent} theme={theme} setTheme={setTheme} />} />
              <Route path="/logs" element={<Logs lang={lang} />} />
              <Route path="/profiles" element={<Profiles />} />
              <Route path="/mcp-permissions" element={<McpPermissions />} />
              <Route path="/code-search" element={<CodeSearch />} />
              <Route path="/eval" element={<EvalDashboard />} />
              <Route path="/skills" element={<Skills lang={lang} />} />
              <Route path="/tasks" element={<Tasks />} />
            </Routes>
          </Suspense>
        </main>
      </div>
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
    return localStorage.getItem('orca_accent') || 'orca';
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
        accent={accent}
        setAccent={setAccent}
        theme={theme}
        setTheme={selectTheme}
      />
    </HashRouter></ErrorBoundary>
  );
}

export default App;
