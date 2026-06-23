import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';

const hoisted = vi.hoisted(() => ({
    collectionGroup: vi.fn(),
    collection: vi.fn(),
    collectionGroupGet: vi.fn(),
    metaDocGet: vi.fn(),
    mockGetUserDeletionGuardState: vi.fn(),
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: vi.fn((_options: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => ({
        collectionGroup: hoisted.collectionGroup,
        collection: hoisted.collection,
    })),
}));

vi.mock('./queue', () => ({
    addSleepSyncQueueItem: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.mockGetUserDeletionGuardState,
}));

import { sleepPollingTestInternals } from './polling';
import { addSleepSyncQueueItem } from './queue';
import * as logger from 'firebase-functions/logger';

describe('sleep polling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.metaDocGet.mockResolvedValue({ exists: false, data: () => undefined });
        hoisted.mockGetUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
    });

    function createTokenDoc(userID: string, data: Record<string, unknown>) {
        return {
            data: () => data,
            ref: {
                parent: {
                    parent: {
                        id: userID,
                    },
                },
            },
        };
    }

    function installCollectionGroupTokenMock(docs: unknown[]) {
        hoisted.collectionGroupGet.mockResolvedValue({ docs });
        hoisted.collectionGroup.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: hoisted.collectionGroupGet,
        });
        hoisted.collection.mockImplementation((name: string) => {
            if (name !== 'users') {
                return undefined;
            }
            return {
                doc: vi.fn(() => ({
                    collection: vi.fn(() => ({
                        doc: vi.fn(() => ({
                            get: hoisted.metaDocGet,
                        })),
                    })),
                })),
            };
        });
    }

    it('chunks recent polling windows by provider API maximum range', () => {
        const dayMs = 24 * 60 * 60 * 1000;
        const nowMs = Date.UTC(2026, 3, 28);

        const windows = sleepPollingTestInternals.chunkRecentWindow(nowMs, 70, 30);

        expect(windows).toEqual([
            { startMs: nowMs - (70 * dayMs), endMs: nowMs - (40 * dayMs) },
            { startMs: nowMs - (40 * dayMs), endMs: nowMs - (10 * dayMs) },
            { startMs: nowMs - (10 * dayMs), endMs: nowMs },
        ]);
    });

    it('skips polling for disabled sleep providers', async () => {
        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.COROSAPI,
            ServiceNames.COROSAPI,
            30,
            Date.UTC(2026, 3, 28),
        );

        expect(queued).toBe(0);
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('queries all Suunto token docs when sleep sync is open to all users', async () => {
        const userID = 'suunto-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
        ]);

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(hoisted.collectionGroup).toHaveBeenCalledWith('tokens');
        expect(hoisted.collection).toHaveBeenCalledWith('users');
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'suunto_poll',
            provider: SLEEP_PROVIDERS.SuuntoApp,
            userID,
            providerUserId: 'suunto-user-1',
        }));
    });

    it('skips users marked reconnect_required in service meta', async () => {
        const userID = 'suunto-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
        ]);
        hoisted.metaDocGet.mockResolvedValue({
            exists: true,
            data: () => ({ connectionState: 'reconnect_required' }),
        });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(0);
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('skips polling when user deletion is in progress', async () => {
        const userID = 'suunto-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
        ]);
        hoisted.mockGetUserDeletionGuardState.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(0);
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('skips polling when the user document is missing', async () => {
        const userID = 'suunto-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
        ]);
        hoisted.mockGetUserDeletionGuardState.mockResolvedValueOnce({
            userExists: false,
            deletionInProgress: false,
            shouldSkip: true,
        });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(0);
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('continues polling other users when deletion guard lookup fails for one user', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc('suunto-user-id-1', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
            createTokenDoc('suunto-user-id-2', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-2',
            }),
        ]);
        hoisted.mockGetUserDeletionGuardState
            .mockRejectedValueOnce(new Error('guard read failed'))
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID: 'suunto-user-id-2',
        }));
        expect(logger.warn).toHaveBeenCalledWith(
            '[SleepSync][SuuntoApp] Failed to read deletion guard for user suunto-user-id-1; skipping sleep polling for this user.',
            expect.any(Error),
        );
    });

    it('continues polling when reconnect state lookup fails for one user', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc('suunto-user-id-1', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
            createTokenDoc('suunto-user-id-2', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-2',
            }),
        ]);
        hoisted.metaDocGet
            .mockRejectedValueOnce(new Error('meta read failed'))
            .mockResolvedValueOnce({ exists: false, data: () => undefined });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(2);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(
            '[SleepSync][SuuntoApp] Failed to read service connection state for user suunto-user-id-1 and service suuntoApp; continuing sleep polling.',
            expect.any(Error),
        );
    });

    it('stops queueing windows for a user when deletion starts after a queue write', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc('suunto-user-id-1', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
            createTokenDoc('suunto-user-id-2', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-2',
            }),
        ]);
        vi.mocked(addSleepSyncQueueItem)
            .mockRejectedValueOnce(Object.assign(new Error('deleted mid-enqueue'), {
                name: 'ProviderQueueUserDeletedOrDeletingError',
            }))
            .mockResolvedValue({} as any);

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(addSleepSyncQueueItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
            userID: 'suunto-user-id-1',
        }));
        expect(addSleepSyncQueueItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
            userID: 'suunto-user-id-2',
        }));
        expect(logger.info).toHaveBeenCalledWith(
            '[SleepSync][SuuntoApp] Stopped queueing polls for user suunto-user-id-1 because deletion started during queue creation.',
        );
    });
});
