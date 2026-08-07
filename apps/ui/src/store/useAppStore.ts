/**
 * Global application store powered by Zustand.
 *
 * Replaces scattered useState + localStorage + CustomEvent patterns.
 * State that was previously duplicated across Chat.tsx, App.tsx, etc.
 * is now centralized here with automatic localStorage persistence.
 */

import { create } from 'zustand';
import type {
  Conversation,
  Workspace,
  ContextTokenInfo,
} from '../types';

// ── Store types ────────────────────────────────────────────────────────

interface AppStore {
  // Theme
  isDark: boolean;
  toggleTheme: () => void;
  setDark: (dark: boolean) => void;

  // Sidebar collapse
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Language
  language: 'zh' | 'en';
  setLanguage: (lang: 'zh' | 'en') => void;

  // Workspaces
  workspaces: Workspace[];
  activeWorkspaceId: string;
  setWorkspaces: (ws: Workspace[]) => void;
  setActiveWorkspaceId: (id: string) => void;
  addWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => void;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => void;

  // Conversations
  conversations: Conversation[];
  activeConversationId: string;
  setConversations: (convs: Conversation[]) => void;
  setActiveConversationId: (id: string) => void;
  upsertConversation: (conv: Conversation) => void;
  deleteConversation: (id: string) => void;

  // Chat UI state
  useAgent: boolean;
  toggleUseAgent: () => void;
  activeSkillId: string;
  setActiveSkillId: (id: string) => void;

  // Right sidebar
  rightSidebarOpen: boolean;
  rightSidebarTab: 'tasks' | 'files' | 'git';
  rightSidebarWidth: number;
  setRightSidebarOpen: (open: boolean) => void;
  setRightSidebarTab: (tab: 'tasks' | 'files' | 'git') => void;
  setRightSidebarWidth: (w: number) => void;

  // History sidebar
  historySidebarWidth: number;
  setHistorySidebarWidth: (w: number) => void;

  // Context tokens
  contextTokens: ContextTokenInfo;
  setContextTokens: (info: ContextTokenInfo) => void;

  // Loading state (per conversation)
  loadingChats: Record<string, boolean>;
  setLoadingChat: (id: string, loading: boolean) => void;
}

// ── localStorage helpers ───────────────────────────────────────────────

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable — fail silently
  }
}

// ── Store implementation ───────────────────────────────────────────────

export const useAppStore = create<AppStore>((set, get) => ({
  // Theme
  isDark: (() => {
    const saved = localStorage.getItem('theme');
    return saved
      ? saved === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  })(),
  toggleTheme: () => {
    const next = !get().isDark;
    set({ isDark: next });
    localStorage.setItem('theme', next ? 'dark' : 'light');
  },
  setDark: (dark) => {
    set({ isDark: dark });
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  },

  // Sidebar
  isSidebarCollapsed: localStorage.getItem('orca_sidebar_collapsed') === 'true',
  toggleSidebar: () => {
    const next = !get().isSidebarCollapsed;
    set({ isSidebarCollapsed: next });
    localStorage.setItem('orca_sidebar_collapsed', String(next));
  },

  // Language
  language: (() => {
    const saved = localStorage.getItem('language');
    return saved === 'en' || saved === 'zh' ? saved : 'zh';
  })(),
  setLanguage: (lang) => {
    set({ language: lang });
    localStorage.setItem('language', lang);
  },

  // Workspaces
  workspaces: loadJSON<Workspace[]>('orca_workspaces', []),
  activeWorkspaceId: localStorage.getItem('orca_active_ws') || '',
  setWorkspaces: (ws) => {
    set({ workspaces: ws });
    saveJSON('orca_workspaces', ws);
  },
  setActiveWorkspaceId: (id) => {
    set({ activeWorkspaceId: id });
    if (id) localStorage.setItem('orca_active_ws', id);
  },
  addWorkspace: (ws) => {
    const updated = [...get().workspaces, ws];
    set({ workspaces: updated, activeWorkspaceId: ws.id });
    saveJSON('orca_workspaces', updated);
    localStorage.setItem('orca_active_ws', ws.id);
  },
  removeWorkspace: (id) => {
    const updated = get().workspaces.filter((w) => w.id !== id);
    const newActive =
      get().activeWorkspaceId === id
        ? updated[0]?.id ?? ''
        : get().activeWorkspaceId;
    set({ workspaces: updated, activeWorkspaceId: newActive });
    saveJSON('orca_workspaces', updated);
    if (newActive) localStorage.setItem('orca_active_ws', newActive);
  },
  updateWorkspace: (id, updates) => {
    const updated = get().workspaces.map((w) =>
      w.id === id ? { ...w, ...updates } : w
    );
    set({ workspaces: updated });
    saveJSON('orca_workspaces', updated);
  },

  // Conversations
  conversations: loadJSON<Conversation[]>('orca_conversations', []),
  activeConversationId: '',
  setConversations: (convs) => {
    set({ conversations: convs });
    saveJSON('orca_conversations', convs);
  },
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  upsertConversation: (conv) => {
    const existing = get().conversations;
    const idx = existing.findIndex((c) => c.id === conv.id);
    const updated =
      idx >= 0
        ? existing.map((c) => (c.id === conv.id ? conv : c))
        : [conv, ...existing];
    set({ conversations: updated });
    saveJSON('orca_conversations', updated);
  },
  deleteConversation: (id) => {
    const updated = get().conversations.filter((c) => c.id !== id);
    const newActive =
      get().activeConversationId === id
        ? updated[0]?.id ?? ''
        : get().activeConversationId;
    set({ conversations: updated, activeConversationId: newActive });
    saveJSON('orca_conversations', updated);
  },

  // Chat UI
  useAgent: true,
  toggleUseAgent: () => set((s) => ({ useAgent: !s.useAgent })),
  activeSkillId: '',
  setActiveSkillId: (id) => set({ activeSkillId: id }),

  // Right sidebar
  rightSidebarOpen: localStorage.getItem('orca_right_sidebar_open') !== 'false',
  rightSidebarTab: 'tasks',
  rightSidebarWidth: parseInt(
    localStorage.getItem('orca_right_sidebar_width') || '300'
  ),
  setRightSidebarOpen: (open) => {
    set({ rightSidebarOpen: open });
    localStorage.setItem('orca_right_sidebar_open', String(open));
  },
  setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),
  setRightSidebarWidth: (w) => {
    set({ rightSidebarWidth: w });
    localStorage.setItem('orca_right_sidebar_width', String(w));
  },

  // History sidebar
  historySidebarWidth: parseInt(
    localStorage.getItem('orca_chat_history_width') || '220'
  ),
  setHistorySidebarWidth: (w) => {
    set({ historySidebarWidth: w });
    localStorage.setItem('orca_chat_history_width', String(w));
  },

  // Context tokens
  contextTokens: { used: 0, total: 0, percent: 0 },
  setContextTokens: (info) => set({ contextTokens: info }),

  // Loading
  loadingChats: {},
  setLoadingChat: (id, loading) =>
    set((s) => ({
      loadingChats: { ...s.loadingChats, [id]: loading },
    })),
}));
