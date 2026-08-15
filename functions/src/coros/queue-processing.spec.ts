import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';

const mocks = vi.hoisted(() => {
  const state = { current: {} as Record<string, unknown> };
  const queueRef = { id: 'coros-queue-1' };
  const transactionUpdate = vi.fn((_ref: unknown, update: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(update)) {
      if (value === 'delete-sentinel') {
        delete state.current[field];
      } else {
        state.current[field] = value;
      }
    }
  });
  const transactionGet = vi.fn(async () => ({
    exists: true,
    data: () => ({ ...state.current }),
  }));
  return {
    state,
    queueRef,
    transactionGet,
    transactionUpdate,
    runTransaction: vi.fn(async (runner: (transaction: {
      get: typeof transactionGet;
      update: typeof transactionUpdate;
    }) => unknown) => runner({
      get: transactionGet,
      update: transactionUpdate,
    })),
    deletionGuard: vi.fn().mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    }),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({ runTransaction: mocks.runTransaction }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => 'delete-sentinel' },
}));

vi.mock('../queue-utils', () => ({
  QueueResult: { Processed: 'PROCESSED' },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.deletionGuard,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));

import {
  claimCOROSEventWriteRevision,
  completeCOROSEventWriteRevision,
  COROS_EVENT_WRITE_LEASE_MS,
} from './queue-processing';

function queueItem(queueRevision: string): COROSAPIWorkoutQueueItemInterface {
  return {
    id: 'coros-queue-1',
    ref: mocks.queueRef as unknown as NonNullable<COROSAPIWorkoutQueueItemInterface['ref']>,
    firebaseUserID: 'firebase-1',
    openId: 'coros-1',
    workoutID: 'workout-1',
    queueRevision,
    dateCreated: 1_777_000_000_000,
    retryCount: 0,
    processed: false,
    dispatchedToCloudTask: 123,
  };
}

describe('COROS event-write revision lease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
    mocks.deletionGuard.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    mocks.state.current = { ...queueItem('revision-1') };
    delete mocks.state.current.ref;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes a replacement that arrives after R1 is claimed but before its event write', async () => {
    const firstRevision = queueItem('revision-1');
    const secondRevision = queueItem('revision-2');

    await expect(claimCOROSEventWriteRevision(firstRevision, 'firebase-1', 'worker-r1'))
      .resolves.toBe('claimed');

    // This is the history transaction racing between the claim and setEvent:
    // it advances the payload revision but preserves the active R1 lease.
    mocks.state.current = {
      ...secondRevision,
      processingOwner: mocks.state.current.processingOwner,
      processingRevision: mocks.state.current.processingRevision,
      processingLeaseExpiresAt: mocks.state.current.processingLeaseExpiresAt,
    };
    delete mocks.state.current.ref;

    await expect(claimCOROSEventWriteRevision(secondRevision, 'firebase-1', 'worker-r2'))
      .resolves.toBe('busy');
    await expect(completeCOROSEventWriteRevision(firstRevision, 'firebase-1', 'worker-r1'))
      .resolves.toBe('PROCESSED');

    expect(mocks.state.current).toEqual(expect.objectContaining({
      queueRevision: 'revision-2',
      processed: false,
      dispatchedToCloudTask: null,
    }));
    expect(mocks.state.current).not.toHaveProperty('processingOwner');

    await expect(claimCOROSEventWriteRevision(secondRevision, 'firebase-1', 'worker-r2'))
      .resolves.toBe('claimed');
    await expect(completeCOROSEventWriteRevision(secondRevision, 'firebase-1', 'worker-r2'))
      .resolves.toBe('PROCESSED');
    expect(mocks.state.current).toEqual(expect.objectContaining({
      queueRevision: 'revision-2',
      processed: true,
    }));
  });

  it('reclaims an expired lease after a crashed worker', async () => {
    mocks.state.current = {
      ...mocks.state.current,
      processingOwner: 'crashed-worker',
      processingRevision: 'revision:revision-1',
      processingLeaseExpiresAt: Date.now() - 1,
    };

    await expect(claimCOROSEventWriteRevision(queueItem('revision-1'), 'firebase-1', 'retry-worker'))
      .resolves.toBe('claimed');
    expect(mocks.state.current).toEqual(expect.objectContaining({
      processingOwner: 'retry-worker',
      processingRevision: 'revision:revision-1',
      processingLeaseExpiresAt: Date.now() + COROS_EVENT_WRITE_LEASE_MS,
    }));
  });

  it('does not claim a revision owned by another Firebase user', async () => {
    mocks.state.current.firebaseUserID = 'different-user';

    await expect(claimCOROSEventWriteRevision(queueItem('revision-1'), 'firebase-1', 'worker-1'))
      .resolves.toBe('superseded');
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('distinguishes user deletion so the worker can run queue cleanup', async () => {
    mocks.deletionGuard.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await expect(claimCOROSEventWriteRevision(queueItem('revision-1'), 'firebase-1', 'worker-1'))
      .resolves.toBe('deleted_user');
    expect(mocks.transactionGet).not.toHaveBeenCalled();
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('releases a replacement left behind by an expired older-revision lease', async () => {
    mocks.state.current = {
      ...queueItem('revision-2'),
      processingOwner: 'crashed-r1-worker',
      processingRevision: 'revision:revision-1',
      processingLeaseExpiresAt: Date.now() - 1,
    };
    delete mocks.state.current.ref;

    await expect(claimCOROSEventWriteRevision(queueItem('revision-1'), 'firebase-1', 'r1-retry'))
      .resolves.toBe('superseded');
    expect(mocks.state.current).toEqual(expect.objectContaining({
      queueRevision: 'revision-2',
      processed: false,
      dispatchedToCloudTask: null,
    }));
    expect(mocks.state.current).not.toHaveProperty('processingOwner');
  });
});
