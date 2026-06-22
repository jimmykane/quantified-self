import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { QUEUE_DEFERRED_REASONS } from '../queue-utils';
import { TTL_CONFIG } from '../shared/ttl-config';

const hoisted = vi.hoisted(() => {
    type Filter = { field: string; value: unknown };
    type StoredDoc = {
        id: string;
        data: Record<string, unknown>;
        update: ReturnType<typeof vi.fn>;
    };

    const collections = new Map<string, StoredDoc[]>();
    const deleteSentinel = { delete: true };
    const timestampFromDate = vi.fn((date: Date) => date);

    const makeQuery = (collectionName: string, filters: Filter[] = []) => ({
        where: vi.fn((field: string, operator: string, value: unknown) => {
            if (operator !== '==') {
                throw new Error(`Unexpected operator ${operator}`);
            }
            return makeQuery(collectionName, [...filters, { field, value }]);
        }),
        get: vi.fn(async () => {
            const docs = (collections.get(collectionName) || [])
                .filter((doc) => filters.every((filter) => doc.data[filter.field] === filter.value))
                .map((doc) => ({
                    id: doc.id,
                    data: () => doc.data,
                    ref: {
                        path: `${collectionName}/${doc.id}`,
                        update: doc.update,
                    },
                }));

            return {
                empty: docs.length === 0,
                docs,
            };
        }),
    });

    return {
        collections,
        deleteSentinel,
        timestampFromDate,
        collection: vi.fn((collectionName: string) => makeQuery(collectionName)),
        loggerInfo: vi.fn(),
        loggerError: vi.fn(),
    };
});

vi.mock('firebase-admin', () => {
    const firestore = Object.assign(() => ({
        collection: hoisted.collection,
    }), {
        FieldValue: {
            delete: vi.fn(() => hoisted.deleteSentinel),
        },
        Timestamp: {
            fromDate: hoisted.timestampFromDate,
        },
    });

    return {
        default: { firestore },
        firestore,
    };
});

vi.mock('firebase-functions/logger', () => ({
    info: hoisted.loggerInfo,
    error: hoisted.loggerError,
}));

import { releaseQueueItemsDeferredForPendingDisconnect } from './pending-disconnect-release';

describe('pending disconnect queue release', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.collections.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function addDoc(collectionName: string, id: string, data: Record<string, unknown>): ReturnType<typeof vi.fn> {
        const update = vi.fn().mockResolvedValue(undefined);
        const docs = hoisted.collections.get(collectionName) || [];
        docs.push({ id, data, update });
        hoisted.collections.set(collectionName, docs);
        return update;
    }

    it('releases deferred queue items for the restored service without touching other services', async () => {
        const nowMs = 1_782_126_100_000;
        vi.spyOn(Date, 'now').mockReturnValue(nowMs);
        const deferredReason = QUEUE_DEFERRED_REASONS.ServiceDisconnectPending;
        const workoutUpdate = addDoc(getServiceWorkoutQueueName(ServiceNames.SuuntoApp), 'workout-1', {
            firebaseUserID: 'user-1',
            deferredReason,
        });
        const activityUpdate = addDoc(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, 'activity-1', {
            userID: 'user-1',
            deferredReason,
            deferredServiceName: ServiceNames.SuuntoApp,
        });
        const otherActivityUpdate = addDoc(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, 'activity-2', {
            userID: 'user-1',
            deferredReason,
            deferredServiceName: ServiceNames.GarminAPI,
        });
        const sleepUpdate = addDoc(SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'sleep-1', {
            userID: 'user-1',
            provider: SLEEP_PROVIDERS.SuuntoApp,
            deferredReason,
        });
        const notDeferredSleepUpdate = addDoc(SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'sleep-2', {
            userID: 'user-1',
            provider: SLEEP_PROVIDERS.SuuntoApp,
        });

        const releasedCount = await releaseQueueItemsDeferredForPendingDisconnect('user-1', ServiceNames.SuuntoApp);

        expect(releasedCount).toBe(3);
        for (const update of [workoutUpdate, activityUpdate, sleepUpdate]) {
            expect(update).toHaveBeenCalledWith(expect.objectContaining({
                processed: false,
                dispatchedToCloudTask: null,
                expireAt: new Date(nowMs + TTL_CONFIG.QUEUE_ITEM_IN_DAYS * 24 * 60 * 60 * 1000),
                resultStatus: hoisted.deleteSentinel,
                deferredReason: hoisted.deleteSentinel,
                serviceDisconnectPendingDeferredAt: hoisted.deleteSentinel,
            }));
        }
        expect(otherActivityUpdate).not.toHaveBeenCalled();
        expect(notDeferredSleepUpdate).not.toHaveBeenCalled();
    });
});
