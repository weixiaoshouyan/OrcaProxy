// ShortcutsCheatsheet.tsx — keyboard shortcuts reference dialog (Reasonix-style).
// Opens with `?` or Ctrl+/ from the chat page.
import { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import type { Language } from '../i18n';

interface ShortcutRow {
  keys: string[];
  label: string;
  labelEn: string;
}

const SECTIONS: { title: string; titleEn: string; rows: ShortcutRow[] }[] = [
  {
    title: '会话', titleEn: 'Session',
    rows: [
      { keys: ['Ctrl', 'K'], label: '打开命令面板', labelEn: 'Open command palette' },
      { keys: ['Ctrl', 'N'], label: '新建会话', labelEn: 'New chat' },
      { keys: ['Ctrl', 'Shift', 'P'], label: '切换 Build / Plan 模式', labelEn: 'Toggle Build / Plan mode' },
      { keys: ['Ctrl', 'S'], label: '停止生成', labelEn: 'Stop generation' },
      { keys: ['Esc'], label: '停止 / 关闭面板', labelEn: 'Stop / close panel' },
      { keys: ['Ctrl', 'Shift', 'C'], label: '复制最后一条回复', labelEn: 'Copy last reply' },
      { keys: ['Ctrl', ','], label: '打开设置', labelEn: 'Open settings' },
    ],
  },
  {
    title: '输入', titleEn: 'Composer',
    rows: [
      { keys: ['Enter'], label: '发送消息', labelEn: 'Send message' },
      { keys: ['Shift', 'Enter'], label: '换行', labelEn: 'New line' },
      { keys: ['@'], label: '引用工作区文件', labelEn: 'Reference workspace file' },
      { keys: ['/'], label: '快捷命令（/plan /fix /test...）', labelEn: 'Slash commands (/plan /fix /test...)' },
      { keys: ['↑', '↓'], label: '在 @ 菜单中导航', labelEn: 'Navigate @ menu' },
    ],
  },
  {
    title: '消息', titleEn: 'Messages',
    rows: [
      { keys: ['↩'], label: '回滚到该消息', labelEn: 'Rollback to message' },
      { keys: ['📋'], label: '复制消息内容', labelEn: 'Copy message content' },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="min-w-[22px] px-1.5 h-[20px] inline-flex items-center justify-center rounded-[5px] border border-[var(--color-border-base)] bg-[var(--color-bg-base)] text-[10px] font-mono font-semibold text-[var(--color-text-secondary)] shadow-[var(--shadow-xs)]">
      {children}
    </kbd>
  );
}

export default function ShortcutsCheatsheet({ open, onClose, lang }: { open: boolean; onClose: () => void; lang: Language }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const isEn = lang === 'en';

  useEffect(() => {
    if (open) requestAnimationFrame(() => closeRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="w-[520px] max-w-[92vw] max-h-[80vh] bg-[var(--color-bg-card)] border border-[var(--color-border-base)] rounded-2xl shadow-[var(--shadow-lg)] overflow-hidden animate-in zoom-in-95 fade-in duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border-base)] shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="orca-gradient-tile w-7 h-7 rounded-lg flex items-center justify-center text-white">
              <Keyboard className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-[var(--color-text-primary)]">
              {isEn ? 'Keyboard Shortcuts' : '键盘快捷键'}
            </h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all cursor-pointer"
            title={isEn ? 'Close' : '关闭'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2 select-none">
                {isEn ? section.titleEn : section.title}
              </div>
              <div className="space-y-1">
                {section.rows.map((row, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[var(--color-bg-hover)]/50 transition-colors">
                    <span className="text-[12.5px] text-[var(--color-text-secondary)]">{isEn ? row.labelEn : row.label}</span>
                    <span className="flex items-center gap-1">
                      {row.keys.map((k, ki) => (
                        <span key={ki} className="flex items-center gap-1">
                          {ki > 0 && <span className="text-[10px] text-[var(--color-text-muted)]">+</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-2 border-t border-[var(--color-border-base)] bg-[var(--color-bg-base)]/40 text-[10px] text-[var(--color-text-muted)] select-none shrink-0">
          {isEn ? 'Press ? anytime to open this reference · ESC to close' : '随时按 ? 打开此速查表 · ESC 关闭'}
        </div>
      </div>
    </div>
  );
}
