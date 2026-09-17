import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { QueueResult } from '../queue-utils';

const hoisted = vi.hoisted(() => ({
  enqueueWorkoutRecoveryTask: vi.fn(),
  deferQueueItemForTokenRefreshContentionIfCurrentUserActive: vi.fn(),
}));

vi.mock('../shared/cloud-tasks', () => ({
  enqueueWorkoutRecoveryTask: hoisted.enqueueWorkoutRecoveryTask,
}));

vi.mock('../queue-utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../queue-utils')>()),
  deferQueueItemForTokenRefreshContentionIfCurrentUserActive:
    hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive,
}));

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { deferWorkoutQueueItemForTokenRefreshContention } from './token-refresh-contention';

describe('deferWorkoutQueueItemForTokenRefreshContention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.enqueueWorkoutRecoveryTask.mockResolvedValue(true);
    hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive
      .mockResolvedValue(QueueResult.Deferred);
  });

  it('enqueues a delayed revision-bound recovery before recording the deferral', async () => {
    const queueItem = {
      id: 'coros-item-1',
      dateCreated: 1_000,
      queueRevision: 'revision-2',
      retryCount: 0,
      processed: false,
      ref: {} as any,
    };
    const isCurrent = vi.fn(() => true);

    await expect(deferWorkoutQueueItemForTokenRefreshContention({
      serviceName: ServiceNames.COROSAPI,
      queueItem,
      userID: 'user-1',
      phase: 'coros_refresh_contention',
      logPrefix: 'WorkoutQueue',
      isCurrent,
    })).resolves.toBe(QueueResult.Deferred);

    expect(hoisted.enqueueWorkoutRecoveryTask).toHaveBeenCalledWith(
      ServiceNames.COROSAPI,
      'coros-item-1',
      1_000,
      95,
      {
        recoveryTaskKey: expect.any(String),
        queueRevision: 'revision-2',
      },
    );
    expect(hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive)
      .toHaveBeenCalledWith(expect.objectContaining({
        queueItem,
        userID: 'user-1',
        phase: 'coros_refresh_contention',
        logPrefix: 'WorkoutQueue',
        recoveryDispatchedAtMs: expect.any(Number),
        isCurrent,
      }));
    expect(hoisted.enqueueWorkoutRecoveryTask.mock.invocationCallOrder[0])
      .toBeLessThan(hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive.mock.invocationCallOrder[0]);
  });

  it('fails the current worker when delayed recovery cannot be confirmed', async () => {
    hoisted.enqueueWorkoutRecoveryTask.mockResolvedValue(false);

    await expect(deferWorkoutQueueItemForTokenRefreshContention({
      serviceName: ServiceNames.SuuntoApp,
      queueItem: {
        id: 'suunto-item-1',
        dateCreated: 2_000,
        retryCount: 0,
        processed: false,
        ref: {} as any,
      },
      userID: 'user-2',
      phase: 'suunto_refresh_contention',
      logPrefix: 'WorkoutQueue',
      isCurrent: () => true,
    })).resolves.toBe(QueueResult.Failed);

    expect(hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive).not.toHaveBeenCalled();
  });
});
