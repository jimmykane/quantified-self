import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SLEEP_BACKFILL_COOLDOWN_MS,
    SLEEP_BACKFILL_START_DATE_ISO,
    getSleepBackfillWindowDays,
} from '../../../shared/sleep-backfill';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';

const hoisted = vi.hoisted(() => ({
    tokenDocs: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
    stateData: null as Record<string, unknown> | null,
    transactionStateData: undefined as Record<string, unknown> | null | undefined,
    transactionSet: vi.fn(),
    hasProAccess: vi.fn(),
    getTokenData: vi.fn(),
    isSleepProviderEnabled: vi.fn(),
    isSleepSyncUserAllowed: vi.fn(),
    addSleepSyncQueueItem: vi.fn(),
    updateSleepSyncState: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: (_options: unknown, handler: unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;

        constructor(code: string, message: string) {
            super(message);
            this.code = code;
            this.name = 'HttpsError';
        }
    },
}));

vi.mock('firebase-admin', () => ({
    firestore: () => ({
        runTransaction: vi.fn(async (handler: (transaction: unknown) => Promise<unknown>) => handler({
            get: vi.fn().mockResolvedValue({
                exists: hoisted.transactionStateData !== undefined
                    ? hoisted.transactionStateData !== null
                    : hoisted.stateData !== null,
                data: () => hoisted.transactionStateData !== undefined
                    ? hoisted.transactionStateData
                    : hoisted.stateData,
            }),
            set: hoisted.transactionSet,
        })),
        collection: (name: string) => {
            if (name === 'suuntoAppAccessTokens') {
                return {
                    doc: () => ({
                        collection: () => ({
                            get: vi.fn().mockResolvedValue({
                                docs: hoisted.tokenDocs,
                            }),
                        }),
                    }),
                };
            }

            if (name === 'users') {
                return {
                    doc: () => ({
                        collection: () => ({
                            doc: () => ({
                                get: vi.fn().mockResolvedValue({
                                    exists: hoisted.stateData !== null,
                                    data: () => hoisted.stateData,
                                }),
                            }),
                        }),
                    }),
                };
            }

            return {
                doc: vi.fn(),
            };
        },
    }),
}));

vi.mock('../utils', () => ({
    ALLOWED_CORS_ORIGINS: ['https://quantified-self.io'],
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.',
    enforceAppCheck: vi.fn((request: { app?: unknown }) => {
        if (!request.app) {
            const error = new Error('App Check verification failed.') as Error & { code: string };
            error.code = 'failed-precondition';
            throw error;
        }
    }),
    hasProAccess: hoisted.hasProAccess,
}));

vi.mock('../tokens', () => ({
    getTokenData: hoisted.getTokenData,
}));

vi.mock('./provider-flags', () => ({
    isSleepProviderEnabled: hoisted.isSleepProviderEnabled,
    isSleepSyncUserAllowed: hoisted.isSleepSyncUserAllowed,
}));

vi.mock('./queue', () => ({
    addSleepSyncQueueItem: hoisted.addSleepSyncQueueItem,
}));

vi.mock('./writer', () => ({
    updateSleepSyncState: hoisted.updateSleepSyncState,
}));

import { backfillSuuntoAppSleep, chunkSleepBackfillRange } from './backfill';

function createRequest(overrides: Partial<{
    app: object | null;
    auth: { uid: string } | null;
}> = {}) {
    return {
        app: overrides.app === undefined ? { appId: 'test-app' } : overrides.app,
        auth: overrides.auth === undefined ? { uid: 'user-1' } : overrides.auth,
        data: {},
    };
}

function seedSuuntoToken(serviceName: string | undefined = undefined) {
    hoisted.tokenDocs.push({
        id: 'suunto-token-1',
        data: () => serviceName ? { serviceName } : {},
    });
}

