import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PENDING_TASKS } from '../shared/queue-config';

interface QueueQueryChainMock {
  where: typeof mockQueueWhere;
  orderBy: typeof mockQueueOrderBy;
  startAfter: typeof mockQueueStartAfter;
  limit: typeof mockQueueLimit;
  get: typeof mockQueueGet;
}

const {
  mockLoggerInfo,
  mockLoggerError,
  mockGetCloudTaskQueueDepthForQueue,
  mockEnqueueRouteDeliverySyncTask,
  mockQueueGet,
  mockQueueWhere,
  mockQueueOrderBy,
  mockQueueStartAfter,
  mockQueueLimit,
  mockQueueCollection,
  mockFirestore,
  mockRecursiveDelete,
  mockGetUserDeletionGuardState,
  mockMarkQueueItemDispatchedIfUserActive,
  mockMarkQueueItemDeletedForUserCleanup,
} = vi.hoisted(() => {
  const mockLoggerInfo = vi.fn();
  const mockLoggerError = vi.fn();
  const mockGetCloudTaskQueueDepthForQueue = vi.fn();
  const mockEnqueueRouteDeliverySyncTask = vi.fn();
  const mockQueueGet = vi.fn();
  const mockQueueWhere = vi.fn();
  const mockQueueOrderBy = vi.fn();
  const mockQueueStartAfter = vi.fn();
  const mockQueueLimit = vi.fn();
  const mockQueueCollection = vi.fn();
  const mockRecursiveDelete = vi.fn();
  const mockFirestore = vi.fn(() => ({
    collection: mockQueueCollection,
    recursiveDelete: mockRecursiveDelete,
  }));
  return {
    mockLoggerInfo,
    mockLoggerError,
    mockGetCloudTaskQueueDepthForQueue,
    mockEnqueueRouteDeliverySyncTask,
    mockQueueGet,
    mockQueueWhere,
    mockQueueOrderBy,
    mockQueueStartAfter,
    mockQueueLimit,
    mockQueueCollection,
    mockFirestore,
    mockRecursiveDelete,
    mockGetUserDeletionGuardState: vi.fn(),
    mockMarkQueueItemDispatchedIfUserActive: vi.fn(),
    mockMarkQueueItemDeletedForUserCleanup: vi.fn(),
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
}));

vi.mock('firebase-admin', () => ({
  firestore: mockFirestore,
}));

vi.mock('../config', () => ({
  config: {
    cloudtasks: {
      routeDeliverySyncQueue: 'processRouteDeliverySyncTask',
    },
  },
}));

vi.mock('../utils', () => ({
  enqueueRouteDeliverySyncTask: mockEnqueueRouteDeliverySyncTask,
  getCloudTaskQueueDepthForQueue: mockGetCloudTaskQueueDepthForQueue,
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: mockGetUserDeletionGuardState,
}));

vi.mock('../queue/dispatch-marker', () => ({
  QueueDispatchMarkerResult: {
    Marked: 'MARKED',
    Skipped: 'SKIPPED',
    Missing: 'MISSING',
  },
  markQueueItemDispatchedIfUserActive: mockMarkQueueItemDispatchedIfUserActive,
}));

vi.mock('../queue/cleanup-tombstone', () => ({
  markQueueItemDeletedForUserCleanup: mockMarkQueueItemDeletedForUserCleanup,
  QUEUE_CLEANUP_TOMBSTONE_REASONS: {
    DispatcherCleanup: 'dispatcher_cleanup',
  },
}));

import { reconcileRouteDeliverySyncQueueDispatches } from './dispatcher';

