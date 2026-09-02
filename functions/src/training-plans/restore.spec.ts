import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
    TRAINING_PLAN_MAX_CURRENT_WORKOUTS,
    type RestoreTrainingScheduleRevisionRequestV1,
    type ScheduledWorkoutV1,
    type TrainingPlanV1,
} from '../../../shared/training-plans';
import type { ReconstructedTrainingPlanRevisionV1 } from './history';
import { createEmptyTrainingPlanState, type TrainingScheduleSnapshotV1 } from './mutation';
import {
    applyPlanRevisionRestore,
    applyStandaloneRevisionRestore,
    parseRestoreTrainingScheduleRevisionRequest,
} from './restore';

const NOW_MS = Date.UTC(2026, 8, 2, 12);
const STRUCTURE = {
    version: 1 as const,
    sport: ActivityTypes.Running,
    nodes: [{
        kind: 'step' as const,
        id: 'steady',
        purpose: 'work' as const,
        ending: { kind: 'time' as const, seconds: 1800 },
        targets: [],
    }],
};

function plan(overrides: Partial<TrainingPlanV1> = {}): TrainingPlanV1 {
    return {
        schemaVersion: 1,
        id: 'plan-1',
        name: 'Current plan',
        lifecycle: 'paused',
        startLocalDate: '2026-09-01',
        endLocalDate: '2026-09-30',
        revision: 4,
        lastCheckpointRevision: 1,
        workoutCount: 1,
        createdAtMs: 1,
        updatedAtMs: 4,
        ...overrides,
    };
}

function workout(overrides: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 {
    return {
        schemaVersion: 1,
        id: 'workout-1',
        planId: 'plan-1',
        localDate: '2026-09-02',
        lifecycle: 'planned',
        title: 'Current workout',
        structure: STRUCTURE,
        revision: 3,
        createdAtMs: 1,
        updatedAtMs: 3,
        ...overrides,
    };
}

function snapshot(
    plans: TrainingPlanV1[],
    workouts: ScheduledWorkoutV1[],
    activePlanId: string | null = null,
): TrainingScheduleSnapshotV1 {
    return {
        state: {
            ...createEmptyTrainingPlanState(0),
            activePlanId,
            revision: 9,
            currentWorkoutCount: workouts.filter(item => item.lifecycle !== 'deleted').length,
        },
        plans: new Map(plans.map(item => [item.id, item])),
        workouts: new Map(workouts.map(item => [item.id, item])),
    };
}

function planRequest(
    expectedRevisions: RestoreTrainingScheduleRevisionRequestV1['expectedRevisions'] = [
        { scope: 'state', id: 'current', revision: 9 },
        { scope: 'plan', id: 'plan-1', revision: 4 },
    ],
): RestoreTrainingScheduleRevisionRequestV1 {
    return {
        mutationId: 'restore-plan-1',
        expectedRevisions,
        scope: { kind: 'plan', id: 'plan-1' },
        targetRevision: 2,
    };
}

describe('parseRestoreTrainingScheduleRevisionRequest', () => {
    it('strictly parses a revision-checked restore request', () => {
        expect(parseRestoreTrainingScheduleRevisionRequest(planRequest())).toEqual(planRequest());
    });

    it('rejects unknown fields and duplicate revision checks', () => {
        expect(() => parseRestoreTrainingScheduleRevisionRequest({ ...planRequest(), uid: 'other' }))
            .toThrow('Unknown field');
        expect(() => parseRestoreTrainingScheduleRevisionRequest({
            ...planRequest(),
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 9 },
                { scope: 'state', id: 'current', revision: 9 },
            ],
        })).toThrow('Duplicate revision check');
        expect(() => parseRestoreTrainingScheduleRevisionRequest({
            ...planRequest(),
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 9, uid: 'other-user' },
            ],
        })).toThrow('Unknown field');
    });
});

