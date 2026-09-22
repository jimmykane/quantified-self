import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import {
  ASSISTANT_MAX_MESSAGE_CHARS,
  isAssistantLocationAccess,
  isValidAssistantRequestId,
  type AssistantChatRequest,
  type AssistantChatResponse,
  type AssistantLocationAccess,
  type AssistantMessage,
  type ApplyAssistantContentProposalRequest,
  type ApplyAssistantContentProposalResponse,
  type AssistantQuotaStatusResponse,
  type ApplyAssistantTrainingProposalRequest,
  type ApplyAssistantTrainingProposalResponse,
  type GetAssistantConversationResponse,
  type ResetAssistantConversationRequest,
  type ResetAssistantConversationResponse,
} from '../../../shared/assistant.types';
import { isValidIanaTimeZone } from '../../../shared/event-stat-aggregation';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import {
  finalizeAssistantQuotaReservation,
  getAssistantQuotaStatus as getAssistantQuotaStatusForUser,
  releaseAssistantQuotaReservation,
  reserveAssistantQuotaForRequest,
  type AssistantQuotaReservation,
  type AssistantUserRoleContext,
} from './quota';
import {
  AssistantConversationStoreError,
  assistantConversationStore,
  createAssistantRequestFingerprint,
  type AssistantConversationStore,
  type AssistantRequestState,
  type BegunAssistantTurn,
  type ReplayedAssistantTurn,
} from './conversation-store';
import {
  assistantRuntime,
  getAssistantRuntimeErrorReason,
  getAssistantRuntimeErrorToolName,
  type AssistantRuntimeResult,
} from './runtime';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { applyTrainingChanges } from '../mcp/training-plans-write.service';
import { MCP_OAUTH_SCOPES } from '../mcp/oauth.service';
import { McpDataError } from '../mcp/data.service';
import { createMcpDataService } from '../mcp/data.service';

interface AssistantCallableContext {
  auth?: {
    uid: string;
    token?: Record<string, unknown>;
  } | null;
  app?: unknown;
  rawRequest?: {
    get: (name: string) => string | undefined;
  };
}

const ASSISTANT_PRODUCTION_APP_BASE_URL = 'https://quantified-self.io';
const ASSISTANT_GROUNDED_ANSWER_ATTEMPT_LIMIT = 2;
const ASSISTANT_HOSTED_APP_ORIGINS = new Set([
  ASSISTANT_PRODUCTION_APP_BASE_URL,
  'https://beta.quantified-self.io',
]);

export interface AssistantCallableDependencies {
  assertLegalAccess: (uid: string) => Promise<void>;
  getQuotaStatus: typeof getAssistantQuotaStatusForUser;
  reserveQuota: typeof reserveAssistantQuotaForRequest;
  finalizeQuota: typeof finalizeAssistantQuotaReservation;
  releaseQuota: typeof releaseAssistantQuotaReservation;
  conversationStore: AssistantConversationStore;
  answer: (input: {
    uid: string;
    appBaseUrl: string;
    prompt: string;
    timeZone: string;
    locationAccess: AssistantLocationAccess;
    timelineNotesEnabled?: boolean;
    activityTagChangesEnabled?: boolean;
    timelineNoteChangesEnabled?: boolean;
    trainingPlansEnabled?: boolean;
    trainingPlanChangesEnabled?: boolean;
    trainingDeliveryEnabled?: boolean;
    conversationId?: string;
    assertTrainingPlansAccess?: () => Promise<void>;
    assertTrainingWriteAccess?: () => Promise<void>;
    assertTimelineNotesAccess?: () => Promise<void>;
    assertContentWriteAccess?: (kind: 'activity_tags' | 'timeline_notes') => Promise<void>;
    history: AssistantMessage[];
    onBillableAttempt: () => Promise<void>;
  }) => Promise<AssistantRuntimeResult>;
  createId: () => string;
  now: () => Date;
}

export async function assertAssistantLegalAccess(
  uid: string,
  db: Pick<FirebaseFirestore.Firestore, 'doc'> = admin.firestore(),
): Promise<void> {
  const snapshot = await db.doc(`users/${uid}/legal/agreements`).get();
  const agreements = snapshot.data();
  if (!snapshot.exists
    || agreements?.acceptedPrivacyPolicy !== true
    || agreements?.acceptedDataPolicy !== true
    || agreements?.acceptedTos !== true) {
    throw new HttpsError(
      'permission-denied',
      'Complete onboarding before using the Assistant.',
    );
  }
}

const defaultDependencies: AssistantCallableDependencies = {
  assertLegalAccess: assertAssistantLegalAccess,
  getQuotaStatus: getAssistantQuotaStatusForUser,
  reserveQuota: reserveAssistantQuotaForRequest,
  finalizeQuota: finalizeAssistantQuotaReservation,
  releaseQuota: releaseAssistantQuotaReservation,
  conversationStore: assistantConversationStore,
  answer: input => assistantRuntime.answer(input),
  createId: () => randomUUID(),
  now: () => new Date(),
};

function requireAuthenticatedUid(context: AssistantCallableContext | undefined): string {
  if (!context?.auth?.uid) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.',
    );
  }
  enforceAppCheck(context);
  return context.auth.uid;
}

