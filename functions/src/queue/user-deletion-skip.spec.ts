import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
    getUserDeletionGuardState: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => ({ firestore: 'db' })),
}));

vi.mock('firebase-functions/logger', () => ({
    warn: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
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

import { shouldSkipQueueWorkForDeletedUser } from './user-deletion-skip';

describe('queue/user-deletion-skip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
    });

    it('does not skip when the user exists and no tombstone is active', async () => {
        await expect(shouldSkipQueueWorkForDeletedUser(
            'user-1',
            ServiceNames.SuuntoApp,
            'queue-1',
            'before_event_write',
        )).resolves.toBe(false);
    });

    it('skips when the user is missing or deletion is in progress', async () => {
        hoisted.getUserDeletionGuardState.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        await expect(shouldSkipQueueWorkForDeletedUser(
            'user-1',
            ServiceNames.SuuntoApp,
            'queue-1',
            'before_event_write',
        )).resolves.toBe(true);
    });

    it('wraps deletion guard read failures as retryable unavailable errors', async () => {
        hoisted.getUserDeletionGuardState.mockRejectedValueOnce(new Error('Firestore unavailable'));

        await expect(shouldSkipQueueWorkForDeletedUser(
            'user-1',
            ServiceNames.SuuntoApp,
            'queue-1',
            'before_event_write',
        )).rejects.toMatchObject({
            name: 'UserDeletionGuardReadError',
            code: 'unavailable',
            statusCode: 503,
            uid: 'user-1',
            phase: 'before_event_write',
        });
    });
});
