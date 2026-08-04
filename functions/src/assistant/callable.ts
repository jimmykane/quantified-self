import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import {
  ASSISTANT_MAX_MESSAGE_CHARS,
  type AssistantChatRequest,
  type AssistantChatResponse,
  type AssistantMessage,
  type GetAssistantConversationResponse,
  type ResetAssistantConversationResponse,
} from '../../../shared/assistant.types';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import {
  reserveAiInsightsQuotaForRequest,
  finalizeAiInsightsQuotaReservation,
  releaseAiInsightsQuotaReservation,
  type AiInsightsQuotaReservation,
} from '../ai/insights/quota';
import { assertValidTimeZone } from '../ai/insights/insight-presentation';
import {
  AssistantConversationStoreError,
  assistantConversationStore,
  type AssistantConversationStore,
  type BegunAssistantTurn,
} from './conversation-store';
import { assistantRuntime, type AssistantRuntimeResult } from './runtime';

interface AssistantCallableContext {
  auth?: { uid: string } | null;
  app?: unknown;
  rawRequest?: {
    get: (name: string) => string | undefined;
  };
}

const ASSISTANT_PRODUCTION_APP_BASE_URL = 'https://quantified-self.io';
const ASSISTANT_HOSTED_APP_ORIGINS = new Set([
  ASSISTANT_PRODUCTION_APP_BASE_URL,
  'https://beta.quantified-self.io',
]);

export interface AssistantCallableDependencies {
  assertLegalAccess: (uid: string) => Promise<void>;
  reserveQuota: typeof reserveAiInsightsQuotaForRequest;
  finalizeQuota: typeof finalizeAiInsightsQuotaReservation;
  releaseQuota: typeof releaseAiInsightsQuotaReservation;
  conversationStore: AssistantConversationStore;
  answer: (input: {
    uid: string;
    appBaseUrl: string;
    prompt: string;
    timeZone: string;
    history: AssistantMessage[];
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
  reserveQuota: reserveAiInsightsQuotaForRequest,
  finalizeQuota: finalizeAiInsightsQuotaReservation,
  releaseQuota: releaseAiInsightsQuotaReservation,
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

function parseAssistantChatRequest(value: unknown): AssistantChatRequest {
  const data = asRecord(value);
  if (typeof data.requestId !== 'string'
    || !/^[A-Za-z0-9_-]{16,120}$/.test(data.requestId)) {
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
  assertValidTimeZone(timeZone);
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

export async function runAssistantChat(
  value: unknown,
  context: AssistantCallableContext | undefined,
  dependencies: AssistantCallableDependencies = defaultDependencies,
): Promise<AssistantChatResponse> {
  const uid = requireAuthenticatedUid(context);
  const input = parseAssistantChatRequest(value);

  let reservation: AiInsightsQuotaReservation | null = null;
  let begunTurn: BegunAssistantTurn | null = null;
  try {
    await dependencies.assertLegalAccess(uid);
    reservation = await dependencies.reserveQuota(uid);
    const turnStart = await dependencies.conversationStore.beginTurn(
      uid,
      input.conversationId,
      input.requestId,
    );
    if (turnStart.kind === 'replayed') {
      if (turnStart.requestText !== input.message) {
        throw new HttpsError(
          'invalid-argument',
          'requestId was already used for a different Assistant message.',
        );
      }
      const quota = await dependencies.releaseQuota(reservation);
      reservation = null;
      return {
        conversation: turnStart.conversation,
        quota,
      };
    }
    begunTurn = turnStart;
    const quota = await dependencies.finalizeQuota(reservation);
    reservation = null;
    const result = await dependencies.answer({
      uid,
      appBaseUrl: resolveAssistantAppBaseUrl(context),
      prompt: input.message,
      timeZone: input.timeZone,
      history: begunTurn.history,
    });
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
    };
    const conversation = await dependencies.conversationStore.completeTurn(
      uid,
      begunTurn,
      userMessage,
      assistantMessage,
    );
    begunTurn = null;
    return { conversation, quota };
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
      });
    }
    throw mappedError;
  }
}

export async function runGetAssistantConversation(
  context: AssistantCallableContext | undefined,
  conversationStore: AssistantConversationStore = assistantConversationStore,
): Promise<GetAssistantConversationResponse> {
  const uid = requireAuthenticatedUid(context);
  try {
    return {
      conversation: await conversationStore.getActiveConversation(uid),
    };
  } catch (error) {
    throw mapAssistantError(error);
  }
}

export async function runResetAssistantConversation(
  context: AssistantCallableContext | undefined,
  conversationStore: AssistantConversationStore = assistantConversationStore,
): Promise<ResetAssistantConversationResponse> {
  const uid = requireAuthenticatedUid(context);
  try {
    return {
      conversation: await conversationStore.resetConversation(uid),
    };
  } catch (error) {
    throw mapAssistantError(error);
  }
}

export const ASSISTANT_CALLABLE_OPTIONS = {
  region: FUNCTIONS_MANIFEST.assistantChat.region,
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

export const getAssistantConversation = onCall({
  region: FUNCTIONS_MANIFEST.getAssistantConversation.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
}, request => runGetAssistantConversation(request));

export const resetAssistantConversation = onCall({
  region: FUNCTIONS_MANIFEST.resetAssistantConversation.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
}, request => runResetAssistantConversation(request));
