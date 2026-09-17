import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues a delayed revision-bound recovery before recording the deferral', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234);
    const queueItem = {
      id: 'coros-item-1',
      dateCreated: 1_000,
      queueRevision: 'revision-2',
      retryCount: 0,
      processed: false,
      dispatchedToCloudTask: 1_234,
      tokenRefreshRecoveryGeneration: 3,
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
      currentRecoveryGeneration: 3,
    })).resolves.toBe(QueueResult.Deferred);

    expect(hoisted.enqueueWorkoutRecoveryTask).toHaveBeenCalledWith(
      ServiceNames.COROSAPI,
      'coros-item-1',
      1_000,
      95,
      {
        recoveryGeneration: 4,
        queueRevision: 'revision-2',
      },
    );
    expect(hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive)
      .toHaveBeenCalledWith(expect.objectContaining({
        queueItem,
        userID: 'user-1',
        phase: 'coros_refresh_contention',
        logPrefix: 'WorkoutQueue',
        recoveryDispatchedAtMs: 1_234,
        recoveryGeneration: 4,
        isCurrent: expect.any(Function),
      }));
    const guardedIsCurrent = hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive
      .mock.calls[0][0].isCurrent;
    expect(guardedIsCurrent({
      processed: false,
      tokenRefreshRecoveryGeneration: 3,
    })).toBe(true);
    expect(guardedIsCurrent({
      processed: false,
      tokenRefreshRecoveryGeneration: 4,
    })).toBe(false);
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
        dispatchedToCloudTask: null,
        ref: {} as any,
      },
      userID: 'user-2',
      phase: 'suunto_refresh_contention',
      logPrefix: 'WorkoutQueue',
      isCurrent: () => true,
    })).resolves.toBe(QueueResult.Failed);

    expect(hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive).not.toHaveBeenCalled();
  });

  it('reuses a stable recovery task name when the marker write has to retry', async () => {
    const queueItem = {
      id: 'garmin-item-1',
      dateCreated: 3_000,
      retryCount: 0,
      processed: false,
      dispatchedToCloudTask: 7_654,
      tokenRefreshRecoveryGeneration: 0,
      ref: {} as any,
    };
    hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive
      .mockResolvedValueOnce(QueueResult.Failed)
      .mockResolvedValueOnce(QueueResult.Deferred);
    const params = {
      serviceName: ServiceNames.GarminAPI,
      queueItem,
      userID: 'user-3',
      phase: 'garmin_refresh_contention',
      logPrefix: 'GarminWorkoutQueue',
      isCurrent: () => true,
    };

    await expect(deferWorkoutQueueItemForTokenRefreshContention(params))
      .resolves.toBe(QueueResult.Failed);
    await expect(deferWorkoutQueueItemForTokenRefreshContention(params))
      .resolves.toBe(QueueResult.Deferred);

    expect(hoisted.enqueueWorkoutRecoveryTask).toHaveBeenCalledTimes(2);
    expect(hoisted.enqueueWorkoutRecoveryTask.mock.calls[0][4]).toEqual({
      recoveryGeneration: 1,
    });
    expect(hoisted.enqueueWorkoutRecoveryTask.mock.calls[1][4]).toEqual({
      recoveryGeneration: 1,
    });
  });

  it('acknowledges a stale delivery when a later recovery generation is already pending', async () => {
    await expect(deferWorkoutQueueItemForTokenRefreshContention({
      serviceName: ServiceNames.SuuntoApp,
      queueItem: {
        id: 'suunto-item-stale',
        dateCreated: 4_000,
        retryCount: 0,
        processed: false,
        dispatchedToCloudTask: 8_000,
        tokenRefreshRecoveryGeneration: 2,
        ref: {} as any,
      },
      userID: 'user-4',
      phase: 'suunto_refresh_contention',
      logPrefix: 'WorkoutQueue',
      isCurrent: () => true,
      currentRecoveryGeneration: 1,
    })).resolves.toBe(QueueResult.Deferred);

    expect(hoisted.enqueueWorkoutRecoveryTask).not.toHaveBeenCalled();
    expect(hoisted.deferQueueItemForTokenRefreshContentionIfCurrentUserActive).not.toHaveBeenCalled();
  });
});
