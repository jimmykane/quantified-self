import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SLEEP_PROVIDERS, SLEEP_STAGES, SleepSession } from '../../../shared/sleep';

const hoisted = vi.hoisted(() => ({
    docGet: vi.fn(),
    docSet: vi.fn(),
    docIds: [] as string[],
    mockGetUserDeletionGuardState: vi.fn(),
    mockGetUserDeletionGuardStateInTransaction: vi.fn(),
    mockRunTransaction: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../utils', () => ({
    generateIDFromParts: vi.fn(async (parts: string[]) => parts.join(':')),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.mockGetUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction: hoisted.mockGetUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
        readonly name = 'UserDeletionGuardReadError';
        readonly code = 'unavailable';
        readonly statusCode = 503;

        constructor(
            public readonly uid: string,
            public readonly phase: string,
            public readonly originalError: unknown,
        ) {
            super(`Could not read deletion guard for user ${uid} during ${phase}.`);
        }
    },
}));

vi.mock('firebase-admin', () => {
    const collectionRef: any = {
        doc: vi.fn((id: string) => {
            hoisted.docIds.push(id);
            return {
                id,
                get: hoisted.docGet,
                set: hoisted.docSet,
                collection: vi.fn(() => collectionRef),
            };
        }),
    };

    return {
        firestore: vi.fn(() => ({
            collection: vi.fn(() => collectionRef),
            runTransaction: hoisted.mockRunTransaction,
        })),
    };
});

import { markSleepSyncError, updateSleepSyncState, upsertSleepSession, upsertSleepSessions } from './writer';

function buildMapperResult(overrides: Partial<SleepSession> = {}) {
    return {
        sourceSessionKey: 'sleep-1',
        session: {
            source: {
                provider: SLEEP_PROVIDERS.SuuntoApp,
                providerUserId: 'suunto-user-1',
                sourceSessionKey: 'sleep-1',
            },
            sleepDate: '2026-04-29',
            startTimeMs: Date.UTC(2026, 3, 28, 18, 51),
            endTimeMs: Date.UTC(2026, 3, 29, 4, 22),
            durationSeconds: 33300,
            inBedDurationSeconds: 34260,
            isNap: false,
            stages: [],
            stageDurationsSeconds: {
                [SLEEP_STAGES.Deep]: 6210,
                [SLEEP_STAGES.Light]: 20070,
                [SLEEP_STAGES.Rem]: 7020,
                [SLEEP_STAGES.Awake]: 960,
            },
            ...overrides,
        },
    };
}

function buildExistingSuuntoSession(overrides: Partial<SleepSession> = {}): SleepSession {
    return {
        id: 'existing-session',
        userID: 'user-1',
        source: {
            provider: SLEEP_PROVIDERS.SuuntoApp,
            providerUserId: 'suunto-user-1',
            sourceSessionKey: 'sleep-1',
        },
        sleepDate: '2026-04-29',
        startTimeMs: Date.UTC(2026, 3, 28, 18, 51),
        endTimeMs: Date.UTC(2026, 3, 29, 4, 22),
        durationSeconds: 33300,
        inBedDurationSeconds: 34260,
        isNap: false,
        stages: [],
        stageDurationsSeconds: {
            [SLEEP_STAGES.Deep]: 6210,
            [SLEEP_STAGES.Light]: 20070,
            [SLEEP_STAGES.Rem]: 7020,
            [SLEEP_STAGES.Awake]: 960,
        },
        createdAtMs: 1000,
        updatedAtMs: 2000,
        ...overrides,
    };
}

