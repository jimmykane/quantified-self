import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';

const hoisted = vi.hoisted(() => ({
    collectionGroup: vi.fn(),
    collection: vi.fn(),
    collectionGroupGet: vi.fn(),
    metaDocGet: vi.fn(),
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

import { sleepPollingTestInternals } from './polling';
import { addSleepSyncQueueItem } from './queue';

describe('sleep polling', () => {
    afterEach(() => {
        vi.clearAllMocks();
        hoisted.metaDocGet.mockResolvedValue({ exists: false, data: () => undefined });
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
});
