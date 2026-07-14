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
    const transactionGet = vi.fn();
    const transactionSet = vi.fn();
    const transactionUpdate = vi.fn();
    const runTransaction = vi.fn(async (callback: (transaction: unknown) => unknown) => callback({
        get: transactionGet,
        set: transactionSet,
        update: transactionUpdate,
    }));
    const doc = vi.fn((path: string) => path.includes('/events/')
        ? { path }
        : { path });
    const activitiesQuery = { kind: 'activities-query' };
    const select = vi.fn(() => activitiesQuery);
    const where = vi.fn(() => ({ select }));
    const activityCollection = { where };
    const userDoc = { collection: vi.fn(() => activityCollection) };
    const collection = vi.fn(() => ({ doc: vi.fn(() => userDoc) }));
    const firestore = Object.assign(vi.fn(() => ({ doc, runTransaction, collection })), {
        FieldValue: { delete: vi.fn(() => ({ __delete__: true })) },
    });
    return {
        transactionGet,
        transactionSet,
        transactionUpdate,
        runTransaction,
        doc,
        activitiesQuery,
        collection,
        where,
        select,
        firestore,
        enforceAppCheck: vi.fn(),
        getUserDeletionGuardState: vi.fn(),
        getUserDeletionGuardStateInTransaction: vi.fn(),
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
    getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
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
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({ shouldSkip: false });
        hoisted.markDerivedMetricsDirtyAndMaybeQueue.mockResolvedValue({
            accepted: true,
            queued: true,
            generation: 14,
        });
        hoisted.transactionGet.mockImplementation(async (ref: unknown) => {
            if (ref === hoisted.activitiesQuery) {
                return { docs: [{ data: () => ({ type: 'Running' }) }] };
            }
            return {
                exists: true,
                data: () => ({
                    name: 'Spring marathon',
                    tags: ['Race'],
                    startDate: Date.UTC(2026, 2, 1, 9, 0, 0),
                }),
            };
        });
    });

    it('requires authentication before accepting a setting write', async () => {
        await expect((setTrainingBuildBenchmark as any)({ data: {} })).rejects.toMatchObject({
            code: 'unauthenticated',
        });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
    });

    it('stops before Firestore access when App Check verification fails', async () => {
        hoisted.enforceAppCheck.mockImplementationOnce(() => {
            throw new Error('App Check verification failed.');
        });

        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: null,
            data: { discipline: 'swimming', selection: null },
        })).rejects.toThrow('App Check verification failed');
        expect(hoisted.firestore).not.toHaveBeenCalled();
    });

    it('validates and stores only the selected sport branch, then queues only this metric', async () => {
        vi.setSystemTime(Date.UTC(2026, 5, 30, 12, 0, 0));

        const result = await (setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' },
            app: { appId: 'app-check' },
            data: {
                discipline: 'running',
                selection: { mode: 'event', durationWeeks: 12, eventId: 'race-1' },
            },
        });

        expect(hoisted.enforceAppCheck).toHaveBeenCalled();
        expect(hoisted.doc).toHaveBeenCalledWith('users/user-1/events/race-1');
        expect(hoisted.doc).toHaveBeenCalledWith('users/user-1/config/settings');
        expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.anything(), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'event', durationWeeks: 12, eventId: 'race-1' },
                },
            },
        }, { merge: true });
        expect(hoisted.markDerivedMetricsDirtyAndMaybeQueue).toHaveBeenCalledWith('user-1', [
            DERIVED_METRIC_KINDS.TrainingBuildComparison,
        ], { incrementEventMutationVersion: false });
        expect(result).toEqual({ accepted: true, queued: true, generation: 14 });
    });

    it('accepts a valid historical event with an ISO start date', async () => {
        hoisted.transactionGet.mockResolvedValueOnce({
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
                selection: { mode: 'event', durationWeeks: 12, eventId: 'race-1' },
            },
        })).resolves.toMatchObject({ accepted: true });
        expect(hoisted.transactionSet).toHaveBeenCalled();
    });

    it('accepts an untagged event and rejects overlapping manual periods', async () => {
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                tags: ['Race pace'],
                startDate: Date.UTC(2026, 2, 1, 9, 0, 0),
                stats: { 'Activity Types': ['Running'] },
            }),
        });
        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: { discipline: 'running', selection: { mode: 'event', durationWeeks: 12, eventId: 'race-1' } },
        })).resolves.toMatchObject({ accepted: true });
        expect(hoisted.transactionUpdate).not.toHaveBeenCalled();
        hoisted.transactionSet.mockClear();

        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: { discipline: 'cycling', selection: { mode: 'period', durationWeeks: 8, endDayMs: Date.now() } },
        })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
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
        expect(hoisted.transactionSet).toHaveBeenLastCalledWith(expect.anything(), {
            trainingSettings: { buildBenchmarks: { cycling: { __delete__: true } } },
        }, { merge: true });
    });

    it('rechecks deletion state inside the atomic benchmark write', async () => {
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({ shouldSkip: true });

        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: { discipline: 'cycling', selection: null },
        })).rejects.toMatchObject({ code: 'failed-precondition' });

        expect(hoisted.transactionSet).not.toHaveBeenCalled();
        expect(hoisted.markDerivedMetricsDirtyAndMaybeQueue).not.toHaveBeenCalled();
    });

    it('rejects malformed selections before reads or writes', () => {
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'period', durationWeeks: 9, endDayMs: 1 },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'event', durationWeeks: 8, eventId: 'event/other-user' },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'event', durationWeeks: 8, eventId: '..' },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'event', durationWeeks: 8, eventId: '__reserved__' },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'period', durationWeeks: 8, endDayMs: 1e100 },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'event', durationWeeks: 8, eventId: '🏃'.repeat(400) },
        })).toThrow('selection must be a valid');
        expect(() => parseTrainingBuildBenchmarkRequest({ discipline: 'rowing', selection: null })).toThrow('discipline');
        expect(() => parseTrainingBuildBenchmarkRequest({
            discipline: 'running',
            selection: { mode: 'session', durationWeeks: 8, eventId: 'event-1' },
        })).toThrow('selection must be a valid');
    });

    it('accepts Swimming when the selected parent event has a swimming activity leg', async () => {
        hoisted.transactionGet.mockImplementation(async (ref: unknown) => {
            if (ref === hoisted.activitiesQuery) {
                return { docs: [{ data: () => ({ type: 'Open Water Swimming' }) }] };
            }
            return {
                exists: true,
                data: () => ({ tags: ['Race'], startDate: Date.UTC(2026, 1, 1) }),
            };
        });

        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: {
                discipline: 'swimming',
                selection: { mode: 'event', durationWeeks: 8, eventId: 'triathlon-1' },
            },
        })).resolves.toMatchObject({ accepted: true });
        expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.anything(), {
            trainingSettings: {
                buildBenchmarks: {
                    swimming: { mode: 'event', durationWeeks: 8, eventId: 'triathlon-1' },
                },
            },
        }, { merge: true });
    });

    it('saves an untagged event benchmark without changing the event', async () => {
        hoisted.transactionGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                name: 'Long run dress rehearsal',
                tags: ['Marathon block'],
                benchmarkReviewTags: ['stale'],
                startDate: Date.UTC(2026, 2, 1, 9, 0, 0),
                stats: { 'Activity Types': ['Running'] },
            }),
        });

        await expect((setTrainingBuildBenchmark as any)({
            auth: { uid: 'user-1' }, app: {},
            data: {
                discipline: 'running',
                selection: { mode: 'event', durationWeeks: 12, eventId: 'event-1' },
            },
        })).resolves.toMatchObject({ accepted: true });

        expect(hoisted.transactionUpdate).not.toHaveBeenCalled();
        expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.anything(), {
            trainingSettings: {
                buildBenchmarks: {
                    running: { mode: 'event', durationWeeks: 12, eventId: 'event-1' },
                },
            },
        }, { merge: true });
    });
});
