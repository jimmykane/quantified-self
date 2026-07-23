import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { WahooAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';

const mocks = vi.hoisted(() => {
  const transactionGet = vi.fn();
  const transactionSet = vi.fn();
  const transactionUpdate = vi.fn();
  const transactionDelete = vi.fn();
  const ref = { id: 'queue-1', path: 'wahooAPIWorkoutQueue/queue-1' };
  const mappingRef = { id: 'wahoo-1', path: 'wahooAPIUserMappings/wahoo-1' };
  const failedRef = { id: 'queue-1', path: 'failed_jobs/queue-1' };
  return {
    transactionGet,
    transactionSet,
    transactionUpdate,
    transactionDelete,
    ref,
    mappingRef,
    failedRef,
    recursiveDelete: vi.fn().mockResolvedValue(undefined),
    runTransaction: vi.fn(async (runner: any) => runner({
      get: transactionGet,
      set: transactionSet,
      update: transactionUpdate,
      delete: transactionDelete,
    })),
    enqueueWorkoutTaskWithDispatchRecovery: vi.fn().mockResolvedValue(true),
    markWorkoutTaskDispatchedWithRetry: vi.fn(async ({ markDispatched }: { markDispatched: () => Promise<boolean> }) => markDispatched()),
    guardedUpdate: vi.fn().mockResolvedValue('updated'),
    deletionGuard: vi.fn().mockResolvedValue({ userExists: true, deletionInProgress: false, shouldSkip: false }),
    markQueueItemDeletedForUserCleanup: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({
    collection: (name: string) => ({ doc: () => {
      if (name === 'failed_jobs') return mocks.failedRef;
      if (name === 'wahooAPIUserMappings') return mocks.mappingRef;
      return mocks.ref;
    } }),
    runTransaction: mocks.runTransaction,
    recursiveDelete: mocks.recursiveDelete,
  }), {
    FieldValue: { delete: () => 'delete-sentinel' },
  }),
}));

vi.mock('../shared/cloud-tasks', () => ({
  enqueueWorkoutTaskWithDispatchRecovery: mocks.enqueueWorkoutTaskWithDispatchRecovery,
  markWorkoutTaskDispatchedWithRetry: mocks.markWorkoutTaskDispatchedWithRetry,
}));
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
vi.mock('../queue/cleanup-tombstone', () => ({
  markQueueItemDeletedForUserCleanup: mocks.markQueueItemDeletedForUserCleanup,
  QUEUE_CLEANUP_TOMBSTONE_REASONS: { UserDeletionGuard: 'user_deletion_guard' },
}));

