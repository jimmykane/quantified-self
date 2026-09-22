import {
  ASSISTANT_CONVERSATION_VERSION,
  ASSISTANT_MAX_EVIDENCE_ITEMS,
  ASSISTANT_MAX_CHART_POINTS_PER_SERIES,
  ASSISTANT_MAX_CHART_SERIES,
  ASSISTANT_MAX_CONVERSATION_BYTES,
  ASSISTANT_MAX_MAP_MARKERS,
  ASSISTANT_MAX_MAP_PATH_POINTS,
  ASSISTANT_MAX_MESSAGE_CHARS,
  ASSISTANT_MAX_RESPONSE_CHARS,
  ASSISTANT_MAX_STORED_MESSAGES,
  ASSISTANT_MAX_VISUAL_BYTES_PER_MESSAGE,
  ASSISTANT_MAX_VISUALS_PER_MESSAGE,
  isValidAssistantRequestId,
  type AssistantChatResponse,
  type AssistantConversation,
  type AssistantEvidence,
  type AssistantMessage,
  type AssistantContentProposalPreview,
  type AssistantTrainingProposalPreview,
  type AssistantVisual,
} from './assistant.types';
import { EVENT_TAG_LIMIT, EVENT_TAG_MAX_LENGTH } from './event-tags';
import {
  TIMELINE_NOTE_CATEGORIES,
  TIMELINE_NOTE_COLORS,
  TIMELINE_NOTE_LIMITS,
} from './timeline-notes';

export type AssistantValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every(key => allowed.has(key));
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isSafeEvidenceUrl(value: unknown): value is string {
  if (!isBoundedString(value, 1, 500)) {
    return false;
  }
  try {
    const url = new URL(value);
    const isHostedOrigin = [
      'https://quantified-self.io',
      'https://www.quantified-self.io',
      'https://beta.quantified-self.io',
    ].includes(url.origin);
    const isLoopbackOrigin = (
      url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
    )
      && (url.protocol === 'http:' || url.protocol === 'https:')
      && !!url.port;
    return (isHostedOrigin || isLoopbackOrigin)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function isEvidence(value: unknown): value is AssistantEvidence {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['toolName', 'title', 'summary', 'facts', 'links'])
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
    && hasOnlyKeys(fact, ['label', 'value'])
    && isBoundedString(fact.label, 1, 80)
    && isBoundedString(fact.value, 1, 160));
  const linksValid = value.links.every(link => isRecord(link)
    && hasOnlyKeys(link, ['label', 'url'])
    && isBoundedString(link.label, 1, 80)
    && isSafeEvidenceUrl(link.url));
  return factsValid && linksValid;
}

function getUtf8ByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isAssistantTrainingProposal(value: unknown): value is AssistantTrainingProposalPreview {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['proposalRef', 'permissionMode', 'expiresAtMs', 'scheduleRevision', 'summary',
      'requiresConfirmation', 'changes', 'providerPreviews'])
    || !isBoundedString(value.proposalRef, 1, 2048)
    || !['schedule', 'delivery', 'combined'].includes(`${value.permissionMode}`)
    || !Number.isSafeInteger(value.expiresAtMs) || Number(value.expiresAtMs) < 0
    || !Number.isSafeInteger(value.scheduleRevision) || Number(value.scheduleRevision) < 0
    || !isBoundedString(value.summary, 1, 1000)
    || value.requiresConfirmation !== true
    || !Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 25
    || !Array.isArray(value.providerPreviews) || value.providerPreviews.length > 100) {
    return false;
  }
  const changesValid = value.changes.every(change => isRecord(change)
    && hasOnlyKeys(change, ['index', 'kind', 'summary'])
    && Number.isSafeInteger(change.index) && Number(change.index) >= 0 && Number(change.index) <= 24
    && isBoundedString(change.kind, 1, 64)
    && isBoundedString(change.summary, 1, 500));
  const providersValid = value.providerPreviews.every(preview => isRecord(preview)
    && hasOnlyKeys(preview, ['index', 'provider', 'targetType', 'action', 'availability', 'timeZone',
      'eligibleCount', 'warningCount', 'summary'])
    && Number.isSafeInteger(preview.index) && Number(preview.index) >= 0 && Number(preview.index) <= 24
    && ['garmin', 'coros', 'wahoo', 'suunto'].includes(`${preview.provider}`)
    && ['plan', 'workout'].includes(`${preview.targetType}`)
    && ['enable', 'send', 'resume', 'stop', 'retry', 'check', 'approve'].includes(`${preview.action}`)
    && ['ready', 'unavailable', 'reconnect_required', 'connection_repair', 'pro_required'].includes(`${preview.availability}`)
    && (preview.timeZone === null || isIanaTimeZone(preview.timeZone))
    && Number.isSafeInteger(preview.eligibleCount) && Number(preview.eligibleCount) >= 0 && Number(preview.eligibleCount) <= 400
    && Number.isSafeInteger(preview.warningCount) && Number(preview.warningCount) >= 0 && Number(preview.warningCount) <= 400
    && isBoundedString(preview.summary, 1, 500));
  return changesValid && providersValid && getUtf8ByteLength(value) <= 256 * 1024;
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function areTags(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= EVENT_TAG_LIMIT
    && value.every(tag => isBoundedString(tag, 1, EVENT_TAG_MAX_LENGTH));
}

