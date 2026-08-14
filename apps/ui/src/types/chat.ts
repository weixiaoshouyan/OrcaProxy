/**
 * Chat conversation types — shared by the Chat page and its modules.
 */

export interface Message {
  role: string;
  content: string;
  timestamp?: string;
}

export interface Conversation {
  id: string;
  workspaceId?: string;
  title: string;
  preset: string; // 'standard' | 'code' | 'bug' | 'translate'
  quality: string; // 'high' | 'medium' | 'low' | 'creative'
  model: string;
  messages: Message[];
  systemPrompt?: string;
}
