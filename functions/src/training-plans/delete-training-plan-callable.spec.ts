import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    enforceAppCheck: vi.fn(),
    deletePlan: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class MockHttpsError extends Error {
        constructor(public readonly code: string, message: string) { super(message); }
    },
    onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({ error: hoisted.loggerError, warn: hoisted.loggerWarn }));
vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: { deleteTrainingPlan: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('./delete-training-plan', () => ({
    deleteTrainingPlanForUser: hoisted.deletePlan,
    TrainingPlanDeletionResumeRequiredError: class extends Error {
        constructor(public readonly originalError: unknown) { super('Plan deletion interrupted.'); }
    },
}));

import { TrainingScheduleMutationError } from './mutation';
import { TrainingPlanDeletionResumeRequiredError } from './delete-training-plan';
import { deleteTrainingPlan } from './delete-training-plan-callable';

const DATA = {
    mutationId: 'delete-plan-1',
    planId: 'plan-1',
    expectedRevisions: [
        { scope: 'state', id: 'current', revision: 8 },
        { scope: 'plan', id: 'plan-1', revision: 4 },
    ],
    workoutDisposition: 'convert-to-standalone',
    confirmPlanDeletion: true,
};

describe('deleteTrainingPlan callable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.deletePlan.mockResolvedValue({ removedPlanId: 'plan-1' });
    });

    it('requires auth and App Check', async () => {
        await expect((deleteTrainingPlan as never as (request: unknown) => Promise<unknown>)({ data: DATA }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();

        hoisted.enforceAppCheck.mockImplementationOnce(() => { throw new Error('App Check failed.'); });
        await expect((deleteTrainingPlan as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, data: DATA,
        })).rejects.toThrow('App Check failed');
    });

    it('derives the owner and passes an explicitly confirmed disposition', async () => {
        await (deleteTrainingPlan as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: DATA,
        });
        expect(hoisted.deletePlan).toHaveBeenCalledWith('owner', DATA);
    });

    it('rejects deletion without exact confirmation', async () => {
        await expect((deleteTrainingPlan as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: { ...DATA, confirmPlanDeletion: false },
        })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(hoisted.deletePlan).not.toHaveBeenCalled();
    });

    it('maps revision conflicts to aborted', async () => {
        hoisted.deletePlan.mockRejectedValueOnce(new TrainingScheduleMutationError('revision-conflict', 'Changed.'));
        await expect((deleteTrainingPlan as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: DATA,
        })).rejects.toMatchObject({ code: 'aborted', message: 'Changed.' });
    });

    it('preserves actionable errors and safe-retry guidance from an interrupted plan deletion', async () => {
        hoisted.deletePlan.mockRejectedValueOnce(new TrainingPlanDeletionResumeRequiredError(
            new TrainingScheduleMutationError('limit-exceeded', 'A snapshot is too large.'),
        ));
        await expect((deleteTrainingPlan as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: DATA,
        })).rejects.toMatchObject({ code: 'resource-exhausted', message: 'A snapshot is too large.' });

        hoisted.deletePlan.mockRejectedValueOnce(new TrainingPlanDeletionResumeRequiredError(new Error('private path')));
        await expect((deleteTrainingPlan as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: DATA,
        })).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('Retry with the same choice') });
        expect(hoisted.loggerWarn).toHaveBeenCalledWith('[TrainingPlans] Plan deletion needs a resumable retry.',
            { errorName: 'Error' });
    });

    it('redacts unexpected failures while telling the client to retry identically', async () => {
        hoisted.deletePlan.mockRejectedValueOnce(new Error('private Firestore path'));
        await expect((deleteTrainingPlan as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner' }, app: {}, data: DATA,
        })).rejects.toMatchObject({
            code: 'internal', message: 'Unable to delete this training plan. Retry with the same request.',
        });
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[TrainingPlans] Plan deletion failed.', { errorName: 'Error' },
        );
    });
});
