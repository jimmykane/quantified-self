import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '../../../shared/assistant.types';
import {
  AssistantConversationStoreError,
  createAssistantConversationStore,
  type AssistantTurnStart,
  type BegunAssistantTurn,
} from './conversation-store';

interface FakeDocumentReference {
  path: string;
  collection: (name: string) => {
    doc: (id: string) => FakeDocumentReference;
  };
  get: () => Promise<FakeSnapshot>;
}

interface FakeSnapshot {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

function createFirestoreHarness() {
  const documents = new Map<string, Record<string, unknown>>();
  const snapshotFor = (path: string): FakeSnapshot => ({
    exists: documents.has(path),
    data: () => documents.get(path),
  });
  const documentRef = (path: string): FakeDocumentReference => ({
    path,
    collection: (name: string) => ({
      doc: (id: string) => documentRef(`${path}/${name}/${id}`),
    }),
    get: async () => snapshotFor(path),
  });
  const transaction = {
    get: async (ref: FakeDocumentReference) => snapshotFor(ref.path),
    set: (ref: FakeDocumentReference, data: Record<string, unknown>) => {
      documents.set(ref.path, data);
    },
  };
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => documentRef(`${name}/${id}`),
    }),
    runTransaction: async <T>(handler: (value: typeof transaction) => Promise<T>) => (
      handler(transaction)
    ),
  };
  return { db, documents };
}

function message(
  id: string,
  role: AssistantMessage['role'],
  text: string,
): AssistantMessage {
  return {
    id,
    role,
    text,
    createdAt: '2026-08-03T12:00:00.000Z',
  };
}

function requireStartedTurn(turn: AssistantTurnStart): BegunAssistantTurn {
  expect(turn.kind).toBe('started');
  if (turn.kind !== 'started') {
    throw new Error('Expected a newly started Assistant turn.');
  }
  return turn;
}

