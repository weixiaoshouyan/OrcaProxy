import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Sparkles, Bot, User, HelpCircle, Settings } from 'lucide-react';
import { CommandPalette } from '../components/CommandPalette';
import SettingsModal from '../components/SettingsModal';
import RewindModal from '../components/RewindModal';
import ShortcutsCheatsheet from '../components/ShortcutsCheatsheet';
import { api } from '../api';
import { startStream, abortStream, subscribeStreams, getLive, listLive, isStreaming, type LiveUsage } from '../store/stream-store';
import { useToast } from '../components/Toast';
import { translate as t } from '../i18n';
import type { Language } from '../i18n';
import type { Conversation, ActiveDropdown, SidebarTab } from '../types/chat';
import type { Workspace, WorkspaceItem } from '../types';
import { getModelContextLimit } from '../utils/model-context';
import { qualId, displayModelLabel } from '../utils/model-label';
import { hasAgentActivity, cleanThinkTags } from '../utils/chat-render';
import { MemoizedAssistantMessage, ChatEmptyState, ChatHeader, MessageFooter, ConversationSidebar, Composer, RightSidebar } from '../components/chat';

export default function Chat({ lang, isDark, toggleTheme, accent, setAccent, theme, setTheme }: {
  lang: Language;
  isDark: boolean;
  toggleTheme: () => void;
  accent: string;
  setAccent: (a: string) => void;
  theme: string;
  setTheme: (t: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [input, setInput] = useState('');
  const [models, setModels] = useState<{ id: string; name: string; providerName: string; providerId: string }[]>([]);
  const [inputMenu, setInputMenu] = useState<{ type: 'at' | 'slash'; query: string; path: string } | null>(null);
  const [atFileItems, setAtFileItems] = useState<WorkspaceItem[]>([]);
  const [atLoading, setAtLoading] = useState(false);
  const composingRef = useRef(false);
  const draftsRef = useRef<Record<string, string>>({});
  const inputMenuRef = useRef<HTMLDivElement>(null);
  const [atFolderStack, setAtFolderStack] = useState<string[]>([]);
  const [loadingChats, setLoadingChats] = useState<Record<string, boolean>>({});
  const [activeDropdown, setActiveDropdown] = useState<ActiveDropdown>('none');
  const toast = useToast();

  // Sync loadingChats to ref for use in useEffect without causing re-renders
  useEffect(() => {
    loadingChatsRef.current = loadingChats;
  }, [loadingChats]);

  const handleStop = (chatId?: string) => {
    const id = chatId || activeId;
    abortStream(id);
    setLoadingChats(prev => ({ ...prev, [id]: false }));
  };

  // ---- Live stream subscription ----
  // The in-flight agent stream lives in stream-store (module-level) so it
  // survives page navigation. Subscribe on mount, re-apply snapshots for any
  // stream already running (returning to this page mid-task), and keep the
  // conversations / loading state in sync while mounted.
  //
  // Notifications are coalesced on a trailing edge (~250ms): long agent
  // transcripts are expensive to re-parse + re-render, and applying every
  // flush synchronously would keep the renderer saturated for the whole task.
  const applyLiveStream = useCallback((chatId: string) => {
    pendingStreamApplyRef.current.add(chatId);
    if (streamApplyTimerRef.current[chatId]) return;
    streamApplyTimerRef.current[chatId] = window.setTimeout(() => {
      streamApplyTimerRef.current[chatId] = null;
      if (!pendingStreamApplyRef.current.delete(chatId)) return;
      const st = getLive(chatId);
      if (!st) return;
      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== chatId) return c;
          const msgs = [...c.messages];
          if (msgs[st.assistantIndex]) {
            msgs[st.assistantIndex] = { ...msgs[st.assistantIndex], content: st.content };
          }
          return { ...c, messages: msgs };
        });
        return updated;
      });
      if (st.contextTokens) setContextTokens(st.contextTokens);
      if (typeof st.cacheRate === 'number') setCacheRate(st.cacheRate);
      if (st.lastUsage) setLastUsage(st.lastUsage);
      setLoadingChats(prev => (prev[chatId] === st.loading ? prev : { ...prev, [chatId]: st.loading }));
    }, 250);
  }, []);

  useEffect(() => {
    const unsub = subscribeStreams(applyLiveStream);
    // Apply live snapshots immediately (no throttle) for streams already
    // running when this page mounts — returning mid-task must be instant.
    listLive().forEach(s => {
      const st = getLive(s.chatId);
      if (!st) return;
      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== s.chatId) return c;
          const msgs = [...c.messages];
          if (msgs[st.assistantIndex]) {
            msgs[st.assistantIndex] = { ...msgs[st.assistantIndex], content: st.content };
          }
          return { ...c, messages: msgs };
        });
        return updated;
      });
      if (st.contextTokens) setContextTokens(st.contextTokens);
      if (typeof st.cacheRate === 'number') setCacheRate(st.cacheRate);
      if (st.lastUsage) setLastUsage(st.lastUsage);
      setLoadingChats(prev => (prev[s.chatId] === st.loading ? prev : { ...prev, [s.chatId]: st.loading }));
    });
    return unsub;
  }, [applyLiveStream]);

  useEffect(() => {
    return () => {
      // Clean up drag listeners if unmounted mid-drag
      dragListenerRef.current?.cleanup();
      dragListenerRef.current = null;
      // Drop any pending live-stream coalesce timers (their state is owned by
      // stream-store and applied again on next mount via listLive()).
      Object.values(streamApplyTimerRef.current).forEach((t) => { if (t) clearTimeout(t); });
      streamApplyTimerRef.current = {};
      pendingStreamApplyRef.current.clear();
      // Don't abort streams on unmount - they live in stream-store and keep
      // running + persisting in the background until they finish.
    };
  }, []);

  // ---- Keyboard Shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // NOTE: Ctrl+K opens the Command Palette (see the handler below) —
      // clear-context lives in the palette. Keeping a second Ctrl+K binding
      // here made both actions fire at once.
      // Ctrl+L: Toggle sidebar (handled in App.tsx)
      // Ctrl+Shift+P: Toggle Build/Plan mode
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setUseAgent(prev => !prev);
      }
      // Ctrl+N: New chat
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        handleNewChat();
      }
      // Ctrl+S: Stop generation
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleStop();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeId, conversations]);

  // Agent mode & skills state
  const [useAgent, setUseAgent] = useState(true);
  const [activeSkillId, setActiveSkillId] = useState('');
  const [skills, setSkills] = useState<any[]>([]);
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [currentTaskList, setCurrentTaskList] = useState<{status: 'pending' | 'running' | 'completed' | 'done', description: string}[]>([]);
  // Live Reasonix todo state (two-level plan) polled from the task monitor
  // endpoint — the authoritative host-maintained list with level/status.
  const [liveTodos, setLiveTodos] = useState<any[]>([]);
  const [liveTaskPhase, setLiveTaskPhase] = useState<string>('');
  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const loadingChatsRef = useRef<Record<string, boolean>>({});

  // Workspace selector state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [historySidebarWidth, setHistorySidebarWidth] = useState(() => {
    return parseInt(localStorage.getItem('orca_chat_history_width') || '220');
  });
  const [convSearch, setConvSearch] = useState('');

  const dragListenerRef = useRef<{ cleanup: () => void } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = historySidebarWidth;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(160, Math.min(400, startWidth + deltaX));
      setHistorySidebarWidth(newWidth);
      localStorage.setItem('orca_chat_history_width', String(newWidth));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      dragListenerRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    dragListenerRef.current = {
      cleanup: () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }
    };
  };

  const handleRightSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightSidebarWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(240, Math.min(500, startWidth + deltaX));
      setRightSidebarWidth(newWidth);
      localStorage.setItem('orca_right_sidebar_width', String(newWidth));
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      dragListenerRef.current = null;
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    dragListenerRef.current = {
      cleanup: () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }
    };
  };

  const filteredConversations = conversations.filter(c => 
    !activeWorkspaceId || c.workspaceId === activeWorkspaceId
  );

  // Switch conversation when active workspace changes
  useEffect(() => {
    if (!activeWorkspaceId || conversations.length === 0 || models.length === 0) return;
    
    // Check if current activeId belongs to current active workspace
    const hasActiveForWs = conversations.some(c => c.id === activeId && c.workspaceId === activeWorkspaceId);
    if (hasActiveForWs) return;

    // Try to find any conversation for this workspace
    const wsChats = conversations.filter(c => c.workspaceId === activeWorkspaceId);
    if (wsChats.length > 0) {
      setActiveId(wsChats[0].id);
    } else {
      // Create a default one for this workspace
      const defaultId = 'chat_' + Date.now();
      const defaultChat: Conversation = {
        id: defaultId,
        workspaceId: activeWorkspaceId,
        title: lang === 'en' ? 'New Chat' : '新会话',
        preset: 'standard',
        quality: 'high',
        model: (conversations.find(c => c.id === activeId)?.model) || models[0]?.id || 'deepseek-chat',
        messages: [{ role: 'system', content: presets.standard.systemPrompt }]
      };
      const updated = [defaultChat, ...conversations];
      setActiveId(defaultId);
      saveChatsToStorage(updated);
    }
  }, [activeWorkspaceId, conversations.length, models.length]);

  // File upload state
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  
  // Audio record simulation state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimer = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabled = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isUserScrolling = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);
  const contextLimitRef = useRef<number>(128000);
  // Coalescing state for live-stream application (see applyLiveStream).
  const pendingStreamApplyRef = useRef<Set<string>>(new Set());
  const streamApplyTimerRef = useRef<Record<string, number | null>>({});

  // Right sidebar state
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => {
    return localStorage.getItem('orca_right_sidebar_open') !== 'false';
  });
  const [rightSidebarTab, setRightSidebarTab] = useState<SidebarTab>('tasks');
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    return parseInt(localStorage.getItem('orca_right_sidebar_width') || '300');
  });
  const [modifiedFiles, setModifiedFiles] = useState<{path: string; action: string; time: string}[]>([]);
  const [gitInfo, setGitInfo] = useState<{
    branch: string;
    changes: number;
    untracked: number;
    status: string;
    lastCommit: string;
    modifiedFiles?: { status: string; filepath: string }[];
  }>({ branch: '—', changes: 0, untracked: 0, status: 'clean', lastCommit: '—', modifiedFiles: [] });
  const [contextTokens, setContextTokens] = useState({ used: 0, total: 0, percent: 0 });
  const [cacheRate, setCacheRate] = useState<number | null>(null);
  // Per-task token usage from the server's final usage chunk (↑ in / ↓ out).
  const [lastUsage, setLastUsage] = useState<LiveUsage | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [pendingAsk, setPendingAsk] = useState<{ taskId: string; question: string; options: string[] } | null>(null);
  const [askAnswerText, setAskAnswerText] = useState('');
  const [askSubmitting, setAskSubmitting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [todoShelfCollapsed, setTodoShelfCollapsed] = useState(false);
  
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);

  const handleOpenFile = async (filePath: string) => {
    try {
      let fullPath = filePath;
      const pathIsAbsolute = (p: string) => /^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('\\');
      const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
      if (activeWorkspace?.path && !pathIsAbsolute(filePath)) {
        const separator = activeWorkspace.path.includes('\\') ? '\\' : '/';
        fullPath = `${activeWorkspace.path}${separator}${filePath}`;
      }
      await api.post('/api/open-file', { filepath: fullPath });
    } catch (err) {
      console.error("Failed to open file:", err);
      toast.error(lang === 'en' ? 'Failed to open file.' : '打开文件失败。');
    }
  };

  // Workspace explorer tree types & state
  const [folderContents, setFolderContents] = useState<Record<string, WorkspaceItem[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({});
  const [modifiedFilesExpanded, setModifiedFilesExpanded] = useState(true);
  const [workspaceFilesExpanded, setWorkspaceFilesExpanded] = useState(true);

  const fetchFolderContents = async (subPath: string) => {
    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!activeWorkspace?.path) return;
    
    setLoadingFolders(prev => ({ ...prev, [subPath]: true }));
    try {
      const response = await api.post('/api/workspace/list', {
        workspacePath: activeWorkspace.path,
        subPath
      });
      if (response.data && response.data.ok) {
        setFolderContents(prev => ({
          ...prev,
          [subPath]: response.data.items
        }));
      }
    } catch (err) {
      console.error('Failed to fetch folder contents:', err);
    } finally {
      setLoadingFolders(prev => ({ ...prev, [subPath]: false }));
    }
  };

  const toggleFolder = async (subPath: string) => {
    const isExpanded = !!expandedPaths[subPath];
    setExpandedPaths(prev => ({
      ...prev,
      [subPath]: !isExpanded
    }));
    
    if (!isExpanded && !folderContents[subPath]) {
      await fetchFolderContents(subPath);
    }
  };

  const handleAttachFile = async (item: WorkspaceItem) => {
    try {
      const response = await api.post('/api/workspace/file-content', { filepath: item.absolutePath });
      if (response.data && response.data.ok) {
        setAttachedFile({
          name: item.name,
          content: response.data.content
        });
      } else {
        toast.error(lang === 'en' ? 'Failed to read file: ' + (response.data.error || 'unknown error') : '读取文件失败：' + (response.data.error || '未知错误'));
      }
    } catch (err: any) {
      toast.error(lang === 'en' ? 'Failed to read file: ' + err.message : '读取文件失败：' + err.message);
    }
  };

  const getVisibleItems = () => {
    const list: { item: WorkspaceItem; depth: number }[] = [];
    const addFolder = (subPath: string, depth: number) => {
      const items = folderContents[subPath] || [];
      for (const item of items) {
        list.push({ item, depth });
        if (item.isDirectory && expandedPaths[item.relativePath]) {
          addFolder(item.relativePath, depth + 1);
        }
      }
    };
    addFolder("", 0);
    return list;
  };

  const getFilteredItems = () => {
    const query = fileSearchQuery.trim().toLowerCase();
    if (!query) {
      return getVisibleItems();
    }
    const matches: { item: WorkspaceItem; depth: number }[] = [];
    const seen = new Set<string>();
    Object.keys(folderContents).forEach(subPath => {
      (folderContents[subPath] || []).forEach(item => {
        if (!item.isDirectory && item.name.toLowerCase().includes(query)) {
          if (!seen.has(item.absolutePath)) {
            seen.add(item.absolutePath);
            matches.push({ item, depth: 0 });
          }
        }
      });
    });
    return matches;
  };

  useEffect(() => {
    if (activeWorkspaceId && rightSidebarTab === 'files') {
      setFolderContents({});
      setExpandedPaths({});
      setFileSearchQuery('');
      fetchFolderContents("");
    }
  }, [activeWorkspaceId, rightSidebarTab]);

  const handleGitCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    setCommitting(true);
    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
    try {
      const res = await api.post('/api/git/commit', {
        workspacePath: activeWorkspace?.path,
        message: commitMessage
      });
      if (res.data && res.data.ok) {
        setCommitMessage('');
        toast.success(lang === 'en' ? 'Changes committed successfully!' : '提交成功！');
        // Refresh git info immediately
        const statusRes = await api.post('/api/git/status', { cwd: activeWorkspace?.path });
        if (statusRes.data) {
          setGitInfo({
            branch: statusRes.data.branch || '—',
            changes: statusRes.data.modified || 0,
            untracked: statusRes.data.untracked || 0,
            status: statusRes.data.modifiedFiles && statusRes.data.modifiedFiles.length > 0 ? 'dirty' : 'clean',
            lastCommit: statusRes.data.lastCommit || '—',
            modifiedFiles: statusRes.data.modifiedFiles || []
          });
        }
      }
    } catch (err: any) {
      console.error(err);
      toast.error((lang === 'en' ? 'Failed to commit: ' : '提交失败: ') + (err.response?.data?.error || err.message));
    } finally {
      setCommitting(false);
    }
  };

  // Track tool execution for file monitoring
  const trackFileOperation = useCallback((toolName: string, label: string) => {
    const WRITE_TOOL_PATHS = ['write_workspace_file', 'patch_workspace_file', 'multi_edit', 'batch_write_files', 'move_file', 'write_file', 'replace_in_file', 'edit_file', 'create_file'];
    if (!WRITE_TOOL_PATHS.some(op => toolName.toLowerCase().includes(op.toLowerCase()))) return;
    // The label is the tool's file-path argument (server-side toolActivityLabel);
    // the block content is the FILE CONTENT / command output — regexing it for
    // dotted strings yields garbage paths (e.g. "0.5.1" from a version bump).
    const path = (label || '').trim();
    if (!path) return;
    setModifiedFiles(prev => {
      const exists = prev.find(f => f.path === path);
      if (exists) return prev;
      return [{ path, action: 'modified', time: new Date().toLocaleTimeString() }, ...prev.slice(0, 49)];
    });
  }, []);

  const presets: Record<string, { name: string; systemPrompt: string }> = {
    standard: {
      name: lang === 'en' ? 'Standard Assistant' : '标准助手 (Standard)',
      systemPrompt: lang === 'en' ? 'You are Orca, a premium AI agent assistant. Help the user with their queries, tasks, and software engineering needs.' : '你是一个专业的 AI 智能助手。你可以协助用户解答日常提问、提供编程方案、审计系统并执行多步骤任务。'
    },
    code: {
      name: lang === 'en' ? 'Code Expert' : '代码专家 (Code Architect)',
      systemPrompt: lang === 'en' ? 'You are an expert software architect and senior developer advisor. Provide professional, clean, and well-designed solutions.' : '你是一个资深的软件架构师和高级开发顾问。请以专业、严谨、高内聚低耦合以及符合设计模式的视角来分析和解答编程问题。'
    },
    bug: {
      name: lang === 'en' ? 'Code Auditor' : '代码审计 (Bug Finder)',
      systemPrompt: lang === 'en' ? 'You are a code review and security audit expert. Focus on analyzing user code, finding logical bugs, security flaws, performance bottlenecks, and provide optimized code.' : '你是一个资深的代码审查与安全审计专家。请专注于分析用户提交的代码，找出其中的逻辑错误、潜在的安全隐患、性能瓶颈，并提供优化的重构代码。'
    },
    translate: {
      name: lang === 'en' ? 'Translation Expert' : '翻译专家 (Translator)',
      systemPrompt: lang === 'en' ? 'You are a professional interpreter and translator. Translate non-English input text to natural English, and English text to natural Chinese.' : '你是一个专业的同声传译与翻译官。请将用户输入的所有非英语文本翻译为地道的英语，或将英语文本翻译成流畅、信达雅的中文。'
    }
  };

  const qualities: Record<string, { name: string; temp: number }> = {
    low: { name: 'Low', temp: 0.1 },
    medium: { name: 'Medium', temp: 0.5 },
    high: { name: 'High', temp: 0.9 }
  };

  // Load configured models from backend
  useEffect(() => {
    const loadModels = () => api.get('/api/providers').then(res => {
      const activeModels: any[] = [];
      res.data.forEach((p: any) => {
        // Only list models if provider is configured
        if (p.configured) {
          p.models.forEach((m: any) => {
            activeModels.push({
              id: m.id,
              name: m.name,
              providerName: p.name,
              providerId: p.id
            });
          });
        }
      });
      setModels(activeModels);
      
      // Load conversations from local storage
      const savedChats = localStorage.getItem('orca_conversations');
      let loadedConversations: Conversation[] = [];
      if (savedChats) {
        try {
          const parsed = JSON.parse(savedChats);
          if (Array.isArray(parsed)) {
            // Accept both bare ids (legacy chats) and provider-qualified ids
            // ("opencode/deepseek-v4-flash") so stored conversations are not
            // reset just because their model is now stored qualified.
            const validIds = new Set<string>();
            activeModels.forEach((m: any) => { validIds.add(m.id); validIds.add(qualId(m)); });
            // Upgrade legacy bare ids to qualified when unambiguous (exactly
            // one provider offers the model) so the picker highlights the
            // right row and requests route to the right provider.
            const bareToQualified = (bareId: string): string | null => {
              const matches = activeModels.filter((m: any) => m.id === bareId);
              return matches.length === 1 && matches[0].providerId ? qualId(matches[0]) : null;
            };
            loadedConversations = parsed.map(c => ({
              ...c,
              workspaceId: c.workspaceId || 'ws_default',
              // A conversation may reference a model whose provider was since
              // removed or unconfigured (e.g. a deleted "longcat-2.0"). Falling
              // back keeps the chat list and the model picker in sync instead
              // of surfacing a stale model that no longer exists.
              model: validIds.has(c.model)
                ? (bareToQualified(c.model) || c.model)
                : (activeModels[0] ? qualId(activeModels[0]) : c.model)
            }));
          }
        } catch (e) {}
      }
      
      if (loadedConversations.length > 0) {
        setConversations(loadedConversations);
        setActiveId(loadedConversations[0].id);
        // Re-attach any live streams (returning to this page mid-task): the
        // store may hold fresher content than what was last persisted.
        listLive().forEach(s => applyLiveStream(s.chatId));
      } else {
        // If no saved conversations, create a default one
        const defaultId = 'chat_' + Date.now();
        const defaultChat: Conversation = {
          id: defaultId,
          workspaceId: 'ws_default',
          title: lang === 'en' ? 'New Chat' : '新会话',
          preset: 'standard',
          quality: 'high',
          model: activeModels[0] ? qualId(activeModels[0]) : 'deepseek-chat',
          messages: [{ role: 'system', content: presets.standard.systemPrompt }]
        };
        setConversations([defaultChat]);
        setActiveId(defaultId);
        localStorage.setItem('orca_conversations', JSON.stringify([defaultChat]));
      }
    }).catch(console.error);

    loadModels();
  }, []);

  // Refresh the model list when the window regains focus so changes made on
  // other pages (provider added/removed, keys configured) show up here without
  // a full reload — keeps every screen's model list in sync.
  useEffect(() => {
    const onFocus = () => {
      api.get('/api/providers').then(res => {
        const list: any[] = [];
        res.data.forEach((p: any) => {
          if (p.configured) {
            p.models.forEach((m: any) => {
              list.push({ id: m.id, name: m.name, providerName: p.name, providerId: p.id });
            });
          }
        });
        setModels(list);
      }).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Load workspaces and skills lists on mount
  useEffect(() => {
    api.get('/api/config').then(configRes => {
      const savedWorkspaces = localStorage.getItem('orca_workspaces');
      let wsList: Workspace[] = [];
      if (savedWorkspaces) {
        try { wsList = JSON.parse(savedWorkspaces); } catch (e) {}
      }
      
      if (wsList.length === 0) {
        const defaultPath = configRes.data?.projectDir || '';
        const defaultName = defaultPath.split(/[\\/]/).pop() || 'orca';
        const defaultWs = {
          id: 'ws_default',
          name: defaultName,
          path: defaultPath,
          initial: defaultName.charAt(0).toUpperCase()
        };
        wsList = [defaultWs];
        localStorage.setItem('orca_workspaces', JSON.stringify(wsList));
      }
      setWorkspaces(wsList);
      
      const savedActiveWs = localStorage.getItem('orca_active_ws');
      if (savedActiveWs && wsList.some(w => w.id === savedActiveWs)) {
        setActiveWorkspaceId(savedActiveWs);
      } else {
        setActiveWorkspaceId(wsList[0].id);
      }

      api.get('/api/skills').then(skillsRes => {
        setSkills(skillsRes.data || []);
      }).catch(err => console.error("Failed to load skills:", err));

      api.get('/api/mcp/tools').then(mcpRes => {
        setMcpTools(mcpRes.data || []);
      }).catch(err => console.error("Failed to load MCP tools:", err));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem('orca_active_ws', activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

  const handleChooseDirectory = (workspaceIdToEdit?: string) => {
    api.post('/api/select-workspace-dir').then(res => {
      if (res.data && res.data.path) {
        const dirPath = res.data.path;
        const separator = dirPath.includes('\\') ? '\\' : '/';
        const parts = dirPath.split(separator);
        const dirName = parts.pop() || 'folder';

        if (workspaceIdToEdit) {
          const updated = workspaces.map(w => {
            if (w.id === workspaceIdToEdit) {
              return {
                ...w,
                name: dirName,
                path: dirPath,
                initial: dirName.charAt(0).toUpperCase()
              };
            }
            return w;
          });
          setWorkspaces(updated);
          localStorage.setItem('orca_workspaces', JSON.stringify(updated));
        } else {
          if (workspaces.some(w => w.path === dirPath)) {
            const existing = workspaces.find(w => w.path === dirPath);
            if (existing) setActiveWorkspaceId(existing.id);
            return;
          }

          const newWs: Workspace = {
            id: 'ws_' + Date.now(),
            name: dirName,
            path: dirPath,
            initial: dirName.charAt(0).toUpperCase()
          };
          
          const updated = [...workspaces, newWs];
          setWorkspaces(updated);
          setActiveWorkspaceId(newWs.id);
          localStorage.setItem('orca_workspaces', JSON.stringify(updated));
        }
      }
    }).catch(err => {
      console.error("Failed to choose directory:", err);
    });
  };

  useEffect(() => {
    // Only auto-scroll if user is not actively scrolling
    if (isAutoScrollEnabled.current && !isUserScrolling.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversations, activeId]);

  // Handle user scroll to detect if they've scrolled up
  const handleMessagesScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
      
      // User has scrolled up, disable auto-scroll
      if (!isAtBottom) {
        isAutoScrollEnabled.current = false;
        isUserScrolling.current = true;
        setShowScrollButton(true);
      } else {
        isAutoScrollEnabled.current = true;
        isUserScrolling.current = false;
        setShowScrollButton(false);
      }
    }
  };

  // Debounced scroll handler to prevent rapid toggling
  const debouncedScrollHandler = () => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      handleMessagesScroll();
    }, 100);
  };

  // Scroll to bottom when user clicks the button
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    isAutoScrollEnabled.current = true;
    isUserScrolling.current = false;
    setShowScrollButton(false);
  };

  // Audio recording timer simulation
  useEffect(() => {
    if (isRecording) {
      setRecordingSeconds(0);
      recordingTimer.current = setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);
    } else {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
    }
    return () => {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
    };
  }, [isRecording]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownsRef.current && !dropdownsRef.current.contains(event.target as Node)) {
        setActiveDropdown('none');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const activeChat = conversations.find(c => c.id === activeId);
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

  // Task-monitor source: the host-maintained todo list (Reasonix two-level
  // plan, polled live) takes precedence; fall back to the legacy markdown
  // parse for old sessions.
  const displayTasks: any[] = liveTodos.length > 0 ? liveTodos : currentTaskList;
  const displayDone = displayTasks.filter((t: any) => t.status === 'completed').length;
  const displayTotal = displayTasks.length;
  const displayProgress = displayTotal > 0 ? Math.round((displayDone / displayTotal) * 100) : 0;

  // Calculate context token usage from active conversation
  useEffect(() => {
    if (!activeChat) return;
    // While a stream is live, the server reports REAL token usage via
    // parsed.usage (applyLiveStream writes st.contextTokens). Don't clobber it
    // with a character-count heuristic on every 250ms flush — that's why the
    // context ring showed a stale estimate instead of the actual usage.
    const live = getLive(activeChat.id);
    if (live && live.contextTokens) return;
    const allContent = activeChat.messages.map(m => m.content).join(' ');
    let count = 0;
    for (let i = 0; i < allContent.length; i++) {
      count += allContent.charCodeAt(i) > 0x7F ? 2.5 : 0.25;
    }
    const estimatedTokens = Math.round(count);
    const total = getModelContextLimit(activeChat.model);
    contextLimitRef.current = total; // Sync the ref so streaming uses the correct real limit
    const percent = Math.min(100, Math.round((estimatedTokens / total) * 100));
    setContextTokens({ used: estimatedTokens, total, percent });
  }, [activeChat?.messages, activeChat?.model]);

  // Git info polling
  useEffect(() => {
    if (!activeWorkspace?.path) return;
    const fetchGitInfo = async () => {
      try {
        const res = await api.post('/api/git/status', { cwd: activeWorkspace.path });
        if (res.data) {
          setGitInfo({
            branch: res.data.branch || '—',
            changes: res.data.modified || 0,
            untracked: res.data.untracked || 0,
            status: res.data.modifiedFiles && res.data.modifiedFiles.length > 0 ? 'dirty' : 'clean',
            lastCommit: res.data.lastCommit || '—',
            modifiedFiles: res.data.modifiedFiles || []
          });
        }
      } catch {
        setGitInfo({ branch: '—', changes: 0, untracked: 0, status: 'no-repo', lastCommit: '—', modifiedFiles: [] });
      }
    };
    fetchGitInfo();
    const interval = setInterval(fetchGitInfo, 15000);
    return () => clearInterval(interval);
  }, [activeWorkspace?.path]);

  const modelsByProvider = models.reduce((acc, m) => {
    const provider = m.providerName || 'Unknown';
    if (!acc[provider]) {
      acc[provider] = [];
    }
    acc[provider].push(m);
    return acc;
  }, {} as Record<string, typeof models>);

  const getWorkspaceStyles = (name: string, isActive: boolean) => {
    const char = name.charAt(0).toUpperCase();
    const code = char.charCodeAt(0) % 4;
    
    if (isActive) {
      return 'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border-[1.5px] border-[var(--color-primary)] text-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,var(--color-bg-card))] font-extrabold shadow-[var(--shadow-primary)]';
    }
    
    const palettes = [
      'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border border-transparent text-purple-500 bg-purple-500/10 hover:opacity-90 hover:border-purple-500/30',
      'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border border-transparent text-emerald-600 bg-emerald-500/10 hover:opacity-90 hover:border-emerald-500/30',
      'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border border-transparent text-blue-500 bg-blue-500/10 hover:opacity-90 hover:border-blue-500/30',
      'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border border-transparent text-rose-500 bg-rose-500/10 hover:opacity-90 hover:border-rose-500/30',
    ];
    return palettes[code];
  };

  function saveChatsToStorage(updated: Conversation[]) {
    setConversations(updated);
    localStorage.setItem('orca_conversations', JSON.stringify(updated));
  }

  const handleNewChat = () => {
    const newId = 'chat_' + Date.now();
    const newChat: Conversation = {
      id: newId,
      workspaceId: activeWorkspaceId,
      title: (lang === 'en' ? 'New Chat ' : '新会话 ') + (filteredConversations.length + 1),
      preset: 'standard',
      quality: 'high',
      model: activeChat?.model || (models[0] ? qualId(models[0]) : 'deepseek-chat'),
      messages: [{ role: 'system', content: presets.standard.systemPrompt }]
    };
    const updated = [newChat, ...conversations];
    setActiveId(newId);
    saveChatsToStorage(updated);
  };

  const handleDeleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (conversations.length === 1) {
      toast.warning(t('chat.delete.confirm', lang));
      return;
    }
    const updated = conversations.filter(c => c.id !== id);
    if (activeId === id) {
      setActiveId(updated[0].id);
    }
    saveChatsToStorage(updated);
  };

  // --- Export / Import ---
  const handleExportMarkdown = () => {
    if (!activeChat) return;
    let md = '# ' + activeChat.title + '\n\n';
    md += '**Model:** ' + activeChat.model + '\n';
    md += '**Date:** ' + new Date().toISOString().split('T')[0] + '\n\n---\n\n';
    for (const msg of activeChat.messages) {
      if (msg.role === 'system') continue;
      md += '### ' + (msg.role === 'user' ? 'User' : 'Assistant') + '\n\n';
      md += msg.content + '\n\n---\n\n';
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (activeChat.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') || 'chat') + '.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = () => {
    const exportData = conversations.map(c => ({
      title: c.title,
      model: c.model,
      preset: c.preset,
      quality: c.quality,
      workspaceId: c.workspaceId,
      messages: c.messages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
      exportedAt: new Date().toISOString(),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orca-chats-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(data)) throw new Error('Expected array');
        const imported: Conversation[] = data.map((c: any, i: number) => ({
          id: 'import_' + Date.now() + '_' + i,
          workspaceId: c.workspaceId || activeWorkspaceId,
          title: c.title || 'Imported Chat ' + (i + 1),
          preset: c.preset || 'standard',
          quality: c.quality || 'high',
          model: c.model || models[0]?.id || 'deepseek-chat',
          messages: Array.isArray(c.messages) ? c.messages : [],
        }));
        const merged = [...imported, ...conversations];
        saveChatsToStorage(merged);
        if (imported.length > 0) setActiveId(imported[0].id);
      } catch (err) {
        toast.error(lang === 'en' ? 'Invalid JSON file.' : '无效的 JSON 文件');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Workspace menu actions (delegated to ConversationSidebar)
  const handleClearNotifications = () => {
    if (activeChat) {
      const systemMsg = activeChat.messages.find(m => m.role === 'system');
      const updated = conversations.map(c => {
        if (c.id === activeId) {
          return { ...c, messages: systemMsg ? [systemMsg] : [{ role: 'system', content: presets.standard.systemPrompt }] };
        }
        return c;
      });
      saveChatsToStorage(updated);
    }
    setWorkspaceMenuOpen(false);
  };

  const handleCloseWorkspace = () => {
    setWorkspaces(prev => {
      const updated = prev.filter(w => w.id !== activeWorkspaceId);
      localStorage.setItem('orca_workspaces', JSON.stringify(updated));
      if (updated.length > 0) {
        setActiveWorkspaceId(updated[0].id);
      } else {
        setActiveWorkspaceId('');
      }
      return updated;
    });
    setWorkspaceMenuOpen(false);
  };

  // Fill the composer from the right sidebar quick actions (git panel)
  const handleQuickFill = (text: string) => {
    setInput(input => input + (input ? ' ' : '') + text);
    textareaRef.current?.focus();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === 'Escape' && activeId && loadingChats[activeId]) {
        e.preventDefault();
        handleStop();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const ac = conversations.find(c => c.id === activeId);
        if (ac) {
          const lastAsst = [...ac.messages].reverse().find(m => m.role === 'assistant');
          if (lastAsst) navigator.clipboard.writeText(lastAsst.content);
        }
      } else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !shortcutsOpen) {
        // `?` opens the shortcuts cheatsheet (Reasonix-style), unless typing
        // inside an input/textarea (composer, search boxes, etc.).
        const target = e.target as HTMLElement | null;
        if (target && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
          e.preventDefault();
          setShortcutsOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeId, loadingChats, conversations, shortcutsOpen]);

  // Poll for pending ask questions (agent ask_question tool) + live todos
  // (task monitor sidebar renders the REAL todo state, not the legacy
  // markdown-list parse).
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await api.get('/api/tasks');
        const list = Array.isArray(data) ? data : [];
        const ws = workspaces.find((w: any) => w.id === activeWorkspaceId);
        const wsPath = ws?.path;
        const wsTasks = wsPath
          ? list.filter((t: any) => !t.workspacePath || t.workspacePath === wsPath || t.workspacePath.endsWith(wsPath))
          : list;
        const mostRecent = [...wsTasks].sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (mostRecent?.taskId) {
          setActiveTaskId(mostRecent.taskId);
          // Live todo monitor: poll the lightweight /todos endpoint for the
          // active task so the sidebar tracks plan phases/sub-steps in real
          // time (todo_write → host-advanced statuses).
          const ACTIVE_PHASES = ['plan', 'execute', 'verify', 'replan', 'pending_approval'];
          if (ACTIVE_PHASES.includes(mostRecent.phase)) {
            const todoRes = await api.get(`/api/tasks/${mostRecent.taskId}/todos`);
            const todos = todoRes.data?.todos;
            if (!cancelled) {
              setLiveTodos(Array.isArray(todos) ? todos : []);
              setLiveTaskPhase(String(todoRes.data?.phase || mostRecent.phase));
            }
          } else if (!cancelled) {
            // Finished task: keep the last known todo state (sidebar stays
            // informative), but clear it when nothing recent exists.
            setLiveTodos(prev => prev);
          }
        } else if (!cancelled) {
          setActiveTaskId(null);
          setLiveTodos([]);
        }
        const withAsk = list.find((t: any) => t.phase === 'pending_approval');
        if (withAsk) {
          const detail = await api.get(`/api/tasks/${withAsk.taskId}`);
          const askMeta = detail.data?.metadata?.pendingAsk;
          if (askMeta && askMeta.question) {
            if (!cancelled) {
              setPendingAsk({ taskId: withAsk.taskId, question: askMeta.question, options: askMeta.options || [] });
            }
            return;
          }
        }
        if (!cancelled) setPendingAsk(null);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeId, activeWorkspaceId, workspaces]);

  const submitAskAnswer = async () => {
    if (!pendingAsk || !askAnswerText.trim()) return;
    setAskSubmitting(true);
    try {
      await api.post(`/api/tasks/${pendingAsk.taskId}/answer`, { answer: askAnswerText.trim() });
      setAskAnswerText('');
      setPendingAsk(null);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setAskSubmitting(false);
    }
  };

  const clearContext = (chatId: string) => {
    setConversations(prev => {
      const updated = prev.map(c =>
        c.id === chatId ? { ...c, messages: [] } : c
      );
      // Persist immediately — otherwise a page refresh brings the cleared
      // messages back (stream-store's debounced persist only rewrites content,
      // never removes messages).
      saveChatsToStorage(updated);
      return updated;
    });
  };

  // Change active model
  const handleModelChange = (modelId: string) => {
    if (!activeChat) return;
    const updated = conversations.map(c => {
      if (c.id === activeId) {
        return { ...c, model: modelId };
      }
      return c;
    });
    saveChatsToStorage(updated);
  };


  // Change quality (Temperature)
  const handleQualityChange = (qualityKey: string) => {
    if (!activeChat) return;
    const updated = conversations.map(c => {
      if (c.id === activeId) {
        return { ...c, quality: qualityKey };
      }
      return c;
    });
    saveChatsToStorage(updated);
  };

  // File attach handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check file size (limit to 5MB for text reading)
    if (file.size > 5 * 1024 * 1024) {
      toast.warning(t('chat.file.large', lang));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setAttachedFile({
        name: file.name,
        content: content
      });
    };
    reader.readAsText(file);
    // Reset file input value
    e.target.value = '';
  };

  // ---- Composer: per-conversation draft persistence ----
  useEffect(() => {
    try {
      draftsRef.current = JSON.parse(localStorage.getItem('orca_input_drafts') || '{}');
    } catch { draftsRef.current = {}; }
  }, []);

  const saveDraft = (chatId: string, text: string) => {
    if (!chatId) return;
    if (text.trim()) draftsRef.current[chatId] = text;
    else delete draftsRef.current[chatId];
    localStorage.setItem('orca_input_drafts', JSON.stringify(draftsRef.current));
  };

  const switchChatRef = useRef(false);
  useEffect(() => {
    if (!activeId) return;
    const saved = draftsRef.current[activeId];
    if (saved !== undefined && !switchChatRef.current) {
      setInput(saved);
    } else {
      switchChatRef.current = false;
    }
    setInputMenu(null);
    setAtFolderStack([]);
  }, [activeId]);

  // ---- Composer: @file reference & / command menu ----
  const SLASH_COMMANDS = [
    { key: '/plan', label: lang === 'en' ? 'Plan first, then execute' : '先规划再执行', text: lang === 'en' ? 'Make a detailed step-by-step plan first, then execute it.' : '请先制定一个详细的分步执行计划，确认后再开始执行。' },
    { key: '/fix', label: lang === 'en' ? 'Find and fix bugs' : '查找并修复 Bug', text: lang === 'en' ? 'Find and fix bugs in this project.' : '请审查这个项目并修复其中的 Bug。' },
    { key: '/review', label: lang === 'en' ? 'Code review' : '代码审查', text: lang === 'en' ? 'Review the code quality and output an issue list with fixes.' : '请全面审查代码质量，输出问题清单与修复建议。' },
    { key: '/test', label: lang === 'en' ? 'Write tests' : '编写测试', text: lang === 'en' ? 'Write or complete unit tests for this project.' : '请为这个项目编写/补充单元测试。' },
    { key: '/explain', label: lang === 'en' ? 'Explain code' : '解释代码', text: lang === 'en' ? 'Explain what this codebase does.' : '请详细解释一下这个项目的结构与核心逻辑。' },
    { key: '/refactor', label: lang === 'en' ? 'Refactor & optimize' : '重构优化', text: lang === 'en' ? 'Refactor and optimize the code quality.' : '请对代码进行重构与优化，提升可维护性。' },
    { key: '/init', label: lang === 'en' ? 'Initialize project rules (ORCA.md)' : '初始化项目规则 (ORCA.md)', text: lang === 'en' ? 'Analyze this project structure and create/update an ORCA.md file with project rules, conventions, and architecture notes for future agent sessions.' : '请分析本项目结构，创建/更新 ORCA.md 项目指令文件，写入项目规则、约定与架构说明，供后续智能体会话遵循。' },
  ];

  const fetchAtFiles = async (subPath: string) => {
    const ws = workspaces.find(w => w.id === activeWorkspaceId);
    if (!ws?.path) return;
    setAtLoading(true);
    try {
      const res = await api.post('/api/workspace/list', { workspacePath: ws.path, subPath });
      if (res.data?.ok) setAtFileItems(res.data.items || []);
    } catch { setAtFileItems([]); }
    finally { setAtLoading(false); }
  };

  const openAtMenu = (subPath: string) => {
    setInputMenu({ type: 'at', query: '', path: subPath });
    fetchAtFiles(subPath);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    saveDraft(activeId, value);

    const cursorAt = value.length - 1;
    const lastChar = value[cursorAt];
    if (lastChar === '@') {
      const before = value.slice(0, cursorAt);
      const prevWord = before.split(/[\s\u4e00-\u9fff]/).pop() || '';
      if (!prevWord) openAtMenu('');
      return;
    }
    if (lastChar === '/') {
      const lineStart = value.lastIndexOf('\n', cursorAt - 1);
      const linePrefix = value.slice(lineStart + 1, cursorAt);
      if (!linePrefix) {
        setInputMenu({ type: 'slash', query: '', path: '' });
        return;
      }
    }
    if (inputMenu?.type === 'at') {
      const atIdx = value.lastIndexOf('@');
      if (atIdx < 0) {
        setInputMenu(null);
        return;
      }
      const lineStart = value.lastIndexOf('\n', atIdx > 0 ? atIdx - 1 : 0);
      const tokenStart = Math.max(atIdx + 1, lineStart + 1);
      const query = value.slice(tokenStart).trim();
      setInputMenu(prev => prev ? { ...prev, query } : prev);
      return;
    }
    if (inputMenu?.type === 'slash') {
      const lineStart = value.lastIndexOf('\n');
      const linePrefix = value.slice(lineStart + 1);
      if (!linePrefix.startsWith('/')) {
        setInputMenu(null);
        return;
      }
      setInputMenu(prev => prev ? { ...prev, query: linePrefix.slice(1) } : prev);
      return;
    }
    setInputMenu(null);
  };

  const insertAtFile = (item: WorkspaceItem) => {
    if (!inputMenu || inputMenu.type !== 'at') return;
    const atIdx = input.lastIndexOf('@');
    const lineStart = input.lastIndexOf('\n', atIdx >= 0 ? atIdx - 1 : 0);
    const tokenStart = Math.max(atIdx >= 0 ? atIdx : 0, lineStart + 1);
    const prefix = input.slice(0, tokenStart);
    const replaced = item.isDirectory ? `${prefix}@${item.relativePath}/` : `${prefix}@${item.relativePath}`;
    setInput(replaced);
    saveDraft(activeId, replaced);
    if (item.isDirectory) {
      setAtFolderStack(prev => [...prev, item.relativePath]);
      setInputMenu({ type: 'at', query: '', path: item.relativePath });
      fetchAtFiles(item.relativePath);
    } else {
      setInputMenu(null);
    }
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const navigateAtFolder = (subPath: string) => {
    setAtFolderStack(prev => [...prev, subPath]);
    setInputMenu(prev => prev ? { ...prev, path: subPath, query: '' } : prev);
    fetchAtFiles(subPath);
  };

  const goBackAtFolder = () => {
    if (atFolderStack.length === 0) return;
    const parent = atFolderStack.slice(0, -1).join('/');
    setAtFolderStack(prev => prev.slice(0, -1));
    setInputMenu(prev => prev ? { ...prev, path: parent } : prev);
    fetchAtFiles(parent);
  };

  const applySlashCommand = (cmd: { key: string; label: string; text: string }) => {
    const lineStart = input.lastIndexOf('\n');
    const prefix = input.slice(0, lineStart + 1);
    setInput(prefix + cmd.text);
    saveDraft(activeId, prefix + cmd.text);
    setInputMenu(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inputMenuRef.current && !inputMenuRef.current.contains(e.target as Node)) {
        setInputMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composingRef.current) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape' && inputMenu) {
      e.preventDefault();
      setInputMenu(null);
    } else if (inputMenu?.type === 'at' && e.key === 'Backspace' && atFolderStack.length > 0 && !inputMenu.query) {
      e.preventDefault();
      goBackAtFolder();
    } else if (inputMenu?.type === 'at' && e.key === 'ArrowRight' && atFileItems[0]?.isDirectory) {
      e.preventDefault();
      navigateAtFolder(atFileItems[0].relativePath);
    }
  };

  const filteredAtItems = inputMenu?.type === 'at'
    ? atFileItems.filter(item => !inputMenu.query || item.name.toLowerCase().includes(inputMenu.query.toLowerCase()))
    : [];
  const filteredSlashCommands = inputMenu?.type === 'slash'
    ? SLASH_COMMANDS.filter(c => c.key.includes(inputMenu.query.toLowerCase()))
    : [];


  // Mock audio transcription helper
  const handleStopRecording = () => {
    setIsRecording(false);
    const audioPrompts = lang === 'en' ? [
      "How to optimize garbage collection and memory overhead in this code?",
      "How to implement a high-concurrency streaming API supporting resuming?",
      "How to avoid split-brain and deadlock when using Redis distributed locks?",
      "Help me write a beautiful CSS glassmorphism card layout."
    ] : [
      "如何优化这段代码的垃圾回收机制与内存开销？",
      "如何实现一个高并发且支持断点续传的流式 API？",
      "使用 Redis 分布式锁时如何避免脑裂和死锁问题？",
      "帮我写一个高颜值的 CSS 玻璃拟态卡片布局样式。"
    ];
    const randomPrompt = audioPrompts[Math.floor(Math.random() * audioPrompts.length)];
    setInput(prev => (prev ? prev + ' ' : '') + randomPrompt);
  };

  // Parse task list from assistant message content
  const parseTaskList = (content: string) => {
    const tasks: {status: 'pending' | 'running' | 'completed' | 'done', description: string}[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Match task list patterns: - [ ] task, - [/] task, - [x] task
      const match = line.match(/^\s*[-*]\s+\[([ xX/])\]\s+(.*)$/);
      if (match) {
        const statusChar = match[1].toLowerCase();
        const description = match[2].trim();
        
        let status: 'pending' | 'running' | 'completed' | 'done' = 'pending';
        if (statusChar === 'x') status = 'completed';
        else if (statusChar === '/') status = 'running';
        
        tasks.push({ status, description });
      }
    }
    
    return tasks;
  };

  // Update task list when conversations change
  useEffect(() => {
    if (!activeChat || !useAgent) {
      setCurrentTaskList([]);
      setIsTaskRunning(false);
      return;
    }

    // Live todo monitor (host-maintained two-level plan) takes precedence over
    // the legacy markdown parse. Running = unfinished items AND the task is in
    // an active phase (a finished task keeps its completed list visible but is
    // not "running").
    if (liveTodos.length > 0) {
      const hasUnfinished = liveTodos.some((t: any) => t.status !== 'completed');
      const activePhases = ['plan', 'execute', 'verify', 'replan', 'pending_approval', 'awaiting_user'];
      setIsTaskRunning(hasUnfinished && activePhases.includes(liveTaskPhase));
      return;
    }

    // Find the latest assistant message
    const assistantMessages = activeChat.messages.filter(m => m.role === 'assistant');
    if (assistantMessages.length === 0) {
      setCurrentTaskList([]);
      setIsTaskRunning(false);
      return;
    }

    const latestMessage = assistantMessages[assistantMessages.length - 1];
    const tasks = parseTaskList(latestMessage.content);
    
    if (tasks.length > 0) {
      setCurrentTaskList(tasks);
      // Check if any task is still running
      const hasRunning = tasks.some(t => t.status === 'running');
      const hasPending = tasks.some(t => t.status === 'pending');
      setIsTaskRunning(hasRunning || hasPending);
    } else {
      // If no tasks found but loading, keep showing previous tasks
      if (!loadingChatsRef.current[activeId]) {
        setIsTaskRunning(false);
      }
    }
  }, [conversations, activeId, useAgent, liveTodos, liveTaskPhase]);

  const handleSend = async () => {
    const chatId = activeId;
    if ((!input.trim() && !attachedFile) || loadingChats[chatId] || isStreaming(chatId) || !activeChat) return;

    // Re-enable auto-scroll when user sends a message
    isAutoScrollEnabled.current = true;
    setShowScrollButton(false);

    let userPrompt = input;
    // Embed attached file if exists
    if (attachedFile) {
      // Warn if file is too large (>200KB)
      if (attachedFile.content.length > 200 * 1024) {
        toast.warning(lang === 'en'
          ? 'File is too large for direct attachment (>200KB). Please use a smaller file or reference it via workspace tools.'
          : '文件过大无法直接附加 (>200KB)。请使用更小的文件或通过工作区工具引用。');
        return;
      }
      userPrompt = lang === 'en' 
        ? `[Attached File: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\`\n${userPrompt}`
        : `[附带文件: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\`\n${userPrompt}`;
    }

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newMessages = [...activeChat.messages, { role: 'user', content: userPrompt, timestamp: timeStr }];
    
    // Clear input & attachments
    setInput('');
    setAttachedFile(null);
    saveDraft(chatId, '');
    setLoadingChats(prev => ({ ...prev, [chatId]: true }));

    // Update conversation state temporarily
    const assistantIndex = newMessages.length;
    const initialAssistantMessages = [...newMessages, { role: 'assistant', content: '', timestamp: timeStr }];
    
    // Update local state and memory
    const tempUpdated = conversations.map(c => {
      if (c.id === chatId) {
        const rawTitle = input.trim().slice(0, 15);
        const isDefaultTitle = c.title === '新会话' || c.title.startsWith('新会话 ') || c.title === 'New Chat' || c.title.startsWith('New Chat ');
        const fileTitle = lang === 'en' ? 'File Chat' : '文件对话';
        const title = isDefaultTitle ? (rawTitle || fileTitle) : c.title;
        return { ...c, title, messages: initialAssistantMessages };
      }
      return c;
    });
    setConversations(tempUpdated);
    // Persist the user message + assistant placeholder immediately — the
    // stream-store merges streamed content into this saved copy, so it must
    // exist before the first delta arrives (even if the user navigates away).
    try { localStorage.setItem('orca_conversations', JSON.stringify(tempUpdated)); } catch { /* quota/storage error — stream still proceeds */ }

    // Kick off the live stream. It is owned by stream-store (module-level) so
    // it keeps running and persisting even if the user navigates away; the
    // subscription effect above re-attaches the UI when they come back.
    const sendMessages = newMessages.filter(m => m.role !== 'system');
    const tempValue = (qualities[activeChat.quality] || qualities.high).temp;
    const body = {
      model: activeChat.model,
      messages: sendMessages,
      temperature: tempValue,
      stream: true,
      useAgent,
      activeSkillId,
      workspacePath: activeWorkspace?.path || ''
    };
    startStream(chatId, assistantIndex, timeStr, lang, body, sendMessages, contextLimitRef.current || 128000);
  };


  const rollbackTo = (idx: number) => {
    if (!activeChat || idx < 0 || idx >= activeChat.messages.length) return;
    const msgs = [...activeChat.messages];
    let targetUserMsgIdx = -1;
    if (msgs[idx].role === 'user') {
      targetUserMsgIdx = idx;
    } else if (msgs[idx].role === 'assistant' && idx > 0 && msgs[idx - 1].role === 'user') {
      targetUserMsgIdx = idx - 1;
    }

    if (targetUserMsgIdx === -1) return;

    let targetUserPrompt = msgs[targetUserMsgIdx].content;
    // Strip attached file wrapper if present
    if (targetUserPrompt.startsWith('[Attached File:') || targetUserPrompt.startsWith('[附带文件:')) {
      const lines = targetUserPrompt.split('\n');
      let codeBlockEnd = -1;
      for (let j = 0; j < lines.length; j++) {
        if (lines[j].trim() === '```') {
          codeBlockEnd = j;
        }
      }
      if (codeBlockEnd !== -1 && codeBlockEnd < lines.length - 1) {
        targetUserPrompt = lines.slice(codeBlockEnd + 1).join('\n');
      }
    }

    const updatedMsgs = msgs.slice(0, targetUserMsgIdx);

    // Force system prompt to stay
    if (updatedMsgs.length === 0 || updatedMsgs[0].role !== 'system') {
      updatedMsgs.unshift({ role: 'system', content: presets[activeChat.preset]?.systemPrompt || presets.standard.systemPrompt });
    }

    const updated = conversations.map(c => {
      if (c.id === activeId) {
        return { ...c, messages: updatedMsgs };
      }
      return c;
    });

    setConversations(updated);
    localStorage.setItem('orca_conversations', JSON.stringify(updated));
    setInput(targetUserPrompt);
    // Autofocus textarea
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  };

  return (
    <div className="flex h-full gap-6 animate-in fade-in duration-500 w-full overflow-hidden p-6">
      
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept=".txt,.js,.json,.ts,.tsx,.css,.html,.md,.py,.go,.java,.cpp,.c,.rs"
      />

      {/* Left Workspace Sidebar */}
      <div className="w-14 flex flex-col items-center gap-3 border-r border-[var(--color-border-base)] pr-3 h-full shrink-0 pt-1">
        {workspaces.map(ws => {
          const isActive = ws.id === activeWorkspaceId;
          return (
            <button 
              key={ws.id}
              onClick={() => setActiveWorkspaceId(ws.id)}
              className={getWorkspaceStyles(ws.name, isActive)}
              title={`${ws.name} (${ws.path})`}
            >
              {ws.initial}
            </button>
          );
        })}
        <button 
          onClick={() => handleChooseDirectory()}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-light transition-all cursor-pointer border border-[var(--color-border-base)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[color-mix(in_srgb,var(--color-primary)_40%,var(--color-border-base))] bg-[var(--color-bg-card)] shadow-[var(--shadow-xs)] select-none"
          title={lang === 'en' ? 'Choose directory' : '选择目录'}
        >
          +
        </button>
        <button 
          onClick={() => setSettingsOpen(true)}
          className="w-10 h-10 mt-auto rounded-xl flex items-center justify-center transition-all cursor-pointer border border-[var(--color-border-base)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[color-mix(in_srgb,var(--color-primary)_40%,var(--color-border-base))] bg-[var(--color-bg-card)] shadow-[var(--shadow-xs)] select-none"
          title={lang === 'en' ? 'Settings' : '设置'}
        >
          <Settings className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Middle conversation sidebar */}
      <ConversationSidebar
        lang={lang}
        width={historySidebarWidth}
        onResizeMouseDown={handleMouseDown}
        activeWorkspace={activeWorkspace || null}
        workspaceMenuOpen={workspaceMenuOpen}
        onToggleWorkspaceMenu={() => setWorkspaceMenuOpen(v => !v)}
        onCloseWorkspaceMenu={() => setWorkspaceMenuOpen(false)}
        onEditWorkspace={() => handleChooseDirectory(activeWorkspaceId)}
        onEnableWorkspace={() => setWorkspaceMenuOpen(false)}
        onClearNotifications={handleClearNotifications}
        onCloseWorkspace={handleCloseWorkspace}
        convSearch={convSearch}
        onConvSearchChange={setConvSearch}
        onNewChat={handleNewChat}
        activeChat={activeChat || null}
        filteredConversations={filteredConversations}
        totalConversations={conversations.length}
        loadingChats={loadingChats}
        activeId={activeId}
        onSelectChat={setActiveId}
        onDeleteChat={handleDeleteChat}
        onExportMarkdown={handleExportMarkdown}
        onExportJSON={handleExportJSON}
        onImportJSON={handleImportJSON}
      />


      {/* Right chat window */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        
        {/* Chat window header */}
        {activeChat && (
          <ChatHeader
            lang={lang}
            activeChat={activeChat}
            useAgent={useAgent}
            presetName={presets[activeChat.preset]?.name ? presets[activeChat.preset]?.name.split(' (')[0] : ''}
            qualityName={(qualities[activeChat.quality] || qualities.high).name}
            modelLabel={displayModelLabel(models, activeChat.model)}
            rightSidebarOpen={rightSidebarOpen}
            onToggleSidebar={() => {
              const next = !rightSidebarOpen;
              setRightSidebarOpen(next);
              // Persist the choice — otherwise the sidebar re-expands on
              // every page (re)mount because the initializer defaults to open.
              localStorage.setItem('orca_right_sidebar_open', String(next));
            }}
            onOpenRewind={() => setRewindOpen(true)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
        )}

        {/* Dynamic Loading Bar at the top of chat interface */}
        {loadingChats[activeId] && (
          <div className="w-full h-1 relative overflow-hidden bg-[var(--color-bg-hover)] shrink-0 mb-3 rounded-full">
            <div className="orca-progress-bar absolute top-0 left-0 h-full w-full rounded-full"></div>
          </div>
        )}

        {/* Message history */}
        <div 
          ref={messagesContainerRef}
          onScroll={debouncedScrollHandler}
          className="flex-1 overflow-y-auto mb-4 bg-[var(--color-bg-base)] rounded-xl pr-2 space-y-6"
        >
          {(!activeChat || activeChat.messages.filter(msg => msg.role !== 'system').length === 0) && (
            <ChatEmptyState
              lang={lang}
              useAgent={useAgent}
              models={models}
              modelLabel={activeChat ? displayModelLabel(models, activeChat.model) : ''}
              onSuggest={(text) => {
                setInput(text);
                // Focus the composer so the user can send immediately.
                setTimeout(() => textareaRef.current?.focus(), 0);
              }}
            />
          )}
          {(() => {
            const allMsgs = (activeChat?.messages || []).filter(msg => msg.role !== 'system');
            const WARM = 24;
            const coldMsgs = allMsgs.slice(0, Math.max(0, allMsgs.length - WARM));
            const hotMsgs = allMsgs.slice(-WARM);
            const renderMsgs = showAllHistory ? allMsgs : hotMsgs;
            return (
            <>
            {coldMsgs.length > 0 && (
              <button
                onClick={() => setShowAllHistory(!showAllHistory)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors select-none cursor-pointer border border-dashed border-[var(--color-border-base)]"
              >
                {showAllHistory
                  ? (lang === 'en' ? `Hide earlier history (${coldMsgs.length} msgs)` : `收起较早消息 (${coldMsgs.length} 条)`)
                  : (lang === 'en' ? `Show earlier history (${coldMsgs.length} msgs)` : `显示较早消息 (${coldMsgs.length} 条)`)}
              </button>
            )}
            {renderMsgs.map((msg, i) => (
            <div key={i} className={`msg-rise flex gap-3.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {msg.role !== 'system' && (
                <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center shadow-[var(--shadow-sm)] ${
                  msg.role === 'user'
                    ? 'orca-gradient-tile text-white'
                    : 'bg-[var(--color-bg-card)] border border-[var(--color-border-base)] text-[var(--color-primary)]'
                }`}>
                  {msg.role === 'user' ? <User className="w-[18px] h-[18px]" /> : <Bot className="w-[18px] h-[18px]" />}
                </div>
              )}
              <div className={`${msg.role === 'system' ? 'w-full flex justify-center' : (msg.role === 'assistant' && hasAgentActivity(msg.content) ? 'w-full' : 'max-w-[85%]')}`}>
                {msg.role === 'system' ? (
                  <div className="px-4 py-2 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-full text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-2 shadow-sm animate-in slide-in-from-top-2 duration-300">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
                    {cleanThinkTags(msg.content)}
                  </div>
                ) : msg.role === 'assistant' && hasAgentActivity(msg.content) ? (
                  // Cursor-style timeline: agent activity (thinking/tools/todos)
                  // renders full-width with a left rail, no bubble.
                  <div className="border-l-2 border-[var(--color-border-base)] pl-4">
                    <MemoizedAssistantMessage
                      content={msg.content}
                      lang={lang}
                      onFileOp={trackFileOperation}
                    />
                  </div>
                ) : (
                  <div className={`p-4 rounded-2xl text-[14px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[var(--color-primary)] text-white rounded-tr-md shadow-[var(--shadow-primary)] whitespace-pre-wrap'
                      : 'orca-bubble text-[var(--color-text-primary)] rounded-tl-md'
                  }`}>
                    {msg.role === 'user' ? (
                      cleanThinkTags(msg.content)
                    ) : (
                      <MemoizedAssistantMessage 
                        content={msg.content} 
                        lang={lang} 
                        onFileOp={trackFileOperation}
                      />
                    )}
                  </div>
                )}
                {msg.role !== 'system' && (
                  <MessageFooter
                    lang={lang}
                    msg={msg}
                    useAgent={useAgent}
                    modelLabel={displayModelLabel(models, (activeChat as any).model)}
                    lastUsage={lastUsage}
                    onRollback={() => rollbackTo((activeChat as any).messages.indexOf(msg))}
                    onCopy={() => navigator.clipboard.writeText(msg.content)}
                  />
                )}
              </div>
            </div>
          ))}
            </>
            );
          })()}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-20 right-4 w-10 h-10 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-full shadow-lg flex items-center justify-center transition-all cursor-pointer z-10"
            title={lang === 'en' ? 'Scroll to bottom' : '滚动到底部'}
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        )}

              

        {/* Ask question card (agent ask_question tool) */}
        {pendingAsk && (
          <div className="shrink-0 border border-[color-mix(in_srgb,var(--color-primary)_30%,var(--color-border-base))] bg-[color-mix(in_srgb,var(--color-primary)_5%,var(--color-bg-card))] rounded-2xl p-4 mb-3 shadow-[var(--shadow-sm)] animate-in fade-in duration-200">
            <div className="flex items-start gap-3">
              <div className="orca-gradient-tile w-8 h-8 shrink-0 rounded-lg text-white flex items-center justify-center">
                <HelpCircle className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-[var(--color-text-primary)] mb-1 uppercase tracking-wider">
                  {lang === 'en' ? 'Agent question' : '智能体提问'}
                </div>
                <div className="text-sm text-[var(--color-text-secondary)] mb-2">{pendingAsk.question}</div>
                {pendingAsk.options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {pendingAsk.options.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => setAskAnswerText(opt)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          askAnswerText === opt
                            ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10'
                            : 'border-[var(--color-border-base)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={askAnswerText}
                    onChange={(e) => setAskAnswerText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAskAnswer(); } }}
                    placeholder={lang === 'en' ? 'Type your answer...' : '输入你的回答...'}
                    className="flex-1 px-3 py-2 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-lg text-xs outline-none focus:border-[var(--color-primary)] text-[var(--color-text-primary)]"
                  />
                  <button
                    onClick={submitAskAnswer}
                    disabled={!askAnswerText.trim() || askSubmitting}
                    className="orca-btn-primary px-3.5 py-2 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:shadow-none"
                  >
                    {askSubmitting ? (lang === 'en' ? 'Sending...' : '发送中...') : (lang === 'en' ? 'Answer' : '回答')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Input box section */}
        <Composer
          lang={lang}
          useAgent={useAgent}
          input={input}
          attachedFile={attachedFile}
          activeChat={activeChat || null}
          loading={!!loadingChats[activeId]}
          contextTokens={contextTokens}
          cacheRate={cacheRate}
          models={models}
          modelsByProvider={modelsByProvider}
          qualities={qualities}
          skills={skills}
          mcpTools={mcpTools}
          activeSkillId={activeSkillId}
          inputMenu={inputMenu}
          atFolderStack={atFolderStack}
          atLoading={atLoading}
          filteredAtItems={filteredAtItems}
          filteredSlashCommands={filteredSlashCommands}
          todoShelf={useAgent && displayTotal > 0 ? { tasks: displayTasks, done: displayDone, total: displayTotal, running: isTaskRunning, collapsed: todoShelfCollapsed } : null}
          isRecording={isRecording}
          recordingSeconds={recordingSeconds}
          activeDropdown={activeDropdown}
          textareaRef={textareaRef}
          inputMenuRef={inputMenuRef}
          dropdownsRef={dropdownsRef}
          composingRef={composingRef}
          toast={toast}
          onInputChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onSend={handleSend}
          onStop={handleStop}
          onRemoveAttachedFile={() => setAttachedFile(null)}
          onAttachFileClick={() => fileInputRef.current?.click()}
          onGoBackAtFolder={goBackAtFolder}
          onInsertAtFile={insertAtFile}
          onApplySlashCommand={applySlashCommand}
          onStopRecording={handleStopRecording}
          onToggleTodoShelf={() => setTodoShelfCollapsed(v => !v)}
          onSetUseAgent={setUseAgent}
          onModelChange={handleModelChange}
          onQualityChange={handleQualityChange}
          onSetSkill={setActiveSkillId}
          onSetDropdown={setActiveDropdown}
        />
      </div>

      {/* Right Sidebar Panel */}
      {rightSidebarOpen && (
        <RightSidebar
          lang={lang}
          width={rightSidebarWidth}
          onResizeMouseDown={handleRightSidebarMouseDown}
          tab={rightSidebarTab}
          onTabChange={setRightSidebarTab}
          displayTasks={displayTasks}
          displayDone={displayDone}
          displayTotal={displayTotal}
          displayProgress={displayProgress}
          liveTaskPhase={liveTaskPhase}
          isTaskRunning={isTaskRunning}
          modifiedFiles={modifiedFiles}
          onClearModifiedFiles={() => setModifiedFiles([])}
          modifiedFilesExpanded={modifiedFilesExpanded}
          onToggleModifiedFiles={() => setModifiedFilesExpanded(v => !v)}
          fileSearchQuery={fileSearchQuery}
          onFileSearchChange={setFileSearchQuery}
          onOpenFile={handleOpenFile}
          workspaceFilesExpanded={workspaceFilesExpanded}
          onToggleWorkspaceFiles={() => setWorkspaceFilesExpanded(v => !v)}
          workspaceItems={getFilteredItems()}
          expandedPaths={expandedPaths}
          loadingFolders={loadingFolders}
          onToggleFolder={toggleFolder}
          onAttachFile={handleAttachFile}
          gitInfo={gitInfo}
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          committing={committing}
          onGitCommit={handleGitCommit}
          onQuickFill={handleQuickFill}
          activeTaskId={activeTaskId}
        />
      )}


      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNewChat={handleNewChat}
        onNewBuildPlan={() => setUseAgent(true)}
        onClearContext={() => {
          if (activeChat) clearContext(activeChat.id);
        }}
        lang={lang}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        lang={lang}
        isDark={isDark}
        toggleTheme={toggleTheme}
        accent={accent}
        setAccent={setAccent}
        theme={theme}
        setTheme={setTheme}
      />

      <RewindModal
        open={rewindOpen}
        taskId={activeTaskId}
        onClose={() => setRewindOpen(false)}
        onRewound={() => { /* git/workspace state refreshes via the existing pollers */ }}
        lang={lang}
      />

      <ShortcutsCheatsheet
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        lang={lang}
      />

    </div>
  );
}

