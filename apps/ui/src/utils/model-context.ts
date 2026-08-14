/**
 * Model context-window lookup (kb-token estimates per model id).
 */

export const MODEL_CONTEXT_SIZES: Record<string, number> = {
  // OpenAI
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
  'gpt-3.5-turbo': 16385,
  // Anthropic
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-3.5-sonnet': 200000,
  'claude-3-5-haiku': 200000,
  'claude-sonnet-4': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-opus-4': 200000,
  // DeepSeek
  'deepseek-chat': 128000,
  'deepseek-reasoner': 65536,
  'deepseek-v3': 128000,
  'deepseek-r1': 128000,
  'deepseek-v4-flash': 128000,
  'deepseek-v4-pro': 128000,
  // Gemini
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-2.0-flash': 1000000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.0': 1000000,
  // Qwen
  'qwen-turbo': 131072,
  'qwen-plus': 131072,
  'qwen-max': 32768,
  'qwen-long': 10000000,
  'qwen': 131072,
  // Zhipu
  'glm-4': 131072,
  'glm-4-flash': 131072,
  'glm-4-long': 10000000,
  // Moonshot
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 131072,
  // Baichuan
  'Baichuan4': 128000,
  'Baichuan3-Turbo': 128000,
  // Yi
  'yi-large': 32768,
  'yi-medium': 32768,
  'yi-spark': 32768,
  // Doubao
  'doubao-pro-4k': 4096,
  'doubao-pro-32k': 32768,
  'doubao-pro-128k': 128000,
  // LongCat
  'LongCat-Flash-Chat': 128000,
  'LongCat-Flash-Thinking': 128000,
  // SiliconFlow
  'deepseek-ai/DeepSeek-V3': 64000,
  'Qwen/Qwen2.5-72B-Instruct': 128000,
  'meta-llama/Meta-Llama-3.1-70B-Instruct': 128000,
  // Meta
  'llama-3': 128000,
};

/** Resolve the context-window limit for a model id (fuzzy prefix match). */
export function getModelContextLimit(model: string): number {
  if (!model) return 128000;
  const modelLower = model.toLowerCase();
  const keys = Object.keys(MODEL_CONTEXT_SIZES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (modelLower.includes(key)) return MODEL_CONTEXT_SIZES[key];
  }
  return 128000; // sensible default
}
