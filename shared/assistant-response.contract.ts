import {
  ASSISTANT_CONVERSATION_VERSION,
  ASSISTANT_MAX_EVIDENCE_ITEMS,
  ASSISTANT_MAX_MESSAGE_CHARS,
  ASSISTANT_MAX_RESPONSE_CHARS,
  ASSISTANT_MAX_STORED_MESSAGES,
  type AssistantChatResponse,
  type AssistantConversation,
  type AssistantEvidence,
  type AssistantMessage,
} from './assistant.types';

export type AssistantValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isSafeEvidenceUrl(value: unknown): value is string {
  if (!isBoundedString(value, 1, 500)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && [
        'quantified-self.io',
        'www.quantified-self.io',
        'beta.quantified-self.io',
      ].includes(url.hostname);
  } catch {
    return false;
  }
}

function isEvidence(value: unknown): value is AssistantEvidence {
  if (!isRecord(value)
    || !isBoundedString(value.toolName, 1, 120)
    || !isBoundedString(value.title, 1, 160)
    || !isBoundedString(value.summary, 1, 300)
    || !Array.isArray(value.facts)
    || value.facts.length > 6
    || !Array.isArray(value.links)
    || value.links.length > 3) {
    return false;
  }

  const factsValid = value.facts.every(fact => isRecord(fact)
    && isBoundedString(fact.label, 1, 80)
    && isBoundedString(fact.value, 1, 160));
  const linksValid = value.links.every(link => isRecord(link)
    && isBoundedString(link.label, 1, 80)
    && isSafeEvidenceUrl(link.url));
  return factsValid && linksValid;
}

function isMessage(value: unknown): value is AssistantMessage {
  if (!isRecord(value)
    || !isBoundedString(value.id, 1, 120)
    || (value.role !== 'user' && value.role !== 'assistant')
    || !isBoundedString(
      value.text,
      1,
      value.role === 'user'
        ? ASSISTANT_MAX_MESSAGE_CHARS
        : ASSISTANT_MAX_RESPONSE_CHARS,
    )
    || !isIsoDate(value.createdAt)) {
    return false;
  }

  return value.evidence === undefined
    || (Array.isArray(value.evidence)
      && value.evidence.length <= ASSISTANT_MAX_EVIDENCE_ITEMS
      && value.evidence.every(isEvidence));
}

export function validateAssistantConversation(
  value: unknown,
): AssistantValidationResult<AssistantConversation> {
  if (!isRecord(value)) {
    return { ok: false, reason: 'conversation_not_object' };
  }
  if (value.version !== ASSISTANT_CONVERSATION_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }
  if (!isBoundedString(value.conversationId, 1, 120)) {
    return { ok: false, reason: 'invalid_conversation_id' };
  }
  if (!Array.isArray(value.messages)
    || value.messages.length > ASSISTANT_MAX_STORED_MESSAGES
    || !value.messages.every(isMessage)) {
    return { ok: false, reason: 'invalid_messages' };
  }
  if (!isIsoDate(value.expiresAt)) {
    return { ok: false, reason: 'invalid_expiry' };
  }

  return { ok: true, data: value as unknown as AssistantConversation };
}

export function validateAssistantChatResponse(
  value: unknown,
): AssistantValidationResult<AssistantChatResponse> {
  if (!isRecord(value)) {
    return { ok: false, reason: 'response_not_object' };
  }
  const conversation = validateAssistantConversation(value.conversation);
  if (conversation.ok === false) {
    return { ok: false, reason: conversation.reason };
  }
  const quota = value.quota;
  if (!isRecord(quota)
    || !['free', 'basic', 'pro'].includes(`${quota.role}`)
    || !Number.isInteger(quota.limit)
    || (quota.limit as number) < 0
    || !Number.isInteger(quota.successfulRequestCount)
    || (quota.successfulRequestCount as number) < 0
    || !Number.isInteger(quota.activeRequestCount)
    || (quota.activeRequestCount as number) < 0
    || !Number.isInteger(quota.remainingCount)
    || (quota.remainingCount as number) < 0
    || (quota.periodStart !== null && !isIsoDate(quota.periodStart))
    || (quota.periodEnd !== null && !isIsoDate(quota.periodEnd))
    || !['subscription', 'grace_hold', 'calendar_month', 'no_billing_period']
      .includes(`${quota.periodKind}`)
    || !['date', 'next_successful_payment'].includes(`${quota.resetMode}`)
    || typeof quota.isEligible !== 'boolean'
    || ![null, 'requires_pro', 'limit_reached'].includes(
      quota.blockedReason as null | string,
    )) {
    return { ok: false, reason: 'invalid_quota' };
  }

  return { ok: true, data: value as unknown as AssistantChatResponse };
}