describe('applyPlanRevisionRestore', () => {
    it('creates a new checkpoint revision and restores same-plan workout state', () => {
        const currentPlan = plan();
        const currentWorkout = workout();
        const desiredWorkout = workout({ title: 'Earlier workout', revision: 1, updatedAtMs: 1 });
        const desired: ReconstructedTrainingPlanRevisionV1 = {
            plan: plan({ name: 'Earlier plan', revision: 2, lastCheckpointRevision: 1, updatedAtMs: 2 }),
            workouts: new Map([[desiredWorkout.id, desiredWorkout]]),
        };

        const result = applyPlanRevisionRestore(
            snapshot([currentPlan], [currentWorkout]), desired, planRequest(), NOW_MS,
        );

        expect(result.applied.after.plans.get('plan-1')).toMatchObject({
            name: 'Earlier plan', revision: 5, lastCheckpointRevision: 5, workoutCount: 1,
        });
        expect(result.applied.after.workouts.get('workout-1')).toMatchObject({
            title: 'Earlier workout', revision: 4, updatedAtMs: NOW_MS,
        });
        expect(result.applied.after.state.revision).toBe(10);
        expect(result.applied.bulkOperation).toBe(true);
        expect(result.response.skippedWorkoutIds).toEqual([]);
    });

    it('skips a desired workout that moved to another scope and deletes same-plan extras recoverably', () => {
        const currentPlan = plan({ workoutCount: 1 });
        const moved = workout({ planId: null, title: 'Now standalone' });
        const extra = workout({ id: 'extra', title: 'Newer extra' });
        const desired: ReconstructedTrainingPlanRevisionV1 = {
            plan: plan({ revision: 2, lastCheckpointRevision: 1 }),
            workouts: new Map([[moved.id, workout({ revision: 1, title: 'Old plan copy' })]]),
        };

        const result = applyPlanRevisionRestore(
            snapshot([currentPlan], [moved, extra]), desired, planRequest(), NOW_MS,
        );

        expect(result.response.skippedWorkoutIds).toEqual(['workout-1']);
        expect(result.applied.after.workouts.get('workout-1')).toEqual(moved);
        expect(result.applied.after.workouts.get('extra')).toMatchObject({
            lifecycle: 'deleted', revision: 4, deletedAtMs: NOW_MS,
        });
        expect(result.applied.after.state.currentWorkoutCount).toBe(1);
        expect(result.applied.after.plans.get('plan-1')?.workoutCount).toBe(0);
    });

    it('does not recreate a workout that was permanently deleted after the target revision', () => {
        const desiredWorkout = workout({ revision: 1, title: 'Deleted forever' });
        const desired: ReconstructedTrainingPlanRevisionV1 = {
            plan: plan({ revision: 2, lastCheckpointRevision: 1 }),
            workouts: new Map([[desiredWorkout.id, desiredWorkout]]),
        };

        const result = applyPlanRevisionRestore(
            snapshot([plan({ workoutCount: 0 })], []), desired, planRequest(), NOW_MS,
        );

        expect(result.response.skippedWorkoutIds).toEqual(['workout-1']);
        expect(result.applied.after.workouts.has('workout-1')).toBe(false);
        expect(result.applied.after.plans.get('plan-1')?.workoutCount).toBe(0);
    });

    it('atomically pauses the previous active plan when restoring an active lifecycle', () => {
        const currentPlan = plan();
        const previousActive = plan({ id: 'plan-2', name: 'Active plan', lifecycle: 'active', revision: 7 });
        const desired: ReconstructedTrainingPlanRevisionV1 = {
            plan: plan({ lifecycle: 'active', revision: 2, lastCheckpointRevision: 1 }),
            workouts: new Map(),
        };
        const expected = [
            { scope: 'state' as const, id: 'current', revision: 9 },
            { scope: 'plan' as const, id: 'plan-1', revision: 4 },
            { scope: 'plan' as const, id: 'plan-2', revision: 7 },
        ];

        const result = applyPlanRevisionRestore(
            snapshot([currentPlan, previousActive], [], 'plan-2'), desired, planRequest(expected), NOW_MS,
        );

        expect(result.applied.after.state.activePlanId).toBe('plan-1');
        expect(result.applied.after.plans.get('plan-2')).toMatchObject({
            lifecycle: 'paused', revision: 8, lastCheckpointRevision: 8,
        });
        expect(result.applied.affectedPlanIds).toEqual(['plan-1', 'plan-2']);
    });

    it('requires matching current state and plan revisions', () => {
        const desired: ReconstructedTrainingPlanRevisionV1 = {
            plan: plan({ revision: 2, lastCheckpointRevision: 1 }),
            workouts: new Map(),
        };
        expect(() => applyPlanRevisionRestore(
            snapshot([plan()], []), desired, planRequest([
                { scope: 'state', id: 'current', revision: 8 },
                { scope: 'plan', id: 'plan-1', revision: 4 },
            ]), NOW_MS,
        )).toThrow(expect.objectContaining({ code: 'revision-conflict' }));
    });

    it('does not restore a plan beyond the account current-workout limit', () => {
        const standalone = Array.from({ length: TRAINING_PLAN_MAX_CURRENT_WORKOUTS }, (_, index) => workout({
            id: `standalone-${index}`,
            planId: null,
        }));
        const desiredWorkout = workout({ id: 'restored-plan-workout', revision: 1 });
        const recoverablyDeleted = workout({
            id: desiredWorkout.id,
            lifecycle: 'deleted',
            deletedAtMs: 5,
        });
        const desired: ReconstructedTrainingPlanRevisionV1 = {
            plan: plan({ workoutCount: 1, revision: 2, lastCheckpointRevision: 1 }),
            workouts: new Map([[desiredWorkout.id, desiredWorkout]]),
        };

        expect(() => applyPlanRevisionRestore(
            snapshot([plan({ workoutCount: 0 })], [recoverablyDeleted, ...standalone]),
            desired,
            planRequest(),
            NOW_MS,
        )).toThrow(expect.objectContaining({ code: 'limit-exceeded' }));
    });
});

