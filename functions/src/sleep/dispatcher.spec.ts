import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PENDING_TASKS } from '../shared/queue-config';

const {
    mockLoggerError,
    mockLoggerInfo,
    mockGetCloudTaskQueueDepthForQueue,
    mockEnqueueSleepSyncTask,
    mockQueueCollection,
    mockQueueGet,
    mockQueueLimit,
    mockQueueOrderBy,
    mockQueueStartAfter,
    mockQueueWhere,
    mockFirestore,
} = vi.hoisted(() => {
    const mockLoggerError = vi.fn();
    const mockLoggerInfo = vi.fn();
    const mockGetCloudTaskQueueDepthForQueue = vi.fn();
    const mockEnqueueSleepSyncTask = vi.fn();
    const mockQueueCollection = vi.fn();
    const mockQueueGet = vi.fn();
    const mockQueueLimit = vi.fn();
    const mockQueueOrderBy = vi.fn();
    const mockQueueStartAfter = vi.fn();
    const mockQueueWhere = vi.fn();
    const mockFirestore = vi.fn(() => ({ collection: mockQueueCollection }));

    return {
        mockLoggerError,
        mockLoggerInfo,
        mockGetCloudTaskQueueDepthForQueue,
        mockEnqueueSleepSyncTask,
        mockQueueCollection,
        mockQueueGet,
        mockQueueLimit,
        mockQueueOrderBy,
        mockQueueStartAfter,
        mockQueueWhere,
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
    error: mockLoggerError,
    info: mockLoggerInfo,
}));

vi.mock('firebase-admin', () => ({
    firestore: mockFirestore,
}));

vi.mock('../config', () => ({
    config: {
        cloudtasks: {
            sleepSyncQueue: 'processSleepSyncTask',
        },
    },
}));

vi.mock('../utils', () => ({
    enqueueSleepSyncTask: mockEnqueueSleepSyncTask,
    getCloudTaskQueueDepthForQueue: mockGetCloudTaskQueueDepthForQueue,
}));

import { reconcileSleepSyncQueueDispatches } from './dispatcher';

describe('sleep/dispatcher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(0);
        mockEnqueueSleepSyncTask.mockResolvedValue(true);

        const queryChain: any = {
            get: mockQueueGet,
            limit: mockQueueLimit,
            orderBy: mockQueueOrderBy,
            startAfter: mockQueueStartAfter,
            where: mockQueueWhere,
        };
        mockQueueCollection.mockReturnValue(queryChain);
        mockQueueWhere.mockReturnValue(queryChain);
        mockQueueOrderBy.mockReturnValue(queryChain);
        mockQueueLimit.mockReturnValue(queryChain);
        mockQueueStartAfter.mockReturnValue(queryChain);
        mockQueueGet.mockResolvedValue({
            empty: true,
            docs: [],
        });
    });

    it('skips reconciliation when the Cloud Tasks queue is already at capacity', async () => {
        mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(MAX_PENDING_TASKS);

        const result = await reconcileSleepSyncQueueDispatches(1_700_000_000_000);

        expect(result).toEqual({
            inspected: 0,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockQueueCollection).not.toHaveBeenCalled();
    });

    it('dispatches undispatched and stale queue items while skipping recently dispatched ones', async () => {
        const nowMs = 1_700_000_000_000;
        const updateRecent = vi.fn().mockResolvedValue(undefined);
        const updateStale = vi.fn().mockResolvedValue(undefined);
        const updateUndispatched = vi.fn().mockResolvedValue(undefined);

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

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 3,
            dispatched: 2,
            skippedRecent: 1,
        });
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('undispatched-item', 101);
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('stale-item', 102);
        expect(updateUndispatched).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
        expect(updateStale).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
        expect(updateRecent).not.toHaveBeenCalled();
    });

    it('paginates past recently dispatched rows so new queue items still dispatch', async () => {
        const nowMs = 1_700_000_000_000;
        const recentDispatchedAt = nowMs - (10 * 60 * 1000);
        const firstPageRecentDocs = Array.from({ length: 100 }, (_, index) => ({
            id: `recent-item-${index}`,
            data: () => ({ dispatchedToCloudTask: recentDispatchedAt, dateCreated: index }),
            ref: { update: vi.fn().mockResolvedValue(undefined) },
        }));
        const updateUndispatched = vi.fn().mockResolvedValue(undefined);
        const undispatchedDoc = {
            id: 'older-undispatched-item',
            data: () => ({ dispatchedToCloudTask: null, dateCreated: 999 }),
            ref: { update: updateUndispatched },
        };

        mockQueueGet
            .mockResolvedValueOnce({
                empty: false,
                docs: firstPageRecentDocs,
            })
            .mockResolvedValueOnce({
                empty: false,
                docs: [undispatchedDoc],
            });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 101,
            dispatched: 1,
            skippedRecent: 100,
        });
        expect(mockQueueOrderBy).toHaveBeenCalledWith('dateCreated', 'asc');
        expect(mockQueueStartAfter).toHaveBeenCalled();
        expect(mockQueueGet).toHaveBeenCalledTimes(2);
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('older-undispatched-item', 999);
        expect(updateUndispatched).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
    });

    it('does not mark queue items as dispatched when Cloud Task enqueue returns false', async () => {
        const nowMs = 1_700_000_000_000;
        const updateUndispatched = vi.fn().mockResolvedValue(undefined);
        mockEnqueueSleepSyncTask.mockResolvedValueOnce(false);
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'undispatched-item',
                    data: () => ({ dispatchedToCloudTask: null, dateCreated: 301 }),
                    ref: { update: updateUndispatched },
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('undispatched-item', 301);
        expect(updateUndispatched).not.toHaveBeenCalled();
        expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('Task not enqueued'));
    });
});
