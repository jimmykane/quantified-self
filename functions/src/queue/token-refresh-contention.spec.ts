import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { DocumentReference } from 'firebase-admin/firestore';
import { QueueResult } from '../queue-utils';

const mocks = vi.hoisted(() => ({
  enqueueWorkoutTask: vi.fn(),
  updateQueueItemIfUserActive: vi.fn(),
}));

vi.mock('../shared/cloud-tasks', () => ({
  enqueueWorkoutTask: mocks.enqueueWorkoutTask,
}));
vi.mock('./dispatch-marker', async importOriginal => ({
  ...(await importOriginal<typeof import('./dispatch-marker')>()),
  updateQueueItemIfUserActive: mocks.updateQueueItemIfUserActive,
}));
vi.mock('./revision-processing-lease', () => ({
  clearRevisionProcessingLeaseUpdate: () => ({ processingLeaseOwner: null }),
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { deferWorkoutQueueItemForTokenRefreshContention } from './token-refresh-contention';

describe('deferWorkoutQueueItemForTokenRefreshContention', () => {
  const queueItem = {
    id: 'coros-item-1',
    dateCreated: 1_000,
    queueRevision: 'revision-2',
    retryCount: 0,
    processed: false,
    dispatchedToCloudTask: 1_234,
    dispatchRecoveryGeneration: 3,
    ref: {} as DocumentReference,
  };
  const baseParams = {
    serviceName: ServiceNames.COROSAPI,
    queueItem,
    userID: 'user-1',
    phase: 'coros_refresh_contention',
    logPrefix: 'WorkoutQueue',
    isCurrent: () => true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueWorkoutTask.mockResolvedValue(true);
    mocks.updateQueueItemIfUserActive.mockResolvedValue('updated');
  });

  it('enqueues and records one delayed recovery with the next dispatch generation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);

    await expect(deferWorkoutQueueItemForTokenRefreshContention(baseParams))
      .resolves.toBe(QueueResult.TokenRefreshDeferred);

    expect(mocks.enqueueWorkoutTask).toHaveBeenCalledWith(
      ServiceNames.COROSAPI,
      queueItem.id,
      queueItem.dateCreated,
      95,
      {
        recoveryTaskKey: 'token-refresh-4',
        dispatchRecoveryGeneration: 4,
        recoveryTaskOnly: true,
        queueRevision: queueItem.queueRevision,
      },
    );
    expect(mocks.updateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItemDocument: queueItem.ref,
      queueItemId: queueItem.id,
      userID: 'user-1',
      updateData: expect.objectContaining({
        dispatchedToCloudTask: 2_000,
        dispatchRecoveryGeneration: 4,
        providerOperationStartedAt: null,
        processingLeaseOwner: null,
      }),
    }));
  });

  it('acknowledges an older task without enqueueing another recovery', async () => {
    await expect(deferWorkoutQueueItemForTokenRefreshContention({
      ...baseParams,
      taskRecoveryGeneration: 2,
    })).resolves.toBe(QueueResult.TokenRefreshDeferred);

    expect(mocks.enqueueWorkoutTask).not.toHaveBeenCalled();
    expect(mocks.updateQueueItemIfUserActive).not.toHaveBeenCalled();
  });
});
