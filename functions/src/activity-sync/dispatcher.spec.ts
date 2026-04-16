import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PENDING_TASKS } from '../shared/queue-config';

const {
  mockLoggerInfo,
  mockLoggerError,
  mockGetCloudTaskQueueDepthForQueue,
  mockEnqueueActivitySyncTask,
  mockQueueGet,
  mockQueueWhere,
  mockQueueOrderBy,
  mockQueueStartAfter,
  mockQueueLimit,
  mockQueueCollection,
  mockFirestore,
} = vi.hoisted(() => {
  const mockLoggerInfo = vi.fn();
  const mockLoggerError = vi.fn();
  const mockGetCloudTaskQueueDepthForQueue = vi.fn();
  const mockEnqueueActivitySyncTask = vi.fn();
  const mockQueueGet = vi.fn();
  const mockQueueWhere = vi.fn();
  const mockQueueOrderBy = vi.fn();
  const mockQueueStartAfter = vi.fn();
  const mockQueueLimit = vi.fn();
  const mockQueueCollection = vi.fn();
  const mockFirestore = vi.fn(() => ({ collection: mockQueueCollection }));

  return {
    mockLoggerInfo,
    mockLoggerError,
    mockGetCloudTaskQueueDepthForQueue,
    mockEnqueueActivitySyncTask,
    mockQueueGet,
    mockQueueWhere,
    mockQueueOrderBy,
    mockQueueStartAfter,
    mockQueueLimit,
    mockQueueCollection,
    mockFirestore,
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
      activitySyncQueue: 'processActivitySyncTask',
    },
  },
}));

vi.mock('../utils', () => ({
  enqueueActivitySyncTask: mockEnqueueActivitySyncTask,
  getCloudTaskQueueDepthForQueue: mockGetCloudTaskQueueDepthForQueue,
}));

import { reconcileActivitySyncQueueDispatches } from './dispatcher';

describe('activity-sync/dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(0);
    mockEnqueueActivitySyncTask.mockResolvedValue(true);
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
          data: () => ({ dispatchedToCloudTask: nowMs - (10 * 60 * 1000), dateCreated: 100 }),
          ref: { update: updateRecent },
        },
        {
          id: 'undispatched-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 101 }),
          ref: { update: updateUndispatched },
        },
        {
          id: 'stale-item',
          data: () => ({ dispatchedToCloudTask: nowMs - (3 * 60 * 60 * 1000), dateCreated: 102 }),
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
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 201 }),
          ref: { update: updateFirst },
        },
        {
          id: 'second-item',
          data: () => ({ dispatchedToCloudTask: null, dateCreated: 202 }),
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

  it('paginates a stable queue window so older undispatched items outside the first page still dispatch', async () => {
    const nowMs = 1_700_000_000_000;
    const recentDispatchedAt = nowMs - (10 * 60 * 1000);
    const firstPageRecentDocs = Array.from({ length: 100 }, (_, index) => ({
      id: `recent-item-${index}`,
      data: () => ({ dispatchedToCloudTask: recentDispatchedAt, dateCreated: index }),
      ref: { update: vi.fn().mockResolvedValue(undefined) },
    }));
    const updateOlderUndispatched = vi.fn().mockResolvedValue(undefined);
    const olderUndispatchedDoc = {
      id: 'older-undispatched-item',
      data: () => ({ dispatchedToCloudTask: null, dateCreated: 999 }),
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
});
