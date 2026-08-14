// ---- Chat Message Parser ----
// Extracted from Chat.tsx for maintainability

interface ToolBlock {
  type: 'tool';
  toolName: string;
  label?: string;
  content: string;
  status: 'running' | 'done' | 'error';
  duration?: string;
}

interface ThinkBlock {
  type: 'think';
  content: string;
  status: 'running' | 'done';
}

interface TodosBlock {
  type: 'todos';
  content: string;
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

type ParsedBlock = ToolBlock | ThinkBlock | TodosBlock | TextBlock;

// Backend per-tool announcements:
//   > 🔧 **Agent Executing Tool:** `write_workspace_file` — src/App.tsx...
// (batch announcements "N tools in parallel" are no longer emitted)
const ANNO_LINE = /^\s*>\s+[^\n]*?\*\*Agent Executing[^:*]*:\*\*\s+`([^`]+)`(?:\s*—\s*([^\n]*?))?\.\.\.\s*$/;
const CODE_BLOCK_SEG = /(```[\s\S]*?```)/g;
const THINK_TAG_OPEN = /<\s*think\s*>/g;
const THINK_TAG_CLOSE = /<\s*\/\s*think\s*>/g;
const THINK_BLOCK = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/g;
const CODE_BLOCK = /```(\w*)\n([\s\S]*?)```/g;
const TASK_PENDING = /^-\s*\[\s\]\s*/;
const TASK_COMPLETED = /^-\s*\[[xX]\]\s*/;
const TASK_RUNNING = /^-\s*\[>\]\s*/;
const TODOS_LINE = /^\s*>\s+📋\s+Todos\s+\[\d+\/\d+\]/;
const DURATION_SUFFIX = /^\((\d+(?:\.\d+)?)s\)\s*$/;

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
 *
 * Sequential walk over the stream: per-tool announcements (`> 🔧 **Agent
 * Executing Tool:** \`name\` — label...`) are queued, and each language-less
 * code block that follows is paired with the oldest pending announcement.
 * Handles both completed and running (streaming) tool blocks, plus compact
 * "📋 Todos [x/y]" host lines and "(Ns)" duration suffixes.
 */
function parseToolsAndText(content: string): ParsedBlock[] {
  const parts: ParsedBlock[] = [];
  const pending: { name: string; label?: string }[] = [];
  const segments = content.split(CODE_BLOCK_SEG);
  let buf = '';
  let lastWasTool = false;

  const flushText = () => {
    if (buf.trim()) {
      parts.push({ type: 'text', content: buf });
      buf = '';
    }
  };

  for (const seg of segments) {
    // Code block segment
    if (seg.startsWith('```') && seg.endsWith('```')) {
      const inner = seg.slice(3, -3);
      const nl = inner.indexOf('\n');
      const lang = nl >= 0 ? inner.slice(0, nl).trim() : '';
      const code = nl >= 0 ? inner.slice(nl + 1) : inner;
      if (pending.length > 0 && !lang) {
        const ann = pending.shift()!;
        flushText();
        const status = code.startsWith('Error:') || code.includes('[Execution Error]')
          ? 'error' as const
          : 'done' as const;
        parts.push({ type: 'tool', toolName: ann.name, label: ann.label, content: code, status });
        lastWasTool = true;
      } else {
        // Model-authored code block (has a language tag or no pending tool) → text
        buf += seg;
        lastWasTool = false;
      }
      continue;
    }

    // Text segment: scan line by line for announcements / todos / durations
    for (const line of seg.split('\n')) {
      const anno = line.match(ANNO_LINE);
      if (anno) {
        flushText();
        pending.push({ name: anno[1].trim(), label: anno[2]?.trim() || undefined });
        lastWasTool = false;
        continue;
      }
      if (TODOS_LINE.test(line)) {
        flushText();
        parts.push({ type: 'todos', content: line.trim() });
        lastWasTool = false;
        continue;
      }
      if (lastWasTool && DURATION_SUFFIX.test(line.trim())) {
        const d = line.trim().match(DURATION_SUFFIX)![1];
        const last = parts[parts.length - 1];
        if (last && last.type === 'tool') (last as ToolBlock).duration = `${d}s`;
        lastWasTool = false;
        continue;
      }
      buf += line + '\n';
      lastWasTool = false;
    }
  }

  // Flush pending announcements (aborted / still streaming) as running rows
  for (const ann of pending) {
    flushText();
    parts.push({ type: 'tool', toolName: ann.name, label: ann.label, content: '', status: 'running' });
  }
  flushText();
  return parts;
}

/**
 * Remove thinking blocks from text content.
 */
export function cleanThinkTags(content: string): string {
  return content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
}

/**
 * True when the assistant content contains agent activity (think blocks,
 * tool announcements, or todo lines) — used to give such messages a
 * full-width timeline layout instead of a narrow bubble.
 */
export function hasAgentActivity(content: string): boolean {
  return /<think|<thinking|Agent Executing|>\s*📋\s*Todos/i.test(content || '');
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

