import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PENDING_TASKS } from '../shared/queue-config';

const {
  mockLoggerInfo,
  mockLoggerError,
  mockLoggerWarn,
  mockGetCloudTaskQueueDepthForQueue,
  mockEnqueueActivitySyncTask,
  mockQueueGet,
  mockQueueWhere,
  mockQueueOrderBy,
  mockQueueStartAfter,
  mockQueueLimit,
  mockQueueCollection,
  mockFirestore,
  mockRunTransaction,
  mockRecursiveDelete,
  mockGetUserDeletionGuardState,
  mockGetUserDeletionGuardStateInTransaction,
} = vi.hoisted(() => {
  const mockLoggerInfo = vi.fn();
  const mockLoggerError = vi.fn();
  const mockLoggerWarn = vi.fn();
  const mockGetCloudTaskQueueDepthForQueue = vi.fn();
  const mockEnqueueActivitySyncTask = vi.fn();
  const mockQueueGet = vi.fn();
  const mockQueueWhere = vi.fn();
  const mockQueueOrderBy = vi.fn();
  const mockQueueStartAfter = vi.fn();
  const mockQueueLimit = vi.fn();
  const mockQueueCollection = vi.fn();
  const mockRecursiveDelete = vi.fn();
  const mockRunTransaction = vi.fn(async (runner: (transaction: { update: (ref: { update?: (data: unknown) => Promise<void> }, data: unknown) => Promise<void> | void }) => unknown) => runner({
    update: (ref, data) => ref.update?.(data),
  }));
  const mockFirestore = vi.fn(() => ({
    collection: mockQueueCollection,
    recursiveDelete: mockRecursiveDelete,
    runTransaction: mockRunTransaction,
  }));
  const mockGetUserDeletionGuardState = vi.fn();
  const mockGetUserDeletionGuardStateInTransaction = vi.fn();

  return {
    mockLoggerInfo,
    mockLoggerError,
    mockLoggerWarn,
    mockGetCloudTaskQueueDepthForQueue,
    mockEnqueueActivitySyncTask,
    mockQueueGet,
    mockQueueWhere,
    mockQueueOrderBy,
    mockQueueStartAfter,
    mockQueueLimit,
    mockQueueCollection,
    mockFirestore,
    mockRunTransaction,
    mockRecursiveDelete,
    mockGetUserDeletionGuardState,
    mockGetUserDeletionGuardStateInTransaction,
  };
});

vi.mock('firebase-functions/v1', () => ({
  region: vi.fn(() => ({
    runWith: vi.fn(() => ({
      pubsub: {
        schedule: vi.fn(() => ({
          onRun: vi.fn((handler: (payload: unknown) => unknown) => handler),
        })),
      },
    })),
  })),
}));

vi.mock('firebase-functions/logger', () => ({
  info: mockLoggerInfo,
  error: mockLoggerError,
  warn: mockLoggerWarn,
}));

vi.mock('firebase-admin', () => ({
  firestore: mockFirestore,
}));

vi.mock('../config', () => ({
  config: {
    cloudtasks: {
      activitySyncQueue: 'processActivitySyncTask',
    },
  },
}));

vi.mock('../utils', () => ({
  enqueueActivitySyncTask: mockEnqueueActivitySyncTask,
  getCloudTaskQueueDepthForQueue: mockGetCloudTaskQueueDepthForQueue,
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: mockGetUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction: mockGetUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
    readonly code = 'unavailable';
    readonly statusCode = 503;

    constructor(
      public readonly uid: string,
      public readonly phase: string,
      public readonly originalError: unknown,
    ) {
      super(`Could not read deletion guard for user ${uid} during ${phase}.`);
    }
  },
}));

import { reconcileActivitySyncQueueDispatches } from './dispatcher';

