import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SLEEP_SYNC_DISABLED_PROVIDERS_ENV } from './provider-flags';

const hoisted = vi.hoisted(() => ({
    addSleepSyncQueueItem: vi.fn(),
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

vi.mock('./queue', () => ({
    addSleepSyncQueueItem: hoisted.addSleepSyncQueueItem,
}));

import { receiveGarminAPISleepData, receiveSuuntoAppSleepData } from './webhooks';

function createResponse() {
    return {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    };
}

describe('sleep webhooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV];
        process.env.SUUNTOAPP_NOTIFICATION_SECRET = 'suunto-notification-secret';
        hoisted.addSleepSyncQueueItem.mockResolvedValue({ id: 'queue-id' });
    });

    it('queues Garmin push and ping sleep payloads separately', async () => {
        const response = createResponse();

        await receiveGarminAPISleepData({
            body: {
                sleeps: [
                    { userId: 'garmin-user-1', summaryId: 'summary-1', startTimeInSeconds: 1760000000 },
                    { userId: 'garmin-user-1', callbackURL: 'https://healthapi.garmin.com/sleep/callback' },
                ],
            },
        } as any, response as any);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'garmin_push',
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            dedupeKey: 'summary-1',
            payload: { sleeps: [expect.objectContaining({ summaryId: 'summary-1' })] },
        }));
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'garmin_ping',
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            callbackURL: 'https://healthapi.garmin.com/sleep/callback',
        }));
    });

    it('acknowledges disabled Garmin sleep webhooks without queueing', async () => {
        process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV] = 'GarminAPI,COROSAPI';
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
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123, StartTime: 1760000000000 }] },
            dedupeKey: 'suunto-user-1:123',
        }));
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
});