describe('applyStandaloneRevisionRestore', () => {
    function standaloneRequest(): RestoreTrainingScheduleRevisionRequestV1 {
        return {
            mutationId: 'restore-workout-1',
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 9 },
                { scope: 'workout', id: 'workout-1', revision: 3 },
            ],
            scope: { kind: 'workout', id: 'workout-1' },
            targetRevision: 1,
        };
    }

    it('restores a standalone snapshot as a new workout revision', () => {
        const current = workout({ planId: null });
        const desired = workout({ planId: null, title: 'Earlier title', revision: 1, updatedAtMs: 1 });
        const result = applyStandaloneRevisionRestore(
            snapshot([], [current]), desired, standaloneRequest(), NOW_MS,
        );

        expect(result.applied.after.workouts.get(current.id)).toMatchObject({
            planId: null, title: 'Earlier title', revision: 4, updatedAtMs: NOW_MS,
        });
        expect(result.applied.after.state.revision).toBe(10);
        expect(result.response.skippedWorkoutIds).toEqual([]);
    });

    it('does not reclaim a workout that is now plan-bound', () => {
        const current = workout({ planId: 'plan-1' });
        const desired = workout({ planId: null, revision: 1 });
        expect(() => applyStandaloneRevisionRestore(
            snapshot([plan()], [current]), desired, standaloneRequest(), NOW_MS,
        )).toThrow('cannot be reclaimed');
    });

    it('does not resurrect a standalone workout beyond the account limit', () => {
        const deleted = workout({ planId: null, lifecycle: 'deleted', deletedAtMs: 5 });
        const current = Array.from({ length: TRAINING_PLAN_MAX_CURRENT_WORKOUTS }, (_, index) => workout({
            id: `standalone-${index}`,
            planId: null,
        }));
        const desired = workout({ planId: null, revision: 1 });

        expect(() => applyStandaloneRevisionRestore(
            snapshot([], [deleted, ...current]),
            desired,
            standaloneRequest(),
            NOW_MS,
        )).toThrow(expect.objectContaining({ code: 'limit-exceeded' }));
    });
});