describe('backfillSuuntoAppSleep', () => {
    const nowMs = Date.parse('2026-04-30T12:00:00.000Z');
    const startMs = Date.parse(SLEEP_BACKFILL_START_DATE_ISO);
    const windowDays = getSleepBackfillWindowDays(SLEEP_PROVIDERS.SuuntoApp) || 0;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(nowMs);
        vi.clearAllMocks();
        hoisted.tokenDocs.length = 0;
        hoisted.stateData = null;
        hoisted.transactionStateData = undefined;
        hoisted.hasProAccess.mockResolvedValue(true);
        hoisted.getTokenData.mockResolvedValue({ userName: 'suunto-user-1' });
        hoisted.isSleepProviderEnabled.mockReturnValue(true);
        hoisted.isSleepSyncUserAllowed.mockReturnValue(true);
        hoisted.addSleepSyncQueueItem.mockResolvedValue({ id: 'queue-item' });
        hoisted.updateSleepSyncState.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('queues Suunto sleep poll windows from the shared start date to now', async () => {
        seedSuuntoToken();
        const expectedWindows = chunkSleepBackfillRange(startMs, nowMs, windowDays);

        const result = await backfillSuuntoAppSleep(createRequest() as any);

        expect(result).toEqual({
            queued: expectedWindows.length,
            startDate: SLEEP_BACKFILL_START_DATE_ISO,
            endDate: new Date(nowMs).toISOString(),
            nextAllowedAtMs: nowMs + SLEEP_BACKFILL_COOLDOWN_MS,
        });
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(expectedWindows.length);
        expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.anything(), {
            provider: SLEEP_PROVIDERS.SuuntoApp,
            status: 'ready',
            lastBackfillQueuedAtMs: nowMs,
            lastBackfillStartMs: startMs,
            lastBackfillEndMs: nowMs,
            lastBackfillQueueItems: 0,
            nextBackfillAllowedAtMs: nowMs + SLEEP_BACKFILL_COOLDOWN_MS,
            lastError: null,
            updatedAtMs: nowMs,
        }, { merge: true });
        expect(hoisted.transactionSet.mock.invocationCallOrder[0])
            .toBeLessThan(hoisted.addSleepSyncQueueItem.mock.invocationCallOrder[0]);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenNthCalledWith(1, {
            type: 'suunto_poll',
            provider: SLEEP_PROVIDERS.SuuntoApp,
            userID: 'user-1',
            providerUserId: 'suunto-user-1',
            rangeStartMs: expectedWindows[0].startMs,
            rangeEndMs: expectedWindows[0].endMs,
            dedupeKey: `sleep-backfill:user-1:${expectedWindows[0].startMs}:${expectedWindows[0].endMs}`,
        });
        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.SuuntoApp, {
            status: 'ready',
            lastBackfillQueuedAtMs: nowMs,
            lastBackfillStartMs: startMs,
            lastBackfillEndMs: nowMs,
            lastBackfillQueueItems: expectedWindows.length,
            nextBackfillAllowedAtMs: nowMs + SLEEP_BACKFILL_COOLDOWN_MS,
            lastError: null,
        }, nowMs);
    });

    it('rejects requests without App Check', async () => {
        seedSuuntoToken();

        await expect(backfillSuuntoAppSleep(createRequest({ app: null }) as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated requests', async () => {
        seedSuuntoToken();

        await expect(backfillSuuntoAppSleep(createRequest({ auth: null }) as any))
            .rejects.toMatchObject({ code: 'unauthenticated' });

        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('rejects non-Pro users', async () => {
        seedSuuntoToken();
        hoisted.hasProAccess.mockResolvedValue(false);

        await expect(backfillSuuntoAppSleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'permission-denied' });

        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('rejects when Suunto sleep sync is disabled', async () => {
        seedSuuntoToken();
        hoisted.isSleepProviderEnabled.mockReturnValue(false);

        await expect(backfillSuuntoAppSleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('rejects users outside the sleep allowlist', async () => {
        seedSuuntoToken();
        hoisted.isSleepSyncUserAllowed.mockReturnValue(false);

        await expect(backfillSuuntoAppSleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'permission-denied' });

        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('rejects users without a connected Suunto token', async () => {
        await expect(backfillSuuntoAppSleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('rejects while the shared sleep backfill cooldown is active', async () => {
        seedSuuntoToken();
        hoisted.stateData = {
            nextBackfillAllowedAtMs: nowMs + 60_000,
        };

        await expect(backfillSuuntoAppSleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'resource-exhausted' });

        expect(hoisted.getTokenData).not.toHaveBeenCalled();
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('rejects a concurrent caller when the transaction observes a freshly claimed cooldown', async () => {
        seedSuuntoToken();
        hoisted.stateData = null;
        hoisted.transactionStateData = {
            nextBackfillAllowedAtMs: nowMs + 60_000,
        };

        await expect(backfillSuuntoAppSleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'resource-exhausted' });

        expect(hoisted.getTokenData).toHaveBeenCalled();
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });
});
