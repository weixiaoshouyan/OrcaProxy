/**
 * Agent transcript render pipeline — pure parsing utilities shared by the
 * chat message components. No React dependencies.
 *
 * parseAssistantMessage turns a raw assistant-message string into ordered
 * blocks (text / think / todos / tool / notice) that the UI renders as a
 * Cursor-style activity timeline.
 */

export type AgentActivityBlock =
  | { type: 'text'; content: string }
  | { type: 'tool'; content: string; toolName?: string; label?: string; status?: 'done' | 'running' | 'error'; duration?: string }
  | { type: 'think'; content: string; status?: 'done' | 'running' }
  | { type: 'todos'; content: string }
  | { type: 'notice'; content: string; severity: 'info' | 'warning' | 'error' };

// Per-tool announcement: `> 🔧 **Agent Executing Tool:** `name` — label...`
// (backtick matched via \x60 to avoid literal template-literal chars in the regex)
export const ANNO_LINE_RE = /^\s*>\s+[^\n]*?\*\*Agent Executing[^:*]*:\*\*\s+\x60([^\x60]+)\x60(?:\s*—\s*([^\n]*?))?\.\.\.\s*$/;
export const TODOS_LINE_RE = /^\s*>\s+📋\s+Todos\s+\[\d+\/\d+\]/;
export const DURATION_SUFFIX_RE = /^\((\d+(?:\.\d+)?)s\)\s*$/;
export const CODE_BLOCK_SPLIT_RE = /(```[\s\S]*?```)/g;

