/**
 * AssistantMessage — the agent-activity timeline renderer. Parses a raw
 * assistant message into ordered blocks (text / think / todos / tool /
 * notice) and renders them with stable family-occurrence keys so streaming
 * text splits never remount sibling blocks.
 */
import React, { useMemo, useRef } from 'react';
import type { Language } from '../../i18n';
import { parseAssistantMessage } from '../../utils/chat-render';
import { ThinkingBlock } from './ThinkingBlock';
import { TodosRow } from './TodosRow';
import { NoticeCard } from './NoticeCard';
import { ToolExecutionBlock, type ToolActivityBlockShape } from './ToolExecutionBlock';
import { MemoizedTextBlocks } from './TextBlocks';

interface AssistantMessageProps {
  content: string;
  lang: Language;
  onFileOp: (toolName: string, content: string) => void;
}

const AssistantMessageContent = ({ content, lang, onFileOp }: AssistantMessageProps) => {
  const parsedBlocks = useMemo(() => {
    return parseAssistantMessage(content);
  }, [content]);

  // Stable per-block keys: index-based keys break during streaming when the
  // trailing text block splits into text + a tool announcement — every later
  // block shifts down one index and React remounts them, resetting
  // ThinkingBlock / ToolExecutionBlock expand state and elapsed timers.
  // Streamed content only ever APPENDS, so each block's family-occurrence
  // number (text/think/todos/tool:name:label) never changes for existing
  // blocks — keys stay stable across the whole task.
  const keyCounts = useRef(new Map<string, number>());
  keyCounts.current.clear();
  const blockKey = (block: any): string => {
    const family = block.type === 'text' ? 'text'
      : block.type === 'think' ? 'think'
      : block.type === 'todos' ? 'todos'
      : `tool:${block.toolName || ''}:${block.label || ''}`;
    const n = (keyCounts.current.get(family) || 0) + 1;
    keyCounts.current.set(family, n);
    return `${block.type}-${n}`;
  };

  // Cursor-style inline timeline: text, thinking, todos and tool activity all
  // flow in order — no "执行过程" grouping panel.
  return (
    <div className="space-y-1.5">
      {parsedBlocks.map((block) => {
        const key = blockKey(block);
        if (block.type === 'text') {
          return (
            <div key={key} className="space-y-1">
              <MemoizedTextBlocks content={block.content} lang={lang} />
            </div>
          );
        }
        if (block.type === 'think') {
          return <ThinkingBlock key={key} content={block.content} status={block.status} lang={lang} />;
        }
        if (block.type === 'todos') {
          return <TodosRow key={key} content={block.content} lang={lang} />;
        }
        if (block.type === 'notice') {
          return <NoticeCard key={key} content={block.content} severity={block.severity} lang={lang} />;
        }
        return <ToolExecutionBlock key={key} block={block as ToolActivityBlockShape} lang={lang} onFileOp={onFileOp} />;
      })}
    </div>
  );
};

export const MemoizedAssistantMessage = React.memo(AssistantMessageContent);
