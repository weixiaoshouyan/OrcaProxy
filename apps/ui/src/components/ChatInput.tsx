import { useState, useRef, useCallback } from 'react';
import { ArrowUp, Square, Paperclip, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { Language } from '../i18n';

interface ChatInputProps {
  lang: Language;
  input: string;
  isLoading: boolean;
  attachedFile: { name: string; content: string } | null;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAttach: (file: { name: string; content: string }) => void;
  onRemoveAttachment: () => void;
}

export function ChatInput({
  lang,
  input,
  isLoading,
  attachedFile,
  onInputChange,
  onSend,
  onStop,
  onAttach,
  onRemoveAttachment,
}: ChatInputProps) {
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isLoading) {
        onStop();
      } else if (input.trim() || attachedFile) {
        onSend();
      }
    }
  }, [input, attachedFile, isLoading, onSend, onStop]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(lang === 'en' ? 'File too large (max 5MB)' : 'File too large (max 5MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onAttach({ name: file.name, content: String(reader.result) });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [lang, onAttach]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(lang === 'en' ? 'File too large (max 5MB)' : 'File too large (max 5MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onAttach({ name: file.name, content: String(reader.result) });
    };
    reader.readAsText(file);
  }, [lang, onAttach]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className={`relative border rounded-xl transition-colors ${
      isDragging ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border-base)] bg-[var(--color-bg-input)]'
    }`}>
      {/* Attached file indicator */}
      {attachedFile && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <Paperclip className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <span className="text-xs text-[var(--color-text-secondary)] truncate flex-1">{attachedFile.name}</span>
          <button
            onClick={onRemoveAttachment}
            className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={e => onInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        placeholder={lang === 'en' ? 'Type a message... (Shift+Enter for newline)' : 'Type a message... (Shift+Enter for newline)'}
        rows={1}
        className="w-full px-3 py-2.5 text-sm bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none resize-none min-h-[44px] max-h-[200px]"
        style={{ height: 'auto', overflowY: input.split('\n').length > 4 ? 'auto' : 'hidden' }}
      />

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            accept=".txt,.md,.js,.ts,.tsx,.jsx,.json,.yaml,.yml,.py,.sh,.ps1,.csv"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title={lang === 'en' ? 'Attach file' : 'Attach file'}
          >
            <Paperclip className="w-4 h-4" />
          </button>
        </div>

        {/* Send/Stop button */}
        <button
          onClick={isLoading ? onStop : onSend}
          disabled={!isLoading && !input.trim() && !attachedFile}
          className={`p-2 rounded-lg transition-colors ${
            isLoading
              ? 'bg-red-500 text-white hover:bg-red-600'
              : input.trim() || attachedFile
              ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'
              : 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] cursor-not-allowed'
          }`}
        >
          {isLoading ? <Square className="w-4 h-4" /> : <ArrowUp className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