// Host/system notices → styled cards: stall guards, approval waits, turn
// refusals, hard stops, ask questions, stream errors.
export const NOTICE_RULES: { re: RegExp; severity: 'info' | 'warning' | 'error' }[] = [
  { re: /^\s*\[Guard\]|^\s*> ⚠️/, severity: 'warning' },
  { re: /^\s*> 🛑|^\s*\[Agent Stream Error\]/, severity: 'error' },
  { re: /^\s*\[Waiting for|^\s*\[Continuing:|^\s*> ❓|^\s*\[Orca/, severity: 'info' },
  { re: /^\s*\[Turn refused/, severity: 'warning' },
];

export function parseAssistantMessage(content: string): AgentActivityBlock[] {
  const parts: AgentActivityBlock[] = [];

  // Tokenize by <think>...</think> blocks. Agent streams may contain MULTIPLE
  // think blocks (one per execution iteration), so handle all of them, not just the first.
  let cursor = 0;
  const thinkMatches = content.matchAll(/<think>([\s\S]*?)<\/think>/gi);

  for (const m of thinkMatches) {
    const textBefore = content.substring(cursor, m.index ?? 0);
    if (textBefore.trim()) {
      parts.push(...parseToolsAndText(textBefore));
    }
    parts.push({ type: 'think', content: m[1], status: 'done' });
    cursor = (m.index ?? 0) + m[0].length;
  }

  // If a think block is still open (streaming), capture the trailing remainder
  const openThinkStart = content.indexOf('<think>', cursor);
  if (openThinkStart >= 0) {
    const textBefore = content.substring(cursor, openThinkStart);
    if (textBefore.trim()) {
      parts.push(...parseToolsAndText(textBefore));
    }
    const thinkContent = content.substring(openThinkStart + 7);
    parts.push({ type: 'think', content: thinkContent, status: 'running' });
    cursor = content.length;
  }

  const textAfter = content.substring(cursor);
  if (textAfter.trim() || parts.length === 0) {
    parts.push(...parseToolsAndText(textAfter));
  }

  return parts;
}

export function parseToolsAndText(content: string): AgentActivityBlock[] {
  const parts: AgentActivityBlock[] = [];
  const pending: { name: string; label?: string }[] = [];
  const segments = content.split(CODE_BLOCK_SPLIT_RE);
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
          ? ('error' as const)
          : ('done' as const);
        parts.push({ type: 'tool', toolName: ann.name, label: ann.label, content: code, status });
        lastWasTool = true;
      } else {
        // Model-authored code block (language tag or no pending tool) → text
        buf += seg;
        lastWasTool = false;
      }
      continue;
    }

    // Text segment: scan line by line for announcements / todos / durations
    for (const line of seg.split('\n')) {
      const anno = line.match(ANNO_LINE_RE);
      if (anno) {
        flushText();
        pending.push({ name: anno[1].trim(), label: anno[2]?.trim() || undefined });
        lastWasTool = false;
        continue;
      }
      if (TODOS_LINE_RE.test(line)) {
        flushText();
        parts.push({ type: 'todos', content: line.trim() });
        lastWasTool = false;
        continue;
      }
      const noticeRule = NOTICE_RULES.find((r) => r.re.test(line));
      if (noticeRule) {
        flushText();
        parts.push({ type: 'notice', content: line.trim(), severity: noticeRule.severity });
        lastWasTool = false;
        continue;
      }
      if (lastWasTool && DURATION_SUFFIX_RE.test(line.trim())) {
        const d = line.trim().match(DURATION_SUFFIX_RE)![1];
        const last = parts[parts.length - 1];
        if (last && last.type === 'tool') (last as { duration?: string }).duration = `${d}s`;
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

/** True when the content contains agent-activity markers (think/tool/todos). */
export function hasAgentActivity(content: string): boolean {
  return /<think|<thinking|Agent Executing|>\s*📋\s*Todos/i.test(content || '');
}

/** Strip <think>/<thinking> tags (user-facing text only). */
export function cleanThinkTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<think>/gi, '')
    .replace(/<\/think>/gi, '')
    .replace(/<thinking>/gi, '')
    .replace(/<\/thinking>/gi, '')
    .trim();
}

// ---- Text-block level parsing (markdown text / code fences / task lists) ----

export interface TaskItem {
  status: 'pending' | 'running' | 'completed';
  description: string;
}

export interface TaskBlock {
  type: 'text' | 'code' | 'tasks';
  content: string;
  language?: string;
  tasks?: TaskItem[];
}

export function parseTextWithCodeBlocksAndTasks(text: string): TaskBlock[] {
  const parts: TaskBlock[] = [];
  const lines = text.split('\n');
  let currentBlock: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = '';
  let currentTasks: TaskItem[] = [];

  const flushCurrentTextOrTasks = () => {
    if (currentTasks.length > 0) {
      parts.push({
        type: 'tasks',
        content: '',
        tasks: currentTasks
      });
      currentTasks = [];
    } else if (currentBlock.length > 0) {
      parts.push({
        type: 'text',
        content: currentBlock.join('\n')
      });
      currentBlock = [];
    }
  };

  const taskRegex = /^\s*[-*+]\s+\[([ xX/])\]\s+(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        parts.push({
          type: 'code',
          content: currentBlock.join('\n'),
          language: codeLanguage
        });
        currentBlock = [];
        inCodeBlock = false;
        codeLanguage = '';
      } else {
        // Start of code block
        flushCurrentTextOrTasks();
        inCodeBlock = true;
        codeLanguage = line.trim().slice(3).trim();
      }
    } else if (inCodeBlock) {
      currentBlock.push(line);
    } else {
      const match = line.match(taskRegex);
      if (match) {
        if (currentBlock.length > 0) {
          parts.push({
            type: 'text',
            content: currentBlock.join('\n')
          });
          currentBlock = [];
        }

        const statusChar = match[1].toLowerCase();
        let status: 'pending' | 'running' | 'completed' = 'pending';
        if (statusChar === 'x') status = 'completed';
        else if (statusChar === '/') status = 'running';

        currentTasks.push({
          status,
          description: match[2].trim()
        });
      } else if (line.trim() === '' && currentTasks.length > 0) {
        continue;
      } else {
        if (currentTasks.length > 0) {
          parts.push({
            type: 'tasks',
            content: '',
            tasks: currentTasks
          });
          currentTasks = [];
        }
        currentBlock.push(line);
      }
    }
  }

  if (inCodeBlock) {
    parts.push({
      type: 'code',
      content: currentBlock.join('\n'),
      language: codeLanguage
    });
  } else {
    flushCurrentTextOrTasks();
  }

  return parts;
}

// ---- Structured [Diff <path> +N -M] section parsing ----

export interface DiffSection {
  path: string;
  added: number;
  removed: number;
  body: string;
  startIndex: number;
}

/** Parse the structured [Diff <path> +N -M] section the server appends to
 *  write/patch/edit tool results. Returns null when absent. */
export function parseDiffSection(content: string): DiffSection | null {
  const m = content.match(/\n\n\[Diff\s+(.+?)\s+\+(\d+)\s+-(\d+)\]\n([\s\S]*)$/);
  if (!m) return null;
  return { path: m[1], added: parseInt(m[2], 10), removed: parseInt(m[3], 10), body: m[4], startIndex: m.index ?? 0 };
}