function hasTimelineNoteFields(value: Record<string, unknown>): boolean {
  return TIMELINE_NOTE_CATEGORIES.includes(value.category as never)
    && isBoundedString(value.title, 1, TIMELINE_NOTE_LIMITS.title)
    && (value.details === null || isBoundedString(value.details, 0, TIMELINE_NOTE_LIMITS.details))
    && isDateOnly(value.startDate)
    && (value.endDate === null || isDateOnly(value.endDate))
    && (value.endDate === null || value.endDate >= value.startDate)
    && isIanaTimeZone(value.timeZone)
    && typeof value.showOnCharts === 'boolean'
    && TIMELINE_NOTE_COLORS.includes(value.color as never);
}

export function isAssistantContentProposal(value: unknown): value is AssistantContentProposalPreview {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['proposalRef', 'kind', 'expiresAtMs', 'summary', 'requiresConfirmation', 'arguments'])
    || !isBoundedString(value.proposalRef, 1, 120)
    || !['update_activity_tags', 'create_timeline_note', 'update_timeline_note', 'delete_timeline_note']
      .includes(`${value.kind}`)
    || !Number.isSafeInteger(value.expiresAtMs) || Number(value.expiresAtMs) < 0
    || !isBoundedString(value.summary, 1, 500)
    || value.requiresConfirmation !== true
    || !isRecord(value.arguments)) return false;
  const args = value.arguments;
  if (value.kind === 'update_activity_tags') {
    return hasOnlyKeys(args, ['activityRef', 'expectedTags', 'tags'])
      && isBoundedString(args.activityRef, 1, 512)
      && areTags(args.expectedTags)
      && areTags(args.tags);
  }
  if (value.kind === 'delete_timeline_note') {
    return hasOnlyKeys(args, ['noteRef', 'expectedRevision'])
      && isBoundedString(args.noteRef, 1, 512)
      && Number.isSafeInteger(args.expectedRevision) && Number(args.expectedRevision) > 0;
  }
  const referenceKeys = value.kind === 'create_timeline_note'
    ? ['mutationId']
    : ['noteRef', 'expectedRevision'];
  const allowedKeys = [...referenceKeys, 'category', 'title', 'details', 'startDate', 'endDate', 'timeZone',
    'showOnCharts', 'color'];
  const referenceValid = value.kind === 'create_timeline_note'
    ? isUuid(args.mutationId)
    : isBoundedString(args.noteRef, 1, 512)
      && Number.isSafeInteger(args.expectedRevision) && Number(args.expectedRevision) > 0;
  return hasOnlyKeys(args, allowedKeys) && referenceValid && hasTimelineNoteFields(args)
    && getUtf8ByteLength(value) <= 80 * 1024;
}

