/**
 * Composer — the chat input area (Reasonix-style prompt shelf + composer).
 *
 * Pure presentational module: renders the live todo shelf, the attached-file
 * chip, the `@`-file / `/`-command input menu, the recording overlay, the
 * textarea with send/stop button, the four bottom dropdowns (Build/Plan,
 * model, quality, ready tools) and the circular context indicator.
 *
 * All state lives in the Chat page and is passed in through props; this
 * component only renders and forwards user actions. Keeping this module
 * isolated means composer bugs (menus, dropdowns, send/stop) are fixable
 * without touching the transcript or sidebar code.
 */
import React from 'react';
import {
  ArrowUp, Check, ChevronDown, ChevronRight, CornerUpLeft, Eye, FileText,
  Folder, Loader, Paperclip, Play, Sparkles, Square, X,
} from 'lucide-react';
import { translate as t } from '../../i18n';
import type { Language } from '../../i18n';
import type { Conversation, ActiveDropdown, SlashCommand, ModelOption, QualityOption } from '../../types/chat';
import type { WorkspaceItem } from '../../types';
import type { ToastContextValue } from '../Toast';
import { displayModelLabel, qualId } from '../../utils/model-label';
import { SpinnerWords } from './SpinnerWords';
import { TodoShelf } from './TodoShelf';

export interface ComposerProps {
  lang: Language;
  useAgent: boolean;
  input: string;
  attachedFile: { name: string; content: string } | null;
  activeChat: Conversation | null;
  /** loadingChats[activeId] — the active chat's stream state. */
  loading: boolean;
  contextTokens: { used: number; total: number; percent: number };
  cacheRate: number | null;
  models: ModelOption[];
  modelsByProvider: Record<string, ModelOption[]>;
  qualities: Record<string, QualityOption>;
  skills: any[];
  mcpTools: any[];
  activeSkillId: string;
  inputMenu: { type: 'at' | 'slash'; query: string; path: string } | null;
  atFolderStack: string[];
  atLoading: boolean;
  filteredAtItems: WorkspaceItem[];
  filteredSlashCommands: SlashCommand[];
  /** Live task shelf summary; null hides the shelf. */
  todoShelf: {
    tasks: any[];
    done: number;
    total: number;
    running: boolean;
    collapsed: boolean;
  } | null;
  isRecording: boolean;
  recordingSeconds: number;
  activeDropdown: ActiveDropdown;
  textareaRef: { current: HTMLTextAreaElement | null };
  inputMenuRef: { current: HTMLDivElement | null };
  dropdownsRef: { current: HTMLDivElement | null };
  composingRef: { current: boolean };
  toast: ToastContextValue;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  onRemoveAttachedFile: () => void;
  onAttachFileClick: () => void;
  onGoBackAtFolder: () => void;
  onInsertAtFile: (item: WorkspaceItem) => void;
  onApplySlashCommand: (cmd: SlashCommand) => void;
  onStopRecording: () => void;
  onToggleTodoShelf: () => void;
  onSetUseAgent: (v: boolean) => void;
  onModelChange: (modelId: string) => void;
  onQualityChange: (qualityKey: string) => void;
  onSetSkill: (skillId: string) => void;
  onSetDropdown: (d: ActiveDropdown) => void;
}

