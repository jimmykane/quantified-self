import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    addSleepSyncQueueItem: vi.fn(),
    garminEnabled: false,
    suuntoEnabled: true,
    allowedUserIDs: ['test-user-uid'] as string[],
    suuntoWebhookTokenMatches: true,
    suuntoWebhookResolvedUserID: 'resolved-suunto-user-id',
}));

vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        runWith: () => ({
            https: {
                onRequest: (handler: unknown) => handler,
            },
        }),
    }),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => ({
        collection: vi.fn(() => ({
            doc: vi.fn(() => ({
                collection: vi.fn(() => ({
                    where: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({
                        empty: !hoisted.suuntoWebhookTokenMatches,
                        docs: hoisted.suuntoWebhookTokenMatches ? [{}] : [],
                    }),
                })),
            })),
        })),
        collectionGroup: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                empty: !hoisted.suuntoWebhookTokenMatches,
                docs: hoisted.suuntoWebhookTokenMatches ? [{
                    id: 'suunto-token-1',
                    data: () => ({
                        userName: 'suunto-user-1',
                    }),
                    ref: {
                        parent: {
                            parent: {
                                id: hoisted.suuntoWebhookResolvedUserID,
                                parent: {
                                    id: 'suuntoAppAccessTokens',
                                },
                            },
                        },
                    },
                }] : [],
            }),
        })),
    })),
}));

vi.mock('./queue', () => ({
    addSleepSyncQueueItem: hoisted.addSleepSyncQueueItem,
    findSleepTokenByProviderUserId: vi.fn(async () => (hoisted.suuntoWebhookTokenMatches ? {
        id: 'suunto-token-1',
        ref: {
            parent: {
                parent: {
                    id: hoisted.suuntoWebhookResolvedUserID,
                },
            },
        },
    } : null)),
    firebaseUserIdFromSleepTokenSnapshot: vi.fn((tokenSnapshot: any) => tokenSnapshot.ref.parent.parent.id),
}));

vi.mock('./provider-flags', () => ({
    SLEEP_SYNC_DISABLED_PROVIDERS: ['GarminAPI', 'COROSAPI'],
    getAllowedSleepSyncUserIds: vi.fn(() => hoisted.allowedUserIDs),
    isSleepProviderEnabled: vi.fn((provider: string) => {
        if (provider === 'GarminAPI') {
            return hoisted.garminEnabled;
        }
        if (provider === 'SuuntoApp') {
            return hoisted.suuntoEnabled;
        }
        return false;
    }),
}));

import {
    receiveGarminAPISleepData,
    receiveSuuntoAppSleepData,
    suuntoWebhookTestInternals,
} from './webhooks';

function createResponse() {
    return {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    };
}

