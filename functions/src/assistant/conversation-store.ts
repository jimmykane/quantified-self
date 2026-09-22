import * as admin from 'firebase-admin';
import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  ASSISTANT_CONVERSATION_VERSION,
  ASSISTANT_MAX_STORED_MESSAGES,
  isAssistantLocationAccess,
  isValidAssistantRequestId,
  type AssistantConversation,
  type AssistantLocationAccess,
  type AssistantMessage,
  type AssistantContentProposalPreview,
  type AssistantTrainingProposalPreview,
} from '../../../shared/assistant.types';
import { isAssistantContentProposal, validateAssistantConversation } from '../../../shared/assistant-response.contract';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { TTL_CONFIG } from '../shared/ttl-config';
import { TRAINING_WRITE_OUTPUTS } from '../mcp/training-plans.schemas';

const ASSISTANT_CONVERSATION_COLLECTION = 'assistantConversations';
const ASSISTANT_ACTIVE_CONVERSATION_DOC = 'active';
const ASSISTANT_CONVERSATION_RETENTION_MS = TTL_CONFIG.ASSISTANT_CONVERSATIONS_IN_DAYS
  * 24 * 60 * 60 * 1_000;
const ASSISTANT_PENDING_TURN_TTL_MS = 4 * 60 * 1_000;
const ASSISTANT_PENDING_TURN_CLOCK_SKEW_MS = 30 * 1_000;
export const ASSISTANT_MAX_REPLAY_RECEIPTS = 512;
const ASSISTANT_REQUEST_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const ASSISTANT_DEFAULT_LOCATION_ACCESS: AssistantLocationAccess = 'coordinate_free';

interface AssistantPendingTurn {
  id: string;
  requestId: string | null;
  requestFingerprint: string | null;
  expiresAtMs: number;
}

export interface AssistantActiveConversationState {
  timelineNotesEnabled?: boolean;
  activityTagChangesEnabled?: boolean;
  timelineNoteChangesEnabled?: boolean;
  trainingPlansEnabled?: boolean;
  trainingPlanChangesEnabled?: boolean;
  trainingDeliveryEnabled?: boolean;
  pendingTrainingProposal?: AssistantTrainingProposalPreview;
  pendingContentProposal?: AssistantContentProposalPreview;
  conversation: AssistantConversation | null;
  pendingRequestId: string | null;
  locationAccess: AssistantLocationAccess;
}

interface AssistantReplayReceipt {
  requestId: string;
  requestFingerprint: string;
  completedAtMs: number;
}

