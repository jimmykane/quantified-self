import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  ASSISTANT_CONVERSATION_VERSION,
  ASSISTANT_MAX_STORED_MESSAGES,
  type AssistantConversation,
  type AssistantMessage,
} from '../../../shared/assistant.types';
import { validateAssistantConversation } from '../../../shared/assistant-response.contract';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { TTL_CONFIG } from '../shared/ttl-config';

const ASSISTANT_CONVERSATION_COLLECTION = 'assistantConversations';
const ASSISTANT_ACTIVE_CONVERSATION_DOC = 'active';
const ASSISTANT_CONVERSATION_RETENTION_MS = TTL_CONFIG.ASSISTANT_CONVERSATIONS_IN_DAYS
  * 24 * 60 * 60 * 1_000;
const ASSISTANT_PENDING_TURN_TTL_MS = 4 * 60 * 1_000;
const ASSISTANT_PENDING_TURN_CLOCK_SKEW_MS = 30 * 1_000;

interface AssistantPendingTurn {
  id: string;
  expiresAtMs: number;
}

interface StoredAssistantConversation {
  version: typeof ASSISTANT_CONVERSATION_VERSION;
  conversationId: string;
  messages: AssistantMessage[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expireAt: Timestamp;
  pendingTurn: AssistantPendingTurn | null;
}

export interface BegunAssistantTurn {
  kind: 'started';
  conversationId: string;
  turnId: string;
  history: AssistantMessage[];
}

export interface ReplayedAssistantTurn {
  kind: 'replayed';
  conversation: AssistantConversation;
  requestText: string;
}

export type AssistantTurnStart = BegunAssistantTurn | ReplayedAssistantTurn;

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
  beginTurn: (
    uid: string,
    expectedConversationId?: string,
    requestId?: string,
  ) => Promise<AssistantTurnStart>;
  completeTurn: (
    uid: string,
    begunTurn: BegunAssistantTurn,
    userMessage: AssistantMessage,
    assistantMessage: AssistantMessage,
  ) => Promise<AssistantConversation>;
  releaseTurn: (uid: string, begunTurn: BegunAssistantTurn) => Promise<void>;
  resetConversation: (uid: string) => Promise<AssistantConversation>;
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

function toMillis(value: unknown): number | null {
  if (value && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const milliseconds = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  return null;
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
        expiresAtMs: data.pendingTurn.expiresAtMs,
      }
      : null;
  return {
    version: ASSISTANT_CONVERSATION_VERSION,
    conversationId: data.conversationId,
    messages: data.messages as AssistantMessage[],
    createdAt: data.createdAt as Timestamp,
    updatedAt: data.updatedAt as Timestamp,
    expireAt: data.expireAt as Timestamp,
    pendingTurn,
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
): StoredAssistantConversation {
  const timestamp = Timestamp.fromDate(now);
  return {
    version: ASSISTANT_CONVERSATION_VERSION,
    conversationId: createId(),
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    expireAt: Timestamp.fromMillis(now.getTime() + ASSISTANT_CONVERSATION_RETENTION_MS),
    pendingTurn: null,
  };
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

  return {
    getActiveConversation: async (uid) => {
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
        if (!conversation || conversation.expireAt.toMillis() <= nowMs) {
          return null;
        }
        return toPublicConversation(conversation);
      });
    },

    beginTurn: async (uid, expectedConversationId, requestId) => {
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
          ? createEmptyConversation(now, dependencies.createId)
          : storedConversation;

        if (expectedConversationId
          && expectedConversationId !== conversation.conversationId) {
          throw new AssistantConversationStoreError(
            'conversation_changed',
            'The active Assistant conversation changed. Reload it before sending another message.',
          );
        }
        if (requestId) {
          const matchingMessage = conversation.messages.find(
            message => message.id === requestId,
          );
          if (matchingMessage?.role === 'user') {
            return {
              kind: 'replayed',
              conversation: toPublicConversation(conversation),
              requestText: matchingMessage.text,
            };
          }
          if (matchingMessage) {
            throw new AssistantConversationStoreError(
              'request_id_conflict',
              'The Assistant request identifier conflicts with a saved message.',
            );
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
            expiresAtMs: nowMs + ASSISTANT_PENDING_TURN_TTL_MS,
          },
        };
        transaction.set(conversationRef, updatedConversation);
        return {
          kind: 'started',
          conversationId: updatedConversation.conversationId,
          turnId,
          history: [...updatedConversation.messages],
        };
      });
    },

    completeTurn: async (
      uid,
      begunTurn,
      userMessage,
      assistantMessage,
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
        const messages = [
          ...conversation.messages,
          userMessage,
          assistantMessage,
        ].slice(-ASSISTANT_MAX_STORED_MESSAGES);
        const updatedConversation: StoredAssistantConversation = {
          ...conversation,
          messages,
          updatedAt: Timestamp.fromDate(now),
          expireAt: Timestamp.fromMillis(nowMs + ASSISTANT_CONVERSATION_RETENTION_MS),
          pendingTurn: null,
        };
        const publicConversation = toPublicConversation(updatedConversation);
        if (!validateAssistantConversation(publicConversation).ok) {
          throw new AssistantConversationStoreError(
            'turn_lost',
            'The Assistant response could not be stored safely.',
          );
        }
        transaction.set(conversationRef, updatedConversation);
        return publicConversation;
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

    resetConversation: async (uid) => {
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
        const conversation = createEmptyConversation(now, dependencies.createId);
        transaction.set(conversationRef, conversation);
        return toPublicConversation(conversation);
      });
    },
  };
}

export const assistantConversationStore = createAssistantConversationStore();