describe('sleep webhooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.garminEnabled = false;
        hoisted.suuntoEnabled = true;
        hoisted.allowedUserIDs = ['test-user-uid'];
        hoisted.suuntoWebhookTokenMatches = true;
        hoisted.suuntoWebhookResolvedUserID = 'resolved-suunto-user-id';
        process.env.SUUNTOAPP_NOTIFICATION_SECRET = 'suunto-notification-secret';
        hoisted.addSleepSyncQueueItem.mockResolvedValue({ id: 'queue-id' });
    });

    it('acknowledges disabled Garmin sleep webhooks without queueing', async () => {
        const response = createResponse();

        await receiveGarminAPISleepData({
            body: {
                sleeps: [
                    { userId: 'garmin-user-1', summaryId: 'summary-1', startTimeInSeconds: 1760000000 },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('queues Garmin ping payloads with trusted Health API callback URLs', async () => {
        hoisted.garminEnabled = true;
        const response = createResponse();
        const callbackURL = 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1760000000&token=garmin-token';

        await receiveGarminAPISleepData({
            body: {
                sleeps: [
                    { userId: 'garmin-user-1', callbackURL },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'garmin_ping',
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            callbackURL,
            dedupeKey: callbackURL,
        }));
        expect(hoisted.addSleepSyncQueueItem.mock.calls[0][0]).not.toHaveProperty('payload');
    });

    it('acknowledges Garmin sleep webhooks when queueing skips a deleted or disconnected provider user', async () => {
        hoisted.garminEnabled = true;
        hoisted.addSleepSyncQueueItem.mockRejectedValueOnce(Object.assign(new Error('deleted'), {
            name: 'ProviderQueueUserDeletedOrDeletingError',
        }));
        const response = createResponse();
        const callbackURL = 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1760000000&token=garmin-token';

        await receiveGarminAPISleepData({
            body: {
                sleeps: [
                    { userId: 'garmin-user-1', callbackURL },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.send).toHaveBeenCalled();
    });

    it('queues valid Garmin sleep payloads when another payload in the same batch is skipped', async () => {
        hoisted.garminEnabled = true;
        hoisted.addSleepSyncQueueItem
            .mockRejectedValueOnce(Object.assign(new Error('deleted'), {
                name: 'ProviderQueueUserDeletedOrDeletingError',
            }))
            .mockResolvedValueOnce({ id: 'queued-valid-payload' });
        const response = createResponse();
        const skippedCallbackURL = 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1760000000&token=deleted-token';
        const validCallbackURL = 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1760000100&token=valid-token';

        await receiveGarminAPISleepData({
            body: {
                sleeps: [
                    { userId: 'deleted-garmin-user', callbackURL: skippedCallbackURL },
                    { userId: 'valid-garmin-user', callbackURL: validCallbackURL },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
            providerUserId: 'deleted-garmin-user',
            callbackURL: skippedCallbackURL,
        }));
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
            providerUserId: 'valid-garmin-user',
            callbackURL: validCallbackURL,
        }));
    });

    it('rejects Garmin push summary payloads without timestamp fallback dedupe', async () => {
        hoisted.garminEnabled = true;
        const response = createResponse();

        await receiveGarminAPISleepData({
            body: {
                sleeps: [
                    {
                        userId: 'garmin-user-1',
                        summaryId: 'summary-1',
                        startTimeInSeconds: 1760000000,
                        durationInSeconds: 28800,
                    },
                    {
                        userId: 'garmin-user-1',
                        summaryId: 'summary-2',
                        startTimeInSeconds: 1760000001,
                        durationInSeconds: 28800,
                    },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(400);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it.each([
        ['missing callback URL', undefined],
        ['non-HTTPS callback URL', 'http://apis.garmin.com/wellness-api/rest/sleeps?token=garmin-token'],
        ['attacker host', 'https://attacker.example/wellness-api/rest/sleeps?token=garmin-token'],
        ['Garmin-looking attacker host', 'https://apis.garmin.com.attacker.example/wellness-api/rest/sleeps?token=garmin-token'],
        ['custom port', 'https://apis.garmin.com:444/wellness-api/rest/sleeps?token=garmin-token'],
        ['non-Health API path', 'https://apis.garmin.com/tools/login'],
    ])('rejects Garmin ping payloads with %s', async (_caseName, callbackURL) => {
        hoisted.garminEnabled = true;
        const response = createResponse();

        await receiveGarminAPISleepData({
            body: {
                sleeps: [
                    { userId: 'garmin-user-1', callbackURL },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(400);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('validates Suunto HMAC before queueing sleep samples', async () => {
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'suunto-user-1',
                samples: [{ SleepId: 123, StartTime: 1760000000000 }],
            },
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123, StartTime: 1760000000000 }] },
            dedupeKey: 'suunto-user-1:123',
        }));
    });

    it('acknowledges Suunto sleep webhooks when queueing skips a deleted or disconnected provider user', async () => {
        hoisted.addSleepSyncQueueItem.mockRejectedValueOnce(Object.assign(new Error('not connected'), {
            name: 'ProviderQueueUserNotConnectedError',
        }));
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'suunto-user-1',
                samples: [{ SleepId: 123, StartTime: 1760000000000 }],
            },
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.send).toHaveBeenCalled();
    });

    it('acknowledges scoped Suunto sleep webhooks without queueing when username is not allowed', async () => {
        hoisted.suuntoWebhookTokenMatches = false;
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'other-suunto-user',
                samples: [{ SleepId: 123, StartTime: 1760000000000 }],
            },
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('resolves all-user Suunto sleep webhooks to a connected app user before queueing', async () => {
        hoisted.allowedUserIDs = [];
        hoisted.suuntoWebhookResolvedUserID = 'connected-user-id';
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'suunto-user-1',
                samples: [{ SleepId: 123, StartTime: 1760000000000 }],
            },
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'connected-user-id',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123, StartTime: 1760000000000 }] },
            dedupeKey: 'suunto-user-1:123',
        }));
    });

    it('acknowledges all-user Suunto sleep webhooks without queueing when no connected token exists', async () => {
        hoisted.allowedUserIDs = [];
        hoisted.suuntoWebhookTokenMatches = false;
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'unknown-suunto-user',
                samples: [{ SleepId: 123, StartTime: 1760000000000 }],
            },
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('uses nested Suunto sleep identifiers for webhook dedupe keys', async () => {
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'suunto-user-1',
                samples: [
                    { entryData: { SleepId: 456, BedtimeStart: '2026-04-27T22:00:00Z' } },
                ],
            },
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ entryData: { SleepId: 456, BedtimeStart: '2026-04-27T22:00:00Z' } }] },
            dedupeKey: 'suunto-user-1:456',
        }));
    });

    it('uses deterministic payload digests for Suunto samples without explicit identifiers', async () => {
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'suunto-user-1',
                samples: [
                    { value: 'first-sample' },
                    { value: 'second-sample' },
                ],
            },
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        const queuedPayload = hoisted.addSleepSyncQueueItem.mock.calls[0][0];
        expect(queuedPayload.dedupeKey).toMatch(/^suunto-user-1:sample-[a-f0-9]{32}:sample-[a-f0-9]{32}$/);
    });

    it('rejects Suunto webhook payloads with invalid HMAC', async () => {
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody: Buffer.from('{}'),
            body: { type: 'SUUNTO_247_SLEEP_CREATED', username: 'suunto-user-1', samples: [{}] },
            get: vi.fn(() => 'bad-signature'),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it.each([
        'SUUNTO_247_ACTIVITY_CREATED',
        'SUUNTO_247_RECOVERY_CREATED',
    ])('queues compact canonical refetches for signed %s notifications', async (type) => {
        hoisted.suuntoEnabled = false;
        const body = {
            type,
            username: 'suunto-user-1',
            samples: [
                { timestamp: '2026-08-27T00:10:00.000+03:00', entryData: { HR: 60 } },
                { timestamp: '2026-08-27T23:50:00.000+03:00', entryData: { HR: 62 } },
            ],
        };
        const rawBody = Buffer.from(JSON.stringify(body));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody,
            body,
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        const startMs = Date.parse('2026-08-26T21:00:00.000Z');
        const endMs = Date.parse('2026-08-27T21:00:00.000Z');
        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith({
            type: 'suunto_health_poll',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            rangeStartMs: startMs,
            rangeEndMs: endMs,
            healthTrigger: 'webhook',
            dedupeKey: expect.stringMatching(
                new RegExp(`^suunto-health-webhook:xcsAolLDDTWTgtRN9eYF3lW2YKL2:suunto-user-1:${startMs}:${endMs}:[a-f0-9]{32}$`),
            ),
            dispatchImmediately: true,
        });
        expect(hoisted.addSleepSyncQueueItem.mock.calls[0][0]).not.toHaveProperty('payload');
    });

    it('deduplicates exact Health notification retries without suppressing later same-day revisions', async () => {
        const deliver = async (heartRate: number) => {
            const body = {
                type: 'SUUNTO_247_ACTIVITY_CREATED',
                username: 'suunto-user-1',
                samples: [{
                    timestamp: '2026-08-27T12:00:00.000+03:00',
                    entryData: { HR: heartRate },
                }],
            };
            const rawBody = Buffer.from(JSON.stringify(body));
            const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
                .update(rawBody)
                .digest('hex');
            await receiveSuuntoAppSleepData({
                rawBody,
                body,
                get: vi.fn(() => signature),
            } as any, createResponse() as any);
        };

        await deliver(60);
        await deliver(60);
        await deliver(61);

        const dedupeKeys = hoisted.addSleepSyncQueueItem.mock.calls
            .map(([input]) => input.dedupeKey);
        expect(dedupeKeys[0]).toBe(dedupeKeys[1]);
        expect(dedupeKeys[2]).not.toBe(dedupeKeys[0]);
    });

    it('does not fill unnotified gaps between sparse webhook days', () => {
        const windows = suuntoWebhookTestInternals.buildSuuntoHealthWebhookWindows([
            { timestamp: '2026-01-01T12:00:00Z' },
            { timestamp: '2026-02-01T12:00:00Z' },
        ]);

        expect(windows).toHaveLength(2);
        expect(windows[0].endMs - windows[0].startMs).toBe(24 * 60 * 60 * 1000);
        expect(windows[1].endMs - windows[1].startMs).toBe(24 * 60 * 60 * 1000);
    });

    it('chunks contiguous webhook-triggered refetches into bounded 28-day windows', () => {
        const windows = suuntoWebhookTestInternals.buildSuuntoHealthWebhookWindows(
            Array.from({ length: 32 }, (_, dayOffset) => ({
                timestamp: new Date(Date.parse('2026-01-01T12:00:00Z') + dayOffset * 24 * 60 * 60 * 1000)
                    .toISOString(),
            })),
        );

        expect(windows).toHaveLength(2);
        expect(windows[0].endMs - windows[0].startMs).toBe(28 * 24 * 60 * 60 * 1000);
        expect(windows[1].endMs - windows[1].startMs).toBe(4 * 24 * 60 * 60 * 1000);
    });

    it('rejects impossible webhook wall-clock values', () => {
        expect(() => suuntoWebhookTestInternals.buildSuuntoHealthWebhookWindows([
            { timestamp: '2026-08-27T25:00:00+03:00' },
        ])).toThrow('webhook time');
    });

    it('rejects malformed and oversized signed Health notifications without queueing', async () => {
        const malformedBody = {
            type: 'SUUNTO_247_ACTIVITY_CREATED',
            username: 'suunto-user-1',
            samples: [{ timestamp: '2026-08-27T12:00:00' }],
        };
        const malformedRawBody = Buffer.from(JSON.stringify(malformedBody));
        const malformedSignature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(malformedRawBody)
            .digest('hex');
        const malformedResponse = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody: malformedRawBody,
            body: malformedBody,
            get: vi.fn(() => malformedSignature),
        } as any, malformedResponse as any);

        expect(malformedResponse.status).toHaveBeenCalledWith(400);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();

        const invalidAccountBody = {
            type: 'SUUNTO_247_ACTIVITY_CREATED',
            username: 'a'.repeat(513),
            samples: [{ timestamp: '2026-08-27T12:00:00Z' }],
        };
        const invalidAccountRawBody = Buffer.from(JSON.stringify(invalidAccountBody));
        const invalidAccountSignature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(invalidAccountRawBody)
            .digest('hex');
        const invalidAccountResponse = createResponse();

        await receiveSuuntoAppSleepData({
            rawBody: invalidAccountRawBody,
            body: invalidAccountBody,
            get: vi.fn(() => invalidAccountSignature),
        } as any, invalidAccountResponse as any);

        expect(invalidAccountResponse.status).toHaveBeenCalledWith(400);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();

        const oversizedRawBody = Buffer.alloc(suuntoWebhookTestInternals.SUUNTO_HEALTH_WEBHOOK_MAX_BYTES + 1, 1);
        const oversizedSignature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(oversizedRawBody)
            .digest('hex');
        const oversizedResponse = createResponse();
        await receiveSuuntoAppSleepData({
            rawBody: oversizedRawBody,
            body: {
                type: 'SUUNTO_247_ACTIVITY_CREATED',
                username: 'suunto-user-1',
                samples: [{ timestamp: '2026-08-27T12:00:00Z' }],
            },
            get: vi.fn(() => oversizedSignature),
        } as any, oversizedResponse as any);

        expect(oversizedResponse.status).toHaveBeenCalledWith(413);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });
});
