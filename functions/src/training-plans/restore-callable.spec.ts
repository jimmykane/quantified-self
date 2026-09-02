import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    enforceAppCheck: vi.fn(),
    restore: vi.fn(),
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
    FUNCTIONS_MANIFEST: { restoreTrainingScheduleRevision: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('./restore', async () => {
    const actual = await vi.importActual<typeof import('./restore')>('./restore');
    return { ...actual, restoreTrainingScheduleRevisionForUser: hoisted.restore };
});

import { TrainingScheduleMutationError } from './mutation';
import { restoreTrainingScheduleRevision } from './restore-callable';

const DATA = {
    mutationId: 'restore-1',
    scope: { kind: 'plan', id: 'plan-1' },
    targetRevision: 2,
    expectedRevisions: [
        { scope: 'state', id: 'current', revision: 3 },
        { scope: 'plan', id: 'plan-1', revision: 4 },
    ],
};

describe('restoreTrainingScheduleRevision callable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.restore.mockResolvedValue({ skippedWorkoutIds: [] });
    });

    it('requires auth and App Check', async () => {
        await expect((restoreTrainingScheduleRevision as never as (request: unknown) => Promise<unknown>)({ data: DATA }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();

        hoisted.enforceAppCheck.mockImplementationOnce(() => { throw new Error('App Check failed.'); });
        await expect((restoreTrainingScheduleRevision as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, data: DATA,
        })).rejects.toThrow('App Check failed');
    });

    it('derives the owner from auth and passes only validated input', async () => {
        await (restoreTrainingScheduleRevision as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: DATA,
        });
        expect(hoisted.restore).toHaveBeenCalledWith('owner', DATA);
    });

    it('rejects unknown fields before persistence', async () => {
        await expect((restoreTrainingScheduleRevision as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: { ...DATA, uid: 'other' },
        })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(hoisted.restore).not.toHaveBeenCalled();
    });

    it('maps revision conflicts to aborted', async () => {
        hoisted.restore.mockRejectedValueOnce(new TrainingScheduleMutationError('revision-conflict', 'Changed.'));
        await expect((restoreTrainingScheduleRevision as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: DATA,
        })).rejects.toMatchObject({ code: 'aborted', message: 'Changed.' });
    });

    it('redacts unexpected persistence failures', async () => {
        hoisted.restore.mockRejectedValueOnce(new Error('private document path'));
        await expect((restoreTrainingScheduleRevision as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: DATA,
        })).rejects.toMatchObject({
            code: 'internal', message: 'Unable to restore this training schedule revision.',
        });
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[TrainingPlans] Revision restore failed.', { errorName: 'Error' },
        );
    });
});
