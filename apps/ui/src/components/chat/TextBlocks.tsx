/**
 * TextBlocks — renders a text segment as markdown / code blocks / task lists
 * with stable family-occurrence keys (stream-split safe).
 */
import React, { useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { rehypeSanitizeHardened } from '../../utils/rehype-sanitize-hardened';
import type { Language } from '../../i18n';
import { parseTextWithCodeBlocksAndTasks } from '../../utils/chat-render';
import { CodeBlock } from './CodeBlock';
import { TaskListWidget } from './TaskListWidget';

const TextBlocksContent = ({ content, lang }: { content: string; lang: Language }) => {
  const subBlocks = useMemo(() => {
    return parseTextWithCodeBlocksAndTasks(content);
  }, [content]);

  // Same family-occurrence keying as AssistantMessage: a code fence or
  // task list appearing mid-stream splits the trailing text block, and
  // index-based keys would remount the later sub-blocks.
  const subKeyCounts = useRef(new Map<string, number>());
  subKeyCounts.current.clear();
  const subKey = (type: string): string => {
    const n = (subKeyCounts.current.get(type) || 0) + 1;
    subKeyCounts.current.set(type, n);
    return `${type}-${n}`;
  };

  return (
    <>
      {subBlocks.map((subBlock) => {
        if (subBlock.type === 'text') {
          return (
            <div key={subKey('text')} className="orca-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeSanitizeHardened]}>
                {subBlock.content}
              </ReactMarkdown>
            </div>
          );
        } else if (subBlock.type === 'tasks' && subBlock.tasks) {
          return (
            <TaskListWidget
              key={subKey('tasks')}
              tasks={subBlock.tasks}
              lang={lang}
            />
          );
        } else {
          return (
            <CodeBlock
              key={subKey('code')}
              content={subBlock.content}
              language={subBlock.language}
              lang={lang}
            />
          );
        }
      })}
    </>
  );
};

export const MemoizedTextBlocks = React.memo(TextBlocksContent);
