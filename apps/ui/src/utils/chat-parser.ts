// ---- Chat Message Parser ----
// Extracted from Chat.tsx for maintainability

interface ToolBlock {
  type: 'tool';
  toolName: string;
  content: string;
  status: 'running' | 'done' | 'error';
}

interface ThinkBlock {
  type: 'think';
  content: string;
  status: 'running' | 'done';
}

interface TextBlock {
  type: 'text';
  content: string;
}

interface SubBlock {
  type: 'text' | 'code' | 'tasks';
  content: string;
  language?: string;
  tasks?: TaskItem[];
}

interface TaskItem {
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

type ParsedBlock = ToolBlock | ThinkBlock | TextBlock;

// Pre-compiled regex patterns (avoid recompilation on each call)
const TOOL_SPLITTER = /^\s*>\s+\*\*Agent Executing[^:*]*:\*\*\s+`([^`]+)`\.\.\./gm;
const CODE_BLOCK_REST = /^\n*```\n([\s\S]*?)\n```/;
const THINK_TAG_OPEN = /<\s*think\s*>/g;
const THINK_TAG_CLOSE = /<\s*\/\s*think\s*>/g;
const THINK_BLOCK = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/g;
const CODE_BLOCK = /```(\w*)\n([\s\S]*?)```/g;
const TASK_PENDING = /^-\s*\[\s\]\s*/;
const TASK_COMPLETED = /^-\s*\[[xX]\]\s*/;
const TASK_RUNNING = /^-\s*\[>\]\s*/;

// Simple LRU cache for parsed content during streaming
const parseCache = new Map<string, { blocks: ParsedBlock[]; timestamp: number }>();
const CACHE_MAX_SIZE = 10;
const CACHE_TTL_MS = 5000;

function getCacheKey(content: string): string {
  // Use first 100 chars + length + last 20 chars as key
  if (content.length < 150) return content;
  return `${content.slice(0, 100)}|${content.length}|${content.slice(-20)}`;
}

function getCachedParse(key: string): ParsedBlock[] | null {
  const cached = parseCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.blocks;
  }
  if (cached) {
    parseCache.delete(key);
  }
  return null;
}

function setCachedParse(key: string, blocks: ParsedBlock[]): void {
  // Evict oldest entries if cache is full
  if (parseCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = parseCache.keys().next().value;
    if (oldestKey) parseCache.delete(oldestKey);
  }
  parseCache.set(key, { blocks, timestamp: Date.now() });
}

/**
 * Split tool blocks from text blocks in assistant message content.
 * Handles both completed (```) and running (streaming) tool blocks.
 */
function parseToolsAndText(content: string): ParsedBlock[] {
  const parts: ParsedBlock[] = [];
  TOOL_SPLITTER.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOOL_SPLITTER.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore.trim()) {
      parts.push({ type: 'text', content: textBefore });
    }

    const toolName = match[1];
    const rest = content.substring(TOOL_SPLITTER.lastIndex);
    const codeBlockMatch = CODE_BLOCK_REST.exec(rest);

    if (codeBlockMatch) {
      parts.push({ type: 'tool', toolName, content: codeBlockMatch[1], status: 'done' });
      TOOL_SPLITTER.lastIndex += codeBlockMatch[0].length;
    } else {
      const remaining = rest.trim();
      parts.push({ type: 'tool', toolName, content: remaining, status: 'running' });
      TOOL_SPLITTER.lastIndex = content.length;
    }

    lastIndex = TOOL_SPLITTER.lastIndex;
  }

  const tail = content.substring(lastIndex);
  if (tail.trim()) {
    parts.push({ type: 'text', content: tail });
  }

  return parts;
}

/**
 * Remove 鎬濊€冭繃绋?/ thinking blocks from text content.
 */
export function cleanThinkTags(content: string): string {
  return content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
}

/**
 * Parse assistant message content into blocks: text, think, tool.
 * Uses LRU cache for streaming optimization.
 */
export function parseAssistantMessage(content: string): ParsedBlock[] {
  const cacheKey = getCacheKey(content);
  const cached = getCachedParse(cacheKey);
  if (cached) return cached;

  const blocks: ParsedBlock[] = [];
  const cleanContent = content.replace(THINK_TAG_OPEN, '<thinking>').replace(THINK_TAG_CLOSE, '</thinking>');
  THINK_BLOCK.lastIndex = 0;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = THINK_BLOCK.exec(cleanContent)) !== null) {
    const textBefore = cleanContent.substring(lastIdx, match.index);
    if (textBefore.trim()) {
      const toolAndText = parseToolsAndText(textBefore);
      blocks.push(...toolAndText);
    }

    const hasClosing = match[0].endsWith('</thinking>');
    blocks.push({ type: 'think', content: match[1], status: hasClosing ? 'done' : 'running' });
    lastIdx = match.index + match[0].length;
  }

  const tail = cleanContent.substring(lastIdx);
  if (tail.trim()) {
    const toolAndText = parseToolsAndText(tail);
    blocks.push(...toolAndText);
  }

  const result = blocks.length > 0 ? blocks : [{ type: 'text' as const, content }];
  setCachedParse(cacheKey, result);
  return result;
}

/**
 * Parse task items from text content.
 * Format: - [ ] pending task / - [x] completed task / - [>] running task
 */
export function parseTasksFromText(text: string): TaskItem[] {
  const lines = text.split('\n');
  const tasks: TaskItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (TASK_PENDING.test(trimmed)) {
      tasks.push({ description: trimmed.replace(TASK_PENDING, ''), status: 'pending' });
    } else if (TASK_COMPLETED.test(trimmed)) {
      tasks.push({ description: trimmed.replace(TASK_COMPLETED, ''), status: 'completed' });
    } else if (TASK_RUNNING.test(trimmed)) {
      tasks.push({ description: trimmed.replace(TASK_RUNNING, ''), status: 'running' });
    }
  }
  return tasks;
}

/**
 * Parse text content into sub-blocks: text, code blocks, and task lists.
 */
export function parseTextWithCodeBlocksAndTasks(text: string): SubBlock[] {
  const blocks: SubBlock[] = [];
  CODE_BLOCK.lastIndex = 0;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = CODE_BLOCK.exec(text)) !== null) {
    const textBefore = text.substring(lastIdx, match.index);
    if (textBefore.trim()) {
      const tasks = parseTasksFromText(textBefore);
      if (tasks.length > 0) {
        blocks.push({ type: 'tasks', content: textBefore, tasks });
      } else {
        blocks.push({ type: 'text', content: textBefore });
      }
    }
    blocks.push({ type: 'code', content: match[2], language: match[1] || undefined });
    lastIdx = match.index + match[0].length;
  }

  const tail = text.substring(lastIdx);
  if (tail.trim()) {
    const tasks = parseTasksFromText(tail);
    if (tasks.length > 0) {
      blocks.push({ type: 'tasks', content: tail, tasks });
    } else {
      blocks.push({ type: 'text', content: tail });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: 'text' as const, content: text }];
}

/**
 * Clear the parse cache (call when starting new conversation)
 */
export function clearParseCache(): void {
  parseCache.clear();
}

