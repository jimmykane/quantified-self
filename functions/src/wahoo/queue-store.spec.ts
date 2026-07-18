import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => {
  const transactionGet = vi.fn();
  const transactionSet = vi.fn();
  const transactionUpdate = vi.fn();
  const ref = { id: 'queue-1', path: 'wahooAPIWorkoutQueue/queue-1' };
  return {
    transactionGet,
    transactionSet,
    transactionUpdate,
    ref,
    runTransaction: vi.fn(async (runner: any) => runner({
      get: transactionGet,
      set: transactionSet,
      update: transactionUpdate,
    })),
    enqueueWorkoutTask: vi.fn().mockResolvedValue(true),
    guardedUpdate: vi.fn().mockResolvedValue('updated'),
    deletionGuard: vi.fn().mockResolvedValue({ userExists: true, deletionInProgress: false, shouldSkip: false }),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: () => ({ doc: () => mocks.ref }),
    runTransaction: mocks.runTransaction,
  }),
}));

vi.mock('../shared/cloud-tasks', () => ({ enqueueWorkoutTask: mocks.enqueueWorkoutTask }));
vi.mock('../shared/ttl-config', () => ({
  getExpireAtTimestamp: () => new Date('2026-08-01T00:00:00.000Z'),
  TTL_CONFIG: { QUEUE_ITEM_IN_DAYS: 7 },
}));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.deletionGuard,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));
vi.mock('../queue/dispatch-marker', () => ({
  updateQueueItemIfUserActive: mocks.guardedUpdate,
  QueueItemUserGuardedUpdateResult: { Updated: 'updated' },
}));

import { upsertWahooWorkoutQueueItem } from './queue-store';

const input = {
  id: 'queue-1',
  firebaseUserID: 'firebase-1',
  wahooUserID: 'wahoo-1',
  workoutID: 'workout-1',
  workoutSummaryID: 'summary-1',
  summaryUpdatedAt: '2026-07-18T10:00:00.000Z',
  FITFileURI: 'https://cdn.wahooligan.com/one.fit',
  starts: '2026-07-18T09:00:00.000Z',
};

describe('upsertWahooWorkoutQueueItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletionGuard.mockResolvedValue({ userExists: true, deletionInProgress: false, shouldSkip: false });
    mocks.enqueueWorkoutTask.mockResolvedValue(true);
    mocks.guardedUpdate.mockResolvedValue('updated');
  });

  it('queues a new revision and dispatches immediate webhook work', async () => {
    mocks.transactionGet.mockResolvedValue({ exists: false });

    await expect(upsertWahooWorkoutQueueItem(input, 'immediate')).resolves.toEqual({ ref: mocks.ref, queued: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.ref, expect.objectContaining({
      workoutID: 'workout-1',
      processed: false,
      retryCount: 0,
      expireAt: new Date('2026-08-01T00:00:00.000Z'),
    }));
    expect(mocks.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.WahooAPI, 'queue-1', expect.any(Number));
  });

  it('resets a processed item when Wahoo sends a newer summary revision', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ processed: true, summaryUpdatedAt: '2026-07-18T09:00:00.000Z' }),
    });

    await upsertWahooWorkoutQueueItem(input, 'deferred');

    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.ref, expect.objectContaining({
      summaryUpdatedAt: input.summaryUpdatedAt,
      processed: false,
      dispatchedToCloudTask: null,
    }));
    expect(mocks.enqueueWorkoutTask).not.toHaveBeenCalled();
  });

  it('does not requeue an older duplicate but refreshes its pending signed URL', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        processed: false,
        dateCreated: 123,
        summaryUpdatedAt: input.summaryUpdatedAt,
        FITFileURI: 'https://cdn.wahooligan.com/expired.fit',
      }),
    });

    await expect(upsertWahooWorkoutQueueItem(input, 'immediate')).resolves.toEqual({ ref: mocks.ref, queued: false });
    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.ref, { FITFileURI: input.FITFileURI });
    expect(mocks.enqueueWorkoutTask).not.toHaveBeenCalled();
  });

  it('does not create queue state once account deletion has started', async () => {
    mocks.deletionGuard.mockResolvedValue({ userExists: true, deletionInProgress: true, shouldSkip: true });

    await expect(upsertWahooWorkoutQueueItem(input, 'immediate')).resolves.toEqual({ ref: mocks.ref, queued: false });
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(mocks.enqueueWorkoutTask).not.toHaveBeenCalled();
  });
});
