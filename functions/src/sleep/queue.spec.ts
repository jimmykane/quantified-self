import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueResult } from '../queue-utils';

const hoisted = vi.hoisted(() => ({
    docSet: vi.fn(),
    docUpdate: vi.fn(),
    docIdValues: [] as string[],
    batchSet: vi.fn(),
    batchDelete: vi.fn(),
    batchCommit: vi.fn(),
    disabledProviders: ['GarminAPI', 'COROSAPI'] as string[],
    allowedUserIDs: ['xcsAolLDDTWTgtRN9eYF3lW2YKL2'] as string[],
    tokenRootWhere: vi.fn(),
    tokenRootLimit: vi.fn(),
    tokenRootGet: vi.fn(),
    collectionGroupGet: vi.fn(),
    getTokenData: vi.fn(),
    requestGet: vi.fn(),
    markSleepSyncError: vi.fn(),
    updateSleepSyncState: vi.fn(),
    upsertSleepSessions: vi.fn(),
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
    const tokenRootQuery: any = {
        where: hoisted.tokenRootWhere,
        limit: hoisted.tokenRootLimit,
        get: hoisted.tokenRootGet,
    };
    hoisted.tokenRootWhere.mockReturnValue(tokenRootQuery);
    hoisted.tokenRootLimit.mockReturnValue(tokenRootQuery);

    const collectionGroupQuery: any = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: hoisted.collectionGroupGet,
    };

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
                    collection: vi.fn(() => tokenRootQuery),
                };
            }),
        })),
        collectionGroup: vi.fn(() => collectionGroupQuery),
        batch: vi.fn(() => ({
            set: hoisted.batchSet,
            delete: hoisted.batchDelete,
            commit: hoisted.batchCommit,
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

vi.mock('./provider-flags', () => ({
    SLEEP_SYNC_DISABLED_PROVIDERS: hoisted.disabledProviders,
    SLEEP_SYNC_ALLOWED_USER_IDS: hoisted.allowedUserIDs,
    isSleepProviderEnabled: vi.fn((provider: string) => !hoisted.disabledProviders.includes(provider)),
    isSleepSyncUserAllowed: vi.fn((userID: string | null | undefined) => (
        hoisted.allowedUserIDs.length === 0
        || (typeof userID === 'string' && hoisted.allowedUserIDs.includes(userID))
    )),
}));

vi.mock('./writer', () => ({
    markSleepSyncError: hoisted.markSleepSyncError,
    updateSleepSyncState: hoisted.updateSleepSyncState,
    upsertSleepSessions: hoisted.upsertSleepSessions,
}));

vi.mock('../tokens', () => ({
    getTokenData: hoisted.getTokenData,
}));

vi.mock('../request-helper', () => ({
    get: hoisted.requestGet,
}));

import { addSleepSyncQueueItem, processSleepSyncQueueItem } from './queue';

describe('sleep queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.docIdValues.length = 0;
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI', 'COROSAPI');
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length, 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
        hoisted.docSet.mockResolvedValue(undefined);
        hoisted.batchCommit.mockResolvedValue(undefined);
        hoisted.tokenRootGet.mockResolvedValue({ docs: [], empty: true });
        hoisted.collectionGroupGet.mockResolvedValue({ docs: [], empty: true });
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'garmin-access-token',
            permissions: ['HEALTH_EXPORT'],
        });
        hoisted.requestGet.mockResolvedValue({ sleeps: [] });
        hoisted.markSleepSyncError.mockResolvedValue(undefined);
        hoisted.updateSleepSyncState.mockResolvedValue(undefined);
        hoisted.upsertSleepSessions.mockResolvedValue({ written: 0, skipped: 0 });
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

    it('records Garmin ping queue successes as webhook sync activity', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-29T06:00:00.000Z'));
        try {
            hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'COROSAPI');
            hoisted.upsertSleepSessions.mockResolvedValue({ written: 1, skipped: 0 });
            hoisted.requestGet.mockResolvedValue({
                sleeps: [{
                    summaryId: 'summary-1',
                    calendarDate: '2026-04-29',
                    startTimeInSeconds: 1_777_424_400,
                    durationInSeconds: 28_800,
                }],
            });
            hoisted.tokenRootGet.mockResolvedValue({
                docs: [{
                    id: 'garmin-token-1',
                    data: () => ({
                        serviceName: 'GarminAPI',
                        userID: 'garmin-user-1',
                    }),
                    ref: {
                        parent: {
                            parent: {
                                id: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                            },
                        },
                    },
                }],
                empty: false,
            });
            const update = vi.fn().mockResolvedValue(undefined);
            const callbackURL = 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1777424400';

            const result = await processSleepSyncQueueItem({
                id: 'garmin-sleep-ping',
                dateCreated: 1_700_000_000_000,
                dispatchedToCloudTask: 1_700_000_000_500,
                processed: false,
                provider: 'GarminAPI',
                userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                providerUserId: 'garmin-user-1',
                retryCount: 0,
                type: 'garmin_ping',
                callbackURL,
                ref: {
                    update,
                } as any,
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.requestGet).toHaveBeenCalledWith(expect.objectContaining({
                url: callbackURL,
                headers: {
                    Authorization: 'Bearer garmin-access-token',
                },
                json: true,
            }));
            expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('xcsAolLDDTWTgtRN9eYF3lW2YKL2', 'GarminAPI', {
                status: 'ready',
                lastSyncedAtMs: Date.now(),
                lastPollAtMs: undefined,
                lastWebhookAtMs: Date.now(),
                lastError: null,
            });
            expect(update).toHaveBeenCalledWith(expect.objectContaining({
                processed: true,
                resultStatus: 'success',
                sessionsWritten: 1,
                sessionsSkipped: 0,
            }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('moves Garmin ping queue items with untrusted callback URLs to DLQ without resolving tokens', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'COROSAPI');
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

        const result = await processSleepSyncQueueItem({
            id: 'garmin-sleep-bad-callback',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            retryCount: 0,
            type: 'garmin_ping',
            callbackURL: 'https://attacker.example/wellness-api/rest/sleeps?token=garmin-token',
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'garmin-sleep-bad-callback',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'INVALID_GARMIN_CALLBACK_URL',
            error: expect.stringContaining('Untrusted Garmin callback URL'),
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('moves Garmin push queue items to DLQ without persisting payload data', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'COROSAPI');
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

        const result = await processSleepSyncQueueItem({
            id: 'garmin-sleep-push',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            retryCount: 0,
            type: 'garmin_push',
            payload: { sleeps: [{ summaryId: 'summary-1', startTimeInSeconds: 1760000000 }] },
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'garmin-sleep-push',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'UNSUPPORTED_GARMIN_PUSH_PAYLOAD',
            error: expect.stringContaining('Garmin push sleep payloads are not accepted'),
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
    });

    it('marks out-of-scope user queue items processed without resolving tokens', async () => {
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-other-user',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'other-user',
            providerUserId: 'suunto-user-2',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'user_not_allowed',
            userAllowed: false,
            sessionsWritten: 0,
            sessionsSkipped: 0,
        }));
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('does not resolve another users token when an allowed queue item has mismatched provider user id', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI', 'COROSAPI');
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-provider-mismatch',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'other-suunto-user',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.tokenRootWhere).toHaveBeenCalledWith('userName', '==', 'other-suunto-user');
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            retryCount: 1,
            dispatchedToCloudTask: null,
        }));
    });
});
