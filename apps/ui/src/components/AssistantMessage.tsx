import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { rehypeSanitizeHardened } from '../utils/rehype-sanitize-hardened';
import type { Language } from '../i18n';
import { parseAssistantMessage, parseTextWithCodeBlocksAndTasks } from '../utils/chat-parser';
import { useStreamingThrottle } from '../hooks/useStreamingThrottle';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolExecutionBlock } from './ToolExecutionBlock';
import { CodeBlock } from './CodeBlock';
import { TaskListWidget } from './TaskListWidget';

interface AssistantMessageProps {
  content: string;
  lang: Language;
  onFileOp: (toolName: string, content: string) => void;
  isStreaming?: boolean;
}

const AssistantMessageContent = ({ content, lang, onFileOp, isStreaming }: AssistantMessageProps) => {
  const parsedBlocks = useMemo(() => {
    return parseAssistantMessage(content);
  }, [content]);

  return (
    <div className="space-y-4">
      {parsedBlocks.map((block, idx) => {
        if (block.type === 'text') {
          return (
            <div key={idx} className="space-y-1">
              <MemoizedTextBlocks content={block.content} isStreaming={isStreaming} lang={lang} />
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
        } else if (block.type === 'todos') {
          return (
            <div key={idx} className="text-[11px] text-[var(--color-text-muted)] px-1 py-0.5 select-none">
              {block.content}
            </div>
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

const MarkdownRenderer = ({ content, lang }: { content: string; lang: Language }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[
      rehypeRaw,           // Parse raw HTML into AST
      rehypeSanitize,      // First-pass: standard sanitization
      rehypeSanitizeHardened, // Second-pass: belt-and-suspenders
    ]}
    components={{
      code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
        const text = String(children ?? '');
        const match = /language-(\w+)/.exec(className ?? '');
        return <CodeBlock content={text} language={match?.[1] ?? 'text'} lang={lang} />;
      },
    }}
  >
    {content}
  </ReactMarkdown>
);

const MemoizedMarkdownRenderer = React.memo(MarkdownRenderer);

const TextBlocksContent = ({ content, isStreaming, lang }: { content: string; isStreaming?: boolean; lang: Language }) => {
  const throttledContent = useStreamingThrottle(content, !!isStreaming);
  const subBlocks = useMemo(() => {
    return parseTextWithCodeBlocksAndTasks(throttledContent);
  }, [throttledContent]);

  return (
    <>
      {subBlocks.map((subBlock, sIdx) => {
        if (subBlock.type === 'text') {
          return (
            <div key={sIdx} className="orca-markdown">
              <MemoizedMarkdownRenderer content={subBlock.content} lang={lang} />
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
              lang={lang}
            />
          );
        }
      })}
    </>
  );
};

export const MemoizedTextBlocks = React.memo(TextBlocksContent);
