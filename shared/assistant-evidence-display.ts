import type {
  AssistantConversation,
  AssistantEvidenceFact,
} from './assistant.types';
import {
  getActivityTypeGroupLabel,
  resolveActivityTypeGroup,
} from './activity-type-group.metadata';

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DISPLAY_DURATION_PATTERN = /^(?:\d+h(?: \d+m)?|\d+m|\d+s)$/;
const ENUM_LIKE_VALUE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;
const ENUM_LIKE_LABEL_PATTERN = /(?:^|\s)(?:type|group|status|state|kind|category|mode|order|unit system)$/i;
const ASSISTANT_DISCOVERY_EVIDENCE_TOOL_NAMES = new Set([
  'list_activity_types',
  'list_measurement_types',
  'list_metrics',
  'list_training_metrics',
  'list_sleep_vitals',
]);

export function isAssistantDiscoveryEvidenceToolName(toolName: string): boolean {
  return ASSISTANT_DISCOVERY_EVIDENCE_TOOL_NAMES.has(toolName);
}

function formatEnumLikeValue(label: string, value: string): string {
  if (/(?:^|\s)activity group$/i.test(label)) {
    const activityGroup = resolveActivityTypeGroup(value);
    if (activityGroup) {
      return getActivityTypeGroupLabel(activityGroup);
    }
  }
  if (!ENUM_LIKE_LABEL_PATTERN.test(label)
    || !ENUM_LIKE_VALUE_PATTERN.test(value)) {
    return value;
  }
  const humanized = value.replace(/_/g, ' ');
  return `${humanized[0].toUpperCase()}${humanized.slice(1)}`;
}

function formatTimestampForDisplay(value: string): string {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) {
    return value;
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function normalizeAssistantEvidenceFactForDisplay(
  fact: AssistantEvidenceFact,
): AssistantEvidenceFact {
  const normalized = normalizeAssistantEvidenceFact(fact);
  const value = formatTimestampForDisplay(normalized.value);
  return value === normalized.value ? normalized : { ...normalized, value };
}

export function normalizeAssistantEvidenceFact(
  fact: AssistantEvidenceFact,
): AssistantEvidenceFact {
  let label = fact.label;
  if (/\s+Ms$/i.test(label) && ISO_TIMESTAMP_PATTERN.test(fact.value)) {
    label = label.replace(/\s+Ms$/i, '');
  } else if (/\s+Seconds$/i.test(label) && DISPLAY_DURATION_PATTERN.test(fact.value)) {
    label = label.replace(/\s+Seconds$/i, '');
  }
  const value = formatEnumLikeValue(label, fact.value);
  return label === fact.label && value === fact.value
    ? fact
    : { ...fact, label, value };
}

export function normalizeAssistantConversationEvidence(
  conversation: AssistantConversation,
): AssistantConversation {
  let changed = false;
  const messages = conversation.messages.map((message) => {
    if (!message.evidence?.length) {
      return message;
    }
    const hasSubstantiveEvidence = message.evidence.some(
      item => !isAssistantDiscoveryEvidenceToolName(item.toolName),
    );
    const visibleEvidence = hasSubstantiveEvidence
      ? message.evidence.filter(
        item => !isAssistantDiscoveryEvidenceToolName(item.toolName),
      )
      : message.evidence;
    const evidence = visibleEvidence.map((item) => {
      const facts = item.facts.map((fact) => {
        const normalized = normalizeAssistantEvidenceFactForDisplay(fact);
        return normalized;
      });
      return facts.some((fact, index) => fact !== item.facts[index])
        ? { ...item, facts }
        : item;
    });
    const messageChanged = visibleEvidence.length !== message.evidence.length
      || evidence.some((item, index) => item !== visibleEvidence[index]);
    if (!messageChanged) {
      return message;
    }
    changed = true;
    return { ...message, evidence };
  });
  return changed ? { ...conversation, messages } : conversation;
}