function isIanaTimeZone(value: unknown): value is string {
  if (!isBoundedString(value, 1, 80)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isMapPosition(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['latitudeDegrees', 'longitudeDegrees'])
    && isFiniteNumber(value.latitudeDegrees)
    && value.latitudeDegrees >= -90
    && value.latitudeDegrees <= 90
    && isFiniteNumber(value.longitudeDegrees)
    && value.longitudeDegrees >= -180
    && value.longitudeDegrees <= 180;
}

function isChartVisual(value: Record<string, unknown>): boolean {
  const xAxis = value.xAxis;
  if (!hasOnlyKeys(value, ['kind', 'title', 'chartType', 'xAxis', 'series'])
    || value.kind !== 'chart'
    || !isBoundedString(value.title, 1, 160)
    || !['line', 'bar'].includes(`${value.chartType}`)
    || !isRecord(xAxis)
    || !hasOnlyKeys(xAxis, ['type', 'label', 'unit', 'dataType', 'timeZone'])
    || !['time', 'linear', 'category'].includes(`${xAxis.type}`)
    || !isBoundedString(xAxis.label, 1, 80)
    || (xAxis.unit !== null && !isBoundedString(xAxis.unit, 1, 80))
    || (xAxis.dataType !== undefined
      && xAxis.dataType !== null
      && !isBoundedString(xAxis.dataType, 1, 120))
    || (xAxis.type === 'time'
      ? !isIanaTimeZone(xAxis.timeZone)
      : xAxis.timeZone !== null)
    || !Array.isArray(value.series)
    || value.series.length < 1
    || value.series.length > ASSISTANT_MAX_CHART_SERIES) {
    return false;
  }

  const labels = new Set<string>();
  return value.series.every((series) => {
    if (!isRecord(series)
      || !hasOnlyKeys(series, ['label', 'unit', 'dataType', 'points'])
      || !isBoundedString(series.label, 1, 120)
      || labels.has(series.label)
      || (series.unit !== null && !isBoundedString(series.unit, 1, 80))
      || (series.dataType !== undefined
        && series.dataType !== null
        && !isBoundedString(series.dataType, 1, 120))
      || !Array.isArray(series.points)
      || series.points.length < 1
      || series.points.length > ASSISTANT_MAX_CHART_POINTS_PER_SERIES) {
      return false;
    }
    labels.add(series.label);
    return series.points.every((point) => {
      if (!isRecord(point)
        || !hasOnlyKeys(point, ['x', 'y'])
        || (point.y !== null && !isFiniteNumber(point.y))) {
        return false;
      }
      if (xAxis.type === 'time') {
        return isIsoDate(point.x);
      }
      if (xAxis.type === 'linear') {
        return isFiniteNumber(point.x);
      }
      return isFiniteNumber(point.x) || isBoundedString(point.x, 1, 120);
    });
  });
}

function isMapVisual(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, ['kind', 'title', 'style', 'markers', 'path'])
    || value.kind !== 'map'
    || !isBoundedString(value.title, 1, 160)
    || (value.style !== 'user_preference' && value.style !== 'satellite')
    || !Array.isArray(value.markers)
    || value.markers.length > ASSISTANT_MAX_MAP_MARKERS
    || !Array.isArray(value.path)
    || value.path.length > ASSISTANT_MAX_MAP_PATH_POINTS
    || (value.markers.length === 0 && value.path.length < 2)
    || (value.path.length === 1)) {
    return false;
  }

  const markerKinds = ['start', 'end', 'jump', 'nearby', 'search'];
  const markersValid = value.markers.every(marker => isRecord(marker)
    && hasOnlyKeys(marker, ['kind', 'label', 'latitudeDegrees', 'longitudeDegrees'])
    && markerKinds.includes(`${marker.kind}`)
    && isBoundedString(marker.label, 1, 120)
    && isFiniteNumber(marker.latitudeDegrees)
    && marker.latitudeDegrees >= -90
    && marker.latitudeDegrees <= 90
    && isFiniteNumber(marker.longitudeDegrees)
    && marker.longitudeDegrees >= -180
    && marker.longitudeDegrees <= 180);
  return markersValid && value.path.every(isMapPosition);
}

