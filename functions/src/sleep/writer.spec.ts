import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { SLEEP_PROVIDERS, SLEEP_STAGES, SleepSession } from '../../../shared/sleep';
import { encodeSleepSessionSportsLibData } from '../../../shared/sports-lib-health-data';

const hoisted = vi.hoisted(() => ({
    docGet: vi.fn(),
    docSet: vi.fn(),
    docIds: [] as string[],
    deleteField: Object.freeze({ __fieldValue: 'delete' }),
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
    interface MockDocumentReference {
        id: string;
        get: typeof hoisted.docGet;
        set: typeof hoisted.docSet;
        collection: () => MockCollectionReference;
    }

    interface MockCollectionReference {
        doc: (id: string) => MockDocumentReference;
    }

    const collectionRef: MockCollectionReference = {
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

vi.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        delete: vi.fn(() => hoisted.deleteField),
    },
}));

import {
    markSleepSyncError,
    SleepLifecycleGuardConfigurationError,
    SleepLifecycleGuardReadError,
    updateSleepSyncState,
    upsertSleepSession,
    upsertSleepSessions,
} from './writer';

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

function tokenCredential(accessToken: string, credentialGeneration: string | null = null) {
    return {
        accessToken,
        refreshToken: '',
        expiresAt: 0,
        dateCreated: 0,
        dateRefreshed: 0,
        credentialGeneration,
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
            durationSeconds: hoisted.deleteField,
            inBedDurationSeconds: hoisted.deleteField,
            stageDurationsSeconds: hoisted.deleteField,
            score: hoisted.deleteField,
            vitals: hoisted.deleteField,
            isNap: false,
            sportsLibData: {
                schemaVersion: 1,
                metrics: expect.objectContaining({
                    duration: { 'Sleep Duration': 33300 },
                    inBedDuration: { 'Sleep In-Bed Duration': 34260 },
                    deepDuration: { 'Deep Sleep Duration': 6210 },
                }),
            },
            createdAtMs: 1000,
            updatedAtMs: 3000,
        }), { merge: true });
    });

    it('derives Sports Lib JSON instead of trusting mapper-supplied JSON', async () => {
        const result = await upsertSleepSession('user-1', buildMapperResult({
            sportsLibData: {
                schemaVersion: 1,
                metrics: { duration: { 'Sleep Duration': 999 } },
            },
        }), 3000);

        expect(result.written).toBe(true);
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            sportsLibData: expect.objectContaining({
                metrics: expect.objectContaining({ duration: { 'Sleep Duration': 33300 } }),
            }),
        }), { merge: true });
    });

    it('deletes stale Sports Lib slots when optional sleep aggregates are cleared', async () => {
        const existingSession = encodeSleepSessionSportsLibData(buildExistingSuuntoSession({
            score: { value: 88 },
            vitals: { averageHrvMs: 61, overnightHrvMs: 64 },
        }));
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => existingSession,
        });

        const result = await upsertSleepSession('user-1', buildMapperResult({
            inBedDurationSeconds: null,
            score: null,
            vitals: { averageHrvMs: null },
        }), 3000);

        expect(result.written).toBe(true);
        expect(result.session.inBedDurationSeconds).toBeNull();
        expect(result.session.score).toBeNull();
        expect(result.session.vitals?.averageHrvMs).toBeNull();
        expect(result.session.sportsLibData?.metrics).not.toHaveProperty('inBedDuration');
        expect(result.session.sportsLibData?.metrics).not.toHaveProperty('score');
        expect(result.session.sportsLibData?.metrics).not.toHaveProperty('averageHrv');

        const writePayload = hoisted.docSet.mock.calls[0][1] as Record<string, unknown>;
        const sportsLibData = writePayload.sportsLibData as Record<string, unknown>;
        const metrics = sportsLibData.metrics as Record<string, unknown>;
        expect(writePayload.durationSeconds).toBe(hoisted.deleteField);
        expect(writePayload.inBedDurationSeconds).toBe(hoisted.deleteField);
        expect(writePayload.stageDurationsSeconds).toBe(hoisted.deleteField);
        expect(writePayload.score).toBe(hoisted.deleteField);
        expect(writePayload.vitals).toBe(hoisted.deleteField);
        expect(metrics.inBedDuration).toBe(hoisted.deleteField);
        expect(metrics.score).toBe(hoisted.deleteField);
        expect(metrics.averageHrv).toBe(hoisted.deleteField);
        expect(metrics).not.toHaveProperty('overnightHrv');
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.any(Object), writePayload, { merge: true });
    });

    it('keeps non-scalar score metadata while removing duplicate aggregate storage', async () => {
        const result = await upsertSleepSession('user-1', buildMapperResult({
            score: { value: 88, qualifier: 'good', components: { recovery: 90 } },
            vitals: { averageHrvMs: 61, averageHeartRateBpm: 54 },
        }), 3000);

        expect(result.written).toBe(true);
        const writePayload = hoisted.docSet.mock.calls[0][1] as Record<string, unknown>;
        expect(writePayload.score).toEqual({
            value: hoisted.deleteField,
            qualifier: 'good',
            components: { recovery: 90 },
        });
        expect(writePayload.vitals).toBe(hoisted.deleteField);
        expect(writePayload.sportsLibData).toEqual({
            schemaVersion: 1,
            metrics: expect.objectContaining({
                score: { 'Sleep Score': 88 },
                averageHrv: { 'Average Sleep HRV': 61 },
                averageHeartRate: { 'Average Sleep Heart Rate': 54 },
            }),
        });
    });

    it('skips unchanged duplicate Garmin sessions even when callback metadata differs', async () => {
        const existingSession = buildExistingSuuntoSession({
            source: {
                provider: SLEEP_PROVIDERS.GarminAPI,
                providerUserId: 'garmin-user-1',
                sourceSessionKey: 'garmin-summary-1',
                callbackURL: 'https://apis.garmin.com/wellness-api/rest/sleeps?old=true',
                receivedAtMs: 2000,
            },
        });
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => encodeSleepSessionSportsLibData(existingSession),
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
            durationSeconds: hoisted.deleteField,
            createdAtMs: 1000,
            updatedAtMs: 3000,
        }), { merge: true });
    });

    it('preserves recoverable legacy COROS Health fields until the guarded migration cleans them', async () => {
        const incoming = buildMapperResult({
            source: {
                provider: SLEEP_PROVIDERS.COROSAPI,
                providerUserId: 'coros-account',
                sourceSessionKey: 'sleep-1',
            },
            providerFields: {
                coros: {
                    happenDay: '20260429',
                    timezoneOffsetSeconds: 0,
                },
            },
        });
        const existing: SleepSession = {
            ...incoming.session,
            id: 'existing-session',
            userID: 'user-1',
            hrvSamples: [{ timestampMs: 1_777_000_000_000, value: 50 }],
            providerFields: {
                coros: {
                    ...incoming.session.providerFields?.coros,
                    step: 12_345,
                    calorie: 2_000,
                    rhr: 48,
                    ppgHrv: 55,
                    sleepAvgHr: 52,
                },
            },
            createdAtMs: 1000,
            updatedAtMs: 2000,
        };
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => existing,
        });

        const result = await upsertSleepSessions('user-1', [incoming], 3000);

        expect(result).toEqual({ written: 0, skipped: 1 });
        expect(hoisted.docSet).not.toHaveBeenCalled();
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

    it('does not write a COROS Sleep session after its token lifecycle guard disappears', async () => {
        const tokenRef = { id: 'private-provider-account' } as admin.firestore.DocumentReference;
        hoisted.docGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

        const result = await upsertSleepSessions(
            'user-1',
            [buildMapperResult({
                source: {
                    provider: SLEEP_PROVIDERS.COROSAPI,
                    providerUserId: 'private-provider-account',
                    sourceSessionKey: 'sleep-1',
                },
            })],
            3000,
            { requiredExistingDocumentRef: tokenRef },
        );

        expect(result).toEqual({
            written: 0,
            skipped: 1,
            lifecycleGuardSkipped: true,
        });
        expect(hoisted.docGet).toHaveBeenCalledWith(tokenRef);
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('rejects token-credential guards without a document reference', async () => {
        await expect(upsertSleepSessions('user-1', [], 3000, {
            requiredExistingTokenCredential: tokenCredential('captured-token'),
        })).rejects.toBeInstanceOf(SleepLifecycleGuardConfigurationError);

        expect(hoisted.mockRunTransaction).not.toHaveBeenCalled();
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not write a COROS Sleep session after its token credential changes', async () => {
        const tokenRef = { id: 'private-provider-account' } as admin.firestore.DocumentReference;
        hoisted.docGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                openId: 'private-provider-account',
                accessToken: 'captured-token',
                tokenCredentialGeneration: 'replacement-generation',
            }),
        });

        const result = await upsertSleepSessions(
            'user-1',
            [buildMapperResult({
                source: {
                    provider: SLEEP_PROVIDERS.COROSAPI,
                    providerUserId: 'private-provider-account',
                    sourceSessionKey: 'sleep-1',
                },
            })],
            3000,
            {
                requiredExistingDocumentRef: tokenRef,
                requiredExistingTokenCredential: tokenCredential(
                    'captured-token',
                    'captured-generation',
                ),
            },
        );

        expect(result).toEqual({
            written: 0,
            skipped: 1,
            lifecycleGuardSkipped: true,
        });
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('redacts token paths when a Sleep lifecycle guard read fails', async () => {
        const privateAccountId = 'private-provider-account';
        const tokenRef = { id: privateAccountId } as admin.firestore.DocumentReference;
        hoisted.docGet.mockRejectedValueOnce(new Error(
            `Read failed at COROSAPIAccessTokens/user-1/tokens/${privateAccountId}`,
        ));

        const write = upsertSleepSession(
            'user-1',
            buildMapperResult({
                source: {
                    provider: SLEEP_PROVIDERS.COROSAPI,
                    providerUserId: privateAccountId,
                    sourceSessionKey: 'sleep-1',
                },
            }),
            3000,
            { requiredExistingDocumentRef: tokenRef },
        );

        await expect(write).rejects.toBeInstanceOf(SleepLifecycleGuardReadError);
        await expect(write).rejects.toThrow('Sleep lifecycle guard could not be read.');
        await expect(write).rejects.not.toThrow(privateAccountId);
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not write a COROS Sleep session after its connection generation changes', async () => {
        const tokenRef = { id: 'private-provider-account' } as admin.firestore.DocumentReference;
        const serviceMetaRef = { id: 'corosAPI' } as admin.firestore.DocumentReference;
        hoisted.docGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    openId: 'private-provider-account',
                    accessToken: 'captured-token',
                    tokenCredentialGeneration: 'captured-generation',
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    providerUserId: 'replacement-account',
                    connectionState: 'connected',
                    connectionStateGeneration: 'new-generation',
                }),
            });

        const result = await upsertSleepSessions(
            'user-1',
            [buildMapperResult({
                source: {
                    provider: SLEEP_PROVIDERS.COROSAPI,
                    providerUserId: 'private-provider-account',
                    sourceSessionKey: 'sleep-1',
                },
            })],
            3000,
            {
                requiredExistingDocumentRef: tokenRef,
                requiredExistingTokenCredential: tokenCredential(
                    'captured-token',
                    'captured-generation',
                ),
                requiredDocumentFieldValues: {
                    documentRef: serviceMetaRef,
                    expectedFields: {
                        providerUserId: 'private-provider-account',
                        connectionState: 'connected',
                        connectionStateGeneration: 'old-generation',
                    },
                },
            },
        );

        expect(result).toEqual({
            written: 0,
            skipped: 1,
            lifecycleGuardSkipped: true,
        });
        expect(hoisted.docGet).toHaveBeenCalledWith(tokenRef);
        expect(hoisted.docGet).toHaveBeenCalledWith(serviceMetaRef);
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not write a COROS Sleep session after its token root is deleted', async () => {
        const tokenRef = { id: 'private-provider-account' } as admin.firestore.DocumentReference;
        const serviceMetaRef = { id: 'corosAPI' } as admin.firestore.DocumentReference;
        const tokenRootRef = { id: 'user-1' } as admin.firestore.DocumentReference;
        hoisted.docGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    accessToken: 'captured-token',
                    tokenCredentialGeneration: 'captured-generation',
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    providerUserId: 'private-provider-account',
                    connectionState: 'connected',
                    connectionStateGeneration: 'connection-generation-1',
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => undefined });

        const result = await upsertSleepSessions(
            'user-1',
            [buildMapperResult({
                source: {
                    provider: SLEEP_PROVIDERS.COROSAPI,
                    providerUserId: 'private-provider-account',
                    sourceSessionKey: 'sleep-1',
                },
            })],
            3000,
            {
                requiredExistingDocumentRef: tokenRef,
                requiredExistingTokenCredential: tokenCredential(
                    'captured-token',
                    'captured-generation',
                ),
                requiredDocumentFieldValues: {
                    documentRef: serviceMetaRef,
                    expectedFields: {
                        providerUserId: 'private-provider-account',
                        connectionState: 'connected',
                        connectionStateGeneration: 'connection-generation-1',
                    },
                },
                additionalRequiredDocumentFieldValues: [{
                    documentRef: tokenRootRef,
                    expectedFields: {
                        activeOAuthCredentialGeneration: 'captured-generation',
                    },
                }],
            },
        );

        expect(result).toEqual({
            written: 0,
            skipped: 1,
            lifecycleGuardSkipped: true,
        });
        expect(hoisted.docGet).toHaveBeenCalledWith(tokenRootRef);
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not recreate sleep sync state when user deletion is in progress', async () => {
        hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        const written = await updateSleepSyncState('user-1', SLEEP_PROVIDERS.SuuntoApp, {
            lastError: 'ignored',
        }, 3000);

        expect(written).toBe(false);
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not write COROS Sleep sync state after its connection generation changes', async () => {
        const tokenRef = { id: 'private-provider-account' } as admin.firestore.DocumentReference;
        const serviceMetaRef = { id: 'corosAPI' } as admin.firestore.DocumentReference;
        hoisted.docGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ openId: 'private-provider-account' }) })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    providerUserId: 'replacement-account',
                    connectionState: 'connected',
                    connectionStateGeneration: 'new-generation',
                }),
            });

        const written = await updateSleepSyncState(
            'user-1',
            SLEEP_PROVIDERS.COROSAPI,
            { status: 'ready', lastError: null },
            3000,
            {
                requiredExistingDocumentRef: tokenRef,
                requiredDocumentFieldValues: {
                    documentRef: serviceMetaRef,
                    expectedFields: {
                        providerUserId: 'private-provider-account',
                        connectionState: 'connected',
                        connectionStateGeneration: 'old-generation',
                    },
                },
            },
        );

        expect(written).toBe(false);
        expect(hoisted.docGet).toHaveBeenCalledWith(tokenRef);
        expect(hoisted.docGet).toHaveBeenCalledWith(serviceMetaRef);
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('does not write COROS Sleep sync state after its token credential changes', async () => {
        const tokenRef = { id: 'private-provider-account' } as admin.firestore.DocumentReference;
        hoisted.docGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                accessToken: 'captured-token',
                tokenCredentialGeneration: 'replacement-generation',
            }),
        });

        const written = await updateSleepSyncState(
            'user-1',
            SLEEP_PROVIDERS.COROSAPI,
            { status: 'ready', lastError: null },
            3000,
            {
                requiredExistingDocumentRef: tokenRef,
                requiredExistingTokenCredential: tokenCredential(
                    'captured-token',
                    'captured-generation',
                ),
            },
        );

        expect(written).toBe(false);
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });

    it('writes COROS Sleep sync state while its exact lifecycle remains current', async () => {
        const tokenRef = { id: 'private-provider-account' } as admin.firestore.DocumentReference;
        const serviceMetaRef = { id: 'corosAPI' } as admin.firestore.DocumentReference;
        hoisted.docGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    openId: 'private-provider-account',
                    accessToken: 'captured-token',
                    tokenCredentialGeneration: 'captured-generation',
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    providerUserId: 'private-provider-account',
                    connectionState: 'connected',
                    connectionStateGeneration: 'current-generation',
                }),
            });

        const written = await updateSleepSyncState(
            'user-1',
            SLEEP_PROVIDERS.COROSAPI,
            { status: 'ready', lastError: null },
            3000,
            {
                requiredExistingDocumentRef: tokenRef,
                requiredExistingTokenCredential: tokenCredential(
                    'captured-token',
                    'captured-generation',
                ),
                requiredDocumentFieldValues: {
                    documentRef: serviceMetaRef,
                    expectedFields: {
                        providerUserId: 'private-provider-account',
                        connectionState: 'connected',
                        connectionStateGeneration: 'current-generation',
                    },
                },
            },
        );

        expect(written).toBe(true);
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            provider: SLEEP_PROVIDERS.COROSAPI,
            status: 'ready',
            updatedAtMs: 3000,
        }), { merge: true });
    });

    it('does not recreate sleep sync error state for a missing user', async () => {
        hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: false,
            deletionInProgress: false,
            shouldSkip: true,
        });

        const written = await markSleepSyncError(
            'user-1',
            SLEEP_PROVIDERS.SuuntoApp,
            new Error('should skip'),
            3000,
        );

        expect(written).toBe(false);
        expect(hoisted.docSet).not.toHaveBeenCalled();
    });
});
