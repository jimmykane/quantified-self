import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SLEEP_BACKFILL_COOLDOWN_MS,
    SLEEP_BACKFILL_START_DATE_ISO,
    getSleepBackfillCooldownMs,
    getSleepBackfillWindowDays,
} from '../../../shared/sleep-backfill';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';

const hoisted = vi.hoisted(() => ({
    tokenDocs: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
    stateData: null as Record<string, unknown> | null,
    transactionStateData: undefined as Record<string, unknown> | null | undefined,
    userExists: true,
    transactionUserExists: undefined as boolean | undefined,
    tombstoneData: null as Record<string, unknown> | null,
    transactionTombstoneData: undefined as Record<string, unknown> | null | undefined,
    transactionSet: vi.fn(),
    hasProAccess: vi.fn(),
    getTokenData: vi.fn(),
    isSleepProviderEnabled: vi.fn(),
    isSleepSyncUserAllowed: vi.fn(),
    addSleepSyncQueueItem: vi.fn(),
    updateSleepSyncState: vi.fn(),
    requestGet: vi.fn(),
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
        runTransaction: vi.fn(async (handler: (transaction: unknown) => Promise<unknown>) => {
            const snapshotForPath = (path: string) => {
                if (path.startsWith('users/') && !path.includes('/sleepSyncState/')) {
                    const userExists = hoisted.transactionUserExists === undefined
                        ? hoisted.userExists
                        : hoisted.transactionUserExists;
                    return {
                        exists: userExists,
                        data: () => userExists ? { uid: path.split('/')[1] } : null,
                    };
                }
                if (path.startsWith('userDeletionTombstones/')) {
                    const tombstoneData = hoisted.transactionTombstoneData === undefined
                        ? hoisted.tombstoneData
                        : hoisted.transactionTombstoneData;
                    return {
                        exists: tombstoneData !== null,
                        data: () => tombstoneData,
                    };
                }
                return {
                    exists: hoisted.transactionStateData !== undefined
                        ? hoisted.transactionStateData !== null
                        : hoisted.stateData !== null,
                    data: () => hoisted.transactionStateData !== undefined
                        ? hoisted.transactionStateData
                        : hoisted.stateData,
                };
            };
            return handler({
                get: vi.fn(async (ref: { path?: string }) => snapshotForPath(ref?.path || '')),
                set: hoisted.transactionSet,
            });
        }),
        collection: (name: string) => {
            const createDocRef = (path: string): any => ({
                path,
                id: path.split('/').pop(),
                get: vi.fn().mockResolvedValue({
                    exists: path.includes('/sleepSyncState/') ? hoisted.stateData !== null : hoisted.userExists,
                    data: () => path.includes('/sleepSyncState/') ? hoisted.stateData : { uid: path.split('/')[1] },
                }),
                collection: (collectionName: string) => ({
                    doc: (docId: string) => createDocRef(`${path}/${collectionName}/${docId}`),
                }),
            });

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

            if (name === 'garminAPITokens') {
                return {
                    doc: () => ({
                        collection: () => ({
                            limit: () => ({
                                get: vi.fn().mockResolvedValue({
                                    empty: hoisted.tokenDocs.length === 0,
                                    docs: hoisted.tokenDocs,
                                }),
                            }),
                        }),
                    }),
                };
            }

            if (name === 'users') {
                return {
                    doc: (docId: string) => createDocRef(`users/${docId}`),
                };
            }

            if (name === 'userDeletionTombstones') {
                return {
                    doc: (docId: string) => createDocRef(`userDeletionTombstones/${docId}`),
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

vi.mock('../request-helper', () => ({
    get: hoisted.requestGet,
}));

import { backfillGarminAPISleep, backfillSuuntoAppSleep, chunkSleepBackfillRange } from './backfill';

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

function seedGarminToken() {
    hoisted.tokenDocs.push({
        id: 'garmin-user-1',
        data: () => ({ serviceName: 'GarminAPI' }),
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
        hoisted.userExists = true;
        hoisted.transactionUserExists = undefined;
        hoisted.tombstoneData = null;
        hoisted.transactionTombstoneData = undefined;
        hoisted.hasProAccess.mockResolvedValue(true);
        hoisted.getTokenData.mockResolvedValue({ userName: 'suunto-user-1' });
        hoisted.isSleepProviderEnabled.mockReturnValue(true);
        hoisted.isSleepSyncUserAllowed.mockReturnValue(true);
        hoisted.addSleepSyncQueueItem.mockResolvedValue({ id: 'queue-item' });
        hoisted.updateSleepSyncState.mockResolvedValue(undefined);
        hoisted.requestGet.mockResolvedValue(undefined);
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

    it('clears the claimed cooldown when queueing sleep backfill windows fails', async () => {
        seedSuuntoToken();
        hoisted.addSleepSyncQueueItem
            .mockResolvedValueOnce({ id: 'queue-item-1' })
            .mockRejectedValueOnce(new Error('queue write failed'));

        await expect(backfillSuuntoAppSleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'internal' });

        expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            nextBackfillAllowedAtMs: nowMs + SLEEP_BACKFILL_COOLDOWN_MS,
        }), { merge: true });
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.SuuntoApp, {
            status: 'failed',
            lastBackfillQueuedAtMs: null,
            lastBackfillQueueItems: 1,
            nextBackfillAllowedAtMs: null,
            lastError: 'queue write failed',
        }, nowMs);
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

    it('does not claim cooldown or enqueue Suunto windows when account deletion starts before the transaction', async () => {
        seedSuuntoToken();
        hoisted.transactionTombstoneData = {};

        await expect(backfillSuuntoAppSleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.transactionSet).not.toHaveBeenCalled();
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
    });
});

describe('backfillGarminAPISleep', () => {
    const nowMs = Date.parse('2026-04-30T12:00:00.000Z');
    const startMs = Date.parse(SLEEP_BACKFILL_START_DATE_ISO);
    const windowDays = getSleepBackfillWindowDays(SLEEP_PROVIDERS.GarminAPI) || 0;
    const cooldownMs = getSleepBackfillCooldownMs(SLEEP_PROVIDERS.GarminAPI) || 0;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(nowMs);
        vi.clearAllMocks();
        hoisted.tokenDocs.length = 0;
        hoisted.stateData = null;
        hoisted.transactionStateData = undefined;
        hoisted.userExists = true;
        hoisted.transactionUserExists = undefined;
        hoisted.tombstoneData = null;
        hoisted.transactionTombstoneData = undefined;
        hoisted.hasProAccess.mockResolvedValue(true);
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'garmin-access-token',
            userID: 'garmin-user-1',
            permissions: ['HISTORICAL_DATA_EXPORT', 'HEALTH_EXPORT'],
        });
        hoisted.isSleepProviderEnabled.mockReturnValue(true);
        hoisted.isSleepSyncUserAllowed.mockReturnValue(true);
        hoisted.addSleepSyncQueueItem.mockResolvedValue({ id: 'queue-item' });
        hoisted.updateSleepSyncState.mockResolvedValue(undefined);
        hoisted.requestGet.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('requests Garmin sleep backfill windows from the shared start date to now', async () => {
        seedGarminToken();
        const expectedWindows = chunkSleepBackfillRange(startMs, nowMs, windowDays);

        const result = await backfillGarminAPISleep(createRequest() as any);

        expect(result).toEqual({
            queued: expectedWindows.length,
            startDate: SLEEP_BACKFILL_START_DATE_ISO,
            endDate: new Date(nowMs).toISOString(),
            nextAllowedAtMs: nowMs + cooldownMs,
        });
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
        expect(hoisted.requestGet).toHaveBeenCalledTimes(expectedWindows.length);
        expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.anything(), {
            provider: SLEEP_PROVIDERS.GarminAPI,
            status: 'ready',
            lastBackfillQueuedAtMs: nowMs,
            lastBackfillStartMs: startMs,
            lastBackfillEndMs: nowMs,
            lastBackfillQueueItems: 0,
            nextBackfillAllowedAtMs: nowMs + cooldownMs,
            lastError: null,
            updatedAtMs: nowMs,
        }, { merge: true });
        expect(hoisted.transactionSet.mock.invocationCallOrder[0])
            .toBeLessThan(hoisted.requestGet.mock.invocationCallOrder[0]);
        expect(hoisted.requestGet).toHaveBeenNthCalledWith(1, {
            headers: {
                Authorization: 'Bearer garmin-access-token',
            },
            url: `https://apis.garmin.com/wellness-api/rest/backfill/sleeps?summaryStartTimeInSeconds=${Math.floor(expectedWindows[0].startMs / 1000)}&summaryEndTimeInSeconds=${Math.floor(expectedWindows[0].endMs / 1000)}`,
        });
        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.GarminAPI, {
            status: 'ready',
            lastBackfillQueuedAtMs: nowMs,
            lastBackfillStartMs: startMs,
            lastBackfillEndMs: nowMs,
            lastBackfillQueueItems: expectedWindows.length,
            nextBackfillAllowedAtMs: nowMs + cooldownMs,
            lastError: null,
        }, nowMs);
    });

    it('rejects Garmin requests without App Check', async () => {
        seedGarminToken();

        await expect(backfillGarminAPISleep(createRequest({ app: null }) as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated Garmin requests', async () => {
        seedGarminToken();

        await expect(backfillGarminAPISleep(createRequest({ auth: null }) as any))
            .rejects.toMatchObject({ code: 'unauthenticated' });

        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('rejects non-Pro Garmin users', async () => {
        seedGarminToken();
        hoisted.hasProAccess.mockResolvedValue(false);

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'permission-denied' });

        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('rejects when Garmin sleep sync is disabled', async () => {
        seedGarminToken();
        hoisted.isSleepProviderEnabled.mockReturnValue(false);

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('rejects Garmin users outside the sleep allowlist', async () => {
        seedGarminToken();
        hoisted.isSleepSyncUserAllowed.mockReturnValue(false);

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'permission-denied' });

        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('rejects Garmin users without a connected token', async () => {
        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('rejects Garmin users missing health backfill permissions and updates sync state', async () => {
        seedGarminToken();
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'garmin-access-token',
            userID: 'garmin-user-1',
            permissions: ['HISTORICAL_DATA_EXPORT'],
        });

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.GarminAPI, {
            status: 'permission_missing',
            lastError: 'Missing required Garmin permissions: HEALTH_EXPORT',
        });
        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('still rejects with the permission error when marking missing permissions fails', async () => {
        seedGarminToken();
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'garmin-access-token',
            userID: 'garmin-user-1',
            permissions: ['HISTORICAL_DATA_EXPORT'],
        });
        hoisted.updateSleepSyncState.mockRejectedValueOnce(new Error('state write failed'));

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({
                code: 'failed-precondition',
                message: 'Missing required Garmin permissions (Historical Data Export, Health Export). Please reconnect Garmin and grant health permissions.',
            });

        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('rejects Garmin users while the provider sleep backfill cooldown is active', async () => {
        seedGarminToken();
        hoisted.stateData = {
            nextBackfillAllowedAtMs: nowMs + 60_000,
        };

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'resource-exhausted' });

        expect(hoisted.getTokenData).not.toHaveBeenCalled();
        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('clears the claimed cooldown when Garmin request submission fails', async () => {
        seedGarminToken();
        hoisted.requestGet
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('garmin unavailable'));

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'internal' });

        expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            nextBackfillAllowedAtMs: nowMs + cooldownMs,
        }), { merge: true });
        expect(hoisted.requestGet).toHaveBeenCalledTimes(2);
        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.GarminAPI, {
            status: 'failed',
            lastBackfillQueuedAtMs: null,
            lastBackfillQueueItems: 1,
            nextBackfillAllowedAtMs: null,
            lastError: 'garmin unavailable',
        }, nowMs);
    });

    it('clears the dashboard prompt suppression marker when Garmin request submission fails', async () => {
        seedGarminToken();
        hoisted.requestGet.mockRejectedValueOnce(new Error('garmin unavailable'));

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'internal' });

        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.GarminAPI, expect.objectContaining({
            status: 'failed',
            lastBackfillQueuedAtMs: null,
            nextBackfillAllowedAtMs: null,
        }), nowMs);
    });

    it('does not claim cooldown or request Garmin windows when account deletion starts before the transaction', async () => {
        seedGarminToken();
        hoisted.transactionTombstoneData = {};

        await expect(backfillGarminAPISleep(createRequest() as any))
            .rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.transactionSet).not.toHaveBeenCalled();
        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('retries a Garmin window clipped to the provider min start time when Garmin returns one', async () => {
        seedGarminToken();
        const expectedWindows = chunkSleepBackfillRange(startMs, nowMs, windowDays);
        const clippedStartMs = expectedWindows[0].startMs + (10 * 24 * 60 * 60 * 1000);
        hoisted.requestGet
            .mockRejectedValueOnce({
                statusCode: 400,
                error: {
                    error: {
                        errorMessage: `start date before min start time ${Math.floor(clippedStartMs / 1000)}`,
                    },
                },
            })
            .mockResolvedValue(undefined);

        const result = await backfillGarminAPISleep(createRequest() as any);

        expect(result.queued).toBe(expectedWindows.length);
        expect(hoisted.requestGet).toHaveBeenNthCalledWith(2, {
            headers: {
                Authorization: 'Bearer garmin-access-token',
            },
            url: `https://apis.garmin.com/wellness-api/rest/backfill/sleeps?summaryStartTimeInSeconds=${Math.floor(clippedStartMs / 1000)}&summaryEndTimeInSeconds=${Math.floor(expectedWindows[0].endMs / 1000)}`,
        });
        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.GarminAPI, expect.objectContaining({
            status: 'ready',
            lastBackfillQueueItems: expectedWindows.length,
            nextBackfillAllowedAtMs: nowMs + cooldownMs,
        }), nowMs);
    });

    it('skips a clipped Garmin min-start retry when that clipped window was already requested', async () => {
        seedGarminToken();
        const expectedWindows = chunkSleepBackfillRange(startMs, nowMs, windowDays);
        const clippedStartMs = expectedWindows[0].startMs + (10 * 24 * 60 * 60 * 1000);
        hoisted.requestGet
            .mockRejectedValueOnce({
                statusCode: 400,
                error: {
                    error: {
                        errorMessage: `start date before min start time ${Math.floor(clippedStartMs / 1000)}`,
                    },
                },
            })
            .mockRejectedValueOnce({ statusCode: 409 })
            .mockResolvedValue(undefined);

        const result = await backfillGarminAPISleep(createRequest() as any);

        expect(result.queued).toBe(expectedWindows.length - 1);
        expect(hoisted.requestGet).toHaveBeenNthCalledWith(2, {
            headers: {
                Authorization: 'Bearer garmin-access-token',
            },
            url: `https://apis.garmin.com/wellness-api/rest/backfill/sleeps?summaryStartTimeInSeconds=${Math.floor(clippedStartMs / 1000)}&summaryEndTimeInSeconds=${Math.floor(expectedWindows[0].endMs / 1000)}`,
        });
        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.GarminAPI, expect.objectContaining({
            status: 'ready',
            lastBackfillQueueItems: expectedWindows.length - 1,
            nextBackfillAllowedAtMs: nowMs + cooldownMs,
        }), nowMs);
    });

    it('skips Garmin windows before the provider min start time when Garmin does not return a usable min start', async () => {
        seedGarminToken();
        hoisted.requestGet
            .mockRejectedValueOnce({
                statusCode: 400,
                error: {
                    error: {
                        errorMessage: 'start date before min start time',
                    },
                },
            })
            .mockResolvedValue(undefined);

        const result = await backfillGarminAPISleep(createRequest() as any);

        expect(result.queued).toBe(chunkSleepBackfillRange(startMs, nowMs, windowDays).length - 1);
        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('user-1', SLEEP_PROVIDERS.GarminAPI, expect.objectContaining({
            status: 'ready',
            lastBackfillQueueItems: result.queued,
            nextBackfillAllowedAtMs: nowMs + cooldownMs,
        }), nowMs);
    });
});
