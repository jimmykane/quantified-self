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
  type AssistantQuotaStatusResponse,
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
  return {
    requestId: data.requestId,
    message,
    timeZone,
    locationAccess: parseAssistantLocationAccess(data.locationAccess),
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
    );
    if (turnStart.kind === 'replayed') {
      assertRequestFingerprintMatchesInput(turnStart, input);
      const quota = await dependencies.releaseQuota(reservation);
      reservation = null;
      return {
        conversation: turnStart.conversation,
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
        quota,
        pendingRequestId: input.requestId,
      };
    }
    begunTurn = turnStart;
    const result = await answerWithGroundedRetry(dependencies.answer, {
      uid,
      appBaseUrl: resolveAssistantAppBaseUrl(context),
      prompt: input.message,
      timeZone: input.timeZone,
      locationAccess: input.locationAccess,
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
    const conversation = await dependencies.conversationStore.completeTurn(
      uid,
      begunTurn,
      userMessage,
      assistantMessage,
    );
    begunTurn = null;
    return {
      conversation,
      quota: finalizedQuota,
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
  try {
    return {
      conversation: await conversationStore.resetConversation(uid, locationAccess),
    };
  } catch (error) {
    throw mapAssistantError(error);
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
}, request => runGetAssistantQuotaStatus(request));

export const getAssistantConversation = onCall({
  region: FUNCTIONS_MANIFEST.getAssistantConversation.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
}, request => runGetAssistantConversation(request));

export const resetAssistantConversation = onCall({
  region: FUNCTIONS_MANIFEST.resetAssistantConversation.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
}, request => runResetAssistantConversation(request.data, request));
