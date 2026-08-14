/**
 * ChatEmptyState — the welcome hero shown when a conversation has no messages:
 * brand tile with sonar rings, mode/model line, first-run provider guidance,
 * suggestion cards and input-affordance hints.
 */
import { Bot, FileText, Zap, Terminal, Sparkles, Settings } from 'lucide-react';
import type { Language } from '../../i18n';

interface ChatEmptyStateProps {
  lang: Language;
  useAgent: boolean;
  models: { id: string; providerId?: string }[];
  modelLabel: string;
  onSuggest: (text: string) => void;
}

export function ChatEmptyState({ lang, useAgent, models, modelLabel, onSuggest }: ChatEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-4 select-none">
      <div className="orca-hero-aura mb-4">
        <div className="orca-gradient-tile orca-sonar w-16 h-16 rounded-[22px] flex items-center justify-center">
          <Bot className="w-8 h-8 text-white" />
        </div>
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)] mb-1.5">
        {lang === 'en' ? 'Hello! How can I help you?' : '你好！有什么可以帮你的？'}
      </h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-8">
        {useAgent ? (lang === 'en' ? 'Build Mode · Full access' : 'Build 模式 · 完全权限') : (lang === 'en' ? 'Plan Mode · Read-only' : 'Plan 模式 · 只读')}
        {modelLabel && <span className="mx-1.5">·</span>}
        {modelLabel && <span className="font-mono text-[12px]">{modelLabel}</span>}
      </p>
      {/* First-run guidance — no configured providers yet */}
      {models.length === 0 && (
        <div className="mb-8 w-full max-w-lg rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <Settings className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-left flex-1 min-w-0">
            <div className="text-xs font-bold text-[var(--color-text-primary)]">
              {lang === 'en' ? 'No model providers configured yet' : '还没有配置模型供应商'}
            </div>
            <div className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
              {lang === 'en'
                ? 'Add an API key for DeepSeek, Qwen, OpenAI or any other provider to start chatting.'
                : '为 DeepSeek、通义千问、OpenAI 等任一供应商添加 API Key 即可开始对话。'}
            </div>
          </div>
          <button
            onClick={() => { window.location.hash = '#/providers'; }}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-[11px] font-bold transition-colors cursor-pointer"
          >
            {lang === 'en' ? 'Configure' : '去配置'}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5 max-w-lg w-full">
        {[
          { icon: <FileText className="w-4 h-4" />, text: lang === 'en' ? 'Analyze this codebase' : '分析当前代码库' },
          { icon: <Zap className="w-4 h-4" />, text: lang === 'en' ? 'Fix bugs in my project' : '修复项目中的 Bug' },
          { icon: <Terminal className="w-4 h-4" />, text: lang === 'en' ? 'Write unit tests' : '编写单元测试' },
          { icon: <Sparkles className="w-4 h-4" />, text: lang === 'en' ? 'Refactor & optimize' : '重构和优化代码' },
        ].map((item, idx) => (
          <button
            key={idx}
            onClick={() => onSuggest(item.text)}
            className="orca-suggestion flex items-center gap-2.5 px-4 py-3.5 rounded-xl text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer shadow-[var(--shadow-xs)]"
          >
            <span className="orca-suggestion-icon text-[var(--color-text-muted)] shrink-0">{item.icon}</span>
            <span className="text-left">{item.text}</span>
          </button>
        ))}
      </div>
      {/* Input affordances hint (Reasonix-style welcome) */}
      <div className="flex items-center gap-4 mt-8 text-[11px] text-[var(--color-text-muted)] select-none">
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-border-base)] bg-[var(--color-bg-card)] font-mono text-[10px] font-semibold shadow-[var(--shadow-xs)]">/</kbd>
          {lang === 'en' ? 'Commands' : '快捷命令'}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-border-base)] bg-[var(--color-bg-card)] font-mono text-[10px] font-semibold shadow-[var(--shadow-xs)]">@</kbd>
          {lang === 'en' ? 'Reference files' : '引用文件'}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-border-base)] bg-[var(--color-bg-card)] font-mono text-[10px] font-semibold shadow-[var(--shadow-xs)]">↵</kbd>
          {lang === 'en' ? 'Send' : '发送'}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-border-base)] bg-[var(--color-bg-card)] font-mono text-[10px] font-semibold shadow-[var(--shadow-xs)]">?</kbd>
          {lang === 'en' ? 'Shortcuts' : '快捷键'}
        </span>
      </div>
    </div>
  );
}