interface StoredAssistantConversation {
  timelineNotesEnabled: boolean;
  activityTagChangesEnabled: boolean;
  timelineNoteChangesEnabled: boolean;
  trainingPlansEnabled: boolean;
  trainingPlanChangesEnabled: boolean;
  trainingDeliveryEnabled: boolean;
  pendingTrainingProposal: AssistantTrainingProposalPreview | null;
  pendingContentProposal: AssistantContentProposalPreview | null;
  version: typeof ASSISTANT_CONVERSATION_VERSION;
  conversationId: string;
  messages: AssistantMessage[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expireAt: Timestamp;
  locationAccess: AssistantLocationAccess;
  pendingTurn: AssistantPendingTurn | null;
  replayReceipts: AssistantReplayReceipt[];
}

export interface BegunAssistantTurn {
  timelineNotesEnabled?: boolean;
  activityTagChangesEnabled?: boolean;
  timelineNoteChangesEnabled?: boolean;
  trainingPlansEnabled?: boolean;
  trainingPlanChangesEnabled?: boolean;
  trainingDeliveryEnabled?: boolean;
  kind: 'started';
  conversationId: string;
  turnId: string;
  history: AssistantMessage[];
  locationAccess: AssistantLocationAccess;
}

export interface ReplayedAssistantTurn {
  kind: 'replayed';
  conversation: AssistantConversation;
  requestFingerprint: string;
  pendingTrainingProposal?: AssistantTrainingProposalPreview;
  pendingContentProposal?: AssistantContentProposalPreview;
}

export interface PendingAssistantTurn {
  kind: 'pending';
  conversation: AssistantConversation;
  requestFingerprint: string;
  pendingTrainingProposal?: AssistantTrainingProposalPreview;
  pendingContentProposal?: AssistantContentProposalPreview;
}

export type AssistantTurnStart =
  | BegunAssistantTurn
  | ReplayedAssistantTurn
  | PendingAssistantTurn;

export type AssistantRequestState = ReplayedAssistantTurn | PendingAssistantTurn;

export interface CompletedAssistantTurn {
  conversation: AssistantConversation;
  pendingContentProposal?: AssistantContentProposalPreview;
}

export type AssistantConversationStoreErrorCode =
  | 'user_deleted'
  | 'conversation_changed'
  | 'request_id_conflict'
  | 'turn_in_progress'
  | 'turn_lost';

export class AssistantConversationStoreError extends Error {
  constructor(
    readonly code: AssistantConversationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssistantConversationStoreError';
  }
}

export interface AssistantConversationStore {
  getActiveConversation: (uid: string) => Promise<AssistantConversation | null>;
  getActiveConversationState: (uid: string) => Promise<AssistantActiveConversationState>;
  findRequestState: (
    uid: string,
    expectedConversationId: string | undefined,
    requestId: string,
    requestFingerprint: string,
  ) => Promise<AssistantRequestState | null>;
  beginTurn: (
    uid: string,
    expectedConversationId?: string,
    requestId?: string,
    requestFingerprint?: string,
    locationAccess?: AssistantLocationAccess,
    timelineNotesEnabled?: boolean,
    trainingPlansEnabled?: boolean,
    trainingPlanChangesEnabled?: boolean,
    trainingDeliveryEnabled?: boolean,
    activityTagChangesEnabled?: boolean,
    timelineNoteChangesEnabled?: boolean,
  ) => Promise<AssistantTurnStart>;
  completeTurn: (
    uid: string,
    begunTurn: BegunAssistantTurn,
    userMessage: AssistantMessage,
    assistantMessage: AssistantMessage,
    pendingTrainingProposal?: AssistantTrainingProposalPreview,
    pendingContentProposal?: AssistantContentProposalPreview,
  ) => Promise<CompletedAssistantTurn>;
  clearTrainingProposal: (uid: string, conversationId: string, proposalRef: string) => Promise<void>;
  clearContentProposal: (uid: string, conversationId: string, proposalRef: string) => Promise<void>;
  releaseTurn: (uid: string, begunTurn: BegunAssistantTurn) => Promise<void>;
  resetConversation: (
    uid: string,
    locationAccess?: AssistantLocationAccess,
    timelineNotesEnabled?: boolean,
    expectedConversationId?: string | null,
    trainingPlansEnabled?: boolean,
    trainingPlanChangesEnabled?: boolean,
    trainingDeliveryEnabled?: boolean,
    activityTagChangesEnabled?: boolean,
    timelineNoteChangesEnabled?: boolean,
  ) => Promise<AssistantConversation>;
}

export interface AssistantConversationStoreDependencies {
  db: () => FirebaseFirestore.Firestore;
  now: () => Date;
  createId: () => string;
  getDeletionGuard: typeof getUserDeletionGuardStateInTransaction;
}

const defaultDependencies: AssistantConversationStoreDependencies = {
  db: () => admin.firestore(),
  now: () => new Date(),
  createId: () => randomUUID(),
  getDeletionGuard: getUserDeletionGuardStateInTransaction,
};

export function createAssistantRequestFingerprint(
  requestId: string,
  requestText: string,
  locationAccess: AssistantLocationAccess = ASSISTANT_DEFAULT_LOCATION_ACCESS,
  timelineNotesEnabled = false,
  trainingPlansEnabled = false,
  trainingPlanChangesEnabled = false,
  trainingDeliveryEnabled = false,
  activityTagChangesEnabled = false,
  timelineNoteChangesEnabled = false,
): string {
  const fingerprint = createHash('sha256')
    .update(requestId)
    .update('\0')
    .update(requestText);
  // Preserve existing coordinate-free receipts while binding wider consent
  // to a distinct idempotency fingerprint.
  if (locationAccess !== ASSISTANT_DEFAULT_LOCATION_ACCESS) {
    fingerprint.update('\0').update(locationAccess);
  }
  if (timelineNotesEnabled) fingerprint.update('\0timeline-notes:read');
  if (activityTagChangesEnabled) fingerprint.update('\0activity-tags:write');
  if (timelineNoteChangesEnabled) fingerprint.update('\0timeline-notes:write');
  if (trainingPlansEnabled) fingerprint.update('\0training-plans:read');
  if (trainingPlanChangesEnabled) fingerprint.update('\0training-plans:write');
  if (trainingDeliveryEnabled) fingerprint.update('\0training-delivery:write');
  return fingerprint.digest('hex');
}

function toMillis(value: unknown): number | null {
  if (value && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const milliseconds = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  return null;
}

function normalizeReplayReceipts(
  value: unknown,
  messages: AssistantMessage[],
  locationAccess: AssistantLocationAccess,
  timelineNotesEnabled: boolean,
  activityTagChangesEnabled: boolean,
  timelineNoteChangesEnabled: boolean,
  trainingPlansEnabled: boolean,
  trainingPlanChangesEnabled: boolean,
  trainingDeliveryEnabled: boolean,
): AssistantReplayReceipt[] {
  const receiptsByRequestId = new Map<string, AssistantReplayReceipt>();
  if (Array.isArray(value)) {
    for (const candidate of value.slice(-ASSISTANT_MAX_REPLAY_RECEIPTS)) {
      if (!candidate
        || typeof candidate !== 'object'
        || typeof candidate.requestId !== 'string'
        || candidate.requestId.length < 1
        || candidate.requestId.length > 120
        || typeof candidate.requestFingerprint !== 'string'
        || !ASSISTANT_REQUEST_FINGERPRINT_PATTERN.test(candidate.requestFingerprint)
        || typeof candidate.completedAtMs !== 'number'
        || !Number.isSafeInteger(candidate.completedAtMs)
        || candidate.completedAtMs <= 0) {
        continue;
      }
      receiptsByRequestId.set(candidate.requestId, {
        requestId: candidate.requestId,
        requestFingerprint: candidate.requestFingerprint,
        completedAtMs: candidate.completedAtMs,
      });
    }
  }

  // Documents written before replay receipts were introduced are upgraded in
  // memory from their retained user messages, then persisted on the next write.
  for (const message of messages) {
    if (message.role !== 'user') {
      continue;
    }
    const completedAtMs = Date.parse(message.createdAt);
    if (!Number.isSafeInteger(completedAtMs)
      || completedAtMs <= 0) {
      continue;
    }
    receiptsByRequestId.set(message.id, {
      requestId: message.id,
      requestFingerprint: createAssistantRequestFingerprint(
        message.id,
        message.text,
        locationAccess,
        timelineNotesEnabled,
        trainingPlansEnabled,
        trainingPlanChangesEnabled,
        trainingDeliveryEnabled,
        activityTagChangesEnabled,
        timelineNoteChangesEnabled,
      ),
      completedAtMs,
    });
  }

  return [...receiptsByRequestId.values()]
    .slice(-ASSISTANT_MAX_REPLAY_RECEIPTS);
}

function parseStoredConversation(
  data: FirebaseFirestore.DocumentData | undefined,
  nowMs: number,
): StoredAssistantConversation | null {
  if (!data
    || data.version !== ASSISTANT_CONVERSATION_VERSION
    || typeof data.conversationId !== 'string'
    || !Array.isArray(data.messages)
    || data.messages.length > ASSISTANT_MAX_STORED_MESSAGES
    || toMillis(data.createdAt) === null
    || toMillis(data.updatedAt) === null
    || toMillis(data.expireAt) === null) {
    return null;
  }
  const publicConversation = {
    version: ASSISTANT_CONVERSATION_VERSION,
    conversationId: data.conversationId,
    messages: data.messages,
    expiresAt: new Date(toMillis(data.expireAt) as number).toISOString(),
  };
  if (!validateAssistantConversation(publicConversation).ok) {
    return null;
  }
  const messages = data.messages as AssistantMessage[];
  const locationAccess = isAssistantLocationAccess(data.locationAccess)
    ? data.locationAccess
    : ASSISTANT_DEFAULT_LOCATION_ACCESS;
  const pendingTurn = data.pendingTurn === null
    ? null
    : data.pendingTurn
      && typeof data.pendingTurn === 'object'
      && typeof data.pendingTurn.id === 'string'
      && data.pendingTurn.id.length >= 1
      && data.pendingTurn.id.length <= 120
      && typeof data.pendingTurn.expiresAtMs === 'number'
      && Number.isSafeInteger(data.pendingTurn.expiresAtMs)
      && data.pendingTurn.expiresAtMs > 0
      // Firestore may be read by an instance whose clock trails the writer.
      // Keep the future bound, but tolerate a small, explicit amount of skew.
      && data.pendingTurn.expiresAtMs <= nowMs
        + ASSISTANT_PENDING_TURN_TTL_MS
        + ASSISTANT_PENDING_TURN_CLOCK_SKEW_MS
      ? {
        id: data.pendingTurn.id,
        requestId: isValidAssistantRequestId(data.pendingTurn.requestId)
          ? data.pendingTurn.requestId
          : null,
        requestFingerprint: typeof data.pendingTurn.requestFingerprint === 'string'
          && ASSISTANT_REQUEST_FINGERPRINT_PATTERN.test(
            data.pendingTurn.requestFingerprint,
          )
          ? data.pendingTurn.requestFingerprint
          : null,
        expiresAtMs: data.pendingTurn.expiresAtMs,
      }
      : null;
  const parsedProposal = TRAINING_WRITE_OUTPUTS.preview_training_changes.safeParse(data.pendingTrainingProposal);
  const pendingTrainingProposal = parsedProposal.success && parsedProposal.data.expiresAtMs > nowMs
    ? parsedProposal.data
    : null;
  const pendingContentProposal = isAssistantContentProposal(data.pendingContentProposal)
    && data.pendingContentProposal.expiresAtMs > nowMs
    ? data.pendingContentProposal
    : null;
  return {
    version: ASSISTANT_CONVERSATION_VERSION,
    conversationId: data.conversationId,
    messages: data.messages as AssistantMessage[],
    createdAt: data.createdAt as Timestamp,
    updatedAt: data.updatedAt as Timestamp,
    expireAt: data.expireAt as Timestamp,
    locationAccess,
    timelineNotesEnabled: data.timelineNotesEnabled === true,
    activityTagChangesEnabled: data.activityTagChangesEnabled === true,
    timelineNoteChangesEnabled: data.timelineNoteChangesEnabled === true && data.timelineNotesEnabled === true,
    trainingPlansEnabled: data.trainingPlansEnabled === true,
    trainingPlanChangesEnabled: data.trainingPlanChangesEnabled === true && data.trainingPlansEnabled === true,
    trainingDeliveryEnabled: data.trainingDeliveryEnabled === true && data.trainingPlansEnabled === true,
    pendingTrainingProposal,
    pendingContentProposal,
    pendingTurn,
    replayReceipts: normalizeReplayReceipts(
      data.replayReceipts,
      messages,
      locationAccess,
      data.timelineNotesEnabled === true,
      data.activityTagChangesEnabled === true,
      data.timelineNoteChangesEnabled === true && data.timelineNotesEnabled === true,
      data.trainingPlansEnabled === true,
      data.trainingPlanChangesEnabled === true && data.trainingPlansEnabled === true,
      data.trainingDeliveryEnabled === true && data.trainingPlansEnabled === true,
    ),
  };
}

function toPublicConversation(
  conversation: StoredAssistantConversation,
): AssistantConversation {
  return {
    version: ASSISTANT_CONVERSATION_VERSION,
    conversationId: conversation.conversationId,
    messages: conversation.messages,
    expiresAt: conversation.expireAt.toDate().toISOString(),
  };
}

function createEmptyConversation(
  now: Date,
  createId: () => string,
  locationAccess: AssistantLocationAccess = ASSISTANT_DEFAULT_LOCATION_ACCESS,
  timelineNotesEnabled = false,
  activityTagChangesEnabled = false,
  timelineNoteChangesEnabled = false,
  trainingPlansEnabled = false,
  trainingPlanChangesEnabled = false,
  trainingDeliveryEnabled = false,
): StoredAssistantConversation {
  const timestamp = Timestamp.fromDate(now);
  return {
    version: ASSISTANT_CONVERSATION_VERSION,
    conversationId: createId(),
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    expireAt: Timestamp.fromMillis(now.getTime() + ASSISTANT_CONVERSATION_RETENTION_MS),
    locationAccess,
    timelineNotesEnabled,
    activityTagChangesEnabled,
    timelineNoteChangesEnabled: timelineNotesEnabled && timelineNoteChangesEnabled,
    trainingPlansEnabled,
    trainingPlanChangesEnabled: trainingPlansEnabled && trainingPlanChangesEnabled,
    trainingDeliveryEnabled: trainingPlansEnabled && trainingDeliveryEnabled,
    pendingTrainingProposal: null,
    pendingContentProposal: null,
    pendingTurn: null,
    replayReceipts: [],
  };
}

function findReplayReceipt(
  conversation: StoredAssistantConversation,
  requestId: string,
): AssistantReplayReceipt | null {
  return conversation.replayReceipts.find(
    receipt => receipt.requestId === requestId,
  ) ?? null;
}

function toReplayedTurn(
  conversation: StoredAssistantConversation,
  receipt: AssistantReplayReceipt,
): ReplayedAssistantTurn {
  return {
    kind: 'replayed',
    conversation: toPublicConversation(conversation),
    requestFingerprint: receipt.requestFingerprint,
    ...(conversation.pendingTrainingProposal
      ? { pendingTrainingProposal: conversation.pendingTrainingProposal }
      : {}),
    ...(conversation.pendingContentProposal
      ? { pendingContentProposal: conversation.pendingContentProposal }
      : {}),
  };
}

function findRequestStateInConversation(
  conversation: StoredAssistantConversation,
  requestId: string,
  requestFingerprint: string | undefined,
  nowMs: number,
): AssistantRequestState | null {
  const receipt = findReplayReceipt(conversation, requestId);
  if (receipt) {
    return toReplayedTurn(conversation, receipt);
  }
  if (conversation.messages.some(
    message => message.id === requestId && message.role === 'assistant',
  )) {
    throw new AssistantConversationStoreError(
      'request_id_conflict',
      'The Assistant request identifier conflicts with a saved message.',
    );
  }
  const pendingTurn = conversation.pendingTurn;
  if (requestFingerprint
    && pendingTurn
    && pendingTurn.expiresAtMs > nowMs
    && pendingTurn.requestId === requestId
    && pendingTurn.requestFingerprint) {
    if (pendingTurn.requestFingerprint !== requestFingerprint) {
      throw new AssistantConversationStoreError(
        'request_id_conflict',
        'The Assistant request identifier is already running with a different message.',
      );
    }
    return {
      kind: 'pending',
      conversation: toPublicConversation(conversation),
      requestFingerprint,
      ...(conversation.pendingTrainingProposal
        ? { pendingTrainingProposal: conversation.pendingTrainingProposal }
        : {}),
      ...(conversation.pendingContentProposal
        ? { pendingContentProposal: conversation.pendingContentProposal }
        : {}),
    };
  }
  return null;
}

function getConversationRef(
  db: FirebaseFirestore.Firestore,
  uid: string,
): FirebaseFirestore.DocumentReference {
  return db
    .collection('users')
    .doc(uid)
    .collection(ASSISTANT_CONVERSATION_COLLECTION)
    .doc(ASSISTANT_ACTIVE_CONVERSATION_DOC);
}

async function assertUserCanPersist(
  dependencies: AssistantConversationStoreDependencies,
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  uid: string,
  nowMs: number,
): Promise<void> {
  const deletionGuard = await dependencies.getDeletionGuard(
    db,
    transaction,
    uid,
    nowMs,
  );
  if (deletionGuard.shouldSkip) {
    throw new AssistantConversationStoreError(
      'user_deleted',
      'The Assistant conversation cannot be saved for this account.',
    );
  }
}

export function createAssistantConversationStore(
  overrides: Partial<AssistantConversationStoreDependencies> = {},
): AssistantConversationStore {
  const dependencies: AssistantConversationStoreDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  const getActiveConversationState = async (
    uid: string,
  ): Promise<AssistantActiveConversationState> => {
    const db = dependencies.db();
    const conversationRef = getConversationRef(db, uid);
    return db.runTransaction(async (transaction) => {
      const nowMs = dependencies.now().getTime();
      const deletionGuard = await dependencies.getDeletionGuard(
        db,
        transaction,
        uid,
        nowMs,
      );
      if (deletionGuard.shouldSkip) {
        return {
          conversation: null,
          pendingRequestId: null,
          locationAccess: ASSISTANT_DEFAULT_LOCATION_ACCESS,
        };
      }
      const snapshot = await transaction.get(conversationRef);
      const conversation = snapshot.exists
        ? parseStoredConversation(snapshot.data(), nowMs)
        : null;
      if (!conversation || conversation.expireAt.toMillis() <= nowMs) {
        return {
          conversation: null,
          pendingRequestId: null,
          locationAccess: ASSISTANT_DEFAULT_LOCATION_ACCESS,
        };
      }
      return {
        conversation: toPublicConversation(conversation),
        pendingRequestId: conversation.pendingTurn
          && conversation.pendingTurn.expiresAtMs > nowMs
          ? conversation.pendingTurn.requestId
          : null,
        locationAccess: conversation.locationAccess,
        ...(conversation.timelineNotesEnabled ? { timelineNotesEnabled: true } : {}),
        ...(conversation.activityTagChangesEnabled ? { activityTagChangesEnabled: true } : {}),
        ...(conversation.timelineNoteChangesEnabled ? { timelineNoteChangesEnabled: true } : {}),
        ...(conversation.trainingPlansEnabled ? { trainingPlansEnabled: true } : {}),
        ...(conversation.trainingPlanChangesEnabled ? { trainingPlanChangesEnabled: true } : {}),
        ...(conversation.trainingDeliveryEnabled ? { trainingDeliveryEnabled: true } : {}),
        ...(conversation.pendingTrainingProposal
          ? { pendingTrainingProposal: conversation.pendingTrainingProposal }
          : {}),
        ...(conversation.pendingContentProposal
          ? { pendingContentProposal: conversation.pendingContentProposal }
          : {}),
      };
    });
  };

  return {
    getActiveConversation: async (uid) => (
      await getActiveConversationState(uid)
    ).conversation,

    getActiveConversationState,

    findRequestState: async (
      uid,
      expectedConversationId,
      requestId,
      requestFingerprint,
    ) => {
      const db = dependencies.db();
      const conversationRef = getConversationRef(db, uid);
      return db.runTransaction(async (transaction) => {
        const nowMs = dependencies.now().getTime();
        const deletionGuard = await dependencies.getDeletionGuard(
          db,
          transaction,
          uid,
          nowMs,
        );
        if (deletionGuard.shouldSkip) {
          return null;
        }
        const snapshot = await transaction.get(conversationRef);
        const conversation = snapshot.exists
          ? parseStoredConversation(snapshot.data(), nowMs)
          : null;
        if (!conversation
          || conversation.expireAt.toMillis() <= nowMs
          || (expectedConversationId
            && expectedConversationId !== conversation.conversationId)) {
          return null;
        }
        return findRequestStateInConversation(
          conversation,
          requestId,
          requestFingerprint,
          nowMs,
        );
      });
    },

    beginTurn: async (
      uid,
      expectedConversationId,
      requestId,
      requestFingerprint,
      locationAccess = ASSISTANT_DEFAULT_LOCATION_ACCESS,
      timelineNotesEnabled = false,
      trainingPlansEnabled = false,
      trainingPlanChangesEnabled = false,
      trainingDeliveryEnabled = false,
      activityTagChangesEnabled = false,
      timelineNoteChangesEnabled = false,
    ) => {
      const db = dependencies.db();
      const conversationRef = getConversationRef(db, uid);
      return db.runTransaction(async (transaction) => {
        const now = dependencies.now();
        const nowMs = now.getTime();
        await assertUserCanPersist(dependencies, db, transaction, uid, nowMs);
        const snapshot = await transaction.get(conversationRef);
        const storedConversation = snapshot.exists
          ? parseStoredConversation(snapshot.data(), nowMs)
          : null;
        const conversation = !storedConversation
          || storedConversation.expireAt.toMillis() <= nowMs
          ? createEmptyConversation(now, dependencies.createId, locationAccess)
          : storedConversation;

        if (expectedConversationId
          && expectedConversationId !== conversation.conversationId) {
          throw new AssistantConversationStoreError(
            'conversation_changed',
            'The active Assistant conversation changed. Reload it before sending another message.',
          );
        }
        if (conversation.locationAccess !== locationAccess
          || conversation.timelineNotesEnabled !== timelineNotesEnabled
          || conversation.activityTagChangesEnabled !== activityTagChangesEnabled
          || conversation.timelineNoteChangesEnabled !== timelineNoteChangesEnabled
          || conversation.trainingPlansEnabled !== trainingPlansEnabled
          || conversation.trainingPlanChangesEnabled !== trainingPlanChangesEnabled
          || conversation.trainingDeliveryEnabled !== trainingDeliveryEnabled) {
          throw new AssistantConversationStoreError(
            'conversation_changed',
            'The Assistant data-access setting changed. Reload before sending another message.',
          );
        }
        if (requestId) {
          const requestState = findRequestStateInConversation(
            conversation,
            requestId,
            requestFingerprint,
            nowMs,
          );
          if (requestState) {
            return requestState;
          }
        }
        if (conversation.pendingTurn
          && conversation.pendingTurn.expiresAtMs > nowMs) {
          throw new AssistantConversationStoreError(
            'turn_in_progress',
            'Another Assistant response is still in progress.',
          );
        }

        const turnId = dependencies.createId();
        const updatedConversation: StoredAssistantConversation = {
          ...conversation,
          expireAt: Timestamp.fromMillis(Math.max(
            conversation.expireAt.toMillis(),
            nowMs + ASSISTANT_PENDING_TURN_TTL_MS,
          )),
          pendingTurn: {
            id: turnId,
            requestId: requestId ?? null,
            requestFingerprint: requestId
              && requestFingerprint
              && ASSISTANT_REQUEST_FINGERPRINT_PATTERN.test(requestFingerprint)
              ? requestFingerprint
              : null,
            expiresAtMs: nowMs + ASSISTANT_PENDING_TURN_TTL_MS,
          },
        };
        transaction.set(conversationRef, updatedConversation);
        return {
          kind: 'started',
          conversationId: updatedConversation.conversationId,
          turnId,
          history: [...updatedConversation.messages],
          locationAccess: updatedConversation.locationAccess,
          ...(updatedConversation.timelineNotesEnabled ? { timelineNotesEnabled: true } : {}),
          ...(updatedConversation.activityTagChangesEnabled ? { activityTagChangesEnabled: true } : {}),
          ...(updatedConversation.timelineNoteChangesEnabled ? { timelineNoteChangesEnabled: true } : {}),
          ...(updatedConversation.trainingPlansEnabled ? { trainingPlansEnabled: true } : {}),
          ...(updatedConversation.trainingPlanChangesEnabled ? { trainingPlanChangesEnabled: true } : {}),
          ...(updatedConversation.trainingDeliveryEnabled ? { trainingDeliveryEnabled: true } : {}),
        };
      });
    },

    completeTurn: async (
      uid,
      begunTurn,
      userMessage,
      assistantMessage,
      pendingTrainingProposal,
      pendingContentProposal,
    ) => {
      const db = dependencies.db();
      const conversationRef = getConversationRef(db, uid);
      return db.runTransaction(async (transaction) => {
        const now = dependencies.now();
        const nowMs = now.getTime();
        await assertUserCanPersist(dependencies, db, transaction, uid, nowMs);
        const snapshot = await transaction.get(conversationRef);
        const conversation = snapshot.exists
          ? parseStoredConversation(snapshot.data(), nowMs)
          : null;
        if (!conversation
          || conversation.conversationId !== begunTurn.conversationId
          || conversation.pendingTurn?.id !== begunTurn.turnId) {
          throw new AssistantConversationStoreError(
            'turn_lost',
            'The Assistant conversation changed before this response could be saved.',
          );
        }
        let messages = [
          ...conversation.messages,
          userMessage,
          assistantMessage,
        ].slice(-ASSISTANT_MAX_STORED_MESSAGES);
        const replayReceipts = [
          ...conversation.replayReceipts.filter(
            receipt => receipt.requestId !== userMessage.id,
          ),
          {
            requestId: userMessage.id,
            requestFingerprint: createAssistantRequestFingerprint(
              userMessage.id,
              userMessage.text,
              begunTurn.locationAccess,
              begunTurn.timelineNotesEnabled === true,
              begunTurn.trainingPlansEnabled === true,
              begunTurn.trainingPlanChangesEnabled === true,
              begunTurn.trainingDeliveryEnabled === true,
              begunTurn.activityTagChangesEnabled === true,
              begunTurn.timelineNoteChangesEnabled === true,
            ),
            completedAtMs: nowMs,
          },
        ].slice(-ASSISTANT_MAX_REPLAY_RECEIPTS);
        let updatedConversation: StoredAssistantConversation;
        let publicConversation: AssistantConversation;
        let validation: ReturnType<typeof validateAssistantConversation>;
        do {
          updatedConversation = {
            ...conversation,
            messages,
            replayReceipts,
            updatedAt: Timestamp.fromDate(now),
            expireAt: Timestamp.fromMillis(nowMs + ASSISTANT_CONVERSATION_RETENTION_MS),
            pendingTurn: null,
            pendingTrainingProposal: pendingTrainingProposal ?? conversation.pendingTrainingProposal,
            pendingContentProposal: pendingContentProposal ?? conversation.pendingContentProposal,
          };
          publicConversation = toPublicConversation(updatedConversation);
          validation = validateAssistantConversation(publicConversation);
          if (!validation.ok
            && validation.reason === 'conversation_too_large'
            && messages.length > 2) {
            messages = messages.slice(2);
            continue;
          }
          break;
        } while (messages.length >= 2);
        if (!validation.ok) {
          throw new AssistantConversationStoreError(
            'turn_lost',
            'The Assistant response could not be stored safely.',
          );
        }
        transaction.set(conversationRef, updatedConversation);
        return {
          conversation: publicConversation,
          ...(updatedConversation.pendingContentProposal
            ? { pendingContentProposal: updatedConversation.pendingContentProposal }
            : {}),
        };
      });
    },

    releaseTurn: async (uid, begunTurn) => {
      const db = dependencies.db();
      const conversationRef = getConversationRef(db, uid);
      await db.runTransaction(async (transaction) => {
        const nowMs = dependencies.now().getTime();
        await assertUserCanPersist(dependencies, db, transaction, uid, nowMs);
        const snapshot = await transaction.get(conversationRef);
        const conversation = snapshot.exists
          ? parseStoredConversation(snapshot.data(), nowMs)
          : null;
        if (!conversation
          || conversation.conversationId !== begunTurn.conversationId
          || conversation.pendingTurn?.id !== begunTurn.turnId) {
          return;
        }
        transaction.set(conversationRef, {
          ...conversation,
          pendingTurn: null,
        });
      });
    },

    clearTrainingProposal: async (uid, conversationId, proposalRef) => {
      const db = dependencies.db();
      const conversationRef = getConversationRef(db, uid);
      await db.runTransaction(async transaction => {
        const nowMs = dependencies.now().getTime();
        await assertUserCanPersist(dependencies, db, transaction, uid, nowMs);
        const snapshot = await transaction.get(conversationRef);
        const conversation = snapshot.exists ? parseStoredConversation(snapshot.data(), nowMs) : null;
        if (!conversation || conversation.conversationId !== conversationId) {
          throw new AssistantConversationStoreError('conversation_changed', 'The Assistant conversation changed.');
        }
        if (conversation.pendingTrainingProposal?.proposalRef !== proposalRef) {
          throw new AssistantConversationStoreError('conversation_changed', 'The Training proposal is no longer current.');
        }
        transaction.update(conversationRef, { pendingTrainingProposal: null });
      });
    },

    clearContentProposal: async (uid, conversationId, proposalRef) => {
      const db = dependencies.db();
      const conversationRef = getConversationRef(db, uid);
      await db.runTransaction(async transaction => {
        const nowMs = dependencies.now().getTime();
        await assertUserCanPersist(dependencies, db, transaction, uid, nowMs);
        const snapshot = await transaction.get(conversationRef);
        const conversation = snapshot.exists ? parseStoredConversation(snapshot.data(), nowMs) : null;
        if (!conversation || conversation.conversationId !== conversationId) {
          throw new AssistantConversationStoreError('conversation_changed', 'The Assistant conversation changed.');
        }
        if (conversation.pendingContentProposal?.proposalRef !== proposalRef) {
          throw new AssistantConversationStoreError('conversation_changed', 'The content proposal is no longer current.');
        }
        transaction.update(conversationRef, { pendingContentProposal: null });
      });
    },

    resetConversation: async (
      uid,
      locationAccess = ASSISTANT_DEFAULT_LOCATION_ACCESS,
      timelineNotesEnabled = false,
      expectedConversationId,
      trainingPlansEnabled = false,
      trainingPlanChangesEnabled = false,
      trainingDeliveryEnabled = false,
      activityTagChangesEnabled = false,
      timelineNoteChangesEnabled = false,
    ) => {
      const db = dependencies.db();
      const conversationRef = getConversationRef(db, uid);
      return db.runTransaction(async (transaction) => {
        const now = dependencies.now();
        await assertUserCanPersist(
          dependencies,
          db,
          transaction,
          uid,
          now.getTime(),
        );
        const snapshot = await transaction.get(conversationRef);
        const stored = snapshot.exists ? parseStoredConversation(snapshot.data(), now.getTime()) : null;
        const currentId = stored && stored.expireAt.toMillis() > now.getTime() ? stored.conversationId : null;
        if (((timelineNotesEnabled || activityTagChangesEnabled || timelineNoteChangesEnabled || trainingPlansEnabled
          || trainingPlanChangesEnabled || trainingDeliveryEnabled) && expectedConversationId === undefined)
          || (expectedConversationId !== undefined && currentId !== expectedConversationId)) {
          throw new AssistantConversationStoreError(
            'conversation_changed',
            'The Assistant conversation changed. Reload before changing data access.',
          );
        }
        const conversation = createEmptyConversation(
          now,
          dependencies.createId,
          locationAccess,
          timelineNotesEnabled,
          activityTagChangesEnabled,
          timelineNoteChangesEnabled,
          trainingPlansEnabled,
          trainingPlanChangesEnabled,
          trainingDeliveryEnabled,
        );
        transaction.set(conversationRef, conversation);
        return toPublicConversation(conversation);
      });
    },
  };
}

export const assistantConversationStore = createAssistantConversationStore();
