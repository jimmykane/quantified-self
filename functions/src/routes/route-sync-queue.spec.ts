'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => {
  const queueCollectionName = 'routeSyncQueue';
  const state = {
    existingQueueData: null as Record<string, unknown> | null,
  };
  const queueDocRef = {
    path: `${queueCollectionName}/route-sync-queue-id`,
    parent: { id: queueCollectionName },
  };
  const transactionGet = vi.fn();
  const transactionSet = vi.fn();
  const transactionUpdate = vi.fn();
  const collectionDoc = vi.fn(() => queueDocRef);
  const collection = vi.fn(() => ({
    doc: collectionDoc,
  }));
  const collectionGroup = vi.fn(() => ({
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ docs: [] }),
  }));
  const runTransaction = vi.fn(async (handler: (transaction: unknown) => Promise<unknown>) => handler({
    get: transactionGet,
    set: transactionSet,
    update: transactionUpdate,
  }));

  return {
    state,
    queueDocRef,
    transactionGet,
    transactionSet,
    transactionUpdate,
    collection,
    collectionDoc,
    collectionGroup,
    runTransaction,
    recursiveDelete: vi.fn(),
    enqueueRouteSyncTask: vi.fn(),
    generateIDFromParts: vi.fn(),
    getUserDeletionGuardState: vi.fn(),
    getUserDeletionGuardStateInTransaction: vi.fn(),
    markQueueItemDispatchedIfUserActive: vi.fn(),
    markQueueItemDeletedForUserCleanup: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
  };
});

vi.mock('firebase-admin', () => {
  const firestore = () => ({
    collection: hoisted.collection,
    collectionGroup: hoisted.collectionGroup,
    runTransaction: hoisted.runTransaction,
    recursiveDelete: hoisted.recursiveDelete,
  });

  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('firebase-functions/logger', () => ({
  info: hoisted.loggerInfo,
  warn: hoisted.loggerWarn,
  error: hoisted.loggerError,
}));

vi.mock('../utils', () => ({
  enqueueRouteSyncTask: (...args: unknown[]) => hoisted.enqueueRouteSyncTask(...args),
  generateIDFromParts: (...args: unknown[]) => hoisted.generateIDFromParts(...args),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: (...args: unknown[]) => hoisted.getUserDeletionGuardState(...args),
  getUserDeletionGuardStateInTransaction: (...args: unknown[]) => hoisted.getUserDeletionGuardStateInTransaction(...args),
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
  },
}));

vi.mock('../queue/dispatch-marker', () => ({
  QueueDispatchMarkerResult: {
    Marked: 'marked',
    SkippedDeletedUser: 'skipped_deleted_user',
  },
  markQueueItemDispatchedIfUserActive: (...args: unknown[]) => hoisted.markQueueItemDispatchedIfUserActive(...args),
}));

vi.mock('../queue/cleanup-tombstone', () => ({
  QUEUE_CLEANUP_TOMBSTONE_REASONS: {
    UserDeletionGuard: 'user_deletion_guard',
  },
  markQueueItemDeletedForUserCleanup: (...args: unknown[]) => hoisted.markQueueItemDeletedForUserCleanup(...args),
}));

import { enqueueRouteSyncQueueItem } from './route-sync-queue';

describe('enqueueRouteSyncQueueItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.state.existingQueueData = null;
    hoisted.generateIDFromParts.mockResolvedValue('route-sync-queue-id');
    hoisted.getUserDeletionGuardState.mockResolvedValue({
      shouldSkip: false,
      userExists: true,
      deletionInProgress: false,
    });
    hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      shouldSkip: false,
      userExists: true,
      deletionInProgress: false,
    });
    hoisted.markQueueItemDispatchedIfUserActive.mockResolvedValue('marked');
    hoisted.enqueueRouteSyncTask.mockResolvedValue(true);
    hoisted.transactionGet.mockImplementation(async () => ({
      exists: hoisted.state.existingQueueData !== null,
      data: () => hoisted.state.existingQueueData,
    }));
  });

  it('keeps pending-disconnect deferred route items queued without redispatching', async () => {
    hoisted.state.existingQueueData = {
      id: 'route-sync-queue-id',
      dateCreated: 1_780_000_000_000,
      processed: true,
      resultStatus: 'deferred',
      deferredReason: 'service_disconnect_pending',
      dispatchedToCloudTask: Number.MAX_SAFE_INTEGER,
      sourceServiceName: ServiceNames.SuuntoApp,
      firebaseUserID: 'user-1',
      providerUserId: 'suunto-user',
      providerRouteId: 'route-1',
      providerRouteName: 'Old route name',
      providerRouteCreatedAt: 1_700_000_000_000,
      providerRouteModifiedAt: 1_700_000_005_000,
      manual: false,
    };

    const result = await enqueueRouteSyncQueueItem({
      sourceServiceName: ServiceNames.SuuntoApp,
      providerUserId: 'suunto-user',
      providerRouteId: 'route-1',
      providerRouteName: 'Updated route name',
      providerRouteCreatedAt: 1_700_000_000_000,
      providerRouteModifiedAt: 1_700_000_010_000,
      manual: false,
      firebaseUserID: 'user-1',
    });

    expect(result).toEqual({
      enqueued: false,
      queueItemId: 'route-sync-queue-id',
      reason: 'already_pending',
      redispatched: undefined,
    });
    expect(hoisted.transactionSet).toHaveBeenCalledWith(
      hoisted.queueDocRef,
      {
        providerRouteName: 'Updated route name',
        providerRouteCreatedAt: 1_700_000_000_000,
        providerRouteModifiedAt: 1_700_000_010_000,
        manual: false,
      },
      { merge: true },
    );
    expect(hoisted.enqueueRouteSyncTask).not.toHaveBeenCalled();
    expect(hoisted.markQueueItemDispatchedIfUserActive).not.toHaveBeenCalled();
  });
});
