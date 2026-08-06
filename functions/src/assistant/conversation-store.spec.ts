import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '../../../shared/assistant.types';
import {
  ASSISTANT_MAX_REPLAY_RECEIPTS,
  AssistantConversationStoreError,
  createAssistantRequestFingerprint,
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

  it('exposes the pending client request only while its turn lease is active', async () => {
    const harness = createFirestoreHarness();
    let now = new Date('2026-08-03T12:00:00.000Z');
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => now,
      createId: () => `generated-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const reset = await store.resetConversation('user-1');
    const requestId = 'assistant-request-pending-0001';

    await store.beginTurn('user-1', reset.conversationId, requestId);

    await expect(store.getActiveConversationState('user-1')).resolves.toEqual({
      conversation: expect.objectContaining({
        conversationId: reset.conversationId,
      }),
      pendingRequestId: requestId,
      locationAccess: 'coordinate_free',
    });

    now = new Date('2026-08-03T12:04:00.001Z');
    await expect(store.getActiveConversationState('user-1')).resolves.toEqual({
      conversation: expect.objectContaining({
        conversationId: reset.conversationId,
      }),
      pendingRequestId: null,
      locationAccess: 'coordinate_free',
    });
  });

  it('binds precise activity-location consent to a fresh conversation generation', async () => {
    const harness = createFirestoreHarness();
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `location-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const conversation = await store.resetConversation(
      'user-1',
      'precise_activity',
    );

    await expect(store.getActiveConversationState('user-1')).resolves.toEqual({
      conversation,
      pendingRequestId: null,
      locationAccess: 'precise_activity',
    });
    await expect(store.beginTurn(
      'user-1',
      conversation.conversationId,
      'assistant-location-request-0001',
      createAssistantRequestFingerprint(
        'assistant-location-request-0001',
        'Where was my biggest jump?',
      ),
      'coordinate_free',
    )).rejects.toMatchObject({ code: 'conversation_changed' });

    const begun = requireStartedTurn(await store.beginTurn(
      'user-1',
      conversation.conversationId,
      'assistant-location-request-0001',
      createAssistantRequestFingerprint(
        'assistant-location-request-0001',
        'Where was my biggest jump?',
        'precise_activity',
      ),
      'precise_activity',
    ));
    expect(begun.locationAccess).toBe('precise_activity');
    expect(createAssistantRequestFingerprint(
      'assistant-location-request-0001',
      'Where was my biggest jump?',
    )).not.toBe(createAssistantRequestFingerprint(
      'assistant-location-request-0001',
      'Where was my biggest jump?',
      'precise_activity',
    ));
  });

  it('recognizes only an identical request as the already-running turn', async () => {
    const harness = createFirestoreHarness();
    let sequence = 0;
    const store = createAssistantConversationStore({
      db: () => harness.db as never,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      createId: () => `generated-${++sequence}`,
      getDeletionGuard: async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      }),
    });
    const requestId = 'assistant-request-pending-duplicate';
    const requestFingerprint = createAssistantRequestFingerprint(
      requestId,
      'How am I today?',
    );
    const begun = requireStartedTurn(await store.beginTurn(
      'user-1',
      undefined,
      requestId,
      requestFingerprint,
    ));

    await expect(store.findRequestState(
      'user-1',
      begun.conversationId,
      requestId,
      requestFingerprint,
    )).resolves.toEqual({
      kind: 'pending',
      conversation: expect.objectContaining({
        conversationId: begun.conversationId,
      }),
      requestFingerprint,
    });

    await expect(store.beginTurn(
      'user-1',
      begun.conversationId,
      requestId,
      requestFingerprint,
    )).resolves.toEqual({
      kind: 'pending',
      conversation: expect.objectContaining({
        conversationId: begun.conversationId,
      }),
      requestFingerprint,
    });

    await expect(store.beginTurn(
      'user-1',
      begun.conversationId,
      requestId,
      createAssistantRequestFingerprint(requestId, 'A different question'),
    )).rejects.toMatchObject({ code: 'request_id_conflict' });

    await expect(store.findRequestState(
      'user-1',
      begun.conversationId,
      requestId,
      createAssistantRequestFingerprint(requestId, 'A different question'),
    )).rejects.toMatchObject({ code: 'request_id_conflict' });

    await expect(store.beginTurn(
      'user-1',
      begun.conversationId,
      'assistant-request-different-pending',
      createAssistantRequestFingerprint(
        'assistant-request-different-pending',
        'How am I today?',
      ),
    )).rejects.toMatchObject({ code: 'turn_in_progress' });
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
    const storedConversation = harness.documents.get(
      'users/user-1/assistantConversations/active',
    );
    if (storedConversation) {
      delete storedConversation.replayReceipts;
      delete storedConversation.locationAccess;
    }

    const replayed = await store.beginTurn(
      'user-1',
      completed.conversationId,
      requestId,
    );

    expect(replayed).toEqual({
      kind: 'replayed',
      conversation: completed,
      requestFingerprint: createAssistantRequestFingerprint(
        requestId,
        'Question once',
      ),
    });
    expect(harness.documents.get(
      'users/user-1/assistantConversations/active',
    )?.pendingTurn).toBeNull();
    await expect(store.getActiveConversationState('user-1')).resolves.toMatchObject({
      locationAccess: 'coordinate_free',
    });
  });

  it('clears replay receipts when a new conversation generation replaces the old one', async () => {
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
    const requestId = 'assistant-request-before-reset-0001';
    const begun = requireStartedTurn(await store.beginTurn(
      'user-1',
      undefined,
      requestId,
    ));
    await store.completeTurn(
      'user-1',
      begun,
      message(requestId, 'user', 'Question before reset'),
      message('assistant-before-reset', 'assistant', 'Answer before reset'),
    );

    const reset = await store.resetConversation('user-1');

    expect(reset.conversationId).not.toBe(begun.conversationId);
    expect(harness.documents.get(
      'users/user-1/assistantConversations/active',
    )?.replayReceipts).toEqual([]);
    await expect(store.findRequestState(
      'user-1',
      reset.conversationId,
      requestId,
      createAssistantRequestFingerprint(requestId, 'Question before reset'),
    )).resolves.toBeNull();
  });

  it('replays a completed request after its messages leave the transcript', async () => {
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
    const originalRequestId = 'assistant-request-original-0001';
    let conversationId: string | undefined;
    for (let index = 0; index < 7; index += 1) {
      const requestId = index === 0
        ? originalRequestId
        : `assistant-request-later-${index.toString().padStart(4, '0')}`;
      const begun = requireStartedTurn(await store.beginTurn(
        'user-1',
        conversationId,
        requestId,
      ));
      conversationId = begun.conversationId;
      await store.completeTurn(
        'user-1',
        begun,
        message(requestId, 'user', `Question ${index}`),
        message(`assistant-response-${index}`, 'assistant', `Answer ${index}`),
      );
    }

    const activeConversation = await store.getActiveConversation('user-1');
    expect(activeConversation?.messages).toHaveLength(12);
    expect(activeConversation).not.toHaveProperty('replayReceipts');
    expect(activeConversation?.messages.some(
      savedMessage => savedMessage.id === originalRequestId,
    )).toBe(false);

    const replayed = await store.findRequestState(
      'user-1',
      conversationId,
      originalRequestId,
      createAssistantRequestFingerprint(originalRequestId, 'Question 0'),
    );
    expect(replayed).toEqual({
      kind: 'replayed',
      conversation: activeConversation,
      requestFingerprint: createAssistantRequestFingerprint(
        originalRequestId,
        'Question 0',
      ),
    });
    await expect(store.beginTurn(
      'user-1',
      conversationId,
      originalRequestId,
    )).resolves.toEqual(replayed);
    expect(harness.documents.get(
      'users/user-1/assistantConversations/active',
    )?.pendingTurn).toBeNull();
  });

  it('bounds replay receipts without retaining evicted prompt text', async () => {
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
    let conversationId: string | undefined;
    for (let index = 0; index <= ASSISTANT_MAX_REPLAY_RECEIPTS; index += 1) {
      const requestId = `assistant-request-${index.toString().padStart(6, '0')}`;
      const begun = requireStartedTurn(await store.beginTurn(
        'user-1',
        conversationId,
        requestId,
      ));
      conversationId = begun.conversationId;
      await store.completeTurn(
        'user-1',
        begun,
        message(requestId, 'user', `Sensitive prompt ${index}`),
        message(`assistant-response-${index}`, 'assistant', `Answer ${index}`),
      );
    }

    const stored = harness.documents.get(
      'users/user-1/assistantConversations/active',
    );
    const receipts = stored?.replayReceipts as Array<Record<string, unknown>>;
    expect(receipts).toHaveLength(ASSISTANT_MAX_REPLAY_RECEIPTS);
    expect(receipts[0]?.requestId).toBe('assistant-request-000001');
    expect(receipts.at(-1)?.requestId).toBe(
      `assistant-request-${ASSISTANT_MAX_REPLAY_RECEIPTS.toString().padStart(6, '0')}`,
    );
    expect(JSON.stringify(receipts)).not.toContain('Sensitive prompt');
  });

  it('retains replay receipts while newer turns keep the conversation generation active', async () => {
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
    const oldRequestId = 'assistant-request-expiring-0001';
    const firstTurn = requireStartedTurn(await store.beginTurn(
      'user-1',
      undefined,
      oldRequestId,
    ));
    await store.completeTurn(
      'user-1',
      firstTurn,
      {
        ...message(oldRequestId, 'user', 'Old question'),
        createdAt: now.toISOString(),
      },
      {
        ...message('old-response', 'assistant', 'Old answer'),
        createdAt: now.toISOString(),
      },
    );

    now = new Date('2026-08-07T12:00:00.000Z');
    const keepAliveTurn = requireStartedTurn(await store.beginTurn(
      'user-1',
      firstTurn.conversationId,
      'assistant-request-keepalive-0001',
    ));
    await store.completeTurn(
      'user-1',
      keepAliveTurn,
      {
        ...message('assistant-request-keepalive-0001', 'user', 'New question'),
        createdAt: now.toISOString(),
      },
      {
        ...message('new-response', 'assistant', 'New answer'),
        createdAt: now.toISOString(),
      },
    );

    now = new Date('2026-08-08T12:00:00.001Z');
    await expect(store.getActiveConversation('user-1')).resolves.not.toBeNull();
    await expect(store.findRequestState(
      'user-1',
      firstTurn.conversationId,
      oldRequestId,
      createAssistantRequestFingerprint(oldRequestId, 'Old question'),
    )).resolves.toMatchObject({
      kind: 'replayed',
      requestFingerprint: createAssistantRequestFingerprint(
        oldRequestId,
        'Old question',
      ),
    });
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

  it('preserves a valid turn lock when the reader clock trails the writer', async () => {
    const harness = createFirestoreHarness();
    let now = new Date('2026-08-03T12:00:01.000Z');
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
    const begun = requireStartedTurn(await store.beginTurn('user-1'));

    now = new Date('2026-08-03T12:00:00.000Z');

    await expect(store.beginTurn('user-1', begun.conversationId))
      .rejects.toMatchObject({ code: 'turn_in_progress' });
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
        expiresAtMs: Date.parse('2026-08-03T12:04:30.001Z'),
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
