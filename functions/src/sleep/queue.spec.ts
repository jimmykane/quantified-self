import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueResult } from '../queue-utils';
import { SLEEP_SYNC_DISABLED_PROVIDERS_ENV } from './provider-flags';

const hoisted = vi.hoisted(() => ({
    docSet: vi.fn(),
    docUpdate: vi.fn(),
    docIdValues: [] as string[],
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
    Timestamp: {
        fromDate: (date: Date) => ({ date }),
    },
}));

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: vi.fn((name: string) => ({
            id: name,
            doc: vi.fn((id: string) => {
                hoisted.docIdValues.push(id);
                return {
                    id,
                    parent: { id: name },
                    set: hoisted.docSet,
                    update: hoisted.docUpdate,
                };
            }),
        })),
        collectionGroup: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
        })),
    }));
    Object.assign(firestoreFn, {
        Timestamp: {
            fromDate: (date: Date) => ({ date }),
        },
    });
    return {
        firestore: firestoreFn,
    };
});

import { addSleepSyncQueueItem, processSleepSyncQueueItem } from './queue';

describe('sleep queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV];
        hoisted.docIdValues.length = 0;
        hoisted.docSet.mockResolvedValue(undefined);
    });

    it('uses deterministic queue ids for duplicated webhook or poll payloads', async () => {
        const input = {
            type: 'suunto_webhook' as const,
            provider: 'SuuntoApp' as const,
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
        };

        await addSleepSyncQueueItem(input);
        await addSleepSyncQueueItem(input);

        expect(hoisted.docIdValues).toHaveLength(2);
        expect(hoisted.docIdValues[0]).toBe(hoisted.docIdValues[1]);
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.objectContaining({
            id: hoisted.docIdValues[0],
            processed: false,
            retryCount: 0,
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
        }), { merge: false });
    });

    it('marks disabled provider queue items processed without resolving tokens', async () => {
        process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV] = 'GarminAPI,COROSAPI';
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'garmin-sleep-disabled',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            retryCount: 0,
            type: 'garmin_push',
            payload: { sleeps: [{ summaryId: 'summary-1' }] },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'provider_disabled',
            providerDisabled: true,
            sessionsWritten: 0,
            sessionsSkipped: 0,
        }));
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });
});
