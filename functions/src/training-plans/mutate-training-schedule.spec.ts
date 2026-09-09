import { ActivityTypes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    enforceAppCheck: vi.fn(),
    mutateTrainingScheduleForUser: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class MockHttpsError extends Error {
        constructor(public readonly code: string, message: string) {
            super(message);
        }
    },
    onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({ error: hoisted.loggerError }));
vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: { mutateTrainingSchedule: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('./persistence', () => ({ mutateTrainingScheduleForUser: hoisted.mutateTrainingScheduleForUser }));

import { TrainingScheduleMutationError } from './mutation';
import { mutateTrainingSchedule } from './mutate-training-schedule';

const VALID_DATA = {
    mutationId: 'create-1',
    expectedRevisions: [{ scope: 'state', id: 'current', revision: 0 }],
    operation: {
        kind: 'create-workout',
        workoutId: 'workout-1',
        planId: null,
        localDate: '2026-09-02',
        title: 'Easy run',
        structure: {
            version: 1,
            sport: ActivityTypes.Running,
            nodes: [{
                kind: 'step',
                id: 'steady',
                purpose: 'work',
                ending: { kind: 'time', seconds: 1800 },
                targets: [],
            }],
        },
        confirmPlanRangeExtension: false,
    },
};

describe('mutateTrainingSchedule callable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.mutateTrainingScheduleForUser.mockResolvedValue({
            mutationId: 'create-1',
            state: {
                schemaVersion: 1,
                activePlanId: null,
                revision: 1,
                currentWorkoutCount: 1,
                updatedAtMs: 1,
            },
            plans: [],
            workouts: [],
            removedPlanIds: [],
            permanentlyDeletedWorkoutIds: [],
        });
    });

    it('requires authentication before App Check or persistence', async () => {
        await expect((mutateTrainingSchedule as never as (request: unknown) => Promise<unknown>)({ data: VALID_DATA }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
        expect(hoisted.mutateTrainingScheduleForUser).not.toHaveBeenCalled();
    });

    it('enforces App Check before validating or persisting', async () => {
        hoisted.enforceAppCheck.mockImplementationOnce(() => {
            throw new Error('App Check verification failed.');
        });
        await expect((mutateTrainingSchedule as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'user-1' }, data: VALID_DATA,
        })).rejects.toThrow('App Check verification failed');
        expect(hoisted.mutateTrainingScheduleForUser).not.toHaveBeenCalled();
    });

    it('normalizes the request and derives ownership only from auth', async () => {
        await (mutateTrainingSchedule as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner-user' },
            app: { appId: 'app-check' },
            data: { ...VALID_DATA, userID: undefined },
        }).catch(() => undefined);

        expect(hoisted.mutateTrainingScheduleForUser).not.toHaveBeenCalled();

        await (mutateTrainingSchedule as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner-user' },
            app: { appId: 'app-check' },
            data: VALID_DATA,
        });
        expect(hoisted.mutateTrainingScheduleForUser).toHaveBeenCalledWith(
            'owner-user',
            expect.objectContaining({ mutationId: 'create-1' }),
        );
    });

    it('rejects malformed and provider-contaminated structures before persistence', async () => {
        await expect((mutateTrainingSchedule as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'user-1' },
            app: {},
            data: {
                ...VALID_DATA,
                operation: {
                    ...VALID_DATA.operation,
                    structure: { ...VALID_DATA.operation.structure, providerId: 'garmin' },
                },
            },
        })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(hoisted.mutateTrainingScheduleForUser).not.toHaveBeenCalled();
    });

    it.each([
        ['revision-conflict', 'aborted'],
        ['range-extension-required', 'failed-precondition'],
        ['limit-exceeded', 'resource-exhausted'],
        ['not-found', 'not-found'],
        ['already-exists', 'already-exists'],
    ] as const)('maps %s without exposing storage internals', async (serviceCode, callableCode) => {
        hoisted.mutateTrainingScheduleForUser.mockRejectedValueOnce(
            new TrainingScheduleMutationError(serviceCode, 'Safe message.'),
        );
        await expect((mutateTrainingSchedule as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'user-1' }, app: {}, data: VALID_DATA,
        })).rejects.toMatchObject({ code: callableCode, message: 'Safe message.' });
    });

    it('redacts unexpected persistence failures', async () => {
        hoisted.mutateTrainingScheduleForUser.mockRejectedValueOnce(new Error('private Firestore path'));
        await expect((mutateTrainingSchedule as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'user-1' }, app: {}, data: VALID_DATA,
        })).rejects.toMatchObject({
            code: 'internal',
            message: 'Unable to update the training schedule.',
        });
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[TrainingPlans] Schedule mutation failed.',
            { errorName: 'Error' },
        );
    });
});
