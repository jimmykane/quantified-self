/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    addSleepSyncQueueItem: vi.fn(),
    resolveGarminPingFirebaseUserIDs: vi.fn(),
    persistSuuntoHealthWebhookIngress: vi.fn(),
    garminEnabled: false,
    garminHealthEnabled: false,
    suuntoEnabled: true,
    allowedUserIDs: ['test-user-uid'] as string[],
    suuntoWebhookTokenMatches: true,
    suuntoWebhookResolvedUserIDs: ['test-user-uid'] as string[],
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
    firestore: vi.fn(() => ({})),
}));

vi.mock('./queue', () => ({
    addSleepSyncQueueItem: hoisted.addSleepSyncQueueItem,
    GARMIN_PING_BATCH_MAX_CALLBACK_BYTES: 700 * 1024,
    GARMIN_PING_BATCH_MAX_CALLBACKS: 250,
    resolveGarminPingFirebaseUserIDs: hoisted.resolveGarminPingFirebaseUserIDs,
}));

vi.mock('../suunto/health-webhook-binding-lifecycle', () => ({
    resolveActiveSuuntoWebhookUserIDs: vi.fn(async () =>
        hoisted.suuntoWebhookTokenMatches ? hoisted.suuntoWebhookResolvedUserIDs : []),
}));

