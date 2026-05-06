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
    enqueueSleepSyncTask: vi.fn(),
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

vi.mock('../utils', async () => {
    const actual = await vi.importActual<typeof import('../utils')>('../utils');
    return {
        ...actual,
        enqueueSleepSyncTask: hoisted.enqueueSleepSyncTask,
    };
});

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
        hoisted.enqueueSleepSyncTask.mockResolvedValue(true);
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

    it('can dispatch webhook queue items immediately after writing the queue document', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-06T05:30:00.000Z'));
        try {
            await addSleepSyncQueueItem({
                type: 'suunto_webhook',
                provider: 'SuuntoApp',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123 }] },
                dedupeKey: 'suunto-user-1:123',
                dispatchImmediately: true,
            });

            expect(hoisted.enqueueSleepSyncTask).toHaveBeenCalledWith(
                hoisted.docIdValues[0],
                Date.now(),
            );
            expect(hoisted.docUpdate).toHaveBeenCalledWith({
                dispatchedToCloudTask: Date.now(),
            });
            expect(hoisted.docSet.mock.invocationCallOrder[0])
                .toBeLessThan(hoisted.enqueueSleepSyncTask.mock.invocationCallOrder[0]);
            expect(hoisted.enqueueSleepSyncTask.mock.invocationCallOrder[0])
                .toBeLessThan(hoisted.docUpdate.mock.invocationCallOrder[0]);
        } finally {
            vi.useRealTimers();
        }
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

    it('prefixes Suunto sleep poll access tokens with Bearer', async () => {
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'raw-suunto-access-token',
        });
        hoisted.requestGet.mockResolvedValue({ samples: [] });
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    serviceName: 'SuuntoApp',
                    userName: 'suunto-user-1',
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

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-poll',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.requestGet).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/247samples/sleep?from=1777392000000&to=1777478400000',
            headers: expect.objectContaining({
                Authorization: 'Bearer raw-suunto-access-token',
            }),
            json: true,
        }));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'success',
        }));
    });

    it('keeps the fullest Suunto sample when a poll returns interim and final records for the same sleep id', async () => {
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'raw-suunto-access-token',
        });
        hoisted.requestGet.mockResolvedValue([
            {
                timestamp: '2026-04-28T21:51:00.000+03:00',
                entryData: {
                    SleepId: 1777402260,
                    DateTime: '2026-04-28T21:51:00.000+03:00',
                    IsNap: true,
                    Duration: 2040,
                    DeepSleepDuration: 0,
                    LightSleepDuration: 0,
                    REMSleepDuration: 0,
                    WakeAfterSleepOnsetDuration: 0,
                },
            },
            {
                timestamp: '2026-04-28T21:51:00.000+03:00',
                entryData: {
                    SleepId: 1777402260,
                    DateTime: '2026-04-28T21:51:00.000+03:00',
                    IsNap: false,
                    Duration: 34260,
                    DeepSleepDuration: 6210,
                    LightSleepDuration: 20070,
                    REMSleepDuration: 7020,
                    WakeAfterSleepOnsetDuration: 960,
                    SleepQualityScore: 67,
                },
            },
        ]);
        hoisted.upsertSleepSessions.mockResolvedValue({ written: 1, skipped: 0 });
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    serviceName: 'SuuntoApp',
                    userName: 'suunto-user-1',
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

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-poll-with-duplicates',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.upsertSleepSessions).toHaveBeenCalledWith('xcsAolLDDTWTgtRN9eYF3lW2YKL2', [
            expect.objectContaining({
                sourceSessionKey: '1777402260',
                session: expect.objectContaining({
                    isNap: false,
                    durationSeconds: 33300,
                    inBedDurationSeconds: 34260,
                    stageDurationsSeconds: expect.objectContaining({
                        deep: 6210,
                        light: 20070,
                        rem: 7020,
                        awake: 960,
                    }),
                    score: expect.objectContaining({
                        value: 67,
                    }),
                }),
            }),
        ]);
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

    it('moves queue items with unresolved provider users to DLQ instead of retrying Cloud Tasks', async () => {
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length);
        hoisted.collectionGroupGet.mockResolvedValue({
            docs: [],
            empty: true,
        });
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-no-token',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'unknown-suunto-user',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'suunto-sleep-no-token',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'NO_TOKEN_FOUND',
            error: 'No SuuntoApp token found for unknown-suunto-user',
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('resolves all-user Suunto queue items against legacy Suunto tokens without serviceName', async () => {
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length);
        hoisted.collectionGroupGet.mockResolvedValue({
            docs: [{
                id: 'legacy-suunto-token-1',
                data: () => ({
                    userName: 'legacy-suunto-user',
                }),
                ref: {
                    parent: {
                        parent: {
                            id: 'legacy-user-id',
                            parent: {
                                id: 'suuntoAppAccessTokens',
                            },
                        },
                    },
                },
            }],
            empty: false,
        });
        hoisted.upsertSleepSessions.mockResolvedValue({ written: 1, skipped: 0 });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-legacy-token',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'legacy-suunto-user',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: {
                samples: [{
                    entryData: {
                        SleepId: 123,
                        DateTime: '2026-04-28T21:51:00.000+03:00',
                        Duration: 28_800,
                    },
                }],
            },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.upsertSleepSessions).toHaveBeenCalledWith('legacy-user-id', expect.any(Array));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'success',
            sessionsWritten: 1,
        }));
        expect(hoisted.batchSet).not.toHaveBeenCalled();
    });

    it('does not resolve another users token when an allowed queue item has mismatched provider user id', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI', 'COROSAPI');
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

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
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.tokenRootWhere).toHaveBeenCalledWith('userName', '==', 'other-suunto-user');
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            'SuuntoApp',
            expect.objectContaining({
                message: 'No SuuntoApp token found for other-suunto-user',
            }),
        );
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'suunto-sleep-provider-mismatch',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'NO_TOKEN_FOUND',
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
    });
});
