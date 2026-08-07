/**
 * Constants and helper functions extracted from Chat.tsx.
 * Reduces Chat.tsx size and enables reuse.
 */

// Model context window sizes (tokens)
export const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-4-turbo': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1000000,
  'gpt-4.1-mini': 1000000,
  'gpt-4.1-nano': 1000000,
  'o1': 200000,
  'o1-mini': 200000,
  'o3-mini': 200000,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-3.5-sonnet': 200000,
  'claude-3-5-haiku': 200000,
  'claude-3.5-haiku': 200000,
  'claude-sonnet-4': 200000,
  'claude-opus-4': 200000,
  'deepseek-chat': 128000,
  'deepseek-reasoner': 65536,
  'deepseek-v3': 128000,
  'deepseek-r1': 128000,
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-2.0-flash': 1000000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.0': 1000000,
  'qwen-turbo': 131072,
  'qwen-plus': 131072,
  'qwen-max': 32768,
  'qwen-long': 10000000,
  'qwen': 131072,
  'glm-4': 131072,
  'glm-4-flash': 131072,
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 131072,
  'llama-3': 128000,
};

export function getModelContextLimit(model: string): number {
  if (!model) return 128000;
  const modelLower = model.toLowerCase();
  for (const [key, size] of Object.entries(MODEL_CONTEXT_SIZES)) {
    if (modelLower.includes(key)) return size;
  }
  return 128000;
}

// Quality presets
export const QUALITIES: Record<string, { name: string; temp: number }> = {
  low: { name: 'Low', temp: 0.1 },
  medium: { name: 'Medium', temp: 0.5 },
  high: { name: 'High', temp: 0.9 },
};

// Stream retry config
export const MAX_RETRIES = 2;
export const RETRY_DELAY = 3000;
export const STORAGE_DEBOUNCE = 2000;

// File operation tool names
export const FILE_OP_TOOLS = [
  'write_to_file',
  'write',
  'replace_in_file',
  'edit_file',
  'create_file',
];

// Get presets based on language
export function getPresets(lang: 'zh' | 'en'): Record<string, { name: string; systemPrompt: string }> {
  return {
    standard: {
      name: lang === 'en' ? 'Standard Assistant' : 'Standard Assistant',
      systemPrompt:
        lang === 'en'
          ? 'You are Orca, a premium AI agent assistant. Help the user with their queries, tasks, and software engineering needs.'
          : 'You are Orca, a premium AI agent assistant. Help the user with their queries, tasks, and software engineering needs.',
    },
    code: {
      name: lang === 'en' ? 'Code Expert' : 'Code Expert',
      systemPrompt:
        lang === 'en'
          ? 'You are an expert software architect and senior developer advisor. Provide professional, clean, and well-designed solutions.'
          : 'You are an expert software architect and senior developer advisor. Provide professional, clean, and well-designed solutions.',
    },
    bug: {
      name: lang === 'en' ? 'Code Auditor' : 'Code Auditor',
      systemPrompt:
        lang === 'en'
          ? 'You are a code review and security audit expert. Focus on analyzing user code, finding logical bugs, security flaws, performance bottlenecks, and provide optimized code.'
          : 'You are a code review and security audit expert. Focus on analyzing user code, finding logical bugs, security flaws, performance bottlenecks, and provide optimized code.',
    },
    translate: {
      name: lang === 'en' ? 'Translation Expert' : 'Translation Expert',
      systemPrompt:
        lang === 'en'
          ? 'You are a professional interpreter and translator. Translate non-English input text to natural English, and English text to natural Chinese.'
          : 'You are a professional interpreter and translator. Translate non-English input text to natural English, and English text to natural Chinese.',
    },
  };
}

// Parse task list from assistant message content
export function parseTaskList(content: string): {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'done';
  description: string;
}[] {
  const tasks: { status: 'pending' | 'running' | 'completed' | 'failed' | 'done'; description: string }[] = [];
  const planMatch = content.match(/<task_plan[^>]*>([\s\S]*?)<\/task_plan>/i);
  const planText = planMatch ? planMatch[1] : content;
  const lines = planText.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+\[([ xX/])\]\s+(.*)$/);
    if (match) {
      const statusChar = match[1].toLowerCase();
      const description = match[2].trim();
      let status: 'pending' | 'running' | 'completed' | 'failed' | 'done' = 'pending';
      if (statusChar === 'x') status = 'completed';
      else if (statusChar === '/') status = 'running';
      tasks.push({ status, description });
    }
  }

  return tasks;
}

// Estimate token count from text (character-level heuristic)
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    tokens += text.charCodeAt(i) > 0x7f ? 2.5 : 0.25;
  }
  return Math.round(tokens);
}
