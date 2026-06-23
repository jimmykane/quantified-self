import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from '../routes/route-sync.constants';
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
    const getFailures = new Map<string, Error>();
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
            const getFailure = getFailures.get(collectionName);
            if (getFailure) {
                throw getFailure;
            }

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
        doc: vi.fn((docID: string) => ({
            collection: vi.fn((subcollectionName: string) => makeQuery(`${collectionName}/${docID}/${subcollectionName}`)),
        })),
    });

    return {
        collections,
        getFailures,
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
        hoisted.getFailures.clear();
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

    function addServiceTokenDoc(collectionName: string, userID: string, id: string, data: Record<string, unknown>): ReturnType<typeof vi.fn> {
        return addDoc(`${collectionName}/${userID}/tokens`, id, data);
    }

    function failCollectionGet(collectionName: string, error: Error): void {
        hoisted.getFailures.set(collectionName, error);
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
        const routeSyncUpdate = addDoc(ROUTE_SYNC_QUEUE_COLLECTION_NAME, 'route-1', {
            firebaseUserID: 'user-1',
            sourceServiceName: ServiceNames.SuuntoApp,
            deferredReason,
        });
        const notDeferredSleepUpdate = addDoc(SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'sleep-2', {
            userID: 'user-1',
            provider: SLEEP_PROVIDERS.SuuntoApp,
        });
        const otherRouteSyncUpdate = addDoc(ROUTE_SYNC_QUEUE_COLLECTION_NAME, 'route-2', {
            firebaseUserID: 'user-1',
            sourceServiceName: ServiceNames.GarminAPI,
            deferredReason,
        });

        const releasedCount = await releaseQueueItemsDeferredForPendingDisconnect('user-1', ServiceNames.SuuntoApp);

        expect(releasedCount).toBe(4);
        for (const update of [workoutUpdate, activityUpdate, sleepUpdate, routeSyncUpdate]) {
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
        expect(otherRouteSyncUpdate).not.toHaveBeenCalled();
    });

    it('releases legacy workout, sleep, and route queue items by provider identifier when local user fields are missing', async () => {
        const nowMs = 1_782_126_100_000;
        vi.spyOn(Date, 'now').mockReturnValue(nowMs);
        const deferredReason = QUEUE_DEFERRED_REASONS.ServiceDisconnectPending;
        addServiceTokenDoc('suuntoAppAccessTokens', 'user-1', 'token-1', {
            userName: 'suunto-provider-user',
        });
        const workoutUpdate = addDoc(getServiceWorkoutQueueName(ServiceNames.SuuntoApp), 'workout-legacy', {
            userName: 'suunto-provider-user',
            deferredReason,
        });
        const sleepUpdate = addDoc(SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'sleep-legacy', {
            provider: SLEEP_PROVIDERS.SuuntoApp,
            providerUserId: 'suunto-provider-user',
            deferredReason,
        });
        const routeSyncUpdate = addDoc(ROUTE_SYNC_QUEUE_COLLECTION_NAME, 'route-legacy', {
            providerUserId: 'suunto-provider-user',
            sourceServiceName: ServiceNames.SuuntoApp,
            deferredReason,
        });
        const otherUserWorkoutUpdate = addDoc(getServiceWorkoutQueueName(ServiceNames.SuuntoApp), 'workout-other-user', {
            firebaseUserID: 'user-2',
            userName: 'suunto-provider-user',
            deferredReason,
        });
        const otherProviderSleepUpdate = addDoc(SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'sleep-other-provider', {
            provider: SLEEP_PROVIDERS.GarminAPI,
            providerUserId: 'suunto-provider-user',
            deferredReason,
        });
        const otherUserRouteSyncUpdate = addDoc(ROUTE_SYNC_QUEUE_COLLECTION_NAME, 'route-other-user', {
            firebaseUserID: 'user-2',
            providerUserId: 'suunto-provider-user',
            sourceServiceName: ServiceNames.SuuntoApp,
            deferredReason,
        });

        const releasedCount = await releaseQueueItemsDeferredForPendingDisconnect('user-1', ServiceNames.SuuntoApp);

        expect(releasedCount).toBe(3);
        expect(workoutUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processed: false,
            dispatchedToCloudTask: null,
            expireAt: new Date(nowMs + TTL_CONFIG.QUEUE_ITEM_IN_DAYS * 24 * 60 * 60 * 1000),
            deferredReason: hoisted.deleteSentinel,
        }));
        expect(sleepUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processed: false,
            dispatchedToCloudTask: null,
            expireAt: new Date(nowMs + TTL_CONFIG.QUEUE_ITEM_IN_DAYS * 24 * 60 * 60 * 1000),
            deferredReason: hoisted.deleteSentinel,
        }));
        expect(routeSyncUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processed: false,
            dispatchedToCloudTask: null,
            expireAt: new Date(nowMs + TTL_CONFIG.QUEUE_ITEM_IN_DAYS * 24 * 60 * 60 * 1000),
            deferredReason: hoisted.deleteSentinel,
        }));
        expect(otherUserWorkoutUpdate).not.toHaveBeenCalled();
        expect(otherProviderSleepUpdate).not.toHaveBeenCalled();
        expect(otherUserRouteSyncUpdate).not.toHaveBeenCalled();
    });

    it('does not release the same queue item twice when it matches local and provider identifier queries', async () => {
        const deferredReason = QUEUE_DEFERRED_REASONS.ServiceDisconnectPending;
        addServiceTokenDoc('garminAPITokens', 'user-1', 'token-1', {
            userID: 'garmin-provider-user',
        });
        const workoutUpdate = addDoc(getServiceWorkoutQueueName(ServiceNames.GarminAPI), 'workout-1', {
            firebaseUserID: 'user-1',
            userID: 'garmin-provider-user',
            deferredReason,
        });
        const sleepUpdate = addDoc(SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'sleep-1', {
            userID: 'user-1',
            provider: SLEEP_PROVIDERS.GarminAPI,
            providerUserId: 'garmin-provider-user',
            deferredReason,
        });

        const releasedCount = await releaseQueueItemsDeferredForPendingDisconnect('user-1', ServiceNames.GarminAPI);

        expect(releasedCount).toBe(2);
        expect(workoutUpdate).toHaveBeenCalledTimes(1);
        expect(sleepUpdate).toHaveBeenCalledTimes(1);
    });

    it('fails release when provider identifier lookup fails so pending state can be retried later', async () => {
        failCollectionGet('suuntoAppAccessTokens/user-1/tokens', new Error('token lookup unavailable'));
        const workoutUpdate = addDoc(getServiceWorkoutQueueName(ServiceNames.SuuntoApp), 'workout-1', {
            firebaseUserID: 'user-1',
            deferredReason: QUEUE_DEFERRED_REASONS.ServiceDisconnectPending,
        });

        await expect(releaseQueueItemsDeferredForPendingDisconnect('user-1', ServiceNames.SuuntoApp))
            .rejects.toThrow('Failed to read provider identifiers');

        expect(workoutUpdate).not.toHaveBeenCalled();
    });

    it('fails release when any deferred queue item update fails so pending state can be retried later', async () => {
        const workoutUpdate = addDoc(getServiceWorkoutQueueName(ServiceNames.SuuntoApp), 'workout-1', {
            firebaseUserID: 'user-1',
            deferredReason: QUEUE_DEFERRED_REASONS.ServiceDisconnectPending,
        });
        workoutUpdate.mockRejectedValueOnce(new Error('write unavailable'));

        await expect(releaseQueueItemsDeferredForPendingDisconnect('user-1', ServiceNames.SuuntoApp))
            .rejects.toThrow('Failed to release 1 deferred queue item');

        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[PendingDisconnectQueueRelease] Failed to release deferred queue item.',
            expect.objectContaining({
                queueItemPath: `${getServiceWorkoutQueueName(ServiceNames.SuuntoApp)}/workout-1`,
                error: 'write unavailable',
            }),
        );
    });
});
