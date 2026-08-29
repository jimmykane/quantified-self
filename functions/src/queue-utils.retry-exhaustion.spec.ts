import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const transaction = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const runTransaction = vi.fn(async (
    runner: (transactionValue: typeof transaction) => Promise<unknown>,
  ) => runner(transaction));
  const collection = vi.fn((collectionId: string) => ({
    doc: vi.fn((documentId: string) => ({
      id: documentId,
      parent: { id: collectionId },
    })),
  }));
  return {
    cleanupQueueItemAfterUserDeletionGuard: vi.fn(),
    collection,
    getUserDeletionGuardStateInTransaction: vi.fn(),
    runTransaction,
    transaction,
  };
});

vi.mock('firebase-admin', () => {
  const firestore = vi.fn(() => ({
    collection: hoisted.collection,
    runTransaction: hoisted.runTransaction,
  }));
  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: vi.fn(() => 'deleted-field') },
  Timestamp: { fromDate: vi.fn((date: Date) => date) },
}));

vi.mock('./shared/user-deletion-guard', () => ({
  cleanupQueueItemAfterUserDeletionGuard: hoisted.cleanupQueueItemAfterUserDeletionGuard,
  getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));

vi.mock('./shared/ttl-config', () => ({
  TTL_CONFIG: { FAILED_JOBS_IN_DAYS: 7 },
  getExpireAtTimestamp: vi.fn(() => 'expiry'),
}));

import {
  increaseRetryCountIfCurrentUserActive,
  moveToDeadLetterQueueIfCurrentUserActive,
  QueueResult,
} from './queue-utils';

describe('guarded terminal queue transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({ shouldSkip: false });
    hoisted.transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({ revision: 'expected', retryCount: 9, totalRetryCount: 9 }),
    });
  });

  it('commits provider terminal state in the retry-exhausted DLQ transaction', async () => {
    const queueItem = {
      id: 'guarded-retry-terminal-state',
      ref: {
        parent: { id: 'sleepSyncQueue' },
        id: 'guarded-retry-terminal-state',
      },
      retryCount: 9,
      dispatchedToCloudTask: 123,
    } as Parameters<typeof increaseRetryCountIfCurrentUserActive>[0]['queueItem'];
    const terminalStateRef = { id: 'provider-state' };
    const onRetryExhaustedInTransaction = vi.fn(async (transaction, current) => {
      expect(current.retryCount).toBe(9);
      transaction.set(terminalStateRef, { status: 'failed' }, { merge: true });
    });

    const result = await increaseRetryCountIfCurrentUserActive({
      queueItem,
      error: new Error('last retry'),
      maxRetryDlqContext: 'PROVIDER_RETRY_EXHAUSTED',
      userID: 'user-1',
      phase: 'provider_retry',
      logPrefix: 'ProviderQueue',
      isCurrent: current => current.revision === 'expected',
      onRetryExhaustedInTransaction,
    });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(onRetryExhaustedInTransaction).toHaveBeenCalledOnce();
    expect(hoisted.transaction.set).toHaveBeenCalledWith(
      terminalStateRef,
      { status: 'failed' },
      { merge: true },
    );
    expect(hoisted.transaction.delete).toHaveBeenCalledWith(queueItem.ref);
  });

  it('commits provider terminal state in an immediate DLQ transaction', async () => {
    const queueItem = {
      id: 'guarded-terminal-state',
      ref: {
        parent: { id: 'sleepSyncQueue' },
        id: 'guarded-terminal-state',
      },
      retryCount: 0,
      dispatchedToCloudTask: 123,
    } as Parameters<typeof moveToDeadLetterQueueIfCurrentUserActive>[0]['queueItem'];
    const terminalStateRef = { id: 'provider-state' };
    const onBeforeMoveInTransaction = vi.fn(async (transaction, current) => {
      expect(current.revision).toBe('expected');
      transaction.set(terminalStateRef, { status: 'failed' }, { merge: true });
    });

    const result = await moveToDeadLetterQueueIfCurrentUserActive({
      queueItem,
      error: new Error('terminal failure'),
      context: 'PROVIDER_TERMINAL',
      userID: 'user-1',
      phase: 'provider_dlq',
      logPrefix: 'ProviderQueue',
      isCurrent: current => current.revision === 'expected',
      onBeforeMoveInTransaction,
    });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(onBeforeMoveInTransaction).toHaveBeenCalledOnce();
    expect(hoisted.transaction.set).toHaveBeenCalledWith(
      terminalStateRef,
      { status: 'failed' },
      { merge: true },
    );
    expect(hoisted.transaction.delete).toHaveBeenCalledWith(queueItem.ref);
  });
});
