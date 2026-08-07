// frontend/src/hooks/useShortcuts.ts
// 全局键盘快捷键 - 让 Orca 更接近桌面应用体验
import { useEffect, useRef } from 'react';

export interface ShortcutBinding {
  key: string;            // 如 'k', 'Enter', 'Escape'
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;         // Cmd on macOS
  description?: string;
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
  // 是否在输入框聚焦时仍触发（默认 false）
  whenInInput?: boolean;
}

function isInEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function matches(e: KeyboardEvent, b: ShortcutBinding): boolean {
  if (e.key.toLowerCase() !== b.key.toLowerCase()) return false;
  if (!!b.ctrl !== e.ctrlKey) return false;
  if (!!b.shift !== e.shiftKey) return false;
  if (!!b.alt !== e.altKey) return false;
  if (b.meta !== undefined && !!b.meta !== e.metaKey) return false;
  return true;
}

export function useShortcuts(bindings: ShortcutBinding[]) {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const b of bindingsRef.current) {
        if (!matches(e, b)) continue;
        if (!b.whenInInput && isInEditableTarget(e.target)) continue;
        if (b.preventDefault !== false) e.preventDefault();
        b.handler(e);
        break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

// 简化：常用快捷键
export const SHORTCUTS = {
  GLOBAL_SEARCH: { key: 'k', ctrl: true, description: 'Open global search' },
  NEW_CHAT: { key: 'n', ctrl: true, description: 'New chat' },
  STOP: { key: 's', ctrl: true, description: 'Stop generation' },
  CLEAR_CONTEXT: { key: 'k', ctrl: true, shift: true, description: 'Clear context' },
  TOGGLE_PLAN: { key: 'p', ctrl: true, shift: true, description: 'Toggle build/plan mode' },
  ESCAPE: { key: 'Escape', description: 'Close modal' },
  SEND: { key: 'Enter', ctrl: true, description: 'Send message' },
};