describe('sleep writer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.docIds.length = 0;
        hoisted.docGet.mockResolvedValue({ exists: false, data: () => undefined });
        hoisted.docSet.mockResolvedValue(undefined);
        hoisted.mockRunTransaction.mockImplementation(async (runner: (transaction: {
            get: typeof hoisted.docGet;
            set: typeof hoisted.docSet;
        }) => unknown) => runner({
            get: hoisted.docGet,
            set: hoisted.docSet,
        }));
        hoisted.mockGetUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
    });

    it('does not let a partial Suunto nap overwrite an existing fuller staged session', async () => {
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => buildExistingSuuntoSession(),
        });

        const result = await upsertSleepSessions('user-1', [{
            sourceSessionKey: 'sleep-1',
            session: {
                source: {
                    provider: SLEEP_PROVIDERS.SuuntoApp,
                    providerUserId: 'suunto-user-1',
                    sourceSessionKey: 'sleep-1',
                },
                sleepDate: '2026-04-29',
                startTimeMs: Date.UTC(2026, 3, 28, 18, 51),
                endTimeMs: Date.UTC(2026, 3, 28, 19, 25),
                durationSeconds: 2040,
                inBedDurationSeconds: 2040,
                isNap: true,
                stages: [],
                stageDurationsSeconds: {},
            },
        }], 3000);

        expect(result).toEqual({ written: 0, skipped: 1 });
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does replace a partial existing Suunto record with a fuller staged session', async () => {
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => buildExistingSuuntoSession({
                durationSeconds: 2040,
                inBedDurationSeconds: 2040,
                isNap: true,
                stageDurationsSeconds: {},
            }),
        });

        const result = await upsertSleepSessions('user-1', [{
            sourceSessionKey: 'sleep-1',
            session: {
                source: {
                    provider: SLEEP_PROVIDERS.SuuntoApp,
                    providerUserId: 'suunto-user-1',
                    sourceSessionKey: 'sleep-1',
                },
                sleepDate: '2026-04-29',
                startTimeMs: Date.UTC(2026, 3, 28, 18, 51),
                endTimeMs: Date.UTC(2026, 3, 29, 4, 22),
                durationSeconds: 33300,
                inBedDurationSeconds: 34260,
                isNap: false,
                stages: [],
                stageDurationsSeconds: {
                    [SLEEP_STAGES.Deep]: 6210,
                    [SLEEP_STAGES.Light]: 20070,
                    [SLEEP_STAGES.Rem]: 7020,
                    [SLEEP_STAGES.Awake]: 960,
                },
            },
        }], 3000);

        expect(result).toEqual({ written: 1, skipped: 0 });
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            durationSeconds: 33300,
            inBedDurationSeconds: 34260,
            isNap: false,
            createdAtMs: 1000,
            updatedAtMs: 3000,
        }), { merge: true });
    });

    it('skips unchanged duplicate Garmin sessions even when callback metadata differs', async () => {
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => buildExistingSuuntoSession({
                source: {
                    provider: SLEEP_PROVIDERS.GarminAPI,
                    providerUserId: 'garmin-user-1',
                    sourceSessionKey: 'garmin-summary-1',
                    callbackURL: 'https://apis.garmin.com/wellness-api/rest/sleeps?old=true',
                    receivedAtMs: 2000,
                },
            }),
        });

        const result = await upsertSleepSessions('user-1', [buildMapperResult({
            source: {
                provider: SLEEP_PROVIDERS.GarminAPI,
                providerUserId: 'garmin-user-1',
                sourceSessionKey: 'garmin-summary-1',
                callbackURL: 'https://apis.garmin.com/wellness-api/rest/sleeps?new=true',
                receivedAtMs: 3000,
            },
        })], 3000);

        expect(result).toEqual({ written: 0, skipped: 1 });
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('updates duplicate Garmin sessions when the canonical sleep payload changes', async () => {
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => buildExistingSuuntoSession({
                source: {
                    provider: SLEEP_PROVIDERS.GarminAPI,
                    providerUserId: 'garmin-user-1',
                    sourceSessionKey: 'garmin-summary-1',
                    callbackURL: 'https://apis.garmin.com/wellness-api/rest/sleeps?old=true',
                    receivedAtMs: 2000,
                },
            }),
        });

        const result = await upsertSleepSessions('user-1', [buildMapperResult({
            source: {
                provider: SLEEP_PROVIDERS.GarminAPI,
                providerUserId: 'garmin-user-1',
                sourceSessionKey: 'garmin-summary-1',
                callbackURL: 'https://apis.garmin.com/wellness-api/rest/sleeps?new=true',
                receivedAtMs: 3000,
            },
            durationSeconds: 33420,
        })], 3000);

        expect(result).toEqual({ written: 1, skipped: 0 });
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            durationSeconds: 33420,
            createdAtMs: 1000,
            updatedAtMs: 3000,
        }), { merge: true });
    });

    it('does not recreate sleep sessions when user deletion is in progress', async () => {
        hoisted.mockGetUserDeletionGuardState.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        const result = await upsertSleepSessions('user-1', [buildMapperResult()], 3000);

        expect(result).toEqual({ written: 0, skipped: 1 });
        expect(hoisted.docGet).not.toHaveBeenCalled();
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not recreate sleep sessions when deletion starts inside the write transaction', async () => {
        hoisted.mockGetUserDeletionGuardState.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        const result = await upsertSleepSessions('user-1', [buildMapperResult()], 3000);

        expect(result).toEqual({ written: 0, skipped: 1 });
        expect(hoisted.docGet).not.toHaveBeenCalled();
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not recreate a sleep session when the user document is missing', async () => {
        hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: false,
            deletionInProgress: false,
            shouldSkip: true,
        });

        const result = await upsertSleepSession('user-1', buildMapperResult(), 3000);

        expect(result.written).toBe(false);
        expect(hoisted.docGet).not.toHaveBeenCalled();
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not recreate sleep sync state when user deletion is in progress', async () => {
        hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        await updateSleepSyncState('user-1', SLEEP_PROVIDERS.SuuntoApp, {
            lastError: 'ignored',
        }, 3000);

        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not recreate sleep sync error state for a missing user', async () => {
        hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: false,
            deletionInProgress: false,
            shouldSkip: true,
        });

        await markSleepSyncError('user-1', SLEEP_PROVIDERS.SuuntoApp, new Error('should skip'), 3000);

        expect(hoisted.docSet).not.toHaveBeenCalled();
    });
});
