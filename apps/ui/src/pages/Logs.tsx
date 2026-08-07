import { useState, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TerminalSquare, RefreshCcw, Trash2, Search, AlertCircle, Info, Activity } from 'lucide-react';
import { api } from '../api';
import { translate as t } from '../i18n';
import type { Language } from '../i18n';

interface LogEntry {
  time: string;
  level: string;
  message: string;
}

interface LogsProps {
  lang: Language;
}

export default function Logs({ lang }: LogsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('ALL'); // 'ALL' | 'INFO' | 'WARN' | 'ERROR'
  const [searchQuery, setSearchQuery] = useState('');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabled = useRef(true);

  // Filter logs based on search and selected level
  const filteredLogs = logs.filter(log => {
    const matchesLevel = filterLevel === 'ALL' || (log.level || '').toUpperCase() === filterLevel;
    const matchesSearch = searchQuery === '' || 
      (log.message || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
      (log.level || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  // Virtualizer for logs list: renders only visible items, drastically reducing DOM nodes
  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 52, []),
    overscan: 10,
    getItemKey: useCallback((index: number) => index, []),
  });

  const fetchLogs = () => {
    api.get('/api/logs').then(res => {
      const logsArray = Array.isArray(res.data) ? res.data : (res.data?.logs || []);
      setLogs(logsArray);
    }).catch(console.error);
  };

  useEffect(() => {
    fetchLogs();
    let interval: ReturnType<typeof setInterval> | undefined;
    if (autoRefresh) {
      interval = setInterval(fetchLogs, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  // Handle auto scrolling
  useEffect(() => {
    if (isAutoScrollEnabled.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const clearLogs = () => {
    if (!confirm("确定要清空所有后台日志缓存吗？")) return;
    api.delete('/api/logs').then(() => setLogs([])).catch(console.error);
  };

  // Stats calculation
  const stats = logs.reduce((acc, log) => {
    const lvl = (log.level || '').toUpperCase();
    if (lvl === 'ERROR') acc.errors++;
    else if (lvl === 'WARN') acc.warnings++;
    else if (lvl === 'INFO') acc.infos++;
    return acc;
  }, { infos: 0, warnings: 0, errors: 0 });

  // Formatting helper
  const parseLogMessage = (msg: string) => {
    // Check if the log message contains HTTP requests like "GET /api/status from 127.0.0.1"
    const httpMatch = msg.match(/(GET|POST|PUT|DELETE|OPTIONS) (\/[^\s]*)/i);
    if (httpMatch) {
      const method = httpMatch[1].toUpperCase();
      const path = httpMatch[2];
      const rest = msg.replace(httpMatch[0], '');
      
      const methodColors: Record<string, string> = {
        GET: 'bg-blue-500/10 text-blue-500 border-blue-500/25',
        POST: 'bg-green-500/10 text-green-500 border-green-500/25',
        PUT: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/25',
        DELETE: 'bg-red-500/10 text-red-500 border-red-500/25',
        OPTIONS: 'bg-gray-500/10 text-gray-500 border-gray-500/25'
      };

      return (
        <div className="flex items-center flex-wrap gap-1.5 text-xs">
          <span className={`px-1.5 py-0.5 font-bold rounded border text-[10px] tracking-wide ${methodColors[method] || 'bg-gray-500/10 text-gray-500'}`}>
            {method}
          </span>
          <span className="font-mono bg-[var(--color-bg-base)] px-1.5 py-0.5 rounded border border-[var(--color-border-base)] font-bold text-[11px] text-[var(--color-text-primary)]">
            {path}
          </span>
          <span className="text-[var(--color-text-secondary)]">{rest}</span>
        </div>
      );
    }

    // Check if the log is model mapping like "[Chat] DeepSeek -> xiaomi-tokenplan/mimo-v2.5-pro"
    if (msg.includes(' -> ')) {
      const parts = msg.split(' -> ');
      return (
        <div className="flex items-center flex-wrap gap-1.5 text-xs">
          <span className="text-gray-400 font-medium">{parts[0]}</span>
          <span className="text-[var(--color-primary)] font-bold">➔</span>
          <span className="font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded text-[11px] font-bold">
            {parts[1]}
          </span>
        </div>
      );
    }

    return <span className="text-[var(--color-text-secondary)] leading-relaxed text-xs">{msg}</span>;
  };

  return (
    <div className="animate-in fade-in duration-500 max-w-6xl mx-auto h-[calc(100vh-64px)] flex flex-col gap-6">
      
      {/* Top dashboard header with details */}
      <div className="flex items-end justify-between shrink-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">{t('logs.title', lang)}</h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-1.5">{t('logs.desc', lang)}</p>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] font-bold cursor-pointer select-none">
            <input 
              type="checkbox" 
              checked={autoRefresh} 
              onChange={e => setAutoRefresh(e.target.checked)} 
              className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)] cursor-pointer" 
            />
            {lang === 'en' ? 'Auto Refresh' : '自动刷新'}
          </label>
          <div className="w-px h-6 bg-[var(--color-border-base)] mx-1"></div>
          <button 
            onClick={fetchLogs} 
            className="p-2 border border-[var(--color-border-base)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)] rounded-xl text-[var(--color-text-secondary)] transition-colors cursor-pointer" 
            title={lang === 'en' ? 'Refresh' : '手动刷新'}
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
          <button 
            onClick={clearLogs} 
            className="p-2 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 rounded-xl text-red-500 transition-colors cursor-pointer" 
            title={lang === 'en' ? 'Clear Logs' : '清空后台日志'}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metrics Statistics Grid */}
      <div className="grid grid-cols-4 gap-4 shrink-0 select-none">
        <div 
          onClick={() => setFilterLevel('ALL')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            filterLevel === 'ALL' ? 'bg-[var(--color-bg-hover)] border-[var(--color-primary)]/40 shadow-sm' : 'bg-[var(--color-bg-card)] border-[var(--color-border-base)]'
          }`}
        >
          <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase">所有日志 (All)</div>
          <div className="text-2xl font-extrabold text-[var(--color-text-primary)] mt-1.5">{logs.length}</div>
        </div>
        <div 
          onClick={() => setFilterLevel('INFO')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            filterLevel === 'INFO' ? 'bg-[var(--color-bg-hover)] border-blue-500/40 shadow-sm' : 'bg-[var(--color-bg-card)] border-[var(--color-border-base)]'
          }`}
        >
          <div className="text-xs font-bold text-blue-500 uppercase flex items-center gap-1">
            <Info className="w-3.5 h-3.5" /> 常规 (Info)
          </div>
          <div className="text-2xl font-extrabold text-[var(--color-text-primary)] mt-1.5">{stats.infos}</div>
        </div>
        <div 
          onClick={() => setFilterLevel('WARN')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            filterLevel === 'WARN' ? 'bg-[var(--color-bg-hover)] border-yellow-500/40 shadow-sm' : 'bg-[var(--color-bg-card)] border-[var(--color-border-base)]'
          }`}
        >
          <div className="text-xs font-bold text-yellow-600 dark:text-yellow-400 uppercase flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> 警告 (Warn)
          </div>
          <div className="text-2xl font-extrabold text-[var(--color-text-primary)] mt-1.5">{stats.warnings}</div>
        </div>
        <div 
          onClick={() => setFilterLevel('ERROR')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            filterLevel === 'ERROR' ? 'bg-[var(--color-bg-hover)] border-red-500/40 shadow-sm' : 'bg-[var(--color-bg-card)] border-[var(--color-border-base)]'
          }`}
        >
          <div className="text-xs font-bold text-red-500 uppercase flex items-center gap-1">
            <Activity className="w-3.5 h-3.5" /> 错误 (Error)
          </div>
          <div className="text-2xl font-extrabold text-[var(--color-text-primary)] mt-1.5">{stats.errors}</div>
        </div>
      </div>

      {/* Main logs display section */}
      <div className="flex-1 bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-3xl overflow-hidden shadow-sm flex flex-col min-h-0">
        
        {/* Top filter bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-base)] bg-[var(--color-bg-base)]/50 shrink-0">
          <div className="flex items-center gap-2">
            <TerminalSquare className="w-4 h-4 text-[var(--color-text-muted)]" />
            <span className="text-xs font-bold font-mono text-[var(--color-text-secondary)]">orca-gateway-v2.log</span>
            <span className="text-[10px] font-bold text-white bg-[var(--color-primary)] px-2 py-0.5 rounded-full uppercase tracking-wider ml-2 animate-pulse">Live</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input 
                type="text" 
                placeholder="搜索日志..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-1.5 bg-[var(--color-bg-input)] border border-[var(--color-border-base)] rounded-xl text-xs outline-none focus:border-[var(--color-primary)] transition-colors w-44 md:w-56" 
              />
            </div>
            
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] font-bold cursor-pointer select-none">
              <input 
                type="checkbox" 
                defaultChecked={true} 
                onChange={e => { isAutoScrollEnabled.current = e.target.checked; }}
                className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)] cursor-pointer" 
              />
              锁定到底部
            </label>
          </div>
        </div>
        
        {/* Logs list viewport */}
        <div 
          ref={scrollRef}
          className="flex-1 p-6 overflow-y-auto font-mono text-[13px] bg-[var(--color-bg-base)]/10 flex flex-col gap-2 min-h-0"
        >
          {filteredLogs.length === 0 ? (
            <div className="text-[var(--color-text-muted)] italic flex h-full items-center justify-center flex-col gap-2 select-none">
              <TerminalSquare className="w-8 h-8 text-[var(--color-border-base)] animate-pulse" />
              <span>暂无匹配的日志记录...</span>
            </div>
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const logObj = filteredLogs[virtualRow.index];
                const level = (logObj.level || '').toUpperCase();
                let cardStyle = 'border-[var(--color-border-base)] bg-[var(--color-bg-card)]';
                let badgeStyle = 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
                
                if (level === 'ERROR') {
                  cardStyle = 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10';
                  badgeStyle = 'bg-red-500/10 text-red-500 border-red-500/20';
                } else if (level === 'WARN') {
                  cardStyle = 'border-yellow-500/20 bg-yellow-500/5 hover:bg-yellow-500/10';
                  badgeStyle = 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20';
                } else if (level === 'INFO') {
                  cardStyle = 'hover:border-[var(--color-text-muted)]';
                }
                
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className={`p-3 rounded-2xl border transition-all flex items-start gap-4 shadow-sm absolute top-0 left-0 w-full ${cardStyle}`}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <span className="text-[11px] font-semibold text-[var(--color-text-muted)] mt-0.5 select-none shrink-0 font-mono">
                      {logObj.time ? new Date(logObj.time).toLocaleTimeString() : '-'}
                    </span>
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border tracking-wide select-none shrink-0 uppercase ${badgeStyle}`}>
                      {level}
                    </span>
                    <div className="flex-1 min-w-0">
                      {parseLogMessage(logObj.message || '')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