function isVisual(value: unknown): value is AssistantVisual {
  if (!isRecord(value)) {
    return false;
  }
  return value.kind === 'chart'
    ? isChartVisual(value)
    : value.kind === 'map' && isMapVisual(value);
}

function areVisualsValid(value: unknown): value is AssistantVisual[] {
  if (!Array.isArray(value)
    || value.length < 1
    || value.length > ASSISTANT_MAX_VISUALS_PER_MESSAGE
    || getUtf8ByteLength(value) > ASSISTANT_MAX_VISUAL_BYTES_PER_MESSAGE
    || !value.every(isVisual)) {
    return false;
  }
  const kinds = new Set(value.map(visual => visual.kind));
  return kinds.size === value.length;
}

function isMessage(value: unknown): value is AssistantMessage {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['id', 'role', 'text', 'createdAt', 'evidence', 'visuals'])
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

  if (value.role === 'user') {
    return value.evidence === undefined && value.visuals === undefined;
  }
  const evidenceValid = value.evidence === undefined
    || (Array.isArray(value.evidence)
      && value.evidence.length <= ASSISTANT_MAX_EVIDENCE_ITEMS
      && value.evidence.every(isEvidence));
  const visualsValid = value.visuals === undefined || areVisualsValid(value.visuals);
  return evidenceValid && visualsValid;
}

function hasValidMessageSequence(messages: AssistantMessage[]): boolean {
  if (messages.length % 2 !== 0) {
    return false;
  }
  const messageIds = new Set<string>();
  return messages.every((message, index) => {
    if (messageIds.has(message.id)) {
      return false;
    }
    messageIds.add(message.id);
    return message.role === (index % 2 === 0 ? 'user' : 'assistant');
  });
}

export function validateAssistantConversation(
  value: unknown,
): AssistantValidationResult<AssistantConversation> {
  if (!isRecord(value)) {
    return { ok: false, reason: 'conversation_not_object' };
  }
  if (!hasOnlyKeys(value, ['version', 'conversationId', 'messages', 'expiresAt'])) {
    return { ok: false, reason: 'unexpected_conversation_fields' };
  }
  if (value.version !== ASSISTANT_CONVERSATION_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }
  if (!isBoundedString(value.conversationId, 1, 120)) {
    return { ok: false, reason: 'invalid_conversation_id' };
  }
  if (!Array.isArray(value.messages)
    || value.messages.length > ASSISTANT_MAX_STORED_MESSAGES
    || !value.messages.every(isMessage)
    || !hasValidMessageSequence(value.messages)) {
    return { ok: false, reason: 'invalid_messages' };
  }
  if (!isIsoDate(value.expiresAt)) {
    return { ok: false, reason: 'invalid_expiry' };
  }
  if (getUtf8ByteLength(value) > ASSISTANT_MAX_CONVERSATION_BYTES) {
    return { ok: false, reason: 'conversation_too_large' };
  }

  return { ok: true, data: value as unknown as AssistantConversation };
}

