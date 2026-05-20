import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockCollection,
    mockDoc,
    mockSet,
    mockGet,
    mockServerTimestamp,
    mockFromDate,
} = vi.hoisted(() => ({
    mockCollection: vi.fn(),
    mockDoc: vi.fn(),
    mockSet: vi.fn(),
    mockGet: vi.fn(),
    mockServerTimestamp: vi.fn(() => 'server-timestamp'),
    mockFromDate: vi.fn((date: Date) => ({ toDate: () => date })),
}));

vi.mock('firebase-admin', () => {
    const firestore = Object.assign(() => ({
        collection: mockCollection,
    }), {
        FieldValue: {
            serverTimestamp: mockServerTimestamp,
        },
        Timestamp: {
            fromDate: mockFromDate,
        },
    });

    return {
        firestore,
    };
});

vi.mock('firebase-functions/logger', () => ({
    error: vi.fn(),
}));

import {
    isQueueItemDeletedForUserCleanup,
    markQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from './cleanup-tombstone';

describe('queue cleanup tombstones', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCollection.mockReturnValue({ doc: mockDoc });
        mockDoc.mockReturnValue({ set: mockSet, get: mockGet });
        mockSet.mockResolvedValue(undefined);
        mockGet.mockResolvedValue({ exists: false });
    });

    it('stores tombstones with encoded deterministic ids', async () => {
        await expect(
            markQueueItemDeletedForUserCleanup(
                'sleepSyncQueue',
                'provider/user:item_1',
                QUEUE_CLEANUP_TOMBSTONE_REASONS.AccountDeletionCleanup,
            ),
        ).resolves.toBe(true);

        expect(mockCollection).toHaveBeenCalledWith('queueCleanupTombstones');
        expect(mockDoc).toHaveBeenCalledWith('sleepSyncQueue__provider%2Fuser%3Aitem_1');
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            queueItemId: 'provider/user:item_1',
            reason: 'account_deletion_cleanup',
            deletedAt: 'server-timestamp',
        }), { merge: true });
    });

    it('matches tombstones only when the stored collection matches', async () => {
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ originalCollection: 'sleepSyncQueue' }),
        });
        await expect(isQueueItemDeletedForUserCleanup('sleepSyncQueue', 'item-1')).resolves.toBe(true);

        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ originalCollection: 'activitySyncQueue' }),
        });
        await expect(isQueueItemDeletedForUserCleanup('sleepSyncQueue', 'item-1')).resolves.toBe(false);
    });
});