describe('route-delivery-sync/dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(0);
    mockEnqueueRouteDeliverySyncTask.mockResolvedValue(true);
    mockRecursiveDelete.mockResolvedValue(undefined);
    mockMarkQueueItemDeletedForUserCleanup.mockResolvedValue(true);
    mockGetUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    mockMarkQueueItemDispatchedIfUserActive.mockResolvedValue('MARKED');
    const queryChain: QueueQueryChainMock = {
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
    mockQueueGet.mockResolvedValue({ empty: true, docs: [] });
  });

  it('skips reconciliation when Cloud Tasks queue is already at capacity', async () => {
    mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(MAX_PENDING_TASKS);

    const result = await reconcileRouteDeliverySyncQueueDispatches(1_700_000_000_000);

    expect(result).toEqual({ inspected: 0, dispatched: 0, skippedRecent: 0 });
    expect(mockQueueCollection).not.toHaveBeenCalled();
  });

  it('paginates a stable oldest-first queue window and dispatches older undispatched items outside the first page', async () => {
    const nowMs = 1_700_000_000_000;
    const recentDispatchedAt = nowMs - (10 * 60 * 1000);
    const firstPageRecentDocs = Array.from({ length: 100 }, (_, index) => ({
      id: `recent-item-${index}`,
      data: () => ({ dispatchedToCloudTask: recentDispatchedAt, dateCreated: index, userID: `recent-user-${index}` }),
      ref: { path: `routeDeliverySyncQueue/recent-item-${index}` },
    }));
    const olderUndispatchedDoc = {
      id: 'older-undispatched-item',
      data: () => ({ dispatchedToCloudTask: null, dateCreated: 999, userID: 'older-undispatched-user' }),
      ref: { path: 'routeDeliverySyncQueue/older-undispatched-item' },
    };

    mockQueueGet
      .mockResolvedValueOnce({ empty: false, docs: firstPageRecentDocs })
      .mockResolvedValueOnce({ empty: false, docs: [olderUndispatchedDoc] });

    const result = await reconcileRouteDeliverySyncQueueDispatches(nowMs);

    expect(result).toEqual({ inspected: 101, dispatched: 1, skippedRecent: 100 });
    expect(mockQueueWhere).toHaveBeenCalledWith('processed', '==', false);
    expect(mockQueueOrderBy).toHaveBeenCalledWith('dateCreated', 'asc');
    expect(mockQueueStartAfter).toHaveBeenCalledWith(firstPageRecentDocs[99]);
    expect(mockEnqueueRouteDeliverySyncTask).toHaveBeenCalledWith('older-undispatched-item', 999);
    expect(mockMarkQueueItemDispatchedIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItemId: 'older-undispatched-item',
      userID: 'older-undispatched-user',
      dispatchedAtMs: nowMs,
      logPrefix: 'RouteDeliverySyncDispatcher',
    }));
  });

  it('does not mark queue item as dispatched when Cloud Task enqueue returns false', async () => {
    const nowMs = 1_700_000_000_000;
    mockEnqueueRouteDeliverySyncTask.mockResolvedValueOnce(false);
    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [{
        id: 'undispatched-item',
        data: () => ({ dispatchedToCloudTask: null, dateCreated: 301, userID: 'undispatched-user' }),
        ref: { path: 'routeDeliverySyncQueue/undispatched-item' },
      }],
    });

    const result = await reconcileRouteDeliverySyncQueueDispatches(nowMs);

    expect(result).toEqual({ inspected: 1, dispatched: 0, skippedRecent: 0 });
    expect(mockEnqueueRouteDeliverySyncTask).toHaveBeenCalledWith('undispatched-item', 301);
    expect(mockMarkQueueItemDispatchedIfUserActive).not.toHaveBeenCalled();
  });

  it('deletes user-owned queue items instead of dispatching when account deletion is active', async () => {
    const nowMs = 1_700_000_000_000;
    const deletedRef = { path: 'routeDeliverySyncQueue/deleted-user-item' };
    mockGetUserDeletionGuardState.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });
    mockQueueGet.mockResolvedValue({
      empty: false,
      docs: [{
        id: 'deleted-user-item',
        data: () => ({ dispatchedToCloudTask: null, dateCreated: 401, userID: 'deleted-user-id' }),
        ref: deletedRef,
      }],
    });

    const result = await reconcileRouteDeliverySyncQueueDispatches(nowMs);

    expect(result).toEqual({ inspected: 1, dispatched: 0, skippedRecent: 0 });
    expect(mockGetUserDeletionGuardState).toHaveBeenCalledWith(expect.anything(), 'deleted-user-id');
    expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'routeDeliverySyncQueue',
      'deleted-user-item',
      'dispatcher_cleanup',
    );
    expect(mockRecursiveDelete).toHaveBeenCalledWith(deletedRef);
    expect(mockEnqueueRouteDeliverySyncTask).not.toHaveBeenCalled();
    expect(mockMarkQueueItemDispatchedIfUserActive).not.toHaveBeenCalled();
  });
});