export function validateAssistantChatResponse(
  value: unknown,
): AssistantValidationResult<AssistantChatResponse> {
  if (!isRecord(value)) {
    return { ok: false, reason: 'response_not_object' };
  }
  if (!hasOnlyKeys(value, ['conversation', 'quota', 'pendingRequestId', 'timelineNotesEnabled',
    'activityTagChangesEnabled', 'timelineNoteChangesEnabled', 'trainingPlansEnabled',
    'trainingPlanChangesEnabled', 'trainingDeliveryEnabled', 'pendingTrainingProposal', 'pendingContentProposal'])) {
    return { ok: false, reason: 'unexpected_response_fields' };
  }
  if (value.trainingPlansEnabled !== undefined && typeof value.trainingPlansEnabled !== 'boolean') return { ok: false, reason: 'invalid_training_plans_access' };
  if (value.trainingPlanChangesEnabled !== undefined && typeof value.trainingPlanChangesEnabled !== 'boolean') return { ok: false, reason: 'invalid_training_plan_changes_access' };
  if (value.trainingDeliveryEnabled !== undefined && typeof value.trainingDeliveryEnabled !== 'boolean') return { ok: false, reason: 'invalid_training_delivery_access' };
  if ((value.trainingPlanChangesEnabled === true || value.trainingDeliveryEnabled === true)
    && value.trainingPlansEnabled !== true) return { ok: false, reason: 'invalid_training_write_dependency' };
  if (value.pendingTrainingProposal !== undefined) {
    if (!isAssistantTrainingProposal(value.pendingTrainingProposal)) {
      return { ok: false, reason: 'invalid_training_proposal' };
    }
  }
  if (value.timelineNotesEnabled !== undefined && typeof value.timelineNotesEnabled !== 'boolean') {
    return { ok: false, reason: 'invalid_timeline_notes_access' };
  }
  if (value.activityTagChangesEnabled !== undefined && typeof value.activityTagChangesEnabled !== 'boolean') {
    return { ok: false, reason: 'invalid_activity_tag_changes_access' };
  }
  if (value.timelineNoteChangesEnabled !== undefined && typeof value.timelineNoteChangesEnabled !== 'boolean') {
    return { ok: false, reason: 'invalid_timeline_note_changes_access' };
  }
  if (value.timelineNoteChangesEnabled === true && value.timelineNotesEnabled !== true) {
    return { ok: false, reason: 'invalid_timeline_note_changes_dependency' };
  }
  if (value.pendingContentProposal !== undefined && !isAssistantContentProposal(value.pendingContentProposal)) {
    return { ok: false, reason: 'invalid_content_proposal' };
  }
  const conversation = validateAssistantConversation(value.conversation);
  if (conversation.ok === false) {
    return { ok: false, reason: conversation.reason };
  }
  if (value.pendingRequestId !== null
    && !isValidAssistantRequestId(value.pendingRequestId)) {
    return { ok: false, reason: 'invalid_pending_request_id' };
  }
  const quota = value.quota;
  if (!isRecord(quota)
    || !hasOnlyKeys(quota, [
      'role',
      'limit',
      'successfulRequestCount',
      'activeRequestCount',
      'remainingCount',
      'periodStart',
      'periodEnd',
      'periodKind',
      'resetMode',
      'isEligible',
      'blockedReason',
    ])
    || !['free', 'basic', 'pro'].includes(`${quota.role}`)
    || !Number.isSafeInteger(quota.limit)
    || (quota.limit as number) < 0
    || !Number.isSafeInteger(quota.successfulRequestCount)
    || (quota.successfulRequestCount as number) < 0
    || !Number.isSafeInteger(quota.activeRequestCount)
    || (quota.activeRequestCount as number) < 0
    || !Number.isSafeInteger(quota.remainingCount)
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

  const limit = quota.limit as number;
  const successfulRequestCount = quota.successfulRequestCount as number;
  const activeRequestCount = quota.activeRequestCount as number;
  const remainingCount = quota.remainingCount as number;
  const isEligible = quota.isEligible as boolean;
  const expectedRemainingCount = isEligible
    ? Math.max(0, limit - successfulRequestCount - activeRequestCount)
    : 0;
  const expectedBlockedReason = !isEligible
    ? 'requires_pro'
    : expectedRemainingCount === 0
      ? 'limit_reached'
      : null;
  const hasPeriodStart = quota.periodStart !== null;
  const hasPeriodEnd = quota.periodEnd !== null;
  if (remainingCount !== expectedRemainingCount
    || quota.blockedReason !== expectedBlockedReason
    || hasPeriodStart !== hasPeriodEnd
    || (isEligible && !hasPeriodStart)
    || (hasPeriodStart
      && Date.parse(quota.periodStart as string) >= Date.parse(quota.periodEnd as string))) {
    return { ok: false, reason: 'invalid_quota' };
  }

  return { ok: true, data: value as unknown as AssistantChatResponse };
}