vi.mock('../suunto/health-webhook-ingress', () => ({
    persistSuuntoHealthWebhookIngress: hoisted.persistSuuntoHealthWebhookIngress,
    SUUNTO_HEALTH_WEBHOOK_MAX_WINDOWS: 16,
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

vi.mock('../garmin/health-rollout', () => ({
    isGarminHealthSyncEnabled: vi.fn(() => hoisted.garminHealthEnabled),
}));

import {
    receiveGarminAPIHealthData,
    receiveGarminAPISleepData,
    receiveSuunto247Data,
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
        hoisted.garminHealthEnabled = false;
        hoisted.suuntoEnabled = true;
        hoisted.allowedUserIDs = ['test-user-uid'];
        hoisted.suuntoWebhookTokenMatches = true;
        hoisted.suuntoWebhookResolvedUserIDs = ['test-user-uid'];
        process.env.SUUNTOAPP_NOTIFICATION_SECRET = 'suunto-notification-secret';
        hoisted.addSleepSyncQueueItem.mockResolvedValue({ id: 'queue-id' });
        hoisted.resolveGarminPingFirebaseUserIDs.mockImplementation(
            async (providerUserIDs: string[]) => new Map(
                providerUserIDs.map(providerUserID => [providerUserID, 'test-user-uid']),
            ),
        );
        hoisted.persistSuuntoHealthWebhookIngress.mockResolvedValue('created');
    });

    function garminCallbackURL(summaryType: string, start = 1760000000): string {
        const endpointPath = summaryType === 'pulseox'
            ? 'pulseOx'
            : summaryType === 'allDayRespiration'
                ? 'respiration'
                : summaryType;
        return `https://apis.garmin.com/wellness-api/rest/${endpointPath}?uploadStartTimeInSeconds=${start}&uploadEndTimeInSeconds=${start + 60}&token=garmin-token`;
    }

    function expectGarminPingBatch(
        callIndex: number,
        summaryType: string,
        providerUserId: string,
        callbackURLs: string[],
    ): void {
        const input = hoisted.addSleepSyncQueueItem.mock.calls[callIndex][0];
        expect(input).toEqual(expect.objectContaining({
            type: 'garmin_ping_batch',
            provider: 'GarminAPI',
            providerUserId,
            userID: 'test-user-uid',
            garminSummaryType: summaryType,
            dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/),
            dispatchImmediately: false,
        }));
        expect(input.garminCallbackURLs).toEqual(callbackURLs);
    }

    it('acknowledges disabled Garmin webhooks without queueing', async () => {
        const response = createResponse();

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                dailies: [{ userId: 'garmin-user-1', callbackURL: garminCallbackURL('dailies') }],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('keeps the legacy Sleep endpoint as a durable Ping/Pull alias', async () => {
        hoisted.garminEnabled = true;
        const response = createResponse();
        const callbackURL = garminCallbackURL('sleeps');

        await receiveGarminAPISleepData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                sleeps: [
                    { userId: 'garmin-user-1', callbackURL },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expectGarminPingBatch(0, 'sleeps', 'garmin-user-1', [callbackURL]);
        expect(hoisted.addSleepSyncQueueItem.mock.calls[0][0]).not.toHaveProperty('payload');
    });

    it.each([
        'dailies',
        'stressDetails',
        'hrv',
        'userMetrics',
        'bodyComps',
        'pulseox',
        'allDayRespiration',
        'bloodPressures',
        'skinTemp',
        'healthSnapshot',
    ])('queues Garmin %s Ping/Pull callbacks through the canonical endpoint', async summaryType => {
        hoisted.garminHealthEnabled = true;
        const response = createResponse();
        const callbackURL = garminCallbackURL(summaryType);

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: { [summaryType]: [{ userId: 'garmin-user-1', callbackURL }] },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expectGarminPingBatch(0, summaryType, 'garmin-user-1', [callbackURL]);
    });

    it('acknowledges Garmin webhooks when admission skips a disconnected user', async () => {
        hoisted.garminHealthEnabled = true;
        hoisted.addSleepSyncQueueItem.mockRejectedValueOnce(Object.assign(new Error('deleted'), {
            name: 'ProviderQueueUserDeletedOrDeletingError',
        }));
        const response = createResponse();
        const callbackURL = garminCallbackURL('dailies');

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: { dailies: [{ userId: 'garmin-user-1', callbackURL }] },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.send).toHaveBeenCalled();
    });

    it('queues valid Garmin payloads when another callback in the batch is skipped', async () => {
        hoisted.garminHealthEnabled = true;
        hoisted.addSleepSyncQueueItem
            .mockRejectedValueOnce(Object.assign(new Error('deleted'), {
                name: 'ProviderQueueUserDeletedOrDeletingError',
            }))
            .mockResolvedValueOnce({ id: 'queued-valid-payload' });
        const response = createResponse();
        const skippedCallbackURL = garminCallbackURL('hrv');
        const validCallbackURL = garminCallbackURL('hrv', 1760000100);

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                hrv: [
                    { userId: 'deleted-garmin-user', callbackURL: skippedCallbackURL },
                    { userId: 'valid-garmin-user', callbackURL: validCallbackURL },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expectGarminPingBatch(0, 'hrv', 'deleted-garmin-user', [skippedCallbackURL]);
        expectGarminPingBatch(1, 'hrv', 'valid-garmin-user', [validCallbackURL]);
    });

    it('deduplicates and durably batches Garmin callbacks before acknowledgement', async () => {
        hoisted.garminHealthEnabled = true;
        const response = createResponse();
        const callbacks = Array.from(
            { length: 251 },
            (_, index) => garminCallbackURL('dailies', 1_760_000_000 + (index * 61)),
        );

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                dailies: [
                    ...callbacks.map(callbackURL => ({ userId: 'garmin-user-1', callbackURL })),
                    { userId: 'garmin-user-1', callbackURL: callbacks[0] },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.resolveGarminPingFirebaseUserIDs).toHaveBeenCalledTimes(1);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expectGarminPingBatch(0, 'dailies', 'garmin-user-1', callbacks.slice(0, 250));
        expectGarminPingBatch(1, 'dailies', 'garmin-user-1', callbacks.slice(250));
    });

    it('drops unresolved Garmin provider accounts before durable queue writes', async () => {
        hoisted.garminHealthEnabled = true;
        hoisted.resolveGarminPingFirebaseUserIDs.mockResolvedValueOnce(new Map());
        const response = createResponse();

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                dailies: [{
                    userId: 'unknown-garmin-user',
                    callbackURL: garminCallbackURL('dailies'),
                }],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('bounds malformed Garmin descriptors before account resolution', async () => {
        hoisted.garminHealthEnabled = true;
        const response = createResponse();

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                dailies: Array.from({ length: 10_001 }, () => ({})),
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.resolveGarminPingFirebaseUserIDs).not.toHaveBeenCalled();
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('acknowledges and drops direct Push summaries and malformed callback descriptors', async () => {
        hoisted.garminHealthEnabled = true;
        const response = createResponse();

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                dailies: [
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

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
            '[HealthSync][Garmin] Webhook accepted',
            expect.objectContaining({
                malformedCount: 2,
                receivedCountByFamily: { dailies: 2 },
                validPingCountByFamily: {},
                directSummaryCountByFamily: { dailies: 2 },
                invalidPingCountByFamily: {},
                queuedCountByFamily: {},
                skippedCountByFamily: {},
                disabledCountByFamily: {},
                unsupportedReceivedCountByFamily: {},
                unsupportedDirectSummaryCountByFamily: {},
            }),
        );
    });

    it('logs privacy-safe Garmin delivery outcomes by summary family', async () => {
        hoisted.garminHealthEnabled = true;
        hoisted.resolveGarminPingFirebaseUserIDs.mockResolvedValueOnce(new Map([
            ['connected-garmin-user', 'test-user-uid'],
        ]));
        const response = createResponse();

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                dailies: [{
                    userId: 'connected-garmin-user',
                    callbackURL: garminCallbackURL('dailies'),
                }],
                hrv: [{
                    userId: 'unresolved-garmin-user',
                    callbackURL: garminCallbackURL('hrv'),
                }],
                stressDetails: [{
                    userId: 'push-garmin-user',
                    summaryId: 'push-summary',
                    startTimeInSeconds: 1760000000,
                }],
                bodyComps: [{
                    userId: 'invalid-ping-user',
                    callbackURL: 'https://attacker.example/wellness-api/rest/bodyComps?token=secret',
                }],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(
            '[HealthSync][Garmin] Webhook accepted',
            expect.objectContaining({
                queuedCount: 1,
                skippedCount: 1,
                malformedCount: 2,
                receivedCountByFamily: {
                    dailies: 1,
                    stressDetails: 1,
                    hrv: 1,
                    bodyComps: 1,
                },
                validPingCountByFamily: { dailies: 1, hrv: 1 },
                directSummaryCountByFamily: { stressDetails: 1 },
                invalidPingCountByFamily: { bodyComps: 1 },
                queuedCountByFamily: { dailies: 1 },
                skippedCountByFamily: { hrv: 1 },
                disabledCountByFamily: {},
                unsupportedReceivedCountByFamily: {},
                unsupportedDirectSummaryCountByFamily: {},
            }),
        );
        const telemetry = vi.mocked(logger.info).mock.calls.find(
            ([message]) => message === '[HealthSync][Garmin] Webhook accepted',
        )?.[1];
        expect(JSON.stringify(telemetry)).not.toContain('connected-garmin-user');
        expect(JSON.stringify(telemetry)).not.toContain('garmin-token');
        expect(JSON.stringify(telemetry)).not.toContain('test-user-uid');
    });

    it.each([
        ['missing callback URL', undefined],
        ['non-HTTPS callback URL', 'http://apis.garmin.com/wellness-api/rest/sleeps?token=garmin-token'],
        ['attacker host', 'https://attacker.example/wellness-api/rest/sleeps?token=garmin-token'],
        ['Garmin-looking attacker host', 'https://apis.garmin.com.attacker.example/wellness-api/rest/sleeps?token=garmin-token'],
        ['custom port', 'https://apis.garmin.com:444/wellness-api/rest/sleeps?token=garmin-token'],
        ['non-Health API path', 'https://apis.garmin.com/tools/login'],
    ])('acknowledges and drops Garmin ping payloads with %s', async (_caseName, callbackURL) => {
        hoisted.garminEnabled = true;
        const response = createResponse();

        await receiveGarminAPISleepData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                sleeps: [
                    { userId: 'garmin-user-1', callbackURL },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('ignores unsupported epochs while accepting supported Health families', async () => {
        hoisted.garminHealthEnabled = true;
        const response = createResponse();
        const callbackURL = garminCallbackURL('dailies');

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                epochs: [
                    { userId: 'garmin-user-1', callbackURL: garminCallbackURL('epochs') },
                    {
                        userId: 'garmin-user-1',
                        summaryId: 'unsupported-push-summary',
                        startTimeInSeconds: 1760000000,
                    },
                ],
                dailies: [{ userId: 'garmin-user-1', callbackURL }],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(1);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            garminSummaryType: 'dailies',
        }));
        expect(logger.info).toHaveBeenCalledWith(
            '[HealthSync][Garmin] Webhook accepted',
            expect.objectContaining({
                unsupportedReceivedCountByFamily: { epochs: 2 },
                unsupportedDirectSummaryCountByFamily: { epochs: 1 },
            }),
        );
    });

    it('accepts the documented 10 MiB payload boundary and drops larger payloads', async () => {
        hoisted.garminHealthEnabled = true;
        const callbackURL = garminCallbackURL('dailies');
        const acceptedResponse = createResponse();

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.alloc(10 * 1024 * 1024),
            body: { dailies: [{ userId: 'garmin-user-1', callbackURL }] },
        } as any, acceptedResponse as any);
        expect(acceptedResponse.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        const oversizedResponse = createResponse();
        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.alloc((10 * 1024 * 1024) + 1),
            body: { dailies: [{ userId: 'garmin-user-1', callbackURL }] },
        } as any, oversizedResponse as any);
        expect(oversizedResponse.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('returns 500 only when a durable Garmin queue write fails', async () => {
        hoisted.garminHealthEnabled = true;
        hoisted.addSleepSyncQueueItem.mockRejectedValueOnce(new Error('firestore unavailable'));
        const response = createResponse();

        await receiveGarminAPIHealthData({
            method: 'POST',
            rawBody: Buffer.from('{}'),
            body: {
                dailies: [{ userId: 'garmin-user-1', callbackURL: garminCallbackURL('dailies') }],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(logger.error).toHaveBeenCalledWith(
            '[HealthSync][Garmin] Failed to durably queue webhook payload',
            expect.objectContaining({
                errorName: 'Error',
                receivedCountByFamily: { dailies: 1 },
                validPingCountByFamily: { dailies: 1 },
                queuedCountByFamily: {},
            }),
        );
        expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('garmin-token');
        expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('garmin-user-1');
    });

    it('validates Suunto HMAC before queueing sleep samples', async () => {
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuunto247Data({
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
            dedupeKey: 'test-user-uid:suunto-user-1:123',
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

        await receiveSuunto247Data({
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

        await receiveSuunto247Data({
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

    it('fans out all-user Suunto sleep webhooks to every connected app user', async () => {
        hoisted.allowedUserIDs = [];
        hoisted.suuntoWebhookResolvedUserIDs = ['connected-user-1', 'connected-user-2'];
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuunto247Data({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'suunto-user-1',
                samples: [{ SleepId: 123, StartTime: 1760000000000 }],
            },
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'connected-user-1',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123, StartTime: 1760000000000 }] },
            dedupeKey: 'connected-user-1:suunto-user-1:123',
        }));
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
            userID: 'connected-user-2',
            dedupeKey: 'connected-user-2:suunto-user-1:123',
        }));
    });

    it('keeps fan-out successful when one shared connection becomes non-retryable', async () => {
        hoisted.allowedUserIDs = [];
        hoisted.suuntoWebhookResolvedUserIDs = ['deleted-user', 'active-user'];
        hoisted.addSleepSyncQueueItem
            .mockRejectedValueOnce(Object.assign(new Error('deleted'), {
                name: 'ProviderQueueUserDeletedOrDeletingError',
            }))
            .mockResolvedValueOnce({ id: 'active-queue-id' });
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuunto247Data({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'suunto-user-1',
                samples: [{ SleepId: 123 }],
            },
            get: vi.fn(() => signature),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenLastCalledWith(expect.objectContaining({
            userID: 'active-user',
            dedupeKey: 'active-user:suunto-user-1:123',
        }));
    });

    it('returns a retryable response when any shared connection queue write fails transiently', async () => {
        hoisted.allowedUserIDs = [];
        hoisted.suuntoWebhookResolvedUserIDs = ['first-user', 'second-user'];
        hoisted.addSleepSyncQueueItem
            .mockResolvedValueOnce({ id: 'first-queue-id' })
            .mockRejectedValueOnce(new Error('cloud tasks unavailable'));
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuunto247Data({
            rawBody,
            body: {
                type: 'SUUNTO_247_SLEEP_CREATED',
                username: 'suunto-user-1',
                samples: [{ SleepId: 123 }],
            },
            get: vi.fn(() => signature),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
    });

    it('acknowledges all-user Suunto sleep webhooks without queueing when no connected token exists', async () => {
        hoisted.allowedUserIDs = [];
        hoisted.suuntoWebhookTokenMatches = false;
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuunto247Data({
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

        await receiveSuunto247Data({
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
            dedupeKey: 'test-user-uid:suunto-user-1:456',
        }));
    });

    it('uses deterministic payload digests for Suunto samples without explicit identifiers', async () => {
        const rawBody = Buffer.from(JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED' }));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuunto247Data({
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
        expect(queuedPayload.dedupeKey).toMatch(/^test-user-uid:suunto-user-1:sample-[a-f0-9]{32}:sample-[a-f0-9]{32}$/);
    });

    it('rejects Suunto webhook payloads with invalid HMAC', async () => {
        const response = createResponse();

        await receiveSuunto247Data({
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
    ])('durably accepts compact canonical ingress for signed %s notifications before fan-out', async (type) => {
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

        await receiveSuunto247Data({
            rawBody,
            body,
            get: vi.fn((header: string) => header === 'X-HMAC-SHA256-Signature' ? signature : undefined),
        } as any, response as any);

        const startMs = Date.parse('2026-08-26T21:00:00.000Z');
        const endMs = Date.parse('2026-08-27T21:00:00.000Z');
        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.persistSuuntoHealthWebhookIngress).toHaveBeenCalledWith({
            notificationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
            notificationType: type,
            providerUserId: 'suunto-user-1',
            windows: [{ startMs, endMs }],
        });
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
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
            await receiveSuunto247Data({
                rawBody,
                body,
                get: vi.fn(() => signature),
            } as any, createResponse() as any);
        };

        await deliver(60);
        await deliver(60);
        await deliver(61);

        const notificationDigests = hoisted.persistSuuntoHealthWebhookIngress.mock.calls
            .map(([input]) => input.notificationDigest);
        expect(notificationDigests[0]).toBe(notificationDigests[1]);
        expect(notificationDigests[2]).not.toBe(notificationDigests[0]);
        expect(notificationDigests.every(digest => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
    });

    it('returns a retryable response when the single durable Health ingress write fails', async () => {
        hoisted.persistSuuntoHealthWebhookIngress.mockRejectedValueOnce(new Error('firestore unavailable'));
        const body = {
            type: 'SUUNTO_247_ACTIVITY_CREATED',
            username: 'suunto-user-1',
            samples: [{ timestamp: '2026-08-27T12:00:00Z' }],
        };
        const rawBody = Buffer.from(JSON.stringify(body));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuunto247Data({
            rawBody,
            body,
            get: vi.fn(() => signature),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(hoisted.persistSuuntoHealthWebhookIngress).toHaveBeenCalledOnce();
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('acknowledges a signed Health notification discarded before ingress persistence', async () => {
        hoisted.persistSuuntoHealthWebhookIngress.mockResolvedValueOnce('permanent_skip');
        const body = {
            type: 'SUUNTO_247_ACTIVITY_CREATED',
            username: 'suunto-user-1',
            samples: [{ timestamp: '2026-08-27T12:00:00Z' }],
        };
        const rawBody = Buffer.from(JSON.stringify(body));
        const signature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(rawBody)
            .digest('hex');
        const response = createResponse();

        await receiveSuunto247Data({
            rawBody,
            body,
            get: vi.fn(() => signature),
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.persistSuuntoHealthWebhookIngress).toHaveBeenCalledOnce();
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
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

    it('acknowledges and drops malformed and oversized signed Health notifications', async () => {
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

        await receiveSuunto247Data({
            rawBody: malformedRawBody,
            body: malformedBody,
            get: vi.fn(() => malformedSignature),
        } as any, malformedResponse as any);

        expect(malformedResponse.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
        expect(hoisted.persistSuuntoHealthWebhookIngress).not.toHaveBeenCalled();

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

        await receiveSuunto247Data({
            rawBody: invalidAccountRawBody,
            body: invalidAccountBody,
            get: vi.fn(() => invalidAccountSignature),
        } as any, invalidAccountResponse as any);

        expect(invalidAccountResponse.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
        expect(hoisted.persistSuuntoHealthWebhookIngress).not.toHaveBeenCalled();

        const oversizedRawBody = Buffer.alloc(suuntoWebhookTestInternals.SUUNTO_HEALTH_WEBHOOK_MAX_BYTES + 1, 1);
        const oversizedSignature = createHmac('sha256', process.env.SUUNTOAPP_NOTIFICATION_SECRET || '')
            .update(oversizedRawBody)
            .digest('hex');
        const oversizedResponse = createResponse();
        await receiveSuunto247Data({
            rawBody: oversizedRawBody,
            body: {
                type: 'SUUNTO_247_ACTIVITY_CREATED',
                username: 'suunto-user-1',
                samples: [{ timestamp: '2026-08-27T12:00:00Z' }],
            },
            get: vi.fn(() => oversizedSignature),
        } as any, oversizedResponse as any);

        expect(oversizedResponse.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
        expect(hoisted.persistSuuntoHealthWebhookIngress).not.toHaveBeenCalled();
    });
});
