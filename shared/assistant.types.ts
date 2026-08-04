import type { AiInsightsQuotaStatus } from './ai-insights.types';

export const ASSISTANT_CONVERSATION_VERSION = 1 as const;
export const ASSISTANT_MAX_MESSAGE_CHARS = 1_000;
export const ASSISTANT_MAX_RESPONSE_CHARS = 4_000;
export const ASSISTANT_MAX_STORED_MESSAGES = 12;
export const ASSISTANT_MAX_EVIDENCE_ITEMS = 6;

export interface AssistantEvidenceFact {
  label: string;
  value: string;
}

export interface AssistantEvidenceLink {
  label: string;
  url: string;
}

export interface AssistantEvidence {
  toolName: string;
  title: string;
  summary: string;
  facts: AssistantEvidenceFact[];
  links: AssistantEvidenceLink[];
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  evidence?: AssistantEvidence[];
}

export interface AssistantConversation {
  version: typeof ASSISTANT_CONVERSATION_VERSION;
  conversationId: string;
  messages: AssistantMessage[];
  expiresAt: string;
}

export interface AssistantChatRequest {
  requestId: string;
  message: string;
  timeZone: string;
  conversationId?: string;
}

export interface AssistantChatResponse {
  conversation: AssistantConversation;
  quota: AiInsightsQuotaStatus;
}

export type GetAssistantConversationRequest = Record<string, never>;

export interface GetAssistantConversationResponse {
  conversation: AssistantConversation | null;
}

export type ResetAssistantConversationRequest = Record<string, never>;

export interface ResetAssistantConversationResponse {
  conversation: AssistantConversation;
}
