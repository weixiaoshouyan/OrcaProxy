/**
 * Chat message-rendering component library.
 * Each block type lives in its own module so rendering bugs are localized
 * and fixable without touching the rest of the transcript pipeline.
 */
export { CodeBlock } from './CodeBlock';
export { ThinkingBlock } from './ThinkingBlock';
export { TodosRow } from './TodosRow';
export { TaskListWidget } from './TaskListWidget';
export { SpinnerWords } from './SpinnerWords';
export { ToolExecutionBlock, type ToolActivityBlockShape } from './ToolExecutionBlock';
export { NoticeCard, type NoticeSeverity } from './NoticeCard';
export { MemoizedTextBlocks } from './TextBlocks';
export { MemoizedAssistantMessage } from './AssistantMessage';
export { ChatEmptyState } from './ChatEmptyState';
export { ChatHeader } from './ChatHeader';
export { MessageFooter } from './MessageFooter';
export { TodoShelf } from './TodoShelf';
export { ConversationSidebar, type ConversationSidebarProps } from './ConversationSidebar';
export { Composer, type ComposerProps } from './Composer';
export { RightSidebar, type RightSidebarProps, type RightSidebarGitInfo } from './RightSidebar';
