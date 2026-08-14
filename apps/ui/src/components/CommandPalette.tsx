// frontend/src/components/CommandPalette.tsx
// 全局命令面板 (Ctrl+K) - 快速跳转、切换模型、新建对话
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MessageSquare, Plus, Settings, BarChart2, MonitorPlay, Box, Layers, Shield, Search as SearchIcon, Beaker, ListTodo, GraduationCap, Activity, FileCode } from 'lucide-react';
import { useShortcuts } from '../hooks/useShortcuts';
import type { Language } from '../i18n';

interface CommandItem {
  id: string;
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
  action: () => void;
  group: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNewChat?: () => void;
  onNewBuildPlan?: () => void;
  onClearContext?: () => void;
  lang?: Language;
}

export function CommandPalette({ open, onClose, onNewChat, onNewBuildPlan, onClearContext, lang }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const isEn = lang === 'en';
  const L = {
    nav: isEn ? 'Navigation' : '导航',
    actions: isEn ? 'Actions' : '动作',
    search: isEn ? 'Search commands, pages, actions...' : '搜索命令、页面、动作...',
    empty: isEn ? 'No matching commands' : '没有匹配的命令',
    newChat: isEn ? 'New Chat' : '新建对话',
    buildPlan: isEn ? 'Build/Plan Mode' : 'Build/Plan 模式',
    buildPlanDesc: isEn ? 'Toggle Build/Plan mode' : '激活 Build/Plan 模式',
    clearCtx: isEn ? 'Clear current context' : '清空当前对话上下文',
    chat: isEn ? 'Chat' : '聊天',
    dashboard: isEn ? 'Dashboard' : '仪表盘',
    apps: isEn ? 'App Integrations' : '应用管理',
    providers: isEn ? 'Providers' : '模型提供商',
    skills: isEn ? 'Skills' : '技能管理',
    settings: isEn ? 'Settings' : '设置',
    logs: isEn ? 'Logs' : '请求日志',
    tasks: isEn ? 'Agent Tasks' : 'Agent 任务',
    select: isEn ? 'Select' : '选择',
    confirm: isEn ? 'Confirm' : '确认',
    close: isEn ? 'Close' : '关闭',
  };

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const items: CommandItem[] = useMemo(() => {
    const navItems: CommandItem[] = [
      { id: 'nav.chat', title: L.chat, icon: MessageSquare, action: () => navigate('/chat'), group: L.nav },
      { id: 'nav.dashboard', title: L.dashboard, icon: BarChart2, action: () => navigate('/dashboard'), group: L.nav },
      { id: 'nav.apps', title: L.apps, icon: MonitorPlay, action: () => navigate('/apps'), group: L.nav },
      { id: 'nav.providers', title: L.providers, icon: Box, action: () => navigate('/providers'), group: L.nav },
      { id: 'nav.profiles', title: 'Profiles', description: isEn ? 'Switch/manage model profiles' : '切换/管理模型组合', icon: Layers, action: () => navigate('/profiles'), group: L.nav },
      { id: 'nav.mcp', title: 'MCP Permissions', icon: Shield, action: () => navigate('/mcp-permissions'), group: L.nav },
      { id: 'nav.codesearch', title: 'Code Search', icon: SearchIcon, action: () => navigate('/code-search'), group: L.nav },
      { id: 'nav.eval', title: 'Evaluation', icon: Beaker, action: () => navigate('/eval'), group: L.nav },
      { id: 'nav.tasks', title: L.tasks, icon: ListTodo, action: () => navigate('/tasks'), group: L.nav },
      { id: 'nav.skills', title: L.skills, icon: GraduationCap, action: () => navigate('/skills'), group: L.nav },
      { id: 'nav.settings', title: L.settings, icon: Settings, action: () => navigate('/settings'), group: L.nav },
      { id: 'nav.logs', title: L.logs, icon: Activity, action: () => navigate('/logs'), group: L.nav },
    ];
    const actions: CommandItem[] = [
      { id: 'act.newchat', title: L.newChat, icon: Plus, keywords: ['new', 'chat'], action: () => onNewChat?.(), group: L.actions },
      { id: 'act.buildplan', title: L.buildPlan, description: L.buildPlanDesc, icon: FileCode, keywords: ['plan', 'agent', 'build'], action: () => onNewBuildPlan?.(), group: L.actions },
      { id: 'act.clear', title: L.clearCtx, icon: Settings, keywords: ['clear', 'reset'], action: () => onClearContext?.(), group: L.actions },
    ];
    return [...actions, ...navItems];
  }, [navigate, onNewChat, onNewBuildPlan, onClearContext, L.nav, L.actions, L.chat, L.dashboard, L.apps, L.providers, L.tasks, L.skills, L.settings, L.logs, L.newChat, L.buildPlan, L.buildPlanDesc, L.clearCtx, isEn]);

  // Fuzzy scoring: subsequence token-order match, contiguous runs score higher.
  const fuzzyScore = (source: string, query: string): number => {
    const s = source.toLowerCase();
    const q = query.toLowerCase();
    if (s === q) return 1000;
    if (s.startsWith(q)) return 900 + s.length;
    let si = 0, qi = 0, score = 0, run = 0;
    while (qi < q.length && si < s.length) {
      if (s[si] === q[qi]) {
        run++;
        score += 10 + run * 3;
        qi++;
      } else {
        run = 0;
      }
      si++;
    }
    return qi === q.length ? score : -1;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const scored = items.map(it => {
      const scores = [
        fuzzyScore(it.title, q),
        it.keywords ? Math.max(...it.keywords.map(k => fuzzyScore(k, q))) : -1,
        it.description ? fuzzyScore(it.description, q) : -1,
      ];
      const best = Math.max(...scores);
      return { it, score: best };
    }).filter(x => x.score >= 0).sort((a, b) => b.score - a.score);
    return scored.map(x => x.it);
  }, [query, items]);

  // 分组
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const it of filtered) {
      if (!map.has(it.group)) map.set(it.group, []);
      map.get(it.group)!.push(it);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useShortcuts([
    { key: 'Escape', handler: onClose, preventDefault: true },
    {
      key: 'ArrowDown',
      handler: () => setActiveIndex(i => Math.min(filtered.length - 1, i + 1)),
      preventDefault: true,
    },
    {
      key: 'ArrowUp',
      handler: () => setActiveIndex(i => Math.max(0, i - 1)),
      preventDefault: true,
    },
    {
      key: 'Enter',
      handler: () => {
        const it = filtered[activeIndex];
        if (it) {
          it.action();
          onClose();
        }
      },
      preventDefault: true,
    },
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl shadow-[var(--shadow-lg)] overflow-hidden animate-in zoom-in-95 fade-in duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border-base)]">
          <Search className="w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={L.search}
            className="flex-1 bg-transparent outline-none text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)] border border-[var(--color-border-base)] rounded">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">
              {L.empty}
            </div>
          ) : grouped.map(([group, list]) => (
            <div key={group} className="mb-1">
              <div className="px-4 py-1.5 text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                {group}
              </div>
              {list.map((it) => {
                const globalIdx = filtered.indexOf(it);
                const isActive = globalIdx === activeIndex;
                const Icon = it.icon;
                return (
                  <button
                    key={it.id}
                    onClick={() => { it.action(); onClose(); }}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                    className={`w-full flex items-center gap-3 px-4 py-2 mx-1.5 text-left transition-colors rounded-lg ${
                      isActive ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{it.title}</div>
                      {it.description && <div className="text-[11px] text-[var(--color-text-muted)] truncate">{it.description}</div>}
                    </div>
                    {isActive && <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-current/30 rounded">↵</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50 flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 border border-[var(--color-border-base)] rounded">↑</kbd> <kbd className="px-1 border border-[var(--color-border-base)] rounded">↓</kbd> {L.select}</span>
            <span><kbd className="px-1 border border-[var(--color-border-base)] rounded">↵</kbd> {L.confirm}</span>
            <span><kbd className="px-1 border border-[var(--color-border-base)] rounded">ESC</kbd> {L.close}</span>
          </div>
          <span>Orca Command Palette</span>
        </div>
      </div>
    </div>
  );
}