describe('activity-sync/dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(0);
    mockEnqueueActivitySyncTask.mockResolvedValue(true);
    mockRecursiveDelete.mockResolvedValue(undefined);
    mockGetUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    const queryChain: any = {
      where: mockQueueWhere,
      orderBy: mockQueueOrderBy,
      startAfter: mockQueueStartAfter,
      limit: mockQueueLimit,
      get: mockQueueGet,
    };
    mockQueueCollection.mockReturnValue(queryChain);
    mockQueueWhere.mockReturnValue(queryChain);
    mockQueueOrderBy.mockReturnValue(queryChain);
    mockQueueStartAfter.mockReturnValue(queryChain);
    mockQueueLimit.mockReturnValue(queryChain);
    mockQueueGet.mockResolvedValue({
      empty: true,
      docs: [],
    });
  });

  it('skips reconciliation when Cloud Tasks queue is already at capacity', async () => {
    mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(MAX_PENDING_TASKS);

    const result = await reconcileActivitySyncQueueDispatches(1_700_000_000_000);

    expect(result).toEqual({
      inspected: 0,
      dispatched: 0,
      skippedRecent: 0,
    });
    expect(mockQueueCollection).not.toHaveBeenCalled();
  });

  it('dispatches undispatched and stale queue items and skips recent ones', async () => {
    const nowMs = 1_700_000_000_000;
    const updateUndispatched = vi.fn().mockResolvedValue(undefined);
    const updateStale = vi.fn().mockResolvedValue(undefined);
    const updateRecent = vi.fn().mockResolvedValue(undefined);

    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'recent-item',
          data: () => ({ dispatchedToCloudTask: nowMs - (10 * 60 * 1000), dateCreated: 100, userID: 'recent-user' }),
          ref: { update: updateRecent },
        },
        {
          id: 'undispatched-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 101, userID: 'undispatched-user' }),
          ref: { update: updateUndispatched },
        },
        {
          id: 'stale-item',
          data: () => ({ dispatchedToCloudTask: nowMs - (3 * 60 * 60 * 1000), dateCreated: 102, userID: 'stale-user' }),
          ref: { update: updateStale },
        },
      ],
    });

    const result = await reconcileActivitySyncQueueDispatches(nowMs);

    expect(result).toEqual({
      inspected: 3,
      dispatched: 2,
      skippedRecent: 1,
    });
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledTimes(2);
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith('undispatched-item', 101);
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith('stale-item', 102);
    expect(updateUndispatched).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
    expect(updateStale).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
    expect(updateRecent).not.toHaveBeenCalled();
  });

  it('continues processing other candidates when dispatching one item fails', async () => {
    const nowMs = 1_700_000_000_000;
    const updateFirst = vi.fn().mockResolvedValue(undefined);
    const updateSecond = vi.fn().mockResolvedValue(undefined);
    mockEnqueueActivitySyncTask
      .mockRejectedValueOnce(new Error('task creation failed'))
      .mockResolvedValueOnce(true);
    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'first-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 201, userID: 'first-user' }),
          ref: { update: updateFirst },
        },
        {
          id: 'second-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 202, userID: 'second-user' }),
          ref: { update: updateSecond },
        },
      ],
    });

    const result = await reconcileActivitySyncQueueDispatches(nowMs);

    expect(result).toEqual({
      inspected: 2,
      dispatched: 1,
      skippedRecent: 0,
    });
    expect(updateFirst).not.toHaveBeenCalled();
    expect(updateSecond).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('does not mark queue item as dispatched when Cloud Task enqueue returns false', async () => {
    const nowMs = 1_700_000_000_000;
    const updateUndispatched = vi.fn().mockResolvedValue(undefined);
    mockEnqueueActivitySyncTask.mockResolvedValueOnce(false);
    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'undispatched-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 301, userID: 'undispatched-user' }),
          ref: { update: updateUndispatched },
        },
      ],
    });

    const result = await reconcileActivitySyncQueueDispatches(nowMs);

    expect(result).toEqual({
      inspected: 1,
      dispatched: 0,
      skippedRecent: 0,
    });
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith('undispatched-item', 301);
    expect(updateUndispatched).not.toHaveBeenCalled();
  });

  it('does not write the dispatch marker when deletion starts after Cloud Task enqueue', async () => {
    const nowMs = 1_700_000_000_000;
    const updateUndispatched = vi.fn().mockResolvedValue(undefined);
    const itemRef = { update: updateUndispatched, path: 'activitySyncQueue/undispatched-item' };
    mockGetUserDeletionGuardState
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      });
    mockGetUserDeletionGuardStateInTransaction
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: true,
        shouldSkip: true,
      });
    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'undispatched-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 301, userID: 'undispatched-user' }),
          ref: itemRef,
        },
      ],
    });

    const result = await reconcileActivitySyncQueueDispatches(nowMs);

    expect(result).toEqual({
      inspected: 1,
      dispatched: 0,
      skippedRecent: 0,
    });
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith('undispatched-item', 301);
    expect(mockRecursiveDelete).toHaveBeenCalledWith(itemRef);
    expect(updateUndispatched).not.toHaveBeenCalled();
  });

  it('paginates a stable queue window so older undispatched items outside the first page still dispatch', async () => {
    const nowMs = 1_700_000_000_000;
    const recentDispatchedAt = nowMs - (10 * 60 * 1000);
    const firstPageRecentDocs = Array.from({ length: 100 }, (_, index) => ({
      id: `recent-item-${index}`,
      data: () => ({ dispatchedToCloudTask: recentDispatchedAt, dateCreated: index, userID: `recent-user-${index}` }),
      ref: { update: vi.fn().mockResolvedValue(undefined) },
    }));
    const updateOlderUndispatched = vi.fn().mockResolvedValue(undefined);
    const olderUndispatchedDoc = {
      id: 'older-undispatched-item',
      data: () => ({ dispatchedToCloudTask: null, dateCreated: 999, userID: 'older-undispatched-user' }),
      ref: { update: updateOlderUndispatched },
    };

    mockQueueGet
      .mockResolvedValueOnce({
        empty: false,
        docs: firstPageRecentDocs,
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [olderUndispatchedDoc],
      });

    const result = await reconcileActivitySyncQueueDispatches(nowMs);

    expect(result).toEqual({
      inspected: 101,
      dispatched: 1,
      skippedRecent: 100,
    });
    expect(mockQueueOrderBy).toHaveBeenCalledWith('dateCreated', 'asc');
    expect(mockQueueStartAfter).toHaveBeenCalled();
    expect(mockQueueGet).toHaveBeenCalledTimes(2);
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith('older-undispatched-item', 999);
    expect(updateOlderUndispatched).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
  });

  it('deletes user-owned queue items instead of dispatching when account deletion is active', async () => {
    const nowMs = 1_700_000_000_000;
    const updateDeleted = vi.fn().mockResolvedValue(undefined);
    const deletedRef = { update: updateDeleted, path: 'activitySyncQueue/deleted-user-item' };
    mockGetUserDeletionGuardState.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });
    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'deleted-user-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 401, userID: 'deleted-user-id' }),
          ref: deletedRef,
        },
      ],
    });

    const result = await reconcileActivitySyncQueueDispatches(nowMs);

    expect(result).toEqual({
      inspected: 1,
      dispatched: 0,
      skippedRecent: 0,
    });
    expect(mockGetUserDeletionGuardState).toHaveBeenCalledWith(expect.anything(), 'deleted-user-id');
    expect(mockRecursiveDelete).toHaveBeenCalledWith(deletedRef);
    expect(mockEnqueueActivitySyncTask).not.toHaveBeenCalled();
    expect(updateDeleted).not.toHaveBeenCalled();
  });

  it('deletes malformed queue items without a userID instead of dispatching them', async () => {
    const nowMs = 1_700_000_000_000;
    const updateMalformed = vi.fn().mockResolvedValue(undefined);
    const malformedRef = { update: updateMalformed, path: 'activitySyncQueue/malformed-item' };
    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'malformed-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 601 }),
          ref: malformedRef,
        },
      ],
    });

    const result = await reconcileActivitySyncQueueDispatches(nowMs);

    expect(result).toEqual({
      inspected: 1,
      dispatched: 0,
      skippedRecent: 0,
    });
    expect(mockGetUserDeletionGuardState).not.toHaveBeenCalled();
    expect(mockRecursiveDelete).toHaveBeenCalledWith(malformedRef);
    expect(mockEnqueueActivitySyncTask).not.toHaveBeenCalled();
    expect(updateMalformed).not.toHaveBeenCalled();
  });

  it('leaves an item undispatched when deletion guard lookup fails and continues with other candidates', async () => {
    const nowMs = 1_700_000_000_000;
    const updateGuardFailure = vi.fn().mockResolvedValue(undefined);
    const updateHealthy = vi.fn().mockResolvedValue(undefined);
    mockGetUserDeletionGuardState
      .mockRejectedValueOnce(new Error('guard unavailable'))
      .mockResolvedValueOnce({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
      });
    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'guard-failure-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 501, userID: 'guard-failure-user' }),
          ref: { update: updateGuardFailure },
        },
        {
          id: 'healthy-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 502, userID: 'healthy-user' }),
          ref: { update: updateHealthy },
        },
      ],
    });

    const result = await reconcileActivitySyncQueueDispatches(nowMs);

    expect(result).toEqual({
      inspected: 2,
      dispatched: 1,
      skippedRecent: 0,
    });
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledTimes(1);
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith('healthy-item', 502);
    expect(updateGuardFailure).not.toHaveBeenCalled();
    expect(updateHealthy).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
    expect(mockLoggerError).toHaveBeenCalledWith(
      '[ActivitySyncDispatcher] Failed to check deletion guard for queue item guard-failure-item and user guard-failure-user; leaving item undispatched for a future run.',
      expect.any(Error),
    );
  });
});
