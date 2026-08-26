import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';

const mocks = vi.hoisted(() => {
  const state = {
    current: null as Record<string, unknown> | null,
    tombstone: null as Record<string, unknown> | null,
  };
  const queueRef = { id: 'sleep-item-1', parent: { id: 'sleepSyncQueue' } };
  const tombstoneRef = { id: 'sleepSyncQueue__sleep-item-1' };
  const transactionGet = vi.fn(async (ref: unknown) => {
    if (ref === tombstoneRef) {
      return {
        exists: state.tombstone !== null,
        data: () => state.tombstone ? { ...state.tombstone } : undefined,
      };
    }
    return {
      exists: state.current !== null,
      data: () => state.current ? { ...state.current } : undefined,
    };
  });
  const transactionUpdate = vi.fn((_ref: unknown, update: Record<string, unknown>) => {
    if (!state.current) throw new Error('missing queue item');
    for (const [field, value] of Object.entries(update)) {
      if (value === 'delete-sentinel') {
        delete state.current[field];
      } else {
        state.current[field] = value;
      }
    }
  });
  const transactionSet = vi.fn((ref: unknown, data: Record<string, unknown>) => {
    if (ref !== tombstoneRef) throw new Error('unexpected transaction set');
    state.tombstone = { ...data };
  });
  const transactionDelete = vi.fn((ref: unknown) => {
    if (ref !== queueRef) throw new Error('unexpected transaction delete');
    state.current = null;
  });
  const runTransaction = vi.fn(async (runner: (transaction: {
    get: typeof transactionGet;
    update: typeof transactionUpdate;
    set: typeof transactionSet;
    delete: typeof transactionDelete;
  }) => unknown) => runner({
    get: transactionGet,
    update: transactionUpdate,
    set: transactionSet,
    delete: transactionDelete,
  }));
  const deletionGuard = vi.fn();
  return {
    state,
    queueRef,
    tombstoneRef,
    transactionGet,
    transactionUpdate,
    transactionSet,
    transactionDelete,
    runTransaction,
    deletionGuard,
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({ runTransaction: mocks.runTransaction }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => 'delete-sentinel' },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.deletionGuard,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));

vi.mock('../queue/cleanup-tombstone', () => ({
  getQueueCleanupTombstoneDocumentRef: () => mocks.tombstoneRef,
  buildQueueCleanupTombstoneData: (collectionName: string, queueItemId: string, reason: string) => ({
    originalCollection: collectionName,
    queueItemId,
    reason,
  }),
}));

import {
  claimSleepQueueRevision,
  deleteSleepQueueRevisionWithTombstone,
  isCurrentSleepQueueRevision,
  releaseSleepQueueRevision,
  SLEEP_QUEUE_PROCESSING_LEASE_MS,
} from './queue-revision';

function queueItem(queueRevision: string, overrides: Record<string, unknown> = {}): SleepSyncQueueItemInterface {
  return {
    id: 'sleep-item-1',
    ref: mocks.queueRef as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
    dateCreated: 1_777_000_000_000,
    queueRevision,
    retryCount: 0,
    processed: false,
    dispatchedToCloudTask: 123,
    type: 'suunto_poll',
    provider: 'SuuntoApp',
    providerUserId: 'suunto-user-1',
    userID: 'firebase-user-1',
    ...overrides,
  } as SleepSyncQueueItemInterface;
}

describe('Sleep queue revision lease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
    mocks.deletionGuard.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    mocks.state.current = { ...queueItem('revision-1') };
    delete mocks.state.current.ref;
    mocks.state.tombstone = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes a replacement behind the active older-revision worker', async () => {
    const revision1 = queueItem('revision-1');
    const revision2 = queueItem('revision-2');

    await expect(claimSleepQueueRevision(revision1, 'firebase-user-1', 'worker-r1'))
      .resolves.toBe('claimed');
    expect(mocks.state.current).toEqual(expect.objectContaining({
      processingOwner: 'worker-r1',
      processingRevision: 'revision:revision-1',
      processingLeaseExpiresAt: Date.now() + SLEEP_QUEUE_PROCESSING_LEASE_MS,
    }));

    mocks.state.current = {
      ...revision2,
      processingOwner: mocks.state.current?.processingOwner,
      processingRevision: mocks.state.current?.processingRevision,
      processingLeaseExpiresAt: mocks.state.current?.processingLeaseExpiresAt,
    };
    delete mocks.state.current.ref;

    await expect(claimSleepQueueRevision(revision2, 'firebase-user-1', 'worker-r2'))
      .resolves.toBe('busy');
    await releaseSleepQueueRevision(revision1, 'firebase-user-1', 'worker-r1');

    expect(mocks.state.current).toEqual(expect.objectContaining({
      queueRevision: 'revision-2',
      processed: false,
      dispatchedToCloudTask: null,
    }));
    expect(mocks.state.current).not.toHaveProperty('processingOwner');
    await expect(claimSleepQueueRevision(revision2, 'firebase-user-1', 'worker-r2'))
      .resolves.toBe('claimed');
  });

  it('reopens a replacement left behind by an expired older-revision lease', async () => {
    mocks.state.current = {
      ...queueItem('revision-2'),
      processingOwner: 'crashed-r1-worker',
      processingRevision: 'revision:revision-1',
      processingLeaseExpiresAt: Date.now() - 1,
    };
    delete mocks.state.current.ref;

    await expect(claimSleepQueueRevision(queueItem('revision-1'), 'firebase-user-1', 'retry-r1'))
      .resolves.toBe('superseded');
    expect(mocks.state.current).toEqual(expect.objectContaining({
      queueRevision: 'revision-2',
      processed: false,
      dispatchedToCloudTask: null,
    }));
    expect(mocks.state.current).not.toHaveProperty('processingOwner');
  });

  it('never reopens a replacement that another path already completed', async () => {
    mocks.state.current = {
      ...queueItem('revision-2'),
      processed: true,
      processingOwner: 'worker-r1',
      processingRevision: 'revision:revision-1',
      processingLeaseExpiresAt: Date.now() - 1,
    };
    delete mocks.state.current.ref;

    await expect(claimSleepQueueRevision(queueItem('revision-1'), 'firebase-user-1', 'retry-r1'))
      .resolves.toBe('superseded');
    await releaseSleepQueueRevision(queueItem('revision-1'), 'firebase-user-1', 'worker-r1');

    expect(mocks.state.current).toEqual(expect.objectContaining({
      queueRevision: 'revision-2',
      processed: true,
    }));
  });

  it('does not claim the same revision after another task completed it', async () => {
    mocks.state.current = {
      ...queueItem('revision-1'),
      processed: true,
      processedAt: Date.now() - 1,
    };
    delete mocks.state.current.ref;

    await expect(claimSleepQueueRevision(queueItem('revision-1'), 'firebase-user-1', 'late-worker'))
      .resolves.toBe('superseded');
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('fails the claim closed when account deletion is active', async () => {
    mocks.deletionGuard.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await expect(claimSleepQueueRevision(queueItem('revision-1'), 'firebase-user-1', 'worker-r1'))
      .resolves.toBe('deleted_user');
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('atomically tombstones and deletes only the exact current revision', async () => {
    mocks.state.current = { ...queueItem('revision-2') };
    delete mocks.state.current.ref;

    await expect(deleteSleepQueueRevisionWithTombstone(
      mocks.queueRef as never,
      'sleep-item-1',
      queueItem('revision-1'),
      'sleepSyncQueue',
      'dispatcher_cleanup',
    )).resolves.toBe(false);
    expect(mocks.state.current).not.toBeNull();
    expect(mocks.state.tombstone).toBeNull();

    await expect(deleteSleepQueueRevisionWithTombstone(
      mocks.queueRef as never,
      'sleep-item-1',
      queueItem('revision-2'),
      'sleepSyncQueue',
      'dispatcher_cleanup',
    )).resolves.toBe(true);
    expect(mocks.state.current).toBeNull();
    expect(mocks.state.tombstone).toEqual({
      originalCollection: 'sleepSyncQueue',
      queueItemId: 'sleep-item-1',
      reason: 'dispatcher_cleanup',
    });
  });

  it('does not let a legacy date identity match a revisioned replacement', () => {
    expect(isCurrentSleepQueueRevision(
      { processed: false, queueRevision: 'revision-2', dateCreated: 100 },
      { dateCreated: 100 },
    )).toBe(false);
    expect(isCurrentSleepQueueRevision(
      { processed: false, dateCreated: 100 },
      { dateCreated: 100 },
    )).toBe(true);
  });
});