function shouldUseCallableTokenForQuotaRoleContext(): boolean {
  // Hosted calls always resolve roles from Firestore. Explicit Functions emulator
  // mode may use local Auth claims so local accounts can exercise each plan.
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

function parseGracePeriodUntilClaim(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }
  return undefined;
}

function buildQuotaRoleContextFromCallableAuth(
  auth: AssistantCallableContext['auth'],
): AssistantUserRoleContext | null {
  const role = auth?.token?.stripeRole;
  if (typeof role !== 'string' || !role.trim()) {
    return null;
  }
  const gracePeriodUntil = parseGracePeriodUntilClaim(auth?.token?.gracePeriodUntil);
  return gracePeriodUntil === undefined
    ? { role }
    : { role, gracePeriodUntil };
}

function resolveCallableQuotaRoleContext(
  context: AssistantCallableContext | undefined,
): AssistantUserRoleContext | null {
  return shouldUseCallableTokenForQuotaRoleContext()
    ? buildQuotaRoleContextFromCallableAuth(context?.auth)
    : null;
}

export function resolveAssistantAppBaseUrl(
  context: AssistantCallableContext | undefined,
): string {
  const originHeader = `${context?.rawRequest?.get('origin') || ''}`.trim();
  if (!originHeader || originHeader.length > 200) {
    return ASSISTANT_PRODUCTION_APP_BASE_URL;
  }
  try {
    const parsed = new URL(originHeader);
    if (originHeader !== parsed.origin) {
      return ASSISTANT_PRODUCTION_APP_BASE_URL;
    }
    if (ASSISTANT_HOSTED_APP_ORIGINS.has(parsed.origin)) {
      return parsed.origin;
    }
    if (
      process.env.FUNCTIONS_EMULATOR === 'true'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.port
    ) {
      return parsed.origin;
    }
  } catch {
    // Fall back to production for missing or malformed client origins.
  }
  return ASSISTANT_PRODUCTION_APP_BASE_URL;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseAssistantLocationAccess(value: unknown): AssistantLocationAccess {
  if (value === undefined) {
    return 'coordinate_free';
  }
  if (!isAssistantLocationAccess(value)) {
    throw new HttpsError(
      'invalid-argument',
      'locationAccess must be coordinate_free or precise_activity.',
    );
  }
  return value;
}

function parseOptionalDataAccess(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new HttpsError('invalid-argument', `${name} must be a boolean.`);
  return value;
}

function parseAssistantChatRequest(value: unknown): AssistantChatRequest {
  const data = asRecord(value);
  if (!isValidAssistantRequestId(data.requestId)) {
    throw new HttpsError(
      'invalid-argument',
      'requestId must be an opaque identifier containing 16 to 120 letters, numbers, hyphens, or underscores.',
    );
  }
  if (typeof data.message !== 'string') {
    throw new HttpsError('invalid-argument', 'message is required.');
  }
  const message = data.message.trim();
  if (!message || message.length > ASSISTANT_MAX_MESSAGE_CHARS) {
    throw new HttpsError(
      'invalid-argument',
      `message must contain 1 to ${ASSISTANT_MAX_MESSAGE_CHARS} characters.`,
    );
  }
  if (typeof data.timeZone !== 'string') {
    throw new HttpsError('invalid-argument', 'timeZone is required.');
  }
  const timeZone = data.timeZone.trim();
  if (!timeZone || timeZone.length > 80) {
    throw new HttpsError(
      'invalid-argument',
      'timeZone must be a valid IANA time zone of at most 80 characters.',
    );
  }
  if (!isValidIanaTimeZone(timeZone)) {
    throw new HttpsError(
      'invalid-argument',
      'timeZone must be a valid IANA time zone of at most 80 characters.',
    );
  }
  const conversationId = typeof data.conversationId === 'string'
    ? data.conversationId.trim()
    : data.conversationId;
  if (conversationId !== undefined
    && (typeof conversationId !== 'string'
      || conversationId.length < 1
      || conversationId.length > 120)) {
    throw new HttpsError(
      'invalid-argument',
      'conversationId must contain 1 to 120 characters.',
    );
  }
  const trainingPlansEnabled = parseOptionalDataAccess(data.trainingPlansEnabled, 'trainingPlansEnabled');
  const trainingPlanChangesEnabled = parseOptionalDataAccess(data.trainingPlanChangesEnabled, 'trainingPlanChangesEnabled');
  const trainingDeliveryEnabled = parseOptionalDataAccess(data.trainingDeliveryEnabled, 'trainingDeliveryEnabled');
  const activityTagChangesEnabled = parseOptionalDataAccess(data.activityTagChangesEnabled, 'activityTagChangesEnabled');
  const timelineNoteChangesEnabled = parseOptionalDataAccess(data.timelineNoteChangesEnabled, 'timelineNoteChangesEnabled');
  const timelineNotesEnabled = parseOptionalDataAccess(data.timelineNotesEnabled, 'timelineNotesEnabled');
  if ((trainingPlanChangesEnabled || trainingDeliveryEnabled) && !trainingPlansEnabled) {
    throw new HttpsError('invalid-argument', 'Training plans read access is required before enabling Training changes.');
  }
  if (timelineNoteChangesEnabled && !timelineNotesEnabled) {
    throw new HttpsError('invalid-argument', 'Timeline notes read access is required before enabling note changes.');
  }
  return {
    requestId: data.requestId,
    message,
    timeZone,
    locationAccess: parseAssistantLocationAccess(data.locationAccess),
    timelineNotesEnabled,
    activityTagChangesEnabled,
    timelineNoteChangesEnabled,
    trainingPlansEnabled,
    trainingPlanChangesEnabled,
    trainingDeliveryEnabled,
    ...(conversationId
      ? { conversationId }
      : {}),
  };
}

function mapConversationStoreError(error: AssistantConversationStoreError): HttpsError {
  if (error.code === 'user_deleted') {
    return new HttpsError('permission-denied', 'The Assistant is unavailable for this account.');
  }
  if (error.code === 'turn_in_progress') {
    return new HttpsError('aborted', error.message, { reason: error.code });
  }
  if (error.code === 'request_id_conflict') {
    return new HttpsError('invalid-argument', error.message);
  }
  return new HttpsError(
    'aborted',
    'The conversation changed. Reload it and try again.',
    { reason: error.code },
  );
}

function mapAssistantError(error: unknown): HttpsError {
  if (error instanceof HttpsError) {
    return error;
  }
  if (error instanceof AssistantConversationStoreError) {
    return mapConversationStoreError(error);
  }
  return new HttpsError(
    'unavailable',
    'The Assistant could not answer right now. Please try again.',
  );
}

function assertRequestFingerprintMatchesInput(
  requestState: Pick<ReplayedAssistantTurn, 'requestFingerprint'>,
  input: AssistantChatRequest,
): void {
  if (requestState.requestFingerprint !== createAssistantRequestFingerprint(
    input.requestId,
    input.message,
    input.locationAccess,
    input.timelineNotesEnabled,
    input.activityTagChangesEnabled,
    input.timelineNoteChangesEnabled,
    input.trainingPlansEnabled,
    input.trainingPlanChangesEnabled,
    input.trainingDeliveryEnabled,
  )) {
    throw new HttpsError(
      'invalid-argument',
      'requestId was already used for a different Assistant message.',
    );
  }
}

function isRetryableGroundedAnswerError(error: unknown): boolean {
  if (error instanceof AssistantConversationStoreError) {
    return false;
  }
  if (!(error instanceof HttpsError)) {
    const genkitStatus = getGenkitErrorStatus(error);
    if (genkitStatus) {
      return genkitStatus === 'UNAVAILABLE'
        || genkitStatus === 'DEADLINE_EXCEEDED'
        || genkitStatus === 'RESOURCE_EXHAUSTED'
        || genkitStatus === 'ABORTED'
        || genkitStatus === 'INTERNAL';
    }
    return true;
  }
  return error.code === 'unavailable'
    || error.code === 'deadline-exceeded'
    || error.code === 'internal';
}

function getGenkitErrorStatus(error: unknown): string | null {
  if (!(error instanceof Error)
    || error.name !== 'GenkitError'
    || typeof (error as Error & { status?: unknown }).status !== 'string') {
    return null;
  }
  return (error as Error & { status: string }).status;
}

async function answerWithGroundedRetry(
  answer: AssistantCallableDependencies['answer'],
  input: Parameters<AssistantCallableDependencies['answer']>[0],
  canRetry: () => boolean,
): Promise<AssistantRuntimeResult> {
  for (
    let attempt = 1;
    attempt <= ASSISTANT_GROUNDED_ANSWER_ATTEMPT_LIMIT;
    attempt += 1
  ) {
    try {
      return await answer(input);
    } catch (error) {
      if (attempt >= ASSISTANT_GROUNDED_ANSWER_ATTEMPT_LIMIT
        || !canRetry()
        || !isRetryableGroundedAnswerError(error)) {
        throw error;
      }
      logger.warn('[Assistant] Retrying grounded response generation.', {
        attempt: attempt + 1,
        errorName: error instanceof Error ? error.name : 'unknown',
        errorReason: getAssistantRuntimeErrorReason(error) ?? 'unknown',
        errorStatus: getGenkitErrorStatus(error) ?? 'unknown',
        toolName: getAssistantRuntimeErrorToolName(error) ?? 'unknown',
      });
    }
  }
  throw new Error('The Assistant grounded response attempt limit was invalid.');
}

async function buildExistingRequestResponse(
  uid: string,
  input: AssistantChatRequest,
  requestState: AssistantRequestState,
  quotaRoleContext: AssistantUserRoleContext | null,
  dependencies: AssistantCallableDependencies,
): Promise<AssistantChatResponse> {
  assertRequestFingerprintMatchesInput(requestState, input);
  const quota = quotaRoleContext
    ? await dependencies.getQuotaStatus(uid, quotaRoleContext)
    : await dependencies.getQuotaStatus(uid);
  return {
    conversation: requestState.conversation,
    ...(input.timelineNotesEnabled ? { timelineNotesEnabled: true } : {}),
    ...(input.activityTagChangesEnabled ? { activityTagChangesEnabled: true } : {}),
    ...(input.timelineNoteChangesEnabled ? { timelineNoteChangesEnabled: true } : {}),
    ...(input.trainingPlansEnabled ? { trainingPlansEnabled: true } : {}),
    ...(input.trainingPlanChangesEnabled ? { trainingPlanChangesEnabled: true } : {}),
    ...(input.trainingDeliveryEnabled ? { trainingDeliveryEnabled: true } : {}),
    ...(requestState.pendingTrainingProposal
      ? { pendingTrainingProposal: requestState.pendingTrainingProposal }
      : {}),
    ...(requestState.pendingContentProposal
      ? { pendingContentProposal: requestState.pendingContentProposal }
      : {}),
    quota,
    pendingRequestId: requestState.kind === 'pending'
      ? input.requestId
      : null,
  };
}

export async function runAssistantChat(
  value: unknown,
  context: AssistantCallableContext | undefined,
  dependencies: AssistantCallableDependencies = defaultDependencies,
): Promise<AssistantChatResponse> {
  const uid = requireAuthenticatedUid(context);
  const input = parseAssistantChatRequest(value);

  let reservation: AssistantQuotaReservation | null = null;
  let begunTurn: BegunAssistantTurn | null = null;
  let finalizedQuota: AssistantQuotaStatusResponse | null = null;
  let finalizeQuotaPromise: Promise<AssistantQuotaStatusResponse> | null = null;
  const finalizeQuotaForBillableAttempt = async (): Promise<void> => {
    if (finalizedQuota) {
      return;
    }
    if (!reservation) {
      throw new Error('Assistant quota reservation was unavailable at the billable-work boundary.');
    }
    if (!finalizeQuotaPromise) {
      const activeReservation = reservation;
      finalizeQuotaPromise = dependencies.finalizeQuota(activeReservation).then(quota => {
        finalizedQuota = quota;
        reservation = null;
        return quota;
      });
    }
    await finalizeQuotaPromise;
  };
  try {
    await dependencies.assertLegalAccess(uid);
    const quotaRoleContext = resolveCallableQuotaRoleContext(context);
    const requestFingerprint = createAssistantRequestFingerprint(
      input.requestId,
      input.message,
      input.locationAccess,
      input.timelineNotesEnabled,
      input.trainingPlansEnabled,
      input.trainingPlanChangesEnabled,
      input.trainingDeliveryEnabled,
      input.activityTagChangesEnabled,
      input.timelineNoteChangesEnabled,
    );
    const existingRequest = await dependencies.conversationStore.findRequestState(
      uid,
      input.conversationId,
      input.requestId,
      requestFingerprint,
    );
    if (existingRequest) {
      const existingResponse = await buildExistingRequestResponse(
        uid,
        input,
        existingRequest,
        quotaRoleContext,
        dependencies,
      );
      return existingResponse;
    }
    try {
      reservation = quotaRoleContext
        ? await dependencies.reserveQuota(uid, quotaRoleContext)
        : await dependencies.reserveQuota(uid);
    } catch (error) {
      if (error instanceof HttpsError && error.code === 'resource-exhausted') {
        const requestStateWhileReserving = await dependencies.conversationStore.findRequestState(
          uid,
          input.conversationId,
          input.requestId,
          requestFingerprint,
        );
        if (requestStateWhileReserving) {
          const existingResponse = await buildExistingRequestResponse(
            uid,
            input,
            requestStateWhileReserving,
            quotaRoleContext,
            dependencies,
          );
          return existingResponse;
        }
      }
      throw error;
    }
    const turnStart = await dependencies.conversationStore.beginTurn(
      uid,
      input.conversationId,
      input.requestId,
      requestFingerprint,
      input.locationAccess,
      input.timelineNotesEnabled,
      input.trainingPlansEnabled,
      input.trainingPlanChangesEnabled,
      input.trainingDeliveryEnabled,
      input.activityTagChangesEnabled,
      input.timelineNoteChangesEnabled,
    );
    if (turnStart.kind === 'replayed') {
      assertRequestFingerprintMatchesInput(turnStart, input);
      const quota = await dependencies.releaseQuota(reservation);
      reservation = null;
      return {
        conversation: turnStart.conversation,
        ...(input.timelineNotesEnabled ? { timelineNotesEnabled: true } : {}),
        ...(input.activityTagChangesEnabled ? { activityTagChangesEnabled: true } : {}),
        ...(input.timelineNoteChangesEnabled ? { timelineNoteChangesEnabled: true } : {}),
        ...(input.trainingPlansEnabled ? { trainingPlansEnabled: true } : {}),
        ...(input.trainingPlanChangesEnabled ? { trainingPlanChangesEnabled: true } : {}),
        ...(input.trainingDeliveryEnabled ? { trainingDeliveryEnabled: true } : {}),
        ...(turnStart.pendingTrainingProposal
          ? { pendingTrainingProposal: turnStart.pendingTrainingProposal }
          : {}),
        ...(turnStart.pendingContentProposal
          ? { pendingContentProposal: turnStart.pendingContentProposal }
          : {}),
        quota,
        pendingRequestId: null,
      };
    }
    if (turnStart.kind === 'pending') {
      assertRequestFingerprintMatchesInput(turnStart, input);
      const quota = await dependencies.releaseQuota(reservation);
      reservation = null;
      return {
        conversation: turnStart.conversation,
        ...(input.timelineNotesEnabled ? { timelineNotesEnabled: true } : {}),
        ...(input.activityTagChangesEnabled ? { activityTagChangesEnabled: true } : {}),
        ...(input.timelineNoteChangesEnabled ? { timelineNoteChangesEnabled: true } : {}),
        ...(input.trainingPlansEnabled ? { trainingPlansEnabled: true } : {}),
        ...(input.trainingPlanChangesEnabled ? { trainingPlanChangesEnabled: true } : {}),
        ...(input.trainingDeliveryEnabled ? { trainingDeliveryEnabled: true } : {}),
        ...(turnStart.pendingTrainingProposal
          ? { pendingTrainingProposal: turnStart.pendingTrainingProposal }
          : {}),
        ...(turnStart.pendingContentProposal
          ? { pendingContentProposal: turnStart.pendingContentProposal }
          : {}),
        quota,
        pendingRequestId: input.requestId,
      };
    }
    begunTurn = turnStart;
    const notesConversationId = begunTurn.conversationId;
    const timelineNotesEnabled = begunTurn.timelineNotesEnabled === true;
    const activityTagChangesEnabled = begunTurn.activityTagChangesEnabled === true;
    const timelineNoteChangesEnabled = begunTurn.timelineNoteChangesEnabled === true;
    const trainingPlansEnabled = begunTurn.trainingPlansEnabled === true;
    const trainingPlanChangesEnabled = begunTurn.trainingPlanChangesEnabled === true;
    const trainingDeliveryEnabled = begunTurn.trainingDeliveryEnabled === true;
    if (trainingPlansEnabled !== (input.trainingPlansEnabled === true)) {
      throw new AssistantConversationStoreError('conversation_changed', 'The Assistant data-access setting changed.');
    }
    if (timelineNotesEnabled !== (input.timelineNotesEnabled === true)) {
      throw new AssistantConversationStoreError('conversation_changed', 'The Assistant data-access setting changed.');
    }
    if (activityTagChangesEnabled !== (input.activityTagChangesEnabled === true)
      || timelineNoteChangesEnabled !== (input.timelineNoteChangesEnabled === true)) {
      throw new AssistantConversationStoreError('conversation_changed', 'The Assistant data-access setting changed.');
    }
    if (trainingPlanChangesEnabled !== (input.trainingPlanChangesEnabled === true)
      || trainingDeliveryEnabled !== (input.trainingDeliveryEnabled === true)) {
      throw new AssistantConversationStoreError('conversation_changed', 'The Assistant data-access setting changed.');
    }
    const result = await answerWithGroundedRetry(dependencies.answer, {
      uid,
      appBaseUrl: resolveAssistantAppBaseUrl(context),
      prompt: input.message,
      timeZone: input.timeZone,
      locationAccess: input.locationAccess,
      timelineNotesEnabled,
      activityTagChangesEnabled,
      timelineNoteChangesEnabled,
      trainingPlansEnabled,
      trainingPlanChangesEnabled,
      trainingDeliveryEnabled,
      conversationId: notesConversationId,
      ...(trainingPlansEnabled ? { assertTrainingPlansAccess: async () => {
        const current = await dependencies.conversationStore.getActiveConversationState(uid);
        if (current.conversation?.conversationId !== notesConversationId || current.trainingPlansEnabled !== true) {
          throw new AssistantConversationStoreError('conversation_changed', 'The Assistant data-access setting changed.');
        }
      } } : {}),
      ...((trainingPlanChangesEnabled || trainingDeliveryEnabled) ? { assertTrainingWriteAccess: async () => {
        const current = await dependencies.conversationStore.getActiveConversationState(uid);
        if (current.conversation?.conversationId !== notesConversationId
          || current.trainingPlansEnabled !== true
          || current.trainingPlanChangesEnabled !== trainingPlanChangesEnabled
          || current.trainingDeliveryEnabled !== trainingDeliveryEnabled) {
          throw new AssistantConversationStoreError('conversation_changed', 'The Assistant data-access setting changed.');
        }
      } } : {}),
      ...(timelineNotesEnabled ? { assertTimelineNotesAccess: async () => {
        const current = await dependencies.conversationStore.getActiveConversationState(uid);
        if (current.conversation?.conversationId !== notesConversationId || current.timelineNotesEnabled !== true) {
          throw new AssistantConversationStoreError('conversation_changed', 'The Assistant data-access setting changed.');
        }
      } } : {}),
      ...((activityTagChangesEnabled || timelineNoteChangesEnabled) ? { assertContentWriteAccess: async (
        kind: 'activity_tags' | 'timeline_notes',
      ) => {
        const current = await dependencies.conversationStore.getActiveConversationState(uid);
        const permitted = kind === 'activity_tags'
          ? current.activityTagChangesEnabled === true
          : current.timelineNotesEnabled === true && current.timelineNoteChangesEnabled === true;
        if (current.conversation?.conversationId !== notesConversationId || !permitted) {
          throw new AssistantConversationStoreError('conversation_changed', 'The Assistant data-access setting changed.');
        }
      } } : {}),
      history: begunTurn.history,
      onBillableAttempt: finalizeQuotaForBillableAttempt,
    }, () => finalizeQuotaPromise === null || finalizedQuota !== null);
    // Production runtime calls this immediately before Gemini or an MCP tool.
    // Retain a defensive completion fallback for injected runtimes: a grounded
    // answer must never be committed without consuming its reserved allowance.
    await finalizeQuotaForBillableAttempt();
    if (!finalizedQuota) {
      throw new Error('Assistant quota was not finalized for a completed answer.');
    }
    const createdAt = dependencies.now().toISOString();
    const userMessage: AssistantMessage = {
      id: input.requestId,
      role: 'user',
      text: input.message,
      createdAt,
    };
    const assistantMessage: AssistantMessage = {
      id: dependencies.createId(),
      role: 'assistant',
      text: result.answer,
      createdAt,
      evidence: result.evidence,
      ...(result.visuals?.length ? { visuals: result.visuals } : {}),
    };
    const completedTurn = await dependencies.conversationStore.completeTurn(
      uid,
      begunTurn,
      userMessage,
      assistantMessage,
      result.pendingTrainingProposal,
      result.pendingContentProposal,
    );
    begunTurn = null;
    return {
      conversation: completedTurn.conversation,
      quota: finalizedQuota,
      ...(timelineNotesEnabled ? { timelineNotesEnabled: true } : {}),
      ...(activityTagChangesEnabled ? { activityTagChangesEnabled: true } : {}),
      ...(timelineNoteChangesEnabled ? { timelineNoteChangesEnabled: true } : {}),
      ...(trainingPlansEnabled ? { trainingPlansEnabled: true } : {}),
      ...(trainingPlanChangesEnabled ? { trainingPlanChangesEnabled: true } : {}),
      ...(trainingDeliveryEnabled ? { trainingDeliveryEnabled: true } : {}),
      ...(result.pendingTrainingProposal ? { pendingTrainingProposal: result.pendingTrainingProposal } : {}),
      ...(completedTurn.pendingContentProposal
        ? { pendingContentProposal: completedTurn.pendingContentProposal }
        : {}),
      pendingRequestId: null,
    };
  } catch (error) {
    if (begunTurn) {
      try {
        await dependencies.conversationStore.releaseTurn(uid, begunTurn);
      } catch (releaseError) {
        logger.warn('[Assistant] Failed to release an incomplete conversation turn.', {
          errorName: releaseError instanceof Error ? releaseError.name : 'unknown',
        });
      }
    }
    if (reservation) {
      try {
        await dependencies.releaseQuota(reservation);
      } catch (releaseError) {
        logger.warn('[Assistant] Failed to release an unused quota reservation.', {
          errorName: releaseError instanceof Error ? releaseError.name : 'unknown',
        });
      }
    }
    const mappedError = mapAssistantError(error);
    if (mappedError.code === 'unavailable') {
      logger.error('[Assistant] Grounded response generation failed.', {
        errorName: error instanceof Error ? error.name : 'unknown',
        errorReason: getAssistantRuntimeErrorReason(error) ?? 'unknown',
        errorStatus: getGenkitErrorStatus(error) ?? 'unknown',
        toolName: getAssistantRuntimeErrorToolName(error) ?? 'unknown',
      });
    }
    throw mappedError;
  }
}

export async function runGetAssistantQuotaStatus(
  context: AssistantCallableContext | undefined,
  getQuotaStatus: typeof getAssistantQuotaStatusForUser = getAssistantQuotaStatusForUser,
): Promise<AssistantQuotaStatusResponse> {
  const uid = requireAuthenticatedUid(context);
  const quotaRoleContext = resolveCallableQuotaRoleContext(context);
  return quotaRoleContext
    ? getQuotaStatus(uid, quotaRoleContext)
    : getQuotaStatus(uid);
}

export async function runGetAssistantConversation(
  context: AssistantCallableContext | undefined,
  conversationStore: AssistantConversationStore = assistantConversationStore,
): Promise<GetAssistantConversationResponse> {
  const uid = requireAuthenticatedUid(context);
  try {
    return await conversationStore.getActiveConversationState(uid);
  } catch (error) {
    throw mapAssistantError(error);
  }
}

export async function runResetAssistantConversation(
  value: unknown,
  context: AssistantCallableContext | undefined,
  conversationStore: AssistantConversationStore = assistantConversationStore,
): Promise<ResetAssistantConversationResponse> {
  const uid = requireAuthenticatedUid(context);
  const data = asRecord(value) as Partial<ResetAssistantConversationRequest>;
  const locationAccess = parseAssistantLocationAccess(data.locationAccess);
  const timelineNotesEnabled = parseOptionalDataAccess(data.timelineNotesEnabled, 'timelineNotesEnabled');
  const activityTagChangesEnabled = parseOptionalDataAccess(data.activityTagChangesEnabled, 'activityTagChangesEnabled');
  const timelineNoteChangesEnabled = parseOptionalDataAccess(data.timelineNoteChangesEnabled, 'timelineNoteChangesEnabled');
  const trainingPlansEnabled = parseOptionalDataAccess(data.trainingPlansEnabled, 'trainingPlansEnabled');
  const trainingPlanChangesEnabled = parseOptionalDataAccess(data.trainingPlanChangesEnabled, 'trainingPlanChangesEnabled');
  const trainingDeliveryEnabled = parseOptionalDataAccess(data.trainingDeliveryEnabled, 'trainingDeliveryEnabled');
  if ((trainingPlanChangesEnabled || trainingDeliveryEnabled) && !trainingPlansEnabled) {
    throw new HttpsError('invalid-argument', 'Training plans read access is required before enabling Training changes.');
  }
  if (timelineNoteChangesEnabled && !timelineNotesEnabled) {
    throw new HttpsError('invalid-argument', 'Timeline notes read access is required before enabling note changes.');
  }
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId.trim() : data.conversationId;
  if ((conversationId !== undefined && conversationId !== null
    && (typeof conversationId !== 'string' || !conversationId || conversationId.length > 120))
    || ((timelineNotesEnabled || activityTagChangesEnabled || timelineNoteChangesEnabled || trainingPlansEnabled
      || trainingPlanChangesEnabled || trainingDeliveryEnabled) && conversationId === undefined)) {
    throw new HttpsError('invalid-argument', 'Provide the current conversationId or null before enabling optional data access.');
  }
  try {
    return {
      conversation: await conversationStore.resetConversation(uid, locationAccess, timelineNotesEnabled, conversationId,
        trainingPlansEnabled, trainingPlanChangesEnabled, trainingDeliveryEnabled,
        activityTagChangesEnabled, timelineNoteChangesEnabled),
      ...(timelineNotesEnabled ? { timelineNotesEnabled: true } : {}),
      ...(activityTagChangesEnabled ? { activityTagChangesEnabled: true } : {}),
      ...(timelineNoteChangesEnabled ? { timelineNoteChangesEnabled: true } : {}),
      ...(trainingPlansEnabled ? { trainingPlansEnabled: true } : {}),
      ...(trainingPlanChangesEnabled ? { trainingPlanChangesEnabled: true } : {}),
      ...(trainingDeliveryEnabled ? { trainingDeliveryEnabled: true } : {}),
    };
  } catch (error) {
    throw mapAssistantError(error);
  }
}

export async function runApplyAssistantTrainingProposal(
  value: unknown,
  context: AssistantCallableContext | undefined,
  conversationStore: AssistantConversationStore = assistantConversationStore,
  applyProposal: typeof applyTrainingChanges = applyTrainingChanges,
): Promise<ApplyAssistantTrainingProposalResponse> {
  const uid = requireAuthenticatedUid(context);
  const data = asRecord(value) as Partial<ApplyAssistantTrainingProposalRequest>;
  const proposalRef = typeof data.proposalRef === 'string' ? data.proposalRef.trim() : '';
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId.trim() : '';
  const permissionMode = data.permissionMode;
  const confirm = data.confirm;
  if (!proposalRef || proposalRef.length > 2048 || !conversationId || conversationId.length > 120
    || !['schedule', 'delivery', 'combined'].includes(`${permissionMode}`) || typeof confirm !== 'boolean') {
    throw new HttpsError('invalid-argument', 'A valid current Training proposal is required.');
  }
  const current = await conversationStore.getActiveConversationState(uid);
  const needsSchedule = permissionMode === 'schedule' || permissionMode === 'combined';
  const needsDelivery = permissionMode === 'delivery' || permissionMode === 'combined';
  if (current.conversation?.conversationId !== conversationId
    || current.pendingTrainingProposal?.proposalRef !== proposalRef
    || current.pendingTrainingProposal?.permissionMode !== permissionMode
    || current.trainingPlansEnabled !== true
    || (needsSchedule && current.trainingPlanChangesEnabled !== true)
    || (needsDelivery && current.trainingDeliveryEnabled !== true)) {
    throw new HttpsError('aborted', 'The Assistant data-access setting changed. Review the proposal again.');
  }
  if (!confirm) {
    await conversationStore.clearTrainingProposal(uid, conversationId, proposalRef);
    return { status: 'dismissed', scheduleRevision: current.pendingTrainingProposal.scheduleRevision,
      changes: [], providers: [] };
  }
  try {
    const result = await applyProposal({
      uid,
      connectionId: `first-party-assistant-v1:${conversationId}`,
      scopes: [
        MCP_OAUTH_SCOPES.TrainingPlansRead,
        ...(needsSchedule ? [MCP_OAUTH_SCOPES.TrainingPlansWrite] : []),
        ...(needsDelivery ? [MCP_OAUTH_SCOPES.TrainingDeliveryWrite] : []),
      ],
      arguments: { proposalRef, permissionMode },
    });
    await conversationStore.clearTrainingProposal(uid, conversationId, proposalRef);
    return {
      status: result.status,
      scheduleRevision: result.scheduleRevision,
      changes: result.changes,
      providers: result.providers,
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof McpDataError) throw new HttpsError('failed-precondition', error.message);
    throw new HttpsError('internal', 'The Training proposal could not be applied safely.');
  }
}

export async function runApplyAssistantContentProposal(
  value: unknown,
  context: AssistantCallableContext | undefined,
  conversationStore: AssistantConversationStore = assistantConversationStore,
  dataService: ReturnType<typeof createMcpDataService> = createMcpDataService(),
): Promise<ApplyAssistantContentProposalResponse> {
  const uid = requireAuthenticatedUid(context);
  const data = asRecord(value) as Partial<ApplyAssistantContentProposalRequest>;
  const proposalRef = typeof data.proposalRef === 'string' ? data.proposalRef.trim() : '';
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId.trim() : '';
  if (!proposalRef || proposalRef.length > 120 || !conversationId || conversationId.length > 120
    || typeof data.confirm !== 'boolean') {
    throw new HttpsError('invalid-argument', 'A valid current content proposal is required.');
  }
  let current;
  try {
    current = await conversationStore.getActiveConversationState(uid);
  } catch (error) {
    throw mapAssistantError(error);
  }
  const proposal = current.pendingContentProposal;
  const needsTags = proposal?.kind === 'update_activity_tags';
  const needsNotes = proposal?.kind === 'create_timeline_note'
    || proposal?.kind === 'update_timeline_note'
    || proposal?.kind === 'delete_timeline_note';
  if (current.conversation?.conversationId !== conversationId
    || !proposal || proposal.proposalRef !== proposalRef
    || (needsTags && current.activityTagChangesEnabled !== true)
    || (needsNotes && (current.timelineNotesEnabled !== true || current.timelineNoteChangesEnabled !== true))) {
    throw new HttpsError('aborted', 'The Assistant data-access setting changed. Review the change again.');
  }
  if (!data.confirm) {
    try {
      await conversationStore.clearContentProposal(uid, conversationId, proposalRef);
    } catch (error) {
      throw mapAssistantError(error);
    }
    return { status: 'dismissed', kind: proposal.kind, message: 'Nothing was changed.' };
  }
  const writeInput = {
    uid,
    connectionId: `first-party-assistant-v1:${conversationId}`,
    assistantConversationId: conversationId,
    assistantProposalRef: proposalRef,
    scopes: needsTags
      ? [MCP_OAUTH_SCOPES.ActivityDetailsRead, MCP_OAUTH_SCOPES.ActivityTagsWrite]
      : [MCP_OAUTH_SCOPES.TimelineNotesRead, MCP_OAUTH_SCOPES.TimelineNotesWrite],
    arguments: proposal.arguments,
  };
  try {
    switch (proposal.kind) {
      case 'update_activity_tags':
        await dataService.updateActivityTags(writeInput);
        break;
      case 'create_timeline_note':
        await dataService.createTimelineNote(writeInput);
        break;
      case 'update_timeline_note':
        await dataService.updateTimelineNote(writeInput);
        break;
      case 'delete_timeline_note':
        await dataService.deleteTimelineNote(writeInput);
        break;
    }
    try {
      await conversationStore.clearContentProposal(uid, conversationId, proposalRef);
    } catch (error) {
      // The content mutation is already accepted and is idempotent. Do not report
      // it as failed merely because a newer proposal won the conversation race
      // or the best-effort cleanup must be retried after a refresh.
      logger.warn('[Assistant] Applied content proposal could not be cleared.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
    return {
      status: 'applied',
      kind: proposal.kind,
      message: proposal.kind === 'update_activity_tags'
        ? 'Activity tags updated.'
        : proposal.kind === 'delete_timeline_note'
          ? 'Timeline note deleted.'
          : proposal.kind === 'create_timeline_note'
            ? 'Timeline note created.'
            : 'Timeline note updated.',
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof McpDataError) throw new HttpsError('failed-precondition', error.message);
    throw new HttpsError('internal', 'The content proposal could not be applied safely.');
  }
}

export const ASSISTANT_CALLABLE_OPTIONS = {
  region: FUNCTIONS_MANIFEST.assistantChat.region,
  secrets: FUNCTION_SECRET_BINDINGS.assistantChat,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
  memory: '2GiB' as const,
  timeoutSeconds: 180,
  concurrency: 10,
  maxInstances: 10,
};

export const assistantChat = onCall(
  ASSISTANT_CALLABLE_OPTIONS,
  request => runAssistantChat(request.data, request),
);

export const getAssistantQuotaStatus = onCall({
  region: FUNCTIONS_MANIFEST.getAssistantQuotaStatus.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
  memory: '512MiB',
}, request => runGetAssistantQuotaStatus(request));

export const getAssistantConversation = onCall({
  region: FUNCTIONS_MANIFEST.getAssistantConversation.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
  memory: '512MiB',
}, request => runGetAssistantConversation(request));

export const RESET_ASSISTANT_CONVERSATION_OPTIONS = {
  region: FUNCTIONS_MANIFEST.resetAssistantConversation.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
  memory: '512MiB' as const,
};

export const resetAssistantConversation = onCall(
  RESET_ASSISTANT_CONVERSATION_OPTIONS,
  request => runResetAssistantConversation(request.data, request),
);

export const APPLY_ASSISTANT_TRAINING_PROPOSAL_OPTIONS = {
  region: FUNCTIONS_MANIFEST.applyAssistantTrainingProposal.region,
  secrets: FUNCTION_SECRET_BINDINGS.applyAssistantTrainingProposal,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
  memory: '512MiB' as const,
};

export const applyAssistantTrainingProposal = onCall(
  APPLY_ASSISTANT_TRAINING_PROPOSAL_OPTIONS,
  request => ('permissionMode' in asRecord(request.data)
    ? runApplyAssistantTrainingProposal(request.data, request)
    : runApplyAssistantContentProposal(request.data, request)),
);
