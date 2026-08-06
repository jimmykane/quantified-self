export const ASSISTANT_CONVERSATION_VERSION = 1 as const;
export const ASSISTANT_MAX_MESSAGE_CHARS = 1_000;
export const ASSISTANT_MAX_RESPONSE_CHARS = 4_000;
export const ASSISTANT_MAX_STORED_MESSAGES = 12;
export const ASSISTANT_MAX_EVIDENCE_ITEMS = 6;

export type AssistantQuotaPeriodKind =
  | 'subscription'
  | 'grace_hold'
  | 'calendar_month'
  | 'no_billing_period';

export type AssistantQuotaResetMode =
  | 'date'
  | 'next_successful_payment';

export type AssistantQuotaBlockedReason =
  | 'requires_pro'
  | 'limit_reached'
  | null;

export interface AssistantQuotaStatus {
  role: 'free' | 'basic' | 'pro';
  limit: number;
  successfulRequestCount: number;
  activeRequestCount: number;
  remainingCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  periodKind: AssistantQuotaPeriodKind;
  resetMode: AssistantQuotaResetMode;
  isEligible: boolean;
  blockedReason: AssistantQuotaBlockedReason;
}

export type AssistantQuotaStatusRequest = Record<string, never>;

export type AssistantQuotaStatusResponse = AssistantQuotaStatus;

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
  quota: AssistantQuotaStatus;
}

export type GetAssistantConversationRequest = Record<string, never>;

export interface GetAssistantConversationResponse {
  conversation: AssistantConversation | null;
  pendingRequestId: string | null;
}

export type ResetAssistantConversationRequest = Record<string, never>;

export interface ResetAssistantConversationResponse {
  conversation: AssistantConversation;
}
