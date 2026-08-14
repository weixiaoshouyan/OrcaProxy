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

/** Composer bottom dropdown identity (single open dropdown at a time). */
export type ActiveDropdown = 'none' | 'preset' | 'model' | 'quality' | 'readyTools' | 'buildPlan';

/** Right sidebar tab identity. */
export type SidebarTab = 'tasks' | 'files' | 'git' | 'terminal';

/** Composer `/` quick command entry. */
export interface SlashCommand {
  key: string;
  label: string;
  text: string;
}

/** Model option shape served by /api/models. */
export interface ModelOption {
  id: string;
  name: string;
  providerName: string;
  providerId: string;
}

/** Quality preset entry (key → label + temperature). */
export interface QualityOption {
  name: string;
  temp: number;
}
