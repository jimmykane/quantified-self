import type {
  AssistantConversation,
  AssistantEvidenceFact,
} from './assistant.types';

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DISPLAY_DURATION_PATTERN = /^(?:\d+h(?: \d+m)?|\d+m|\d+s)$/;

export function normalizeAssistantEvidenceFact(
  fact: AssistantEvidenceFact,
): AssistantEvidenceFact {
  let label = fact.label;
  if (/\s+Ms$/i.test(label) && ISO_TIMESTAMP_PATTERN.test(fact.value)) {
    label = label.replace(/\s+Ms$/i, '');
  } else if (/\s+Seconds$/i.test(label) && DISPLAY_DURATION_PATTERN.test(fact.value)) {
    label = label.replace(/\s+Seconds$/i, '');
  }
  return label === fact.label ? fact : { ...fact, label };
}

export function normalizeAssistantConversationEvidence(
  conversation: AssistantConversation,
): AssistantConversation {
  let changed = false;
  const messages = conversation.messages.map((message) => {
    if (!message.evidence?.length) {
      return message;
    }
    const evidence = message.evidence.map((item) => {
      const facts = item.facts.map((fact) => {
        const normalized = normalizeAssistantEvidenceFact(fact);
        changed ||= normalized !== fact;
        return normalized;
      });
      return facts.some((fact, index) => fact !== item.facts[index])
        ? { ...item, facts }
        : item;
    });
    return evidence.some((item, index) => item !== message.evidence?.[index])
      ? { ...message, evidence }
      : message;
  });
  return changed ? { ...conversation, messages } : conversation;
}