describe('Assistant conversation store', () => {
  it('serializes turns and persists only a bounded completed history', async () => {
    const harness = createFirestoreHarness();
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });

    let expectedConversationId: string | undefined;
    for (let index = 0; index < 7; index += 1) {
      const begun = requireStartedTurn(await store.beginTurn(
        'user-1',
        expectedConversationId,
      ));
      expectedConversationId = begun.conversationId;
      await expect(store.beginTurn('user-1', expectedConversationId))
        .rejects.toMatchObject({ code: 'turn_in_progress' });
      await store.completeTurn(
        'user-1',
        begun,
        message(`user-${index}`, 'user', `Question ${index}`),
        message(`assistant-${index}`, 'assistant', `Answer ${index}`),
      );
    }

    const conversation = await store.getActiveConversation('user-1');
    expect(conversation?.messages).toHaveLength(12);
    expect(conversation?.messages[0].text).toBe('Question 1');
    expect(conversation?.messages.at(-1)?.text).toBe('Answer 6');
  });

  it('replays a completed client request without creating another turn lock', async () => {
    const harness = createFirestoreHarness();
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const requestId = 'assistant-request-replay-0001';
    const begun = requireStartedTurn(await store.beginTurn(
      'user-1',
      undefined,
      requestId,
    ));
    const completed = await store.completeTurn(
      'user-1',
      begun,
      message(requestId, 'user', 'Question once'),
      message('assistant-once', 'assistant', 'Answer once'),
    );

    const replayed = await store.beginTurn(
      'user-1',
      completed.conversationId,
      requestId,
    );

    expect(replayed).toEqual({
      kind: 'replayed',
      conversation: completed,
      requestText: 'Question once',
    });
    expect(harness.documents.get(
      'users/user-1/assistantConversations/active',
    )?.pendingTurn).toBeNull();
  });

  it('rejects a request identifier that collides with a saved assistant message', async () => {
    const harness = createFirestoreHarness();
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const begun = requireStartedTurn(await store.beginTurn('user-1'));
    const completed = await store.completeTurn(
      'user-1',
      begun,
      message('assistant-request-original-0001', 'user', 'Question once'),
      message('assistant-response-original-0001', 'assistant', 'Answer once'),
    );

    await expect(store.beginTurn(
      'user-1',
      completed.conversationId,
      'assistant-response-original-0001',
    )).rejects.toMatchObject({ code: 'request_id_conflict' });
    expect(harness.documents.get(
      'users/user-1/assistantConversations/active',
    )?.pendingTurn).toBeNull();
  });

  it('does not let an old in-flight response resurrect a reset conversation', async () => {
    const harness = createFirestoreHarness();
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const begun = requireStartedTurn(await store.beginTurn('user-1'));
    const reset = await store.resetConversation('user-1');

    await expect(store.completeTurn(
      'user-1',
      begun,
      message('old-user', 'user', 'Old question'),
      message('old-assistant', 'assistant', 'Old answer'),
    )).rejects.toMatchObject({ code: 'turn_lost' });
    expect((await store.getActiveConversation('user-1'))?.conversationId)
      .toBe(reset.conversationId);
    expect((await store.getActiveConversation('user-1'))?.messages).toEqual([]);
  });

  it('extends retention only after a turn completes', async () => {
    const harness = createFirestoreHarness();
    let now = new Date('2026-08-01T12:00:00.000Z');
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => now,
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const reset = await store.resetConversation('user-1');
    const originalExpiry = reset.expiresAt;

    now = new Date('2026-08-02T12:00:00.000Z');
    const releasedTurn = requireStartedTurn(await store.beginTurn(
      'user-1',
      reset.conversationId,
    ));
    await store.releaseTurn('user-1', releasedTurn);
    expect((await store.getActiveConversation('user-1'))?.expiresAt)
      .toBe(originalExpiry);

    const completedTurn = requireStartedTurn(await store.beginTurn(
      'user-1',
      reset.conversationId,
    ));
    const completed = await store.completeTurn(
      'user-1',
      completedTurn,
      message('completed-user', 'user', 'Completed question'),
      message('completed-assistant', 'assistant', 'Completed answer'),
    );
    expect(completed.expiresAt).toBe('2026-08-09T12:00:00.000Z');
  });

  it('keeps a nearly expired conversation alive for the pending-turn lease only', async () => {
    const harness = createFirestoreHarness();
    let now = new Date('2026-08-01T12:00:00.000Z');
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => now,
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const reset = await store.resetConversation('user-1');

    now = new Date('2026-08-08T11:59:00.000Z');
    const begun = requireStartedTurn(await store.beginTurn(
      'user-1',
      reset.conversationId,
    ));
    expect((await store.getActiveConversation('user-1'))?.expiresAt)
      .toBe('2026-08-08T12:03:00.000Z');

    await store.releaseTurn('user-1', begun);
    expect((await store.getActiveConversation('user-1'))?.expiresAt)
      .toBe('2026-08-08T12:03:00.000Z');
  });

  it('does not let malformed or impossible persisted lease data lock the conversation', async () => {
    const harness = createFirestoreHarness();
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const reset = await store.resetConversation('user-1');
    const path = 'users/user-1/assistantConversations/active';
    const stored = harness.documents.get(path);
    harness.documents.set(path, {
      ...stored,
      pendingTurn: {
        id: 'malformed-turn',
        expiresAtMs: Date.parse('2026-08-03T12:04:00.001Z'),
      },
    });

    await expect(store.beginTurn('user-1', reset.conversationId)).resolves.toMatchObject({
      conversationId: reset.conversationId,
      turnId: 'id-2',
    });
  });

  it('fails closed when account deletion has started', async () => {
    const harness = createFirestoreHarness();
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      getDeletionGuard: async () => ({
        userExists: false,
        deletionInProgress: true,
        shouldSkip: true,
      }),
    });

    await expect(store.beginTurn('user-1')).rejects.toBeInstanceOf(
      AssistantConversationStoreError,
    );
    expect(harness.documents.size).toBe(0);
  });

  it('does not rewrite a turn lock after account deletion starts', async () => {
    const harness = createFirestoreHarness();
    let deletionStarted = false;
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: !deletionStarted,
        deletionInProgress: deletionStarted,
        shouldSkip: deletionStarted,
      }),
    });
    const begun = requireStartedTurn(await store.beginTurn('user-1'));
    const storedBeforeRelease = harness.documents.get(
      'users/user-1/assistantConversations/active',
    );
    deletionStarted = true;

    await expect(store.releaseTurn('user-1', begun))
      .rejects.toMatchObject({ code: 'user_deleted' });
    expect(harness.documents.get(
      'users/user-1/assistantConversations/active',
    )).toBe(storedBeforeRelease);
    expect(storedBeforeRelease?.pendingTurn).toMatchObject({ id: begun.turnId });
  });

  it('does not return a saved conversation after account deletion starts', async () => {
    const harness = createFirestoreHarness();
    let deletionStarted = false;
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `id-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: !deletionStarted,
        deletionInProgress: deletionStarted,
        shouldSkip: deletionStarted,
      }),
    });
    await store.resetConversation('user-1');
    deletionStarted = true;

    await expect(store.getActiveConversation('user-1')).resolves.toBeNull();
  });
});
