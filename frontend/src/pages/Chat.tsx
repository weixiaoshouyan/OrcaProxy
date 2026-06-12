import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ArrowUp, ChevronDown, Sparkles, Bot, User, Settings2, Trash2, FileText, X, Square, Terminal, Loader, CheckCircle, Check, CornerUpLeft, Copy, Brain, Eye, Play, Zap, PanelRightOpen, PanelRightClose, GitBranch, FolderGit2, Activity, Clock, Download, Upload, Folder, FolderOpen, Search, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { useNavigate } from 'react-router-dom';
import { api, fetchEventSource } from '../api';
import { translate as t } from '../i18n';
import type { Language } from '../i18n';

interface Message {
  role: string;
  content: string;
  timestamp?: string;
}

interface Conversation {
  id: string;
  workspaceId?: string;
  title: string;
  preset: string; // 'standard' | 'code' | 'bug' | 'translate'
  quality: string; // 'high' | 'medium' | 'low' | 'creative'
  model: string;
  messages: Message[];
}

function PenSquareIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      style={props.style}
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 1 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}

export default function Chat({ lang }: { lang: Language }) {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [input, setInput] = useState('');
  const [models, setModels] = useState<{ id: string; name: string; providerName: string }[]>([]);
  const [loadingChats, setLoadingChats] = useState<Record<string, boolean>>({});
  const [activeDropdown, setActiveDropdown] = useState<'none' | 'preset' | 'model' | 'quality' | 'readyTools' | 'buildPlan'>('none');
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  const retryCountRef = useRef<Record<string, number>>({});
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 3000;

  // Sync loadingChats to ref for use in useEffect without causing re-renders
  useEffect(() => {
    loadingChatsRef.current = loadingChats;
  }, [loadingChats]);

  const handleStop = (chatId?: string) => {
    const id = chatId || activeId;
    const controller = abortControllersRef.current[id];
    if (controller) {
      controller.abort();
      delete abortControllersRef.current[id];
    }
    setLoadingChats(prev => ({ ...prev, [id]: false }));
  };

  useEffect(() => {
    return () => {
      // Don't abort controllers on unmount - let them complete in background
      // and save results to localStorage
      // Object.values(abortControllersRef.current).forEach(controller => controller.abort());
    };
  }, []);
  
  // Agent mode & skills state
  const [useAgent, setUseAgent] = useState(true);
  const [activeSkillId, setActiveSkillId] = useState('');
  const [skills, setSkills] = useState<any[]>([]);
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [currentTaskList, setCurrentTaskList] = useState<{status: 'pending' | 'running' | 'completed' | 'done', description: string}[]>([]);
  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const loadingChatsRef = useRef<Record<string, boolean>>({});

  // Workspace selector state
  interface Workspace {
    id: string;
    name: string;
    path: string;
    initial: string;
  }
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [historySidebarWidth, setHistorySidebarWidth] = useState(() => {
    return parseInt(localStorage.getItem('orca_chat_history_width') || '220');
  });
  const [convSearch, setConvSearch] = useState('');

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
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
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
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
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
  const streamBufferRef = useRef<string>('');
  const streamRafRef = useRef<number | null>(null);
  const lastStorageWriteRef = useRef<number>(0);
  const STORAGE_DEBOUNCE = 2000;

  // Right sidebar state
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => {
    return localStorage.getItem('orca_right_sidebar_open') !== 'false';
  });
  const [rightSidebarTab, setRightSidebarTab] = useState<'tasks' | 'files' | 'git'>('tasks');
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
      alert(lang === 'en' ? 'Failed to open file.' : '打开文件失败。');
    }
  };

  // Workspace explorer tree types & state
  interface WorkspaceItem {
    name: string;
    relativePath: string;
    absolutePath: string;
    isDirectory: boolean;
    size?: number;
  }
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
        alert(lang === 'en' ? 'Failed to read file: ' + (response.data.error || 'unknown error') : '读取文件失败：' + (response.data.error || '未知错误'));
      }
    } catch (err: any) {
      alert(lang === 'en' ? 'Failed to read file: ' + err.message : '读取文件失败：' + err.message);
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
        alert(lang === 'en' ? 'Changes committed successfully!' : '提交成功！');
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
      alert((lang === 'en' ? 'Failed to commit: ' : '提交失败: ') + (err.response?.data?.error || err.message));
    } finally {
      setCommitting(false);
    }
  };

  // Track tool execution for file monitoring
  const trackFileOperation = useCallback((toolName: string, content: string) => {
    const fileOps = ['write_to_file', 'write', 'replace_in_file', 'edit_file', 'create_file'];
    if (fileOps.some(op => toolName.toLowerCase().includes(op.toLowerCase()))) {
      const fileMatch = content.match(/["']?([a-zA-Z0-9_\-/.\\]+\.\w{1,10})["']?/);
      if (fileMatch) {
        setModifiedFiles(prev => {
          const exists = prev.find(f => f.path === fileMatch[1]);
          if (exists) return prev;
          return [{ path: fileMatch[1], action: 'modified', time: new Date().toLocaleTimeString() }, ...prev.slice(0, 49)];
        });
      }
    }
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
    api.get('/api/providers').then(res => {
      const activeModels: any[] = [];
      res.data.forEach((p: any) => {
        // Only list models if provider is configured
        if (p.configured) {
          p.models.forEach((m: any) => {
            activeModels.push({
              id: m.id,
              name: m.name,
              providerName: p.name
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
            loadedConversations = parsed.map(c => ({
              ...c,
              workspaceId: c.workspaceId || 'ws_default'
            }));
          }
        } catch (e) {}
      }
      
      if (loadedConversations.length > 0) {
        setConversations(loadedConversations);
        setActiveId(loadedConversations[0].id);
      } else {
        // If no saved conversations, create a default one
        const defaultId = 'chat_' + Date.now();
        const defaultChat: Conversation = {
          id: defaultId,
          workspaceId: 'ws_default',
          title: lang === 'en' ? 'New Chat' : '新会话',
          preset: 'standard',
          quality: 'high',
          model: activeModels[0]?.id || 'deepseek-chat',
          messages: [{ role: 'system', content: presets.standard.systemPrompt }]
        };
        setConversations([defaultChat]);
        setActiveId(defaultId);
        localStorage.setItem('orca_conversations', JSON.stringify([defaultChat]));
      }
    }).catch(console.error);
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
    api.post('/api/choose-directory').then(res => {
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

  // Calculate context token usage from active conversation
  useEffect(() => {
    if (!activeChat) return;
    const allContent = activeChat.messages.map(m => m.content).join(' ');
    const estimatedTokens = Math.ceil(allContent.length / 4);
    const modelLimits: Record<string, number> = {
      'deepseek-chat': 65536, 'deepseek-reasoner': 65536,
      'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000,
      'claude-sonnet-4-20250514': 200000, 'claude-3-5-haiku-20241022': 200000,
      'qwen-turbo': 131072, 'qwen-plus': 131072, 'qwen-max': 32768, 'qwen-long': 10000000,
      'glm-4': 131072, 'glm-4-flash': 131072,
      'moonshot-v1-8k': 8192, 'moonshot-v1-32k': 32768, 'moonshot-v1-128k': 131072,
    };
    const total = modelLimits[activeChat.model] || 65536;
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
      return 'w-10 h-10 rounded-[10px] flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border-[2px] border-[#1a3a4b] text-[#24818d] bg-[#e2f3f5] font-extrabold shadow-sm';
    }
    
    const palettes = [
      'w-10 h-10 rounded-[10px] flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border border-transparent text-[#9c5a9c] bg-[#f6eaf6] hover:opacity-90',
      'w-10 h-10 rounded-[10px] flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border border-transparent text-[#5c8a5c] bg-[#eaf6ea] hover:opacity-90',
      'w-10 h-10 rounded-[10px] flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border border-transparent text-[#5c6ea3] bg-[#eaeaf6] hover:opacity-90',
      'w-10 h-10 rounded-[10px] flex items-center justify-center text-sm font-bold transition-all relative cursor-pointer border border-transparent text-[#a35c5c] bg-[#f6eaea] hover:opacity-90',
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
      model: activeChat?.model || models[0]?.id || 'deepseek-chat',
      messages: [{ role: 'system', content: presets.standard.systemPrompt }]
    };
    const updated = [newChat, ...conversations];
    setActiveId(newId);
    saveChatsToStorage(updated);
  };

  const handleDeleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (conversations.length === 1) {
      alert(t('chat.delete.confirm', lang));
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
        alert(lang === 'en' ? 'Invalid JSON file.' : '无效的 JSON 文件');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        handleNewChat();
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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeId, loadingChats, conversations]);

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
      alert(t('chat.file.large', lang));
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
  }, [conversations, activeId, useAgent]);

  const handleSend = async () => {
    const chatId = activeId;
    if ((!input.trim() && !attachedFile) || loadingChats[chatId] || !activeChat) return;

    // Re-enable auto-scroll when user sends a message
    isAutoScrollEnabled.current = true;
    setShowScrollButton(false);

    let userPrompt = input;
    // Embed attached file if exists
    if (attachedFile) {
      userPrompt = lang === 'en' 
        ? `[Attached File: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\`\n${userPrompt}`
        : `[附带文件: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\`\n${userPrompt}`;
    }

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newMessages = [...activeChat.messages, { role: 'user', content: userPrompt, timestamp: timeStr }];
    
    // Clear input & attachments
    setInput('');
    setAttachedFile(null);
    retryCountRef.current[chatId] = 0;
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

    // Prepare API body parameters
    const tempValue = (qualities[activeChat.quality] || qualities.high).temp;
    const body = {
      model: activeChat.model,
      messages: newMessages.filter(m => m.role !== 'system'),
      temperature: tempValue,
      stream: true,
      useAgent,
      activeSkillId,
      workspacePath: activeWorkspace?.path || ''
    };

    const controller = new AbortController();
    abortControllersRef.current[chatId] = controller;

    await fetchEventSource('/v1/chat/completions', body, 
      (data) => {
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            streamBufferRef.current += delta;
            // Batch state updates via rAF to prevent render jank
            if (!streamRafRef.current) {
              streamRafRef.current = requestAnimationFrame(() => {
                streamRafRef.current = null;
                const buffered = streamBufferRef.current;
                if (!buffered) return;
                streamBufferRef.current = '';
                setConversations(prev => {
                  const updated = prev.map(c => {
                    if (c.id === chatId) {
                      const msgs = [...c.messages];
                      if (msgs[assistantIndex]) {
                        msgs[assistantIndex] = {
                          role: 'assistant',
                          content: msgs[assistantIndex].content + buffered,
                          timestamp: msgs[assistantIndex].timestamp || timeStr
                        };
                      }
                      return { ...c, messages: msgs };
                    }
                    return c;
                  });
                  // Debounce localStorage writes
                  const now = Date.now();
                  if (now - lastStorageWriteRef.current >= STORAGE_DEBOUNCE) {
                    lastStorageWriteRef.current = now;
                    localStorage.setItem('orca_conversations', JSON.stringify(updated));
                  }
                  return updated;
                });
              });
            }
          }
        } catch(e) {}
      },
      () => {
        // Flush remaining buffer
        if (streamRafRef.current) {
          cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = null;
        }
        const remaining = streamBufferRef.current;
        if (remaining) {
          streamBufferRef.current = '';
          setConversations(prev => {
            const updated = prev.map(c => {
              if (c.id === chatId) {
                const msgs = [...c.messages];
                if (msgs[assistantIndex]) {
                  msgs[assistantIndex] = {
                    role: 'assistant',
                    content: msgs[assistantIndex].content + remaining,
                    timestamp: msgs[assistantIndex].timestamp || timeStr
                  };
                }
                return { ...c, messages: msgs };
              }
              return c;
            });
            localStorage.setItem('orca_conversations', JSON.stringify(updated));
            return updated;
          });
        }
        setLoadingChats(prev => ({ ...prev, [chatId]: false }));
        delete abortControllersRef.current[chatId];
      },
      (err) => {
        if (err.name === 'AbortError') {
          console.log('Request aborted by user');
          setLoadingChats(prev => ({ ...prev, [chatId]: false }));
          delete abortControllersRef.current[chatId];
          delete retryCountRef.current[chatId];
          return;
        }
        console.error(err);
        // Flush any pending stream buffer before retrying
        if (streamRafRef.current) {
          cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = null;
        }
        const pendingBuffer = streamBufferRef.current;
        streamBufferRef.current = '';
        const currentRetry = retryCountRef.current[chatId] || 0;
        if (currentRetry < MAX_RETRIES) {
          retryCountRef.current[chatId] = currentRetry + 1;
          const retryNum = currentRetry + 1;
          const retryMsg = lang === 'en'
            ? '\n\n[Connection lost. Retrying (' + retryNum + '/' + MAX_RETRIES + ')...]'
            : '\n\n[连接中断，正在重试 (' + retryNum + '/' + MAX_RETRIES + ')…]';
          setConversations(prev => {
            const updated = prev.map(c => {
              if (c.id === chatId) {
                const msgs = [...c.messages];
                if (msgs[assistantIndex]) {
                  const currentContent = msgs[assistantIndex].content + (pendingBuffer || '');
                  msgs[assistantIndex] = { role: 'assistant', content: currentContent + retryMsg, timestamp: msgs[assistantIndex].timestamp || timeStr };
                }
                return { ...c, messages: msgs };
              }
              return c;
            });
            localStorage.setItem('orca_conversations', JSON.stringify(updated));
            return updated;
          });
          delete abortControllersRef.current[chatId];
          setTimeout(() => {
            if (retryCountRef.current[chatId] !== undefined) {
              handleSend();
            }
          }, RETRY_DELAY);
          return;
        }
        delete retryCountRef.current[chatId];
        const errMsg = lang === 'en'
          ? '\n\n[Error: Failed after retries. Please check network and provider settings.]'
          : '\n\n[错误: 重试后仍无法获取响应，请检查网络和供应商配置。]';
        setConversations(prev => {
          const updated = prev.map(c => {
            if (c.id === chatId) {
              const msgs = [...c.messages];
              if (msgs[assistantIndex]) {
                msgs[assistantIndex] = { role: 'assistant', content: msgs[assistantIndex].content + errMsg, timestamp: msgs[assistantIndex].timestamp || timeStr };
              }
              return { ...c, messages: msgs };
            }
            return c;
          });
          localStorage.setItem('orca_conversations', JSON.stringify(updated));
          return updated;
        });
        setLoadingChats(prev => ({ ...prev, [chatId]: false }));
        delete abortControllersRef.current[chatId];
      },
      controller.signal
    );
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

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
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
          className="w-10 h-10 rounded-[10px] flex items-center justify-center text-xl font-light transition-all cursor-pointer border border-[var(--color-border-base)] text-gray-400 dark:text-gray-500 hover:text-[var(--color-text-primary)] hover:border-gray-400 bg-[var(--color-bg-card)] shadow-sm select-none"
          title={lang === 'en' ? 'Choose directory' : '选择目录'}
        >
          +
        </button>
      </div>

      {/* Middle conversation sidebar */}
      <div 
        style={{ width: `${historySidebarWidth}px` }}
        className="relative flex flex-col gap-3.5 border-r border-[var(--color-border-base)] pr-4 h-full shrink-0 pt-1"
      >
        {/* Resize Handle */}
        <div 
          onMouseDown={handleMouseDown}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--color-primary)]/40 active:bg-[var(--color-primary)]/60 transition-colors z-30"
          title="Drag to resize / 拖动调整大小"
        />
        {activeWorkspace && (
          <div className="px-2 select-none flex flex-col gap-0.5 relative">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-[var(--color-text-primary)] truncate">
                {activeWorkspace.name}
              </span>
              <button 
                onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                title={lang === 'en' ? 'Workspace Menu' : '工作区菜单'}
              >
                <span className="text-lg font-bold leading-none">...</span>
              </button>
            </div>
            <div className="text-[11px] text-[var(--color-text-muted)] truncate font-mono" title={activeWorkspace.path}>
              {activeWorkspace.path}
            </div>

            {workspaceMenuOpen && (
              <div 
                className="absolute top-8 right-0 bg-white dark:bg-slate-900 border border-[var(--color-border-base)] rounded-xl shadow-lg z-50 w-36 py-1 text-left"
                onMouseLeave={() => setWorkspaceMenuOpen(false)}
              >
                <div 
                  onClick={() => {
                    handleChooseDirectory(activeWorkspaceId);
                    setWorkspaceMenuOpen(false);
                  }}
                  className="px-4 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  {lang === 'en' ? 'Edit' : '编辑'}
                </div>
                <div 
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                  }}
                  className="px-4 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  {lang === 'en' ? 'Enable Workspace' : '启用工作区'}
                </div>
                <div 
                  onClick={() => {
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
                  }}
                  className="px-4 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  {lang === 'en' ? 'Clear Notifications' : '清除通知'}
                </div>
                <div className="border-t border-[var(--color-border-base)] my-1" />
                <div 
                  onClick={() => {
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
                  }}
                  className="px-4 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-red-500 cursor-pointer"
                >
                  {lang === 'en' ? 'Close' : '关闭'}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Conversation Search */}
        <div className="relative">
          <input
            type="text"
            value={convSearch}
            onChange={(e) => setConvSearch(e.target.value)}
            placeholder={lang === 'en' ? 'Search conversations...' : '搜索会话...'}
            className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/40 focus:ring-1 focus:ring-[var(--color-primary)]/20 transition-all"
          />
          {convSearch && (
            <button
              onClick={() => setConvSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button 
          onClick={handleNewChat}
          className="flex items-center justify-center gap-1.5 w-full py-2 bg-white dark:bg-slate-900 border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg shadow-sm transition-all cursor-pointer mt-1"
        >
          <PenSquareIcon className="w-4 h-4 text-gray-500" />
          <span>{lang === 'en' ? 'New Chat' : '新建会话'}</span>
        </button>

        {/* Export / Import row */}
        <div className="flex gap-1 mt-1">
          <button
            onClick={handleExportMarkdown}
            disabled={!activeChat}
            title={lang === 'en' ? 'Export as Markdown' : '导出 Markdown'}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white dark:bg-slate-900 border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-xs rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3 h-3" />
            <span>MD</span>
          </button>
          <button
            onClick={handleExportJSON}
            disabled={conversations.length === 0}
            title={lang === 'en' ? 'Export all as JSON' : '导出全部 JSON'}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white dark:bg-slate-900 border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-xs rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3 h-3" />
            <span>JSON</span>
          </button>
          <label
            title={lang === 'en' ? 'Import JSON' : '导入 JSON'}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white dark:bg-slate-900 border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-xs rounded-lg transition-all cursor-pointer"
          >
            <Upload className="w-3 h-3" />
            <span>{lang === 'en' ? 'Import' : '导入'}</span>
            <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 pr-1 mt-2">
          {(convSearch ? filteredConversations.filter(c => 
            c.title.toLowerCase().includes(convSearch.toLowerCase()) ||
            c.messages.some(m => m.content.toLowerCase().includes(convSearch.toLowerCase()))
          ) : filteredConversations).map(chat => {
            const isActive = chat.id === activeId;
            const isChatLoading = loadingChats[chat.id];
            return (
              <div 
                key={chat.id}
                onClick={() => setActiveId(chat.id)}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                  isActive 
                    ? 'bg-[#eaeff2] dark:bg-slate-800 text-[var(--color-text-primary)] font-semibold' 
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <div className="truncate flex-1 pr-2">
                  <div className="text-[13px] flex items-center gap-1.5">
                    {isChatLoading && <Loader className="w-3 h-3 animate-spin text-[#24818d] shrink-0" />}
                    <span className="truncate">{chat.title}</span>
                  </div>
                  {chat.messages.length > 0 && (
                    <div className="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5 pl-[1px]">
                      {chat.messages[chat.messages.length - 1].content?.substring(0, 30).replace(/[\n\r]/g, ' ') || ''}
                    </div>
                  )}
                </div>
                <button 
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 text-gray-400 transition-opacity p-0.5"
                  title={t('chat.delete.tooltip', lang)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right chat window */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        
        {/* Chat window Header details */}
        {activeChat && (
          <div className="mb-4 flex items-center justify-between shrink-0 bg-[var(--color-bg-base)] border-b border-[var(--color-border-base)]/50 pb-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">{activeChat.title}</h2>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--color-text-secondary)] select-none">
                <span className="bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 px-2.5 py-0.5 rounded-md font-medium text-[10.5px]">
                  {useAgent 
                    ? (lang === 'en' ? 'Agent Assistant (Build)' : '智能体助手 (Build)') 
                    : (presets[activeChat.preset]?.name ? presets[activeChat.preset]?.name.split(' (')[0] + ' (Plan)' : 'Plan')
                  }
                </span>
                <span className="bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 px-2.5 py-0.5 rounded-md font-medium text-[10.5px]">
                  {(qualities[activeChat.quality] || qualities.high).name}
                </span>
                <span className="font-mono text-gray-400 dark:text-gray-500 text-[10.5px] truncate max-w-[200px]">
                  {activeChat.model}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => navigate('/providers')}
                className="p-1.5 rounded-lg border border-[var(--color-border-base)] bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors text-gray-500 shadow-sm cursor-pointer"
                title={lang === 'en' ? 'Provider & Model Settings' : '模型供应商设置'}
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Loading Bar at the top of chat interface */}
        {loadingChats[activeId] && (
          <div className="w-full h-1 relative overflow-hidden bg-gray-100 dark:bg-slate-800/50 shrink-0 mb-3 rounded-full">
            <div className="absolute top-0 left-0 h-full w-full bg-gradient-to-r from-blue-500 via-emerald-500 to-indigo-500 animate-loading-bar rounded-full"></div>
          </div>
        )}

        {/* Message history */}
        <div 
          ref={messagesContainerRef}
          onScroll={debouncedScrollHandler}
          className="flex-1 overflow-y-auto mb-4 bg-[var(--color-bg-base)] rounded-xl pr-2 space-y-6"
        >
          {(!activeChat || activeChat.messages.filter(msg => msg.role !== 'system').length === 0) && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-4 select-none">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
                {lang === 'en' ? 'Hello! How can I help you?' : '你好！有什么可以帮你的？'}
              </h2>
              <p className="text-sm text-[var(--color-text-muted)] mb-6">
                {useAgent ? (lang === 'en' ? 'Build Mode · Full access' : 'Build 模式 · 完全权限') : (lang === 'en' ? 'Plan Mode · Read-only' : 'Plan 模式 · 只读')}
                {activeChat && ` · ${activeChat.model}`}
              </p>
              <div className="grid grid-cols-2 gap-2 max-w-md w-full">
                {[
                  { icon: <FileText className="w-4 h-4" />, text: lang === 'en' ? 'Analyze this codebase' : '分析当前代码库' },
                  { icon: <Zap className="w-4 h-4" />, text: lang === 'en' ? 'Fix bugs in my project' : '修复项目中的 Bug' },
                  { icon: <Terminal className="w-4 h-4" />, text: lang === 'en' ? 'Write unit tests' : '编写单元测试' },
                  { icon: <Sparkles className="w-4 h-4" />, text: lang === 'en' ? 'Refactor & optimize' : '重构和优化代码' },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => setInput(item.text)}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border-base)] hover:bg-[var(--color-bg-hover)] text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer shadow-sm"
                  >
                    {item.icon}
                    <span>{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeChat?.messages.filter(msg => msg.role !== 'system').map((msg, i) => (
            <div key={i} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {msg.role !== 'system' && (
                <div className={`w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center shadow-sm ${
                  msg.role === 'user' ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' : 'bg-[var(--color-bg-card)] border border-[var(--color-border-base)] text-[var(--color-primary)]'
                }`}>
                  {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                </div>
              )}
              <div className={`max-w-[85%] ${msg.role === 'system' ? 'w-full flex justify-center' : ''}`}>
                {msg.role === 'system' ? (
                  <div className="px-4 py-2 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-full text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-2 shadow-sm animate-in slide-in-from-top-2 duration-300">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
                    {cleanThinkTags(msg.content)}
                  </div>
                ) : (
                  <div className={`p-4 rounded-2xl shadow-sm text-[14px] leading-relaxed ${
                    msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-sm whitespace-pre-wrap' : 'bg-[var(--color-bg-card)] border border-[var(--color-border-base)] text-[var(--color-text-primary)] rounded-tl-sm'
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
                  <div className={`flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mt-1.5 px-1 select-none w-full gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className="flex items-center gap-1 font-medium">
                      <span>{useAgent ? 'Build' : 'Plan'}</span>
                      <span>·</span>
                      <span className="truncate max-w-[150px]">{activeChat.model}</span>
                      <span>·</span>
                      <span>{msg.timestamp || '22:29'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                      <button 
                        onClick={(e) => { e.stopPropagation(); rollbackTo(i); }}
                        className="hover:text-red-500 transition-colors p-0.5 cursor-pointer"
                        title={lang === 'en' ? 'Rollback to this point' : '回滚/编辑'}
                      >
                        <CornerUpLeft className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(msg.content);
                        }}
                        className="hover:text-[var(--color-text-primary)] transition-colors p-0.5 cursor-pointer"
                        title={lang === 'en' ? 'Copy content' : '复制内容'}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
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

              

        {/* Input box section */}
        <div className="shrink-0 flex flex-col gap-3">
          


          {/* File attach chip */}
          {attachedFile && (
            <div className="flex items-center gap-2 bg-[var(--color-bg-hover)] border border-[var(--color-border-base)] px-3 py-1.5 rounded-xl self-start text-xs font-semibold animate-in slide-in-from-bottom-2">
              <FileText className="w-4 h-4 text-blue-500" />
              <span className="max-w-xs truncate text-[var(--color-text-primary)]">{attachedFile.name}</span>
              <button 
                onClick={() => setAttachedFile(null)}
                className="hover:text-red-500 transition-colors p-0.5"
                title={t('chat.file.delete', lang)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div 
            onClick={(e) => {
              if (e.target !== textareaRef.current) {
                textareaRef.current?.focus();
              }
            }}
            className="relative bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-[var(--color-primary)]/50 focus-within:border-[var(--color-primary)] transition-all flex flex-col overflow-hidden cursor-text"
          >
            
            {isRecording ? (
              <div 
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-0 bg-[var(--color-bg-card)] z-20 flex items-center justify-between px-6 py-4 animate-in fade-in duration-200"
              >
                <div className="flex items-center gap-4">
                  <div className="w-4 h-4 rounded-full bg-red-500 animate-ping"></div>
                  <span className="text-sm font-semibold text-red-500">{t('chat.voice.recording', lang)} {formatSeconds(recordingSeconds)}</span>
                </div>
                
                {/* Audio wave mock animation */}
                <div className="flex items-end gap-1 h-6">
                  <div className="w-1 bg-red-500 rounded-full animate-[pulse_0.8s_infinite] h-4"></div>
                  <div className="w-1 bg-red-500 rounded-full animate-[pulse_0.4s_infinite] h-6"></div>
                  <div className="w-1 bg-red-500 rounded-full animate-[pulse_0.6s_infinite] h-2"></div>
                  <div className="w-1 bg-red-500 rounded-full animate-[pulse_0.5s_infinite] h-5"></div>
                  <div className="w-1 bg-red-500 rounded-full animate-[pulse_0.7s_infinite] h-3"></div>
                </div>

                <button 
                  onClick={(e) => { e.stopPropagation(); handleStopRecording(); }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-white" /> {t('chat.voice.stop', lang)}
                </button>
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = textareaRef.current;
                if (el) {
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 300) + 'px';
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t('chat.input.placeholder', lang)}
              className="w-full bg-transparent text-[var(--color-text-primary)] p-4 pb-2 resize-none outline-none text-[15px] min-h-[80px] max-h-[300px] overflow-y-auto"
              rows={1}
            />
            
            <div className="flex items-center justify-between p-3 pt-1">
              <button 
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 transition-colors cursor-pointer text-xl font-light"
                title={t('chat.file.tooltip', lang)}
              >
                +
              </button>
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (loadingChats[activeId]) {
                    handleStop(); 
                  } else {
                    handleSend(); 
                  }
                }}
                disabled={!loadingChats[activeId] && ((!input.trim() && !attachedFile) || !activeChat)}
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-250 cursor-pointer ${
                  loadingChats[activeId] 
                    ? 'bg-red-500 text-white shadow-md shadow-red-500/20 animate-pulse' 
                    : (!input.trim() && !attachedFile) || !activeChat
                      ? 'bg-gray-100 dark:bg-slate-800/80 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                }`}
                title={loadingChats[activeId] ? (lang === 'en' ? 'Stop' : '停止运行') : (lang === 'en' ? 'Send' : '发送')}
              >
                {loadingChats[activeId] ? (
                  <Square className="w-4 h-4 fill-white" />
                ) : (
                  <ArrowUp className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
          
          {/* Bottom Dropdowns */}
          {activeChat && (
            <div ref={dropdownsRef} className="flex items-center gap-2 px-2 select-none relative z-30">
              
              {/* Dropdown 1: Build / Plan Selector */}
              <div className="relative">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDropdown(activeDropdown === 'buildPlan' ? 'none' : 'buildPlan');
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors bg-[var(--color-bg-hover)] px-3 py-1.5 rounded-lg shadow-sm cursor-pointer"
                >
                  {useAgent ? (
                    <>
                      <Play className="w-3 h-3 text-emerald-500 fill-emerald-500/20" />
                      <span>{lang === 'en' ? 'Build Mode' : 'Build 执行'}</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3 h-3 text-blue-500" />
                      <span>{lang === 'en' ? 'Plan Mode' : 'Plan 规划'}</span>
                    </>
                  )}
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
                {activeDropdown === 'buildPlan' && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-full left-0 mb-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl shadow-lg z-30 w-36 py-1 overflow-hidden"
                  >
                    <div 
                      onClick={() => {
                        setUseAgent(false);
                        setActiveDropdown('none');
                      }} 
                      className={`px-3 py-2 text-xs hover:bg-[var(--color-bg-hover)] cursor-pointer flex items-center gap-2 transition-colors ${!useAgent ? 'bg-[var(--color-bg-hover)] font-bold text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'}`}
                    >
                      <Eye className="w-3.5 h-3.5 text-blue-500" />
                      <span>{lang === 'en' ? 'Plan Mode' : 'Plan 规划'}</span>
                      {!useAgent && <Check className="w-3.5 h-3.5 ml-auto shrink-0" />}
                    </div>
                    <div 
                      onClick={() => {
                        setUseAgent(true);
                        setActiveDropdown('none');
                      }} 
                      className={`px-3 py-2 text-xs hover:bg-[var(--color-bg-hover)] cursor-pointer flex items-center gap-2 transition-colors ${useAgent ? 'bg-[var(--color-bg-hover)] font-bold text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'}`}
                    >
                      <Play className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500/20" />
                      <span>{lang === 'en' ? 'Build Mode' : 'Build 执行'}</span>
                      {useAgent && <Check className="w-3.5 h-3.5 ml-auto shrink-0" />}
                    </div>
                  </div>
                )}
              </div>

              {/* Dropdown 2: Model Selector */}
              <div className="relative">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDropdown(activeDropdown === 'model' ? 'none' : 'model');
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors bg-[var(--color-bg-hover)] px-3 py-1.5 rounded-lg shadow-sm cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-amber-500 fill-amber-500/20 animate-pulse" />
                  <span className="truncate max-w-[150px]">{activeChat.model}</span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
                {activeDropdown === 'model' && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-full left-0 mb-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl shadow-lg z-30 w-72 py-2 max-h-80 overflow-y-auto"
                  >
                    {models.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[var(--color-text-muted)] italic">{t('chat.models.empty', lang)}</div>
                    ) : (
                      Object.entries(modelsByProvider).map(([providerName, providerModels]) => (
                        <div key={providerName} className="mb-2 last:mb-0">
                          <div className="px-3 py-1.5 text-[11px] font-semibold text-[#a06a55] select-none bg-slate-50/50 dark:bg-slate-800/30">
                            {providerName}
                          </div>
                          {providerModels.map(m => {
                            const isSelected = activeChat.model === m.id;
                            return (
                              <div 
                                key={m.id} 
                                onClick={() => {
                                  handleModelChange(m.id);
                                  setActiveDropdown('none');
                                }} 
                                className={`px-3 py-2 text-xs hover:bg-[var(--color-bg-hover)] cursor-pointer flex justify-between items-center transition-colors ${isSelected ? 'bg-[var(--color-bg-hover)] font-bold text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'}`}
                              >
                                <span className="truncate flex-1 pr-2">{m.name || m.id}</span>
                                {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                              </div>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Dropdown 3: Quality Selector */}
              <div className="relative">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDropdown(activeDropdown === 'quality' ? 'none' : 'quality');
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors bg-[var(--color-bg-hover)] px-3 py-1.5 rounded-lg shadow-sm cursor-pointer"
                >
                  <span>{(qualities[activeChat.quality] || qualities.high).name}</span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
                {activeDropdown === 'quality' && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-full left-0 mb-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl shadow-lg z-30 w-36 py-1 overflow-hidden"
                  >
                    {Object.entries(qualities).map(([key, val]) => {
                      const isSelected = activeChat.quality === key;
                      return (
                        <div 
                          key={key} 
                          onClick={() => {
                            handleQualityChange(key);
                            setActiveDropdown('none');
                          }} 
                          className={`px-3 py-2 text-xs hover:bg-[var(--color-bg-hover)] cursor-pointer flex justify-between items-center transition-colors ${isSelected ? 'bg-[var(--color-bg-hover)] font-bold text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'}`}
                        >
                          <span>{val.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Dropdown 4: Ready Tools Indicator */}
              <div className="relative">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDropdown(activeDropdown === 'readyTools' ? 'none' : 'readyTools');
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors bg-[var(--color-bg-hover)] px-3 py-1.5 rounded-lg shadow-sm cursor-pointer border border-[#a6e3a1]/25 hover:border-[#a6e3a1]/50"
                >
                  <span className="w-2 h-2 rounded-full bg-[#a6e3a1] animate-pulse"></span>
                  <span>{lang === 'en' ? `Tools (${skills.length + mcpTools.length})` : `就绪工具 (${skills.length + mcpTools.length})`}</span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
                {activeDropdown === 'readyTools' && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-full left-0 mb-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-xl shadow-lg z-30 w-80 py-3 px-4 max-h-[350px] overflow-y-auto"
                  >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--color-border-base)]">
                      <span className="text-xs font-bold text-[var(--color-text-primary)]">{lang === 'en' ? 'Active Tools & Skills' : '已就绪智能体工具'}</span>
                      <span className="text-[10px] text-emerald-500 font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">ONLINE</span>
                    </div>

                    {/* Section 1: Skills */}
                    <div className="mb-3">
                      <div className="text-[10.5px] font-bold text-amber-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        {lang === 'en' ? `Skills (${skills.length})` : `本地技能库 (${skills.length})`}
                      </div>
                      {skills.length === 0 ? (
                        <div className="text-[11px] text-[var(--color-text-muted)] italic pl-2.5">{lang === 'en' ? 'No local skills loaded.' : '暂无加载本地技能'}</div>
                      ) : (
                        <div className="flex flex-col gap-1 pl-2">
                          <div
                            onClick={() => setActiveSkillId('')}
                            className={`group flex flex-col p-1.5 rounded cursor-pointer transition-colors border ${activeSkillId === '' ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5' : 'border-transparent hover:bg-[var(--color-bg-hover)]'}`}
                          >
                            <span className="text-xs font-semibold text-[var(--color-text-muted)]">{lang === 'en' ? 'No skill (Normal Chat)' : '无技能 (常规对话)'}</span>
                          </div>
                          {skills.slice(0, 15).map((s: any) => (
                            <div
                              key={s.id}
                              onClick={() => setActiveSkillId(s.id)}
                              className={`group flex flex-col p-1.5 rounded cursor-pointer transition-colors border ${activeSkillId === s.id ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5' : 'border-transparent hover:bg-[var(--color-bg-hover)]'}`}
                            >
                              <span className="text-xs font-mono font-bold text-[var(--color-text-primary)]">{s.name}</span>
                              <span className="text-[10.5px] text-[var(--color-text-muted)] line-clamp-1 group-hover:line-clamp-none transition-all duration-200">{s.description || 'No description'}</span>
                            </div>
                          ))}
                          {skills.length > 15 && (
                            <div className="text-[10px] text-[var(--color-text-muted)] italic pl-1 pt-1">
                              {lang === 'en' ? `... and ${skills.length - 15} more skills` : `... 以及另外 ${skills.length - 15} 个技能`}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Section 2: MCP Tools */}
                    <div>
                      <div className="text-[10.5px] font-bold text-sky-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                        {lang === 'en' ? `MCP Tools (${mcpTools.length})` : `MCP 外部工具 (${mcpTools.length})`}
                      </div>
                      {mcpTools.length === 0 ? (
                        <div className="text-[11px] text-[var(--color-text-muted)] italic pl-2.5">{lang === 'en' ? 'No MCP tools connected.' : '未连接 MCP 外部工具'}</div>
                      ) : (
                        <div className="flex flex-col gap-1.5 pl-2 max-h-[150px] overflow-y-auto">
                          {mcpTools.map((t: any) => (
                            <div key={`${t.serverName}_${t.name}`} className="group flex flex-col p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors border-l-2 border-sky-500/30 pl-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-mono font-bold text-[var(--color-text-primary)]">{t.name}</span>
                                <span className="text-[9px] text-sky-500 font-bold bg-sky-500/10 px-1 py-0.2 rounded border border-sky-500/15">{t.serverName}</span>
                              </div>
                              <span className="text-[10.5px] text-[var(--color-text-muted)] line-clamp-1 group-hover:line-clamp-none transition-all duration-200">{t.description || 'No description'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Circular Context Indicator */}
              <div className="relative group">
                <button 
                  type="button"
                  className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors bg-[var(--color-bg-hover)] px-2.5 py-1.5 rounded-lg shadow-sm cursor-pointer border border-transparent"
                  title={`${lang === 'en' ? 'Context Window' : '上下文窗口'}: ${contextTokens.used.toLocaleString()} / ${contextTokens.total.toLocaleString()} tokens (${contextTokens.percent}%)`}
                >
                  <div className="relative w-4 h-4 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        className="stroke-gray-200 dark:stroke-slate-700"
                        strokeWidth="2"
                        fill="none"
                      />
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        className={`transition-all duration-500 ${
                          contextTokens.percent > 85 ? 'stroke-red-500' :
                          contextTokens.percent > 60 ? 'stroke-yellow-500' :
                          'stroke-emerald-500'
                        }`}
                        strokeWidth="2"
                        fill="none"
                        strokeDasharray={2 * Math.PI * 6}
                        strokeDashoffset={2 * Math.PI * 6 * (1 - contextTokens.percent / 100)}
                      />
                    </svg>
                  </div>
                  <span className="font-mono text-[10.5px]">{contextTokens.percent}%</span>
                </button>
                
                {/* Tooltip on Hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-900 text-white text-[10px] rounded-lg py-1.5 px-2.5 whitespace-nowrap z-50 shadow-md font-mono select-text text-left">
                  <div>Used: {contextTokens.used.toLocaleString()}</div>
                  <div>Total: {contextTokens.total.toLocaleString()}</div>
                  {contextTokens.percent > 85 && (
                    <div className="text-red-400 mt-1">{lang === 'en' ? '⚠️ Near Limit' : '⚠️ 接近上限'}</div>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar Toggle Button (when collapsed) */}
      {!rightSidebarOpen && (
        <button
          onClick={() => {
            setRightSidebarOpen(true);
            localStorage.setItem('orca_right_sidebar_open', 'true');
          }}
          className="fixed right-4 top-1/2 -translate-y-1/2 w-8 h-16 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-l-lg shadow-md flex items-center justify-center hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer z-20"
          title={lang === 'en' ? 'Open sidebar' : '打开侧边栏'}
        >
          <PanelRightOpen className="w-4 h-4 text-[var(--color-text-secondary)]" />
        </button>
      )}

      {/* Right Sidebar Panel */}
      {rightSidebarOpen && (
        <div
          style={{ width: `${rightSidebarWidth}px` }}
          className="relative flex flex-col border-l border-[var(--color-border-base)] pl-4 h-full shrink-0"
        >
          {/* Resize Handle */}
          <div
            onMouseDown={handleRightSidebarMouseDown}
            className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--color-primary)]/40 active:bg-[var(--color-primary)]/60 transition-colors z-30"
            title="Drag to resize"
          />

          {/* Sidebar Header with Tabs & Collapse */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--color-border-base)] shrink-0">
            <div className="flex items-center gap-0.5 bg-[var(--color-bg-hover)] rounded-lg p-0.5">
              <button
                onClick={() => setRightSidebarTab('tasks')}
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                  rightSidebarTab === 'tasks'
                    ? 'bg-white dark:bg-slate-800 text-[var(--color-text-primary)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Activity className="w-3 h-3" />
                <span>{lang === 'en' ? 'Tasks' : '任务'}</span>
                {currentTaskList.length > 0 && (
                  <span className={`text-[10px] font-bold px-1 rounded ${
                    isTaskRunning ? 'bg-blue-500 text-white' : 'bg-emerald-500 text-white'
                  }`}>
                    {currentTaskList.filter(t => t.status === 'completed').length}/{currentTaskList.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setRightSidebarTab('files')}
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                  rightSidebarTab === 'files'
                    ? 'bg-white dark:bg-slate-800 text-[var(--color-text-primary)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <FileText className="w-3 h-3" />
                <span>{lang === 'en' ? 'Files' : '文件'}</span>
                {modifiedFiles.length > 0 && (
                  <span className="text-[10px] font-bold px-1 rounded bg-amber-500 text-white">{modifiedFiles.length}</span>
                )}
              </button>
              <button
                onClick={() => setRightSidebarTab('git')}
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                  rightSidebarTab === 'git'
                    ? 'bg-white dark:bg-slate-800 text-[var(--color-text-primary)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <GitBranch className="w-3 h-3" />
                <span>Git</span>
                {gitInfo.status === 'dirty' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                )}
              </button>
            </div>
            <button
              onClick={() => {
                setRightSidebarOpen(false);
                localStorage.setItem('orca_right_sidebar_open', 'false');
              }}
              className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
              title={lang === 'en' ? 'Close sidebar' : '关闭侧边栏'}
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Tasks Tab */}
            {rightSidebarTab === 'tasks' && (
              <div className="space-y-3">
                {currentTaskList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[200px] text-center px-4">
                    <Activity className="w-10 h-10 text-[var(--color-text-muted)] mb-3 opacity-40" />
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {lang === 'en'
                        ? 'No active tasks. Start a build session to see tasks here.'
                        : '暂无活跃任务。启动 Build 模式后会在此显示任务列表。'}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                        <span>{lang === 'en' ? 'Overall Progress' : '总体进度'}</span>
                        <span className="font-mono">
                          {Math.round(currentTaskList.length > 0
                            ? (currentTaskList.filter(t => t.status === 'completed').length / currentTaskList.length) * 100
                            : 0)}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            isTaskRunning ? 'bg-blue-500' : 'bg-emerald-500'
                          }`}
                          style={{
                            width: `${currentTaskList.length > 0
                              ? (currentTaskList.filter(t => t.status === 'completed').length / currentTaskList.length) * 100
                              : 0}%`
                          }}
                        />
                      </div>
                    </div>

                    {/* Task Items */}
                    <div className="space-y-0.5">
                      {currentTaskList.map((task, idx) => (
                        <div
                          key={idx}
                          className={`flex items-start gap-2.5 p-2 rounded-lg text-xs transition-colors ${
                            task.status === 'running'
                              ? 'bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30'
                              : 'hover:bg-[var(--color-bg-hover)]'
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {task.status === 'completed' && (
                              <CheckCircle className="w-4 h-4 text-emerald-500" />
                            )}
                            {task.status === 'running' && (
                              <Loader className="w-4 h-4 text-blue-500 animate-spin" />
                            )}
                            {task.status === 'pending' && (
                              <Clock className="w-4 h-4 text-gray-400" />
                            )}
                          </div>
                          <span className={`flex-1 leading-relaxed ${
                            task.status === 'completed'
                              ? 'text-[var(--color-text-muted)] line-through'
                              : task.status === 'running'
                                ? 'text-blue-700 dark:text-blue-300 font-semibold'
                                : 'text-[var(--color-text-secondary)]'
                          }`}>
                            {task.description}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Files / Explorer Tab */}
            {rightSidebarTab === 'files' && (
              <div className="flex flex-col h-full space-y-4 px-1 pb-4">
                {/* File Search */}
                <div className="relative shrink-0 mx-1">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-[var(--color-text-muted)]">
                    <Search className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder={lang === 'en' ? 'Search files...' : '搜索文件...'}
                    className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg pl-8 pr-7 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/40 focus:ring-1 focus:ring-[var(--color-primary)]/20 transition-all font-sans"
                  />
                  {fileSearchQuery && (
                    <button
                      onClick={() => setFileSearchQuery('')}
                      className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Session Modified Files List */}
                {!fileSearchQuery && (
                  <div className="border-b border-[var(--color-border-base)] pb-3 shrink-0 mx-1">
                    <div 
                      onClick={() => setModifiedFilesExpanded(!modifiedFilesExpanded)}
                      className="flex items-center justify-between text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-text-primary)] select-none mb-1.5"
                    >
                      <div className="flex items-center gap-1">
                        <ChevronDown className={`w-3 h-3 transition-transform ${modifiedFilesExpanded ? '' : '-rotate-90'}`} />
                        <span>{lang === 'en' ? 'Modified in Session' : '本会话已修改'}</span>
                        {modifiedFiles.length > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500 text-white font-mono ml-1">
                            {modifiedFiles.length}
                          </span>
                        )}
                      </div>
                      {modifiedFiles.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setModifiedFiles([]);
                          }}
                          className="text-[10px] text-gray-400 hover:text-red-500 transition-colors cursor-pointer capitalize font-semibold normal-case"
                        >
                          {lang === 'en' ? 'Clear' : '清除'}
                        </button>
                      )}
                    </div>

                    {modifiedFilesExpanded && (
                      <div className="space-y-0.5 max-h-[140px] overflow-y-auto pr-0.5">
                        {modifiedFiles.length === 0 ? (
                          <div className="text-[11px] text-[var(--color-text-muted)] italic py-1 px-4">
                            {lang === 'en' ? 'No files modified yet' : '暂无修改文件'}
                          </div>
                        ) : (
                          modifiedFiles.map((file, idx) => (
                            <div
                              key={idx}
                              onClick={() => handleOpenFile(file.path)}
                              className="flex items-center gap-2 p-1.5 rounded-lg text-xs hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer group/file"
                            >
                              <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-mono text-[10.5px] text-[var(--color-text-primary)] truncate group-hover/file:text-[var(--color-primary)] transition-colors" title={file.path}>
                                  {file.path}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[9px] px-1 py-0.1 rounded bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-semibold font-mono">
                                    {file.action}
                                  </span>
                                  <span className="text-[9px] text-[var(--color-text-muted)]">{file.time}</span>
                                </div>
                              </div>
                              <Eye className="w-3 h-3 text-gray-400 opacity-0 group-hover/file:opacity-100 transition-opacity" />
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Workspace Files Explorer */}
                <div className="flex-1 flex flex-col min-h-0 mx-1">
                  <div 
                    onClick={() => setWorkspaceFilesExpanded(!workspaceFilesExpanded)}
                    className="flex items-center justify-between text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-text-primary)] select-none mb-1.5"
                  >
                    <div className="flex items-center gap-1">
                      <ChevronDown className={`w-3 h-3 transition-transform ${workspaceFilesExpanded ? '' : '-rotate-90'}`} />
                      <span>{lang === 'en' ? 'Workspace Explorer' : '项目资源管理器'}</span>
                    </div>
                  </div>

                  {workspaceFilesExpanded && (
                    <div className="flex-1 overflow-y-auto pr-0.5 space-y-0.5 font-mono text-[11.5px] select-none">
                      {getFilteredItems().length === 0 ? (
                        <div className="text-[11px] text-[var(--color-text-muted)] italic py-2 px-4">
                          {lang === 'en' ? 'No files found' : '没有找到文件'}
                        </div>
                      ) : (
                        getFilteredItems().map(({ item, depth }) => {
                          const isExpanded = !!expandedPaths[item.relativePath];
                          const isLoading = !!loadingFolders[item.relativePath];
                          
                          let iconColor = 'text-gray-400 dark:text-gray-500';
                          if (item.isDirectory) {
                            iconColor = 'text-blue-500 dark:text-blue-400';
                          } else {
                            const ext = item.name.split('.').pop()?.toLowerCase();
                            if (ext === 'js' || ext === 'ts' || ext === 'tsx' || ext === 'jsx') {
                              iconColor = 'text-amber-500 dark:text-amber-400';
                            } else if (ext === 'css' || ext === 'html' || ext === 'scss') {
                              iconColor = 'text-sky-500 dark:text-sky-400';
                            } else if (ext === 'py' || ext === 'go' || ext === 'rs') {
                              iconColor = 'text-emerald-500 dark:text-emerald-400';
                            } else if (ext === 'md' || ext === 'json') {
                              iconColor = 'text-purple-500 dark:text-purple-400';
                            }
                          }

                          return (
                            <div
                              key={item.absolutePath}
                              style={{ paddingLeft: `${depth * 10 + 4}px` }}
                              onClick={() => item.isDirectory ? toggleFolder(item.relativePath) : handleOpenFile(item.absolutePath)}
                              className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer group/item"
                            >
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <span className="shrink-0">
                                  {item.isDirectory ? (
                                    isExpanded ? (
                                      <FolderOpen className={`w-3.5 h-3.5 ${iconColor}`} />
                                    ) : (
                                      <Folder className={`w-3.5 h-3.5 ${iconColor}`} />
                                    )
                                  ) : (
                                    <FileText className={`w-3.5 h-3.5 ${iconColor}`} />
                                  )}
                                </span>
                                
                                <span className="truncate text-[var(--color-text-secondary)] group-hover/item:text-[var(--color-text-primary)] transition-colors" title={item.name}>
                                  {item.name}
                                </span>
                                
                                {isLoading && (
                                  <Loader className="w-3 h-3 text-[var(--color-primary)] animate-spin shrink-0" />
                                )}
                              </div>

                              {!item.isDirectory && (
                                <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity pl-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAttachFile(item);
                                    }}
                                    className="p-1 rounded hover:bg-[var(--color-bg-card)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
                                    title={lang === 'en' ? 'Attach to prompt context' : '添加到输入上下文'}
                                  >
                                    <Paperclip className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenFile(item.absolutePath);
                                    }}
                                    className="p-1 rounded hover:bg-[var(--color-bg-card)] text-[var(--color-text-muted)] hover:text-emerald-500 transition-colors cursor-pointer"
                                    title={lang === 'en' ? 'Open file locally' : '本地打开文件'}
                                  >
                                    <Eye className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Git Tab */}
            {rightSidebarTab === 'git' && (
              <div className="space-y-4">
                {gitInfo.status === 'no-repo' ? (
                  <div className="flex flex-col items-center justify-center h-[200px] text-center px-4">
                    <FolderGit2 className="w-10 h-10 text-[var(--color-text-muted)] mb-3 opacity-40" />
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {lang === 'en' ? 'Not a git repository.' : '当前工作区不是 Git 仓库。'}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Branch Info */}
                    <div className="bg-[var(--color-bg-hover)] rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <GitBranch className="w-4 h-4 text-[var(--color-primary)]" />
                        <span className="text-sm font-bold font-mono text-[var(--color-text-primary)]">{gitInfo.branch}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex flex-col">
                          <span className="text-[var(--color-text-muted)]">{lang === 'en' ? 'Modified' : '已修改'}</span>
                          <span className={`font-bold font-mono text-sm ${gitInfo.changes > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {gitInfo.changes}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[var(--color-text-muted)]">{lang === 'en' ? 'Untracked' : '未跟踪'}</span>
                          <span className={`font-bold font-mono text-sm ${gitInfo.untracked > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {gitInfo.untracked}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        gitInfo.status === 'clean'
                          ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                      }`}>
                        {gitInfo.status === 'clean' ? '✓ Clean' : '● Dirty'}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[200px]" title={gitInfo.lastCommit}>
                        {lang === 'en' ? 'Last commit' : '最近提交'}: {gitInfo.lastCommit}
                      </span>
                    </div>

                    {/* Modified Files List in Git */}
                    {gitInfo.modifiedFiles && gitInfo.modifiedFiles.length > 0 && (
                      <div className="space-y-1.5 mt-2">
                        <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
                          {lang === 'en' ? 'Changed Files' : '文件改动列表'}
                        </span>
                        <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border border-[var(--color-border-base)] rounded-lg p-1.5 bg-white/40 dark:bg-slate-900/40">
                          {gitInfo.modifiedFiles.map((file, idx) => {
                            const isUntracked = file.status.includes('?');
                            const isDeleted = file.status.includes('D');
                            const isAdded = file.status.includes('A');
                            
                            let badgeColor = 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300';
                            if (isUntracked) badgeColor = 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
                            else if (isDeleted) badgeColor = 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300';
                            else if (isAdded) badgeColor = 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300';
                            
                            return (
                              <div 
                                key={idx} 
                                onClick={() => handleOpenFile(file.filepath)}
                                className="flex items-center justify-between text-[11px] font-mono py-1 px-1.5 hover:bg-[var(--color-bg-hover)] rounded cursor-pointer group/gitfile"
                              >
                                <span className="truncate flex-1 text-[var(--color-text-secondary)] mr-2 group-hover/gitfile:text-[var(--color-primary)] transition-colors" title={file.filepath}>
                                  {file.filepath}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold shrink-0 ${badgeColor}`}>
                                  {file.status.trim() || 'M'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Git Commit Form */}
                    {gitInfo.status === 'dirty' && (
                      <form onSubmit={handleGitCommit} className="space-y-2 border-t border-[var(--color-border-base)] pt-3 mt-2">
                        <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
                          {lang === 'en' ? 'Commit Changes' : '提交改动'}
                        </span>
                        <input
                          type="text"
                          value={commitMessage}
                          onChange={(e) => setCommitMessage(e.target.value)}
                          placeholder={lang === 'en' ? 'Commit message...' : '提交说明...'}
                          required
                          className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]/40 focus:ring-1 focus:ring-[var(--color-primary)]/20 transition-all font-sans"
                        />
                        <button
                          type="submit"
                          disabled={committing}
                          className="w-full py-2 text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-400 text-white transition-colors cursor-pointer text-center shadow-sm"
                        >
                          {committing 
                            ? (lang === 'en' ? 'Committing...' : '提交中...') 
                            : (lang === 'en' ? 'Stage & Commit' : '暂存并提交')}
                        </button>
                      </form>
                    )}

                    {/* Quick Actions */}
                    <div className="flex gap-2 border-t border-[var(--color-border-base)] pt-3 mt-2">
                      <button
                        onClick={() => {
                          setInput(input => input + (input ? ' ' : '') + (lang === 'en' ? 'Show me the git diff' : '请帮我查看当前的 git diff'));
                          textareaRef.current?.focus();
                        }}
                        className="flex-1 py-2 text-xs font-semibold rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border-base)] hover:bg-white dark:hover:bg-slate-800 text-[var(--color-text-primary)] transition-colors cursor-pointer text-center"
                        title={lang === 'en' ? 'Ask agent to show git diff' : '请智能体显示 git diff'}
                      >
                        {lang === 'en' ? 'Show Diff' : '查看改动'}
                      </button>
                      <button
                        onClick={() => {
                          setInput(input => input + (input ? ' ' : '') + (lang === 'en' ? 'Summarize the recent git changes and suggest a commit message' : '请总结最近的 git 改动并建议一个 commit message'));
                          textareaRef.current?.focus();
                        }}
                        className="flex-1 py-2 text-xs font-semibold rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 hover:bg-[var(--color-primary)]/20 text-[var(--color-primary)] transition-colors cursor-pointer text-center"
                        title={lang === 'en' ? 'Ask agent for commit suggestion' : '请智能体建议 commit'}
                      >
                        {lang === 'en' ? 'Suggest Commit' : '提交建议'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

function parseAssistantMessage(content: string) {
  const parts: { type: 'text' | 'tool' | 'think'; content: string; toolName?: string; status?: 'done' | 'running' }[] = [];
  
  // Parse think blocks first
  const thinkStart = content.indexOf('<think>');
  if (thinkStart >= 0) {
    const textBefore = content.substring(0, thinkStart);
    if (textBefore.trim()) {
      parts.push(...parseToolsAndText(textBefore));
    }
    
    const thinkEnd = content.indexOf('</think>', thinkStart);
    if (thinkEnd >= 0) {
      const thinkContent = content.substring(thinkStart + 7, thinkEnd);
      parts.push({ type: 'think', content: thinkContent, status: 'done' });
      
      const textAfter = content.substring(thinkEnd + 8);
      if (textAfter.trim()) {
        parts.push(...parseToolsAndText(textAfter));
      }
    } else {
      const thinkContent = content.substring(thinkStart + 7);
      parts.push({ type: 'think', content: thinkContent, status: 'running' });
    }
  } else {
    parts.push(...parseToolsAndText(content));
  }
  
  return parts;
}

function parseToolsAndText(content: string) {
  const parts: { type: 'text' | 'tool'; content: string; toolName?: string; status?: 'done' | 'running' }[] = [];
  const toolSplitter = /> 🔧 \*\*Agent Executing Tool:\*\* `(.*?)`\.\.\./g;
  let lastIndex = 0;
  let match;
  
  while ((match = toolSplitter.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore.trim()) {
      parts.push({ type: 'text', content: textBefore });
    }
    
    const toolName = match[1];
    const rest = content.substring(toolSplitter.lastIndex);
    const codeBlockMatch = rest.match(/^\n*```\n([\s\S]*?)\n```/);
    
    if (codeBlockMatch) {
      parts.push({
        type: 'tool',
        toolName,
        content: codeBlockMatch[1],
        status: 'done'
      });
      toolSplitter.lastIndex += codeBlockMatch[0].length;
    } else {
      const codeBlockStartMatch = rest.match(/^\n*```\n([\s\S]*)$/);
      const toolOutput = codeBlockStartMatch ? codeBlockStartMatch[1] : '';
      parts.push({
        type: 'tool',
        toolName,
        content: toolOutput,
        status: 'running'
      });
      toolSplitter.lastIndex = content.length;
    }
    
    lastIndex = toolSplitter.lastIndex;
  }
  
  if (lastIndex < content.length) {
    const textAfter = content.substring(lastIndex);
    if (textAfter.trim() || parts.length === 0) {
      parts.push({ type: 'text', content: textAfter });
    }
  }
  
  return parts;
}

function cleanThinkTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<think>/gi, '')
    .replace(/<\/think>/gi, '')
    .replace(/<thinking>/gi, '')
    .replace(/<\/thinking>/gi, '')
    .trim();
}

function ThinkingBlock({ content, status, lang }: { content: string; status?: 'done' | 'running'; lang: Language }) {
  const [isExpanded, setIsExpanded] = useState(status === 'running');
  const cleanedContent = cleanThinkTags(content);

  useEffect(() => {
    if (status === 'running') setIsExpanded(true);
    else if (status === 'done') setIsExpanded(false);
  }, [status]);
  
  return (
    <div className="my-3 border border-[var(--color-border-base)] rounded-xl overflow-hidden shadow-sm bg-gray-50/50 dark:bg-slate-900/30">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-4 py-2.5 bg-gray-100/70 dark:bg-slate-800/40 text-gray-500 dark:text-gray-400 text-xs border-b border-[var(--color-border-base)] select-none cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-2 font-semibold">
          <Brain className={`w-4 h-4 text-purple-500 ${status === 'running' ? 'animate-pulse' : ''}`} />
          <span>{lang === 'en' ? 'Thinking Process' : '思考过程'}</span>
          {status === 'running' && <span className="flex h-1.5 w-1.5 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-purple-500"></span></span>}
        </div>
        <button className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          {isExpanded ? (lang === 'en' ? 'Collapse' : '收起') : (lang === 'en' ? 'Expand' : '展开')}
        </button>
      </div>
      {isExpanded && (
        <div className="p-4 text-xs font-mono whitespace-pre-wrap text-gray-600 dark:text-gray-300 leading-relaxed max-h-[300px] overflow-y-auto bg-white/30 dark:bg-slate-950/20 italic">
          {cleanedContent || (lang === 'en' ? 'Thinking...' : '正在思考...')}
        </div>
      )}
    </div>
  );
}

// Lightweight syntax tokenizer for code blocks
const SYNTAX_KW: Record<string, string[]> = {
  js: ['const','let','var','function','return','if','else','for','while','class','import','export','from','default','async','await','new','this','try','catch','throw','typeof','instanceof','switch','case','break','continue','do','in','of','yield','null','undefined','true','false','void','delete','super','extends','static','get','set'],
  ts: ['const','let','var','function','return','if','else','for','while','class','import','export','from','default','async','await','new','this','try','catch','throw','typeof','instanceof','switch','case','type','interface','enum','implements','extends','abstract','readonly','private','public','protected','as','is','keyof','infer','never','unknown','any','null','undefined','true','false','void','declare'],
  py: ['def','class','import','from','return','if','elif','else','for','while','try','except','finally','with','as','in','not','and','or','is','True','False','None','pass','break','continue','yield','lambda','raise','global','nonlocal','assert','del','async','await','self','print'],
  go: ['func','package','import','var','const','type','struct','interface','return','if','else','for','range','switch','case','default','go','defer','chan','map','select','make','new','append','len','nil','true','false','break','continue','fallthrough'],
  rs: ['fn','let','mut','const','if','else','for','while','loop','match','return','struct','enum','impl','trait','pub','use','mod','self','super','crate','async','await','move','ref','type','where','true','false','Some','None','Ok','Err','unsafe','extern','static'],
  java: ['public','private','protected','static','final','class','interface','extends','implements','return','if','else','for','while','try','catch','throw','throws','new','import','package','void','int','long','double','float','boolean','char','String','null','true','false','this','super','abstract','synchronized'],
  sh: ['if','then','else','elif','fi','for','while','do','done','case','esac','function','return','exit','echo','export','source','local','readonly','shift','set','unset','trap','eval','exec','cd','pwd','ls','cat','grep','sed','awk','find','sudo','chmod','mkdir','rm','cp','mv'],
  css: ['color','background','margin','padding','border','font','display','position','width','height','top','left','right','bottom','flex','grid','align','justify','transform','transition','animation','opacity','overflow','z-index','cursor','box-shadow'],
};
const KW_ALIAS: Record<string, string> = { javascript: 'js', typescript: 'ts', python: 'py', golang: 'go', rust: 'rs', bash: 'sh', shell: 'sh', jsx: 'js', tsx: 'ts', powershell: 'sh', scss: 'css', less: 'css' };

function tokenizeCode(code: string, lang?: string): string {
  const normLang = KW_ALIAS[lang || ''] || lang || '';
  const keywords = SYNTAX_KW[normLang] || SYNTAX_KW['js'] || [];
  let html = '';
  let i = 0;
  while (i < code.length) {
    if (code[i] === '/' && code[i + 1] === '/') {
      let end = code.indexOf('\n', i);
      if (end === -1) end = code.length;
      html += `<span class="hl-cmt">${esc(code.slice(i, end))}</span>`;
      i = end;
    } else if (code[i] === '#' && (normLang === 'py' || normLang === 'sh') && (i === 0 || code[i - 1] === '\n')) {
      let end = code.indexOf('\n', i);
      if (end === -1) end = code.length;
      html += `<span class="hl-cmt">${esc(code.slice(i, end))}</span>`;
      i = end;
    } else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const q = code[i]; let j = i + 1;
      while (j < code.length && code[j] !== q) { if (code[j] === '\\') j++; j++; }
      html += `<span class="hl-str">${esc(code.slice(i, Math.min(j + 1, code.length)))}</span>`;
      i = j + 1;
    } else if (/[0-9]/.test(code[i]) && (i === 0 || !/[a-zA-Z_$]/.test(code[i - 1]))) {
      let j = i;
      while (j < code.length && /[0-9.xXa-fA-FeE_]/.test(code[j])) j++;
      html += `<span class="hl-num">${esc(code.slice(i, j))}</span>`;
      i = j;
    } else if (/[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (keywords.includes(word)) html += `<span class="hl-kw">${esc(word)}</span>`;
      else html += esc(word);
      i = j;
    } else {
      html += esc(code[i]); i++;
    }
  }
  return html;
}
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function CodeBlock({ content, language, highlightLine }: { content: string; language?: string; highlightLine?: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const lines = content.split('\n');
  const lineCount = lines.length;
  const highlighted = lineCount <= 500 ? tokenizeCode(content, language) : esc(content);
  const lineNumWidth = String(lineCount).length;

  return (
    <div className="my-4 border border-[var(--color-border-base)] rounded-xl overflow-hidden shadow-sm bg-gray-50 dark:bg-slate-900 font-mono text-[13px] leading-relaxed">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 text-xs border-b border-[var(--color-border-base)] select-none">
        <div className="flex items-center gap-3">
          <span className="font-semibold uppercase tracking-wider">{language || 'code'}</span>
          <span className="text-[10px] opacity-60">{lineCount} lines</span>
        </div>
        <button onClick={handleCopy} className="flex items-center gap-1 hover:text-[var(--color-text-primary)] transition-colors px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 text-[11px] font-semibold cursor-pointer text-gray-600 dark:text-gray-300">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="flex overflow-x-auto max-h-[500px]">
        {/* Line numbers gutter */}
        <div className="shrink-0 select-none text-right pr-3 pl-3 py-4 bg-gray-100/50 dark:bg-slate-800/30 text-[11px] leading-relaxed text-gray-400 dark:text-gray-600 border-r border-[var(--color-border-base)] font-mono">
          {lines.map((_, i) => (
            <div 
              key={i} 
              className={`${highlightLine === i + 1 ? 'text-[var(--color-primary)] font-bold' : ''}`}
              style={{ minWidth: `${lineNumWidth + 1}ch` }}
            >
              {i + 1}
            </div>
          ))}
        </div>
        {/* Code */}
        <pre className="p-4 whitespace-pre text-[var(--color-text-primary)] min-w-0 flex-1">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>
    </div>
  );
}

interface TaskItem {
  status: 'pending' | 'running' | 'completed';
  description: string;
}

interface TaskBlock {
  type: 'text' | 'code' | 'tasks';
  content: string;
  language?: string;
  tasks?: TaskItem[];
}

function parseTextWithCodeBlocksAndTasks(text: string): TaskBlock[] {
  const parts: TaskBlock[] = [];
  const lines = text.split('\n');
  let currentBlock: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = '';
  let currentTasks: TaskItem[] = [];

  const flushCurrentTextOrTasks = () => {
    if (currentTasks.length > 0) {
      parts.push({
        type: 'tasks',
        content: '',
        tasks: currentTasks
      });
      currentTasks = [];
    } else if (currentBlock.length > 0) {
      parts.push({
        type: 'text',
        content: currentBlock.join('\n')
      });
      currentBlock = [];
    }
  };

  const taskRegex = /^\s*[-*+]\s+\[([ xX/])\]\s+(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        parts.push({
          type: 'code',
          content: currentBlock.join('\n'),
          language: codeLanguage
        });
        currentBlock = [];
        inCodeBlock = false;
        codeLanguage = '';
      } else {
        // Start of code block
        flushCurrentTextOrTasks();
        inCodeBlock = true;
        codeLanguage = line.trim().slice(3).trim();
      }
    } else if (inCodeBlock) {
      currentBlock.push(line);
    } else {
      const match = line.match(taskRegex);
      if (match) {
        if (currentBlock.length > 0) {
          parts.push({
            type: 'text',
            content: currentBlock.join('\n')
          });
          currentBlock = [];
        }
        
        const statusChar = match[1].toLowerCase();
        let status: 'pending' | 'running' | 'completed' = 'pending';
        if (statusChar === 'x') status = 'completed';
        else if (statusChar === '/') status = 'running';
        
        currentTasks.push({
          status,
          description: match[2].trim()
        });
      } else if (line.trim() === '' && currentTasks.length > 0) {
        continue;
      } else {
        if (currentTasks.length > 0) {
          parts.push({
            type: 'tasks',
            content: '',
            tasks: currentTasks
          });
          currentTasks = [];
        }
        currentBlock.push(line);
      }
    }
  }

  if (inCodeBlock) {
    parts.push({
      type: 'code',
      content: currentBlock.join('\n'),
      language: codeLanguage
    });
  } else {
    flushCurrentTextOrTasks();
  }

  return parts;
}

function TaskListWidget({ tasks }: { tasks: TaskItem[] }) {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="my-4 p-4 border border-[var(--color-border-base)] rounded-xl bg-gray-50/50 dark:bg-slate-900/40 backdrop-blur-sm shadow-sm max-w-xl animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-primary)]">
          {running > 0 ? '⚡ 任务执行中...' : (completed === total ? '✅ 任务已完成' : '📋 任务清单')}
        </span>
        <span className="text-xs font-mono text-[var(--color-text-muted)] font-medium">
          {completed}/{total} ({percent}%)
        </span>
      </div>
      
      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-800 rounded-full overflow-hidden mb-4">
        <div 
          className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-500" 
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="space-y-2.5">
        {tasks.map((task, idx) => {
          const isCompleted = task.status === 'completed';
          const isRunning = task.status === 'running';

          return (
            <div 
              key={idx} 
              className={`flex items-start gap-3 p-2 rounded-lg transition-all duration-300 ${
                isRunning 
                  ? 'bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/10 shadow-sm' 
                  : 'border border-transparent'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isCompleted && (
                  <span className="w-4 h-4 rounded-full bg-green-500 text-white flex items-center justify-center text-[10px] font-bold select-none shadow-sm">
                    ✓
                  </span>
                )}
                {isRunning && (
                  <span className="w-4 h-4 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center text-[10px] font-bold select-none animate-spin shadow-sm">
                    ↻
                  </span>
                )}
                {!isCompleted && !isRunning && (
                  <span className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600 bg-transparent flex items-center justify-center select-none" />
                )}
              </div>
              <div className={`text-xs leading-relaxed ${
                isCompleted 
                  ? 'text-[var(--color-text-muted)] line-through decoration-gray-400 dark:decoration-gray-600' 
                  : (isRunning ? 'text-[var(--color-text-primary)] font-semibold animate-pulse' : 'text-[var(--color-text-secondary)]')
              }`}>
                {task.description}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderDiffContent(content: string, isRunning: boolean) {
  if (!content) {
    return <span className="text-slate-500 italic">{isRunning ? 'Establishing pipeline with agent daemon...' : 'Output was empty'}</span>;
  }

  const lines = content.split('\n');
  const hasDiffIndicators = lines.some(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));
  
  if (!hasDiffIndicators) {
    return <span className="text-[#a6e3a1] whitespace-pre">{content}</span>;
  }

  return (
    <div className="flex flex-col font-mono text-[11px] leading-relaxed">
      {lines.map((line, idx) => {
        let className = "text-slate-300";
        let bgStyle = "";
        
        if (line.startsWith('+')) {
          className = "text-[#a6e3a1] font-semibold";
          bgStyle = "bg-emerald-500/10 border-l-2 border-emerald-500 pl-1.5";
        } else if (line.startsWith('-')) {
          className = "text-[#f38ba8] font-semibold";
          bgStyle = "bg-red-500/10 border-l-2 border-red-500 pl-1.5";
        } else if (line.startsWith('@@')) {
          className = "text-[#89b4fa] font-bold";
          bgStyle = "bg-[#89b4fa]/5 pl-1.5";
        } else {
          className = "text-slate-300 pl-2";
        }
        
        return (
          <div key={idx} className={`${bgStyle} min-h-[18px] py-0.5 whitespace-pre-wrap select-text`}>
            <span className={className}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

function ToolExecutionBlock({ block, lang, onFileOp }: { block: any; lang: string; onFileOp?: (name: string, content: string) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isRunning = block.status === 'running';

  useEffect(() => {
    if (!isRunning && onFileOp) {
      onFileOp(block.toolName || '', block.content || '');
    }
  }, [isRunning, block.toolName, block.content, onFileOp]);

  return (
    <div className="my-4 rounded-xl overflow-hidden shadow-md border border-[var(--color-border-base)] bg-gradient-to-br from-[var(--color-bg-card)] to-[var(--color-bg-base)] transition-all duration-300">
      {/* Header */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-4 py-3 bg-[var(--color-bg-sidebar)] hover:bg-[var(--color-bg-hover)] text-xs select-none cursor-pointer border-b border-[var(--color-border-base)] transition-colors"
      >
        {/* Left: Icon & Title */}
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            isRunning 
              ? 'bg-blue-500/10 text-blue-500' 
              : 'bg-emerald-500/10 text-emerald-500'
          }`}>
            {isRunning ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Terminal className="w-4 h-4" />
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--color-text-primary)]">
              {block.toolName || 'Terminal'}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {isRunning 
                ? (lang === 'en' ? 'Executing...' : '执行中...') 
                : (lang === 'en' ? 'Completed' : '已完成')
              }
            </span>
          </div>
        </div>
        
        {/* Right: Status badge & Toggle */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <span className="flex items-center gap-1.5 text-blue-500 font-semibold bg-blue-500/10 px-2.5 py-1 rounded-full text-[11px] border border-blue-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
              <span>{lang === 'en' ? 'Running' : '运行中'}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-500 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-full text-[11px] border border-emerald-500/20">
              <CheckCircle className="w-3.5 h-3.5" /> 
              <span>{lang === 'en' ? 'Done' : '完成'}</span>
            </span>
          )}
          
          <button className="p-1.5 rounded-lg hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Content Panel */}
      {isExpanded && (
        <div className="p-4 font-mono text-[12px] leading-relaxed overflow-x-auto animate-in slide-in-from-top-2 duration-200">
          {/* Command line */}
          <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-3 select-none">
            <span className="text-emerald-500 font-bold">$</span>
            <span className="text-[var(--color-text-secondary)]">{block.toolName}</span>
          </div>
          
          {/* Output */}
          <div className="overflow-x-auto bg-[var(--color-bg-sidebar)] p-4 rounded-lg border border-[var(--color-border-base)] font-mono select-text text-[var(--color-text-primary)]">
            {renderDiffContent(block.content, isRunning)}
          </div>
        </div>
      )}
    </div>
  );
}

// MEMOIZED ASSISTANT MESSAGE COMPONENTS TO PREVENT UI CRASH
interface AssistantMessageProps {
  content: string;
  lang: Language;
  onFileOp: (toolName: string, content: string) => void;
}

const AssistantMessageContent = ({ content, lang, onFileOp }: AssistantMessageProps) => {
  const parsedBlocks = useMemo(() => {
    return parseAssistantMessage(content);
  }, [content]);

  return (
    <div className="space-y-4">
      {parsedBlocks.map((block, idx) => {
        if (block.type === 'text') {
          return (
            <div key={idx} className="space-y-1">
              <MemoizedTextBlocks content={block.content} />
            </div>
          );
        } else if (block.type === 'think') {
          return (
            <ThinkingBlock 
              key={idx} 
              content={block.content} 
              status={block.status} 
              lang={lang}
            />
          );
        } else {
          return (
            <ToolExecutionBlock 
              key={idx} 
              block={block} 
              lang={lang} 
              onFileOp={onFileOp}
            />
          );
        }
      })}
    </div>
  );
};

export const MemoizedAssistantMessage = React.memo(AssistantMessageContent);

const TextBlocksContent = ({ content }: { content: string }) => {
  const subBlocks = useMemo(() => {
    return parseTextWithCodeBlocksAndTasks(content);
  }, [content]);

  return (
    <>
      {subBlocks.map((subBlock, sIdx) => {
        if (subBlock.type === 'text') {
          return (
            <div key={sIdx} className="orca-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>
                {subBlock.content}
              </ReactMarkdown>
            </div>
          );
        } else if (subBlock.type === 'tasks' && subBlock.tasks) {
          return (
            <TaskListWidget 
              key={sIdx}
              tasks={subBlock.tasks}
            />
          );
        } else {
          return (
            <CodeBlock 
              key={sIdx} 
              content={subBlock.content} 
              language={subBlock.language} 
            />
          );
        }
      })}
    </>
  );
};

export const MemoizedTextBlocks = React.memo(TextBlocksContent);