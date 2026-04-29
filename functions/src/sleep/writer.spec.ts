import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SLEEP_PROVIDERS, SLEEP_STAGES, SleepSession } from '../../../shared/sleep';

const hoisted = vi.hoisted(() => ({
    docGet: vi.fn(),
    docSet: vi.fn(),
    docIds: [] as string[],
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../utils', () => ({
    generateIDFromParts: vi.fn(async (parts: string[]) => parts.join(':')),
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
        })),
    };
});

import { upsertSleepSessions } from './writer';

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
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.objectContaining({
            durationSeconds: 33300,
            inBedDurationSeconds: 34260,
            isNap: false,
            createdAtMs: 1000,
            updatedAtMs: 3000,
        }), { merge: true });
    });
});