function formatSeconds(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function Composer(props: ComposerProps) {
  const {
    lang, useAgent, input, attachedFile, activeChat, loading,
    contextTokens, cacheRate, models, modelsByProvider, qualities,
    skills, mcpTools, activeSkillId, inputMenu, atFolderStack, atLoading,
    filteredAtItems, filteredSlashCommands, todoShelf, isRecording, recordingSeconds,
    activeDropdown, textareaRef, inputMenuRef, dropdownsRef, composingRef,
    toast, onInputChange, onKeyDown, onSend, onStop, onRemoveAttachedFile,
    onAttachFileClick, onGoBackAtFolder, onInsertAtFile, onApplySlashCommand,
    onStopRecording, onToggleTodoShelf, onSetUseAgent, onModelChange,
    onQualityChange, onSetSkill, onSetDropdown,
  } = props;

  return (
    <div className="shrink-0 flex flex-col gap-3">

      {/* Todo shelf — live task summary pinned above the composer (Reasonix PromptShelf-style) */}
      {useAgent && todoShelf && todoShelf.total > 0 && (
        <TodoShelf
          lang={lang}
          tasks={todoShelf.tasks}
          done={todoShelf.done}
          total={todoShelf.total}
          isTaskRunning={todoShelf.running}
          collapsed={todoShelf.collapsed}
          onToggleCollapsed={onToggleTodoShelf}
        />
      )}
      {/* File attach chip */}
      {attachedFile && (
        <div className="flex items-center gap-2 bg-[var(--color-bg-hover)] border border-[var(--color-border-base)] px-3 py-1.5 rounded-xl self-start text-xs font-semibold shadow-[var(--shadow-xs)] animate-in slide-in-from-bottom-2">
          <FileText className="w-4 h-4 text-[var(--color-primary)]" />
          <span className="max-w-xs truncate text-[var(--color-text-primary)]">{attachedFile.name}</span>
          <button
            onClick={onRemoveAttachedFile}
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
        className="orca-composer relative bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl shadow-[var(--shadow-sm)] flex flex-col cursor-text"
      >

        {/* Composer input menu: @ file references & / commands */}
        {inputMenu && (
          <div
            ref={inputMenuRef}
            className="orca-popover absolute bottom-full left-0 right-0 mb-2 overflow-hidden z-40"
          >
            {inputMenu.type === 'at' ? (
              <div className="max-h-64 overflow-y-auto">
                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center justify-between border-b border-[var(--color-border-base)] bg-[var(--color-bg-hover)]/50">
                  <span>{lang === 'en' ? 'Reference file' : '引用文件'} @</span>
                  <span className="font-mono normal-case truncate ml-2">/{inputMenu.path || ''}</span>
                </div>
                {atFolderStack.length > 0 && (
                  <button
                    onClick={onGoBackAtFolder}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] cursor-pointer transition-colors"
                  >
                    <CornerUpLeft className="w-3 h-3" />
                    <span className="font-mono">../</span>
                  </button>
                )}
                {atLoading ? (
                  <div className="px-3 py-3 text-xs text-[var(--color-text-muted)] flex items-center gap-2">
                    <Loader className="w-3 h-3 animate-spin" />
                    {lang === 'en' ? 'Loading...' : '加载中...'}
                  </div>
                ) : filteredAtItems.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-[var(--color-text-muted)] italic">
                    {lang === 'en' ? 'No matching files' : '没有匹配的文件'}
                  </div>
                ) : (
                  filteredAtItems.slice(0, 40).map(item => (
                    <button
                      key={item.absolutePath}
                      onClick={() => onInsertAtFile(item)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[var(--color-bg-hover)] text-left cursor-pointer transition-colors"
                    >
                      {item.isDirectory
                        ? <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        : <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                      <span className="flex-1 truncate font-mono text-[11px] text-[var(--color-text-primary)]">
                        {item.name}{item.isDirectory ? '/' : ''}
                      </span>
                      {item.isDirectory && <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)] shrink-0" />}
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="py-1">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--color-border-base)]">
                  {lang === 'en' ? 'Commands' : '快捷命令'}
                </div>
                {filteredSlashCommands.map(cmd => (
                  <button
                    key={cmd.key}
                    onClick={() => onApplySlashCommand(cmd)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--color-bg-hover)] cursor-pointer transition-colors"
                  >
                    <span className="font-mono text-xs font-bold text-[var(--color-primary)] w-14 shrink-0">{cmd.key}</span>
                    <span className="flex-1 truncate text-[11px] text-[var(--color-text-secondary)]">{cmd.label}</span>
                  </button>
                ))}
                {filteredSlashCommands.length === 0 && (
                  <div className="px-3 py-2 text-xs text-[var(--color-text-muted)] italic">
                    {lang === 'en' ? 'No matching commands' : '没有匹配的命令'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isRecording ? (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 bg-[var(--color-bg-card)] z-20 flex items-center justify-between px-6 py-4 rounded-2xl animate-in fade-in duration-200"
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
              onClick={(e) => { e.stopPropagation(); onStopRecording(); }}
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
            onInputChange(e.target.value);
            const el = textareaRef.current;
            if (el) {
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 300) + 'px';
            }
          }}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          placeholder={t('chat.input.placeholder', lang)}
          className="w-full bg-transparent text-[var(--color-text-primary)] p-4 pb-2 resize-none outline-none text-[15px] min-h-[80px] max-h-[300px] overflow-y-auto"
          rows={1}
        />

        <div className="flex items-center justify-between p-3 pt-1">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] select-none animate-in fade-in duration-200">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <SpinnerWords lang={lang} />
              </span>
            </div>
          )}
          {!loading && <span />}
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onAttachFileClick(); }}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer"
              title={t('chat.file.tooltip', lang)}
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (loading) {
                  if (input.trim() || attachedFile) {
                    // No backend steer-injection exists for a running task —
                    // silently calling handleSend() (which guards on
                    // loadingChats) made this button a dead control. Be
                    // honest instead: the message goes through when the
                    // current run finishes.
                    toast.info(lang === 'en'
                      ? 'Agent is still running — your message will be sent when it finishes.'
                      : 'Agent 仍在运行中，运行结束后即可发送。');
                  } else {
                    onStop();
                  }
                } else {
                  onSend();
                }
              }}
              disabled={!loading && ((!input.trim() && !attachedFile) || !activeChat)}
              className={`orca-btn-primary w-9 h-9 flex items-center justify-center rounded-xl transition-all cursor-pointer disabled:shadow-none ${
                loading
                  ? input.trim()
                    ? ''
                    : '!bg-red-500 animate-pulse'
                  : (!input.trim() && !attachedFile) || !activeChat
                    ? '!bg-[var(--color-bg-hover)] !text-[var(--color-text-muted)]'
                    : ''
              }`}
              title={
                loading
                  ? input.trim()
                    ? (lang === 'en' ? 'Steer the running agent with your message' : '运行中发送指令')
                    : (lang === 'en' ? 'Stop' : '停止运行')
                  : (lang === 'en' ? 'Send' : '发送')
              }
            >
              {loading ? (
                input.trim() ? (
                  <CornerUpLeft className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4 fill-white" />
                )
              ) : (
                <ArrowUp className="w-5 h-5" />
              )}
            </button>
          </div>
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
                onSetDropdown(activeDropdown === 'buildPlan' ? 'none' : 'buildPlan');
              }}
              className="orca-pill"
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
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {activeDropdown === 'buildPlan' && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="orca-popover absolute bottom-full left-0 mb-2 w-40 py-1 overflow-hidden"
              >
                <div
                  onClick={() => {
                    onSetUseAgent(false);
                    onSetDropdown('none');
                  }}
                  className={`px-3 py-2 text-xs hover:bg-[var(--color-bg-hover)] cursor-pointer flex items-center gap-2 transition-colors ${!useAgent ? 'bg-[var(--color-bg-hover)] font-bold text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'}`}
                >
                  <Eye className="w-3.5 h-3.5 text-blue-500" />
                  <span>{lang === 'en' ? 'Plan Mode' : 'Plan 规划'}</span>
                  {!useAgent && <Check className="w-3.5 h-3.5 ml-auto shrink-0" />}
                </div>
                <div
                  onClick={() => {
                    onSetUseAgent(true);
                    onSetDropdown('none');
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
                onSetDropdown(activeDropdown === 'model' ? 'none' : 'model');
              }}
              className="orca-pill"
            >
              <Sparkles className="w-3 h-3 text-amber-500 fill-amber-500/20" />
              <span className="max-w-[150px] truncate">{displayModelLabel(models, activeChat.model)}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {activeDropdown === 'model' && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="orca-popover absolute bottom-full left-0 mb-2 w-72 py-2 max-h-80 overflow-y-auto"
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
                        // Use the provider-qualified id for identity so the
                        // same model id served by two providers selects
                        // exactly one row (and routes to that provider).
                        const q = qualId(m);
                        const isSelected = activeChat.model === q;
                        return (
                          <div
                            key={q}
                            onClick={() => {
                              onModelChange(q);
                              onSetDropdown('none');
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

          {/* Dropdown 3: Quality Selector (EffortSwitcher-style) */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSetDropdown(activeDropdown === 'quality' ? 'none' : 'quality');
              }}
              className="orca-pill"
            >
              <span>{(qualities[activeChat.quality] || qualities.high).name}</span>
              <span className="text-[9.5px] font-mono px-1 py-0.5 rounded bg-[var(--color-bg-card)] text-[var(--color-text-muted)] border border-[var(--color-border-base)]">
                T={(qualities[activeChat.quality] || qualities.high).temp}
              </span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {activeDropdown === 'quality' && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="orca-popover absolute bottom-full left-0 mb-2 w-44 py-1 overflow-hidden"
              >
                {Object.entries(qualities).map(([key, val]) => {
                  const isSelected = activeChat.quality === key;
                  return (
                    <div
                      key={key}
                      onClick={() => {
                        onQualityChange(key);
                        onSetDropdown('none');
                      }}
                      className={`px-3 py-2 text-xs hover:bg-[var(--color-bg-hover)] cursor-pointer flex justify-between items-center transition-colors ${isSelected ? 'bg-[var(--color-bg-hover)] font-bold text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {val.name}
                        <span className="text-[9.5px] font-mono text-[var(--color-text-muted)]">T={val.temp}</span>
                      </span>
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
                onSetDropdown(activeDropdown === 'readyTools' ? 'none' : 'readyTools');
              }}
              className="orca-pill border-[color-mix(in_srgb,var(--color-primary)_25%,var(--color-border-base))]"
            >
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] shadow-[0_0_6px_var(--color-primary)]" />
              <span>{lang === 'en' ? `Tools (${skills.length + mcpTools.length})` : `就绪工具 (${skills.length + mcpTools.length})`}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {activeDropdown === 'readyTools' && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="orca-popover absolute bottom-full left-0 mb-2 w-80 py-3 px-4 max-h-[350px] overflow-y-auto"
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
                        onClick={() => onSetSkill('')}
                        className={`group flex flex-col p-1.5 rounded cursor-pointer transition-colors border ${activeSkillId === '' ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5' : 'border-transparent hover:bg-[var(--color-bg-hover)]'}`}
                      >
                        <span className="text-xs font-semibold text-[var(--color-text-muted)]">{lang === 'en' ? 'No skill (Normal Chat)' : '无技能 (常规对话)'}</span>
                      </div>
                      {skills.slice(0, 15).map((s: any) => (
                        <div
                          key={s.id}
                          onClick={() => onSetSkill(s.id)}
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
                      {mcpTools.map((mt: any) => (
                        <div key={`${mt.serverName}_${mt.name}`} className="group flex flex-col p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors border-l-2 border-sky-500/30 pl-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-bold text-[var(--color-text-primary)]">{mt.name}</span>
                            <span className="text-[9px] text-sky-500 font-bold bg-sky-500/10 px-1 py-0.2 rounded border border-sky-500/15">{mt.serverName}</span>
                          </div>
                          <span className="text-[10.5px] text-[var(--color-text-muted)] line-clamp-1 group-hover:line-clamp-none transition-all duration-200">{mt.description || 'No description'}</span>
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
              className="orca-pill"
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
              {cacheRate !== null && (
                <div className={`mt-1 ${cacheRate >= 50 ? 'text-emerald-400' : cacheRate >= 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                  Cache hit: {cacheRate}%
                </div>
              )}
              {contextTokens.percent > 85 && (
                <div className="text-red-400 mt-1">{lang === 'en' ? '⚠️ Near Limit' : '⚠️ 接近上限'}</div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