import {
  claimWahooWorkoutQueueRevision,
  completeWahooWorkoutQueueRevision,
  createWahooEventWriteOwnershipGuard,
  failWahooWorkoutQueueRevision,
  getClaimedWahooWorkoutQueueRevisionEventWriteFence,
  upsertWahooWorkoutQueueItem,
} from './queue-store';

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
    mocks.enqueueWorkoutTaskWithDispatchRecovery.mockResolvedValue(true);
    mocks.markWorkoutTaskDispatchedWithRetry.mockImplementation(async ({ markDispatched }) => markDispatched());
    mocks.guardedUpdate.mockResolvedValue('updated');
    mocks.recursiveDelete.mockResolvedValue(undefined);
    mocks.markQueueItemDeletedForUserCleanup.mockResolvedValue(true);
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
    expect(mocks.enqueueWorkoutTaskWithDispatchRecovery).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: ServiceNames.WahooAPI,
      queueItem: expect.objectContaining({
        id: 'queue-1',
        dateCreated: expect.any(Number),
      }),
      advanceDispatchRecoveryGeneration: expect.any(Function),
    }));
    const markerParams = mocks.guardedUpdate.mock.calls[0][0];
    expect(markerParams.isCurrent({ ...input, processed: false, dispatchedToCloudTask: null })).toBe(true);
    expect(markerParams.isCurrent({
      ...input,
      workoutSummaryID: 'summary-2',
      summaryUpdatedAt: '2026-07-18T11:00:00.000Z',
      processed: false,
      dispatchedToCloudTask: null,
    })).toBe(false);
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
    expect(mocks.enqueueWorkoutTaskWithDispatchRecovery).not.toHaveBeenCalled();
  });

  it('treats a different summary ID at the same timestamp as a newer revision', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        processed: true,
        workoutSummaryID: 'summary-previous',
        summaryUpdatedAt: input.summaryUpdatedAt,
      }),
    });

    await upsertWahooWorkoutQueueItem(input, 'deferred');

    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.ref, expect.objectContaining({
      workoutSummaryID: input.workoutSummaryID,
      summaryUpdatedAt: input.summaryUpdatedAt,
      processed: false,
    }));
    expect(mocks.transactionUpdate).not.toHaveBeenCalledWith(mocks.ref, { FITFileURI: input.FITFileURI });
  });

  it('invalidates an older worker lease when a newer summary arrives', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        processed: false,
        summaryUpdatedAt: '2026-07-18T09:00:00.000Z',
        processingOwner: 'older-worker',
        processingRevision: '2026-07-18T09:00:00.000Z',
        processingLeaseExpiresAt: Date.now() + 60_000,
      }),
    });

    await upsertWahooWorkoutQueueItem(input, 'deferred');

    const queuePayload = mocks.transactionSet.mock.calls[0][1];
    expect(queuePayload).toEqual(expect.objectContaining({
      summaryUpdatedAt: input.summaryUpdatedAt,
    }));
    expect(queuePayload).not.toHaveProperty('processingOwner');
    expect(queuePayload).not.toHaveProperty('processingRevision');
    expect(queuePayload).not.toHaveProperty('processingLeaseExpiresAt');
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
    expect(mocks.enqueueWorkoutTaskWithDispatchRecovery).not.toHaveBeenCalled();
  });

  it('does not create queue state once account deletion has started', async () => {
    mocks.deletionGuard.mockResolvedValue({ userExists: true, deletionInProgress: true, shouldSkip: true });

    await expect(upsertWahooWorkoutQueueItem(input, 'immediate')).resolves.toEqual({ ref: mocks.ref, queued: false });
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(mocks.enqueueWorkoutTaskWithDispatchRecovery).not.toHaveBeenCalled();
  });

  it('recursively removes a queue item when deletion starts during dispatch recovery', async () => {
    mocks.transactionGet.mockResolvedValue({ exists: false });

    await upsertWahooWorkoutQueueItem(input, 'immediate');
    const dispatchParams = mocks.enqueueWorkoutTaskWithDispatchRecovery.mock.calls[0][0] as {
      queueItem: WahooAPIWorkoutQueueItemInterface;
      advanceDispatchRecoveryGeneration: (queueItem: WahooAPIWorkoutQueueItemInterface) => Promise<WahooAPIWorkoutQueueItemInterface | null>;
    };
    mocks.deletionGuard.mockResolvedValueOnce({ userExists: true, deletionInProgress: true, shouldSkip: true });

    await expect(dispatchParams.advanceDispatchRecoveryGeneration(dispatchParams.queueItem)).resolves.toBeNull();
    expect(mocks.markQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'wahooAPIWorkoutQueue',
      'queue-1',
      'user_deletion_guard',
    );
    expect(mocks.recursiveDelete).toHaveBeenCalledWith(mocks.ref);
  });

  it('returns a normal busy outcome while the current revision lease is active', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        ...input,
        processingOwner: 'worker-1',
        processingLeaseExpiresAt: Date.now() + 60_000,
      }),
    });

    await expect(claimWahooWorkoutQueueRevision({ ...input, ref: mocks.ref } as any, 'worker-2'))
      .resolves.toBe('busy');
    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('does not create an event-write fence after Wahoo ownership transfers', async () => {
    mocks.transactionGet.mockImplementation((ref: unknown) => {
      if (ref === mocks.ref) {
        return Promise.resolve({
          exists: true,
          data: () => ({ ...input, processingOwner: 'worker-1' }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ firebaseUserID: 'new-firebase-owner' }),
      });
    });

    await expect(getClaimedWahooWorkoutQueueRevisionEventWriteFence(
      { ...input, ref: mocks.ref } as unknown as WahooAPIWorkoutQueueItemInterface,
      'worker-1',
    )).resolves.toBeNull();
    expect(mocks.transactionGet).toHaveBeenCalledWith(mocks.ref);
    expect(mocks.transactionGet).toHaveBeenCalledWith(mocks.mappingRef);
  });

  it('captures the Wahoo ownership version for a claimed current revision', async () => {
    mocks.transactionGet.mockImplementation((ref: unknown) => {
      if (ref === mocks.ref) {
        return Promise.resolve({
          exists: true,
          data: () => ({ ...input, processingOwner: 'worker-1' }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ firebaseUserID: input.firebaseUserID, ownershipVersion: 7 }),
      });
    });

    await expect(getClaimedWahooWorkoutQueueRevisionEventWriteFence(
      { ...input, ref: mocks.ref } as unknown as WahooAPIWorkoutQueueItemInterface,
      'worker-1',
    )).resolves.toEqual({
      firebaseUserID: input.firebaseUserID,
      wahooUserID: input.wahooUserID,
      ownershipVersion: 7,
    });
  });

  it('rejects event writes when the captured Wahoo mapping version is superseded', async () => {
    const guard = createWahooEventWriteOwnershipGuard({
      firebaseUserID: input.firebaseUserID,
      wahooUserID: input.wahooUserID,
      ownershipVersion: 7,
    });
    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ firebaseUserID: 'new-firebase-owner', ownershipVersion: 8 }),
      }),
    } as unknown as admin.firestore.Transaction;

    await expect(guard(transaction)).resolves.toBe(false);
    expect(transaction.get).toHaveBeenCalledWith(mocks.mappingRef);

    transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({ firebaseUserID: input.firebaseUserID, ownershipVersion: 7 }),
    });
    await expect(guard(transaction)).resolves.toBe(true);
  });

  it('lets the latest revision claim immediately after replacing an older worker lease', async () => {
    const latestRevision = {
      ...input,
      workoutSummaryID: 'summary-2',
      summaryUpdatedAt: '2026-07-18T11:00:00.000Z',
    };
    mocks.transactionGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ...input,
          processed: false,
          processingOwner: 'older-worker',
          processingLeaseExpiresAt: Date.now() + 60_000,
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ...latestRevision, processed: false, dispatchedToCloudTask: null }),
      });

    await upsertWahooWorkoutQueueItem(latestRevision, 'deferred');
    await expect(claimWahooWorkoutQueueRevision({ ...latestRevision, ref: mocks.ref } as any, 'latest-worker'))
      .resolves.toBe('claimed');

    const latestPayload = mocks.transactionSet.mock.calls[0][1];
    expect(latestPayload).not.toHaveProperty('processingOwner');
    expect(latestPayload).not.toHaveProperty('processingLeaseExpiresAt');
    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.ref, expect.objectContaining({
      processingOwner: 'latest-worker',
      processingRevision: latestRevision.summaryUpdatedAt,
    }));
  });

  it('releases an older worker lease without completing a newer revision', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        ...input,
        workoutSummaryID: 'summary-2',
        summaryUpdatedAt: '2026-07-18T11:00:00.000Z',
        processingOwner: 'worker-1',
      }),
    });

    await expect(completeWahooWorkoutQueueRevision({ ...input, ref: mocks.ref } as any, 'worker-1'))
      .resolves.toBe('PROCESSED');
    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.ref, expect.objectContaining({
      processed: false,
      dispatchedToCloudTask: null,
      processingOwner: 'delete-sentinel',
    }));
    expect(mocks.transactionUpdate).not.toHaveBeenCalledWith(
      mocks.ref,
      expect.objectContaining({ processed: true }),
    );
  });

  it('marks only the claimed current revision as processed', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ ...input, processingOwner: 'worker-1' }),
    });

    await expect(completeWahooWorkoutQueueRevision({ ...input, ref: mocks.ref } as any, 'worker-1'))
      .resolves.toBe('PROCESSED');
    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.ref, expect.objectContaining({
      processed: true,
      processedAt: expect.any(Number),
      processingOwner: 'delete-sentinel',
    }));
  });

  it('does not let an older worker retry overwrite a newer revision', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        ...input,
        workoutSummaryID: 'summary-2',
        summaryUpdatedAt: '2026-07-18T11:00:00.000Z',
        processingOwner: 'worker-1',
      }),
    });

    await expect(failWahooWorkoutQueueRevision(
      { ...input, ref: mocks.ref } as any,
      'worker-1',
      new Error('old revision failed'),
    )).resolves.toBe('PROCESSED');
    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.ref, expect.objectContaining({
      processed: false,
      dispatchedToCloudTask: null,
      processingOwner: 'delete-sentinel',
    }));
    expect(mocks.transactionSet).not.toHaveBeenCalledWith(mocks.failedRef, expect.anything());
  });
});
