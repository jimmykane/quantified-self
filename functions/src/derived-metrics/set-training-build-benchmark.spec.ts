import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';

vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class MockHttpsError extends Error {
        constructor(public readonly code: string, message: string) {
            super(message);
        }
    },
    onCall: (_options: unknown, handler: unknown) => handler,
}));

const hoisted = vi.hoisted(() => {
    const eventGet = vi.fn();
    const settingsSet = vi.fn();
    const doc = vi.fn((path: string) => path.includes('/events/')
        ? { get: eventGet }
        : { set: settingsSet });
    const firestore = Object.assign(vi.fn(() => ({ doc })), {
        FieldValue: { delete: vi.fn(() => ({ __delete__: true })) },
    });
    return {
        eventGet,
        settingsSet,
        doc,
        firestore,
        enforceAppCheck: vi.fn(),
        getUserDeletionGuardState: vi.fn(),
        markDerivedMetricsDirtyAndMaybeQueue: vi.fn(),
    };
});

vi.mock('firebase-admin', () => ({ firestore: hoisted.firestore }));
vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: { setTrainingBuildBenchmark: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
}));
vi.mock('./derived-metrics.service', async () => {
    const actual = await vi.importActual<typeof import('./derived-metrics.service')>('./derived-metrics.service');
    return { ...actual, markDerivedMetricsDirtyAndMaybeQueue: hoisted.markDerivedMetricsDirtyAndMaybeQueue };
});

import { parseTrainingBuildBenchmarkRequest, setTrainingBuildBenchmark } from './set-training-build-benchmark';

describe('setTrainingBuildBenchmark', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: false });
        hoisted.markDerivedMetricsDirtyAndMaybeQueue.mockResolvedValue({
            accepted: true,
            queued: true,
            generation: 14,
        });
        hoisted.settingsSet.mockResolvedValue(undefined);
        hoisted.eventGet.mockResolvedValue({
            exists: true,
            data: () => ({
                name: 'Spring marathon',
                tags: ['Race'],
                startDate: Date.UTC(2026, 2, 1, 9, 0, 0),
                stats: { 'Activity Types': ['Running'] },
            }),
        });
    });

    it('requires authentication before accepting a setting write', async () => {
        await expect((setTrainingBuildBenchmark as any)({ data: {} })).rejects.toMatchObject({
            code: 'unauthenticated',
        });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
    });

    it('validates and stores only the selected sport branch, then queues only this metric', async () => {
        vi.setSystemTime(Date.UTC(2026, 5, 30, 12, 0, 0));

        const result = await (setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' },
            app: { appId: 'app-check' },
            data: {
                discipline: 'running',
                selection: { mode: 'race', durationWeeks: 12, raceEventId: 'race-1' },
            },
        });

        expect(hoisted.enforceAppCheck).toHaveBeenCalled();
        expect(hoisted.doc).toHaveBeenCalledWith('users/user-1/events/race-1');
        expect(hoisted.doc).toHaveBeenCalledWith('users/user-1/config/settings');
        expect(hoisted.settingsSet).toHaveBeenCalledWith({
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'race', durationWeeks: 12, raceEventId: 'race-1' },
                },
            },
        }, { merge: true });
        expect(hoisted.markDerivedMetricsDirtyAndMaybeQueue).toHaveBeenCalledWith('user-1', [
            DERIVED_METRIC_KINDS.TrainingBuildComparison,
        ], { incrementEventMutationVersion: false });
        expect(result).toEqual({ accepted: true, queued: true, generation: 14 });
    });

    it('accepts a valid tagged race with a legacy ISO start date', async () => {
        hoisted.eventGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                name: 'Spring marathon',
                tags: ['Race'],
                startDate: '2026-03-01T09:00:00.000Z',
                stats: { 'Activity Types': ['Running'] },
            }),
        });

        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' },
            app: { appId: 'app-check' },
            data: {
                discipline: 'running',
                selection: { mode: 'race', durationWeeks: 12, raceEventId: 'race-1' },
            },
        })).resolves.toMatchObject({ accepted: true });
        expect(hoisted.settingsSet).toHaveBeenCalled();
    });

    it('rejects races without an exact Race tag and overlapping manual periods', async () => {
        hoisted.eventGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                tags: ['Race pace'],
                startDate: Date.UTC(2026, 2, 1, 9, 0, 0),
                stats: { 'Activity Types': ['Running'] },
            }),
        });
        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: { discipline: 'running', selection: { mode: 'race', durationWeeks: 12, raceEventId: 'race-1' } },
        })).rejects.toMatchObject({ code: 'failed-precondition' });

        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: { discipline: 'cycling', selection: { mode: 'period', durationWeeks: 8, endDayMs: Date.now() } },
        })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(hoisted.settingsSet).not.toHaveBeenCalled();
    });

    it('guards deletion and clears only the selected sport benchmark', async () => {
        hoisted.getUserDeletionGuardState.mockResolvedValueOnce({ shouldSkip: true });
        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: { discipline: 'cycling', selection: null },
        })).rejects.toMatchObject({ code: 'failed-precondition' });

        hoisted.getUserDeletionGuardState.mockResolvedValueOnce({ shouldSkip: false });
        await (setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: { discipline: 'cycling', selection: null },
        });
        expect(hoisted.settingsSet).toHaveBeenLastCalledWith({
            trainingSettings: { buildBenchmarks: { cycling: { __delete__: true } } },
        }, { merge: true });
    });

    it('rejects malformed selections before reads or writes', () => {
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'period', durationWeeks: 9, endDayMs: 1 },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'race', durationWeeks: 8, raceEventId: 'race/other-user' },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'race', durationWeeks: 8, raceEventId: '..' },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'race', durationWeeks: 8, raceEventId: '__reserved__' },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'period', durationWeeks: 8, endDayMs: 1e100 },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'race', durationWeeks: 8, raceEventId: '🏃'.repeat(400) },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({ discipline: 'swimming', selection: null })).toThrow('discipline');
    });
});
