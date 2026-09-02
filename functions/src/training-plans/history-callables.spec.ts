import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    enforceAppCheck: vi.fn(),
    getHistory: vi.fn(),
    previewRestore: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class MockHttpsError extends Error {
        constructor(public readonly code: string, message: string) { super(message); }
    },
    onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({ error: hoisted.loggerError }));
vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        getTrainingScheduleHistory: { region: 'europe-west2' },
        previewTrainingScheduleRestore: { region: 'europe-west2' },
    },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('./history', async () => {
    const actual = await vi.importActual<typeof import('./history')>('./history');
    return {
        ...actual,
        getTrainingScheduleHistoryForUser: hoisted.getHistory,
        previewTrainingScheduleRestoreForUser: hoisted.previewRestore,
    };
});

import { getTrainingScheduleHistory, previewTrainingScheduleRestore } from './history-callables';

describe('training schedule history callables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.getHistory.mockResolvedValue({ entries: [] });
        hoisted.previewRestore.mockResolvedValue({ changedWorkoutIds: [] });
    });

    it.each([
        ['history', getTrainingScheduleHistory],
        ['preview', previewTrainingScheduleRestore],
    ] as const)('requires auth and App Check for %s', async (_label, callable) => {
        await expect((callable as never as (request: unknown) => Promise<unknown>)({ data: {} }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();

        hoisted.enforceAppCheck.mockImplementationOnce(() => { throw new Error('App Check verification failed.'); });
        await expect((callable as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'user-1' }, data: {},
        })).rejects.toThrow('App Check verification failed');
    });

    it('bounds history input and derives the owner from auth', async () => {
        await (getTrainingScheduleHistory as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {},
            data: { scope: { kind: 'plan', id: 'plan-1' }, limit: 10 },
        });
        expect(hoisted.getHistory).toHaveBeenCalledWith('owner', {
            scope: { kind: 'plan', id: 'plan-1' }, limit: 10,
        });

        await expect((getTrainingScheduleHistory as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {},
            data: { scope: { kind: 'plan', id: 'plan-1' }, limit: 1000 },
        })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('passes only a validated restore target to preview', async () => {
        await (previewTrainingScheduleRestore as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {},
            data: { scope: { kind: 'workout', id: 'workout-1' }, targetRevision: 2 },
        });
        expect(hoisted.previewRestore).toHaveBeenCalledWith('owner', {
            scope: { kind: 'workout', id: 'workout-1' }, targetRevision: 2,
        });
    });

    it('redacts unexpected history failures', async () => {
        hoisted.getHistory.mockRejectedValueOnce(new Error('private history payload'));
        await expect((getTrainingScheduleHistory as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {},
            data: { scope: { kind: 'plan', id: 'plan-1' } },
        })).rejects.toMatchObject({
            code: 'internal', message: 'Unable to load training schedule history.',
        });
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[TrainingPlans] History query failed.', { errorName: 'Error' },
        );
    });
});
