import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockLoggerError,
    mockLoggerWarn,
    mockLoggerInfo,
    mockRecursiveDelete,
    mockRunTransaction,
    mockTransactionUpdate,
    mockGetUserDeletionGuardStateInTransaction,
    mockMarkQueueItemDeletedForUserCleanup,
} = vi.hoisted(() => {
    const mockTransactionUpdate = vi.fn((ref: { update?: (data: unknown) => Promise<void> }, data: unknown) => ref.update?.(data));
    return {
        mockLoggerError: vi.fn(),
        mockLoggerWarn: vi.fn(),
        mockLoggerInfo: vi.fn(),
        mockRecursiveDelete: vi.fn(),
        mockRunTransaction: vi.fn(async (runner: (transaction: { update: typeof mockTransactionUpdate }) => unknown) => runner({
            update: mockTransactionUpdate,
        })),
        mockTransactionUpdate,
        mockGetUserDeletionGuardStateInTransaction: vi.fn(),
        mockMarkQueueItemDeletedForUserCleanup: vi.fn(),
    };
});

vi.mock('firebase-functions/logger', () => ({
    error: mockLoggerError,
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
}));

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => ({
        runTransaction: mockRunTransaction,
        recursiveDelete: mockRecursiveDelete,
    })),
}));

vi.mock('../shared/user-deletion-guard', () => ({
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

vi.mock('./cleanup-tombstone', () => ({
    markQueueItemDeletedForUserCleanup: mockMarkQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS: {
        UserDeletionGuard: 'user_deletion_guard',
    },
}));

import {
    QueueItemUserGuardedUpdateResult,
    updateQueueItemIfUserActive,
} from './dispatch-marker';

describe('queue dispatch marker guarded updates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRecursiveDelete.mockResolvedValue(undefined);
        mockMarkQueueItemDeletedForUserCleanup.mockResolvedValue(true);
        mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        mockRunTransaction.mockImplementation(async (runner: (transaction: { update: typeof mockTransactionUpdate }) => unknown) => runner({
            update: mockTransactionUpdate,
        }));
    });

    it('deletes queue item after deletion guard only when cleanup tombstone is written', async () => {
        mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: false,
            deletionInProgress: false,
            shouldSkip: true,
        });
        const queueItemDocument = {
            parent: { id: 'sleepSyncQueue' },
            update: vi.fn(),
        };

        const result = await updateQueueItemIfUserActive({
            queueItemDocument: queueItemDocument as any,
            queueItemId: 'sleep-item-1',
            userID: 'deleted-user',
            phase: 'sleep_sync_dispatch_marker',
            updateData: { dispatchedToCloudTask: 123 },
            logPrefix: 'SleepSync',
            actionDescription: 'dispatch marker write',
        });

        expect(result).toBe(QueueItemUserGuardedUpdateResult.SkippedDeletedUser);
        expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'sleep-item-1',
            'user_deletion_guard',
        );
        expect(mockRecursiveDelete).toHaveBeenCalledWith(queueItemDocument);
    });

    it('preserves queue item when cleanup tombstone write fails after deletion guard trips', async () => {
        mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: false,
            deletionInProgress: false,
            shouldSkip: true,
        });
        mockMarkQueueItemDeletedForUserCleanup.mockResolvedValueOnce(false);
        const queueItemDocument = {
            parent: { id: 'sleepSyncQueue' },
            update: vi.fn(),
        };

        const result = await updateQueueItemIfUserActive({
            queueItemDocument: queueItemDocument as any,
            queueItemId: 'sleep-item-1',
            userID: 'deleted-user',
            phase: 'sleep_sync_dispatch_marker',
            updateData: { dispatchedToCloudTask: 123 },
            logPrefix: 'SleepSync',
            actionDescription: 'dispatch marker write',
        });

        expect(result).toBe(QueueItemUserGuardedUpdateResult.SkippedDeletedUser);
        expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'sleep-item-1',
            'user_deletion_guard',
        );
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
        expect(mockLoggerError).toHaveBeenCalledWith(
            '[SleepSync] Failed to write cleanup tombstone for queue item sleep-item-1; leaving item in place to avoid missing-doc Cloud Task retries.',
        );
    });
});
