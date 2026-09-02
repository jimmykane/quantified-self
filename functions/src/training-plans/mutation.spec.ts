import { ActivityTypes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    TRAINING_PLAN_MAX_CURRENT_WORKOUTS,
    type MutateTrainingScheduleRequestV1,
    type ScheduledWorkoutV1,
    type TrainingPlanV1,
} from '../../../shared/training-plans';
import {
    TrainingScheduleMutationError,
    applyTrainingScheduleMutation,
    createEmptyTrainingPlanState,
    type TrainingScheduleSnapshotV1,
} from './mutation';

const NOW_MS = Date.UTC(2026, 8, 2, 10);
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
        name: 'Plan one',
        lifecycle: 'active',
        startLocalDate: '2026-09-01',
        endLocalDate: '2026-09-30',
        revision: 3,
        lastCheckpointRevision: 1,
        workoutCount: 0,
        createdAtMs: 1,
        updatedAtMs: 2,
        ...overrides,
    };
}

function workout(overrides: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 {
    return {
        schemaVersion: 1,
        id: 'workout-1',
        planId: null,
        localDate: '2026-09-02',
        lifecycle: 'planned',
        title: 'Steady run',
        structure: STRUCTURE,
        revision: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
        ...overrides,
    };
}

function snapshot(
    plans: TrainingPlanV1[] = [],
    workouts: ScheduledWorkoutV1[] = [],
    activePlanId: string | null = null,
): TrainingScheduleSnapshotV1 {
    return {
        state: {
            ...createEmptyTrainingPlanState(0),
            activePlanId,
            revision: 7,
            currentWorkoutCount: workouts.filter(item => item.lifecycle !== 'deleted').length,
        },
        plans: new Map(plans.map(item => [item.id, item])),
        workouts: new Map(workouts.map(item => [item.id, item])),
    };
}

function request(
    operation: MutateTrainingScheduleRequestV1['operation'],
    expectedRevisions: MutateTrainingScheduleRequestV1['expectedRevisions'] = [],
): MutateTrainingScheduleRequestV1 {
    return {
        mutationId: `mutation-${operation.kind}`,
        expectedRevisions: [
            { scope: 'state', id: 'current', revision: 7 },
            ...expectedRevisions,
        ],
        operation,
    };
}

describe('applyTrainingScheduleMutation', () => {
    let initial: TrainingScheduleSnapshotV1;

    beforeEach(() => {
        initial = snapshot();
    });

    it('creates a standalone workout without a plan', () => {
        const result = applyTrainingScheduleMutation(initial, request({
            kind: 'create-workout',
            workoutId: 'standalone-1',
            planId: null,
            localDate: '2026-09-03',
            title: 'Standalone run',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        }), NOW_MS);

        expect(result.after.workouts.get('standalone-1')).toMatchObject({
            id: 'standalone-1',
            planId: null,
            revision: 1,
            lifecycle: 'planned',
        });
        expect(result.after.state.currentWorkoutCount).toBe(1);
        expect(result.affectedPlanIds).toEqual([]);
    });

    it('activates a new plan and atomically pauses the previous active plan', () => {
        const oldPlan = plan();
        initial = snapshot([oldPlan], [], oldPlan.id);

        const result = applyTrainingScheduleMutation(initial, request({
            kind: 'create-plan',
            planId: 'plan-2',
            name: 'Plan two',
            startLocalDate: '2026-10-01',
            endLocalDate: '2026-10-31',
            activate: true,
        }, [{ scope: 'plan', id: oldPlan.id, revision: oldPlan.revision }]), NOW_MS);

        expect(result.after.state.activePlanId).toBe('plan-2');
        expect(result.after.plans.get('plan-1')).toMatchObject({ lifecycle: 'paused', revision: 4 });
        expect(result.after.plans.get('plan-2')).toMatchObject({ lifecycle: 'active', revision: 1 });
        expect(result.affectedPlanIds).toEqual(['plan-1', 'plan-2']);
    });

    it('requires confirmation before atomically extending a plan range', () => {
        const targetPlan = plan();
        initial = snapshot([targetPlan]);
        const operation = {
            kind: 'create-workout' as const,
            workoutId: 'outside',
            planId: targetPlan.id,
            localDate: '2026-10-02',
            title: 'Outside range',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        };
        const expected = [{ scope: 'plan' as const, id: targetPlan.id, revision: targetPlan.revision }];

        expect(() => applyTrainingScheduleMutation(initial, request(operation, expected), NOW_MS))
            .toThrow(expect.objectContaining({ code: 'range-extension-required' }));

        const result = applyTrainingScheduleMutation(initial, request({
            ...operation,
            confirmPlanRangeExtension: true,
        }, expected), NOW_MS);
        expect(result.after.plans.get(targetPlan.id)).toMatchObject({
            endLocalDate: '2026-10-02',
            workoutCount: 1,
            revision: 4,
        });
    });

    it('moves standalone workouts into plans and plan workouts back to standalone without changing IDs', () => {
        const targetPlan = plan();
        const standalone = workout();
        initial = snapshot([targetPlan], [standalone]);
        const attached = applyTrainingScheduleMutation(initial, request({
            kind: 'move-workout',
            workoutId: standalone.id,
            planId: targetPlan.id,
            localDate: '2026-09-05',
            confirmPlanRangeExtension: false,
        }, [
            { scope: 'workout', id: standalone.id, revision: standalone.revision },
            { scope: 'plan', id: targetPlan.id, revision: targetPlan.revision },
        ]), NOW_MS);

        expect(attached.after.workouts.get(standalone.id)).toMatchObject({
            id: standalone.id,
            planId: targetPlan.id,
            revision: 3,
        });
        expect(attached.after.plans.get(targetPlan.id)?.workoutCount).toBe(1);

        const detached = applyTrainingScheduleMutation(attached.after, {
            mutationId: 'detach',
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 8 },
                { scope: 'workout', id: standalone.id, revision: 3 },
                { scope: 'plan', id: targetPlan.id, revision: 4 },
            ],
            operation: {
                kind: 'move-workout',
                workoutId: standalone.id,
                planId: null,
                localDate: '2026-09-06',
                confirmPlanRangeExtension: false,
            },
        }, NOW_MS + 1);

        expect(detached.after.workouts.get(standalone.id)).toMatchObject({ id: standalone.id, planId: null });
        expect(detached.after.plans.get(targetPlan.id)?.workoutCount).toBe(0);
    });

    it('moves a workout between plans while revising both plan streams once', () => {
        const sourcePlan = plan({ workoutCount: 1 });
        const destinationPlan = plan({ id: 'plan-2', name: 'Plan two', lifecycle: 'paused', revision: 6 });
        const scheduled = workout({ planId: sourcePlan.id });
        initial = snapshot([sourcePlan, destinationPlan], [scheduled], sourcePlan.id);

        const result = applyTrainingScheduleMutation(initial, request({
            kind: 'move-workout',
            workoutId: scheduled.id,
            planId: destinationPlan.id,
            localDate: '2026-09-10',
            confirmPlanRangeExtension: false,
        }, [
            { scope: 'workout', id: scheduled.id, revision: scheduled.revision },
            { scope: 'plan', id: sourcePlan.id, revision: sourcePlan.revision },
            { scope: 'plan', id: destinationPlan.id, revision: destinationPlan.revision },
        ]), NOW_MS);

        expect(result.after.plans.get(sourcePlan.id)).toMatchObject({ revision: 4, workoutCount: 0 });
        expect(result.after.plans.get(destinationPlan.id)).toMatchObject({ revision: 7, workoutCount: 1 });
        expect(result.after.workouts.get(scheduled.id)?.id).toBe(scheduled.id);
    });

    it('shifts only the selected plan range and its associated current workouts', () => {
        const selectedPlan = plan({ workoutCount: 1 });
        const otherPlan = plan({ id: 'plan-2', name: 'Other', revision: 2, workoutCount: 1 });
        const selectedWorkout = workout({ planId: selectedPlan.id });
        const otherWorkout = workout({ id: 'workout-2', planId: otherPlan.id, localDate: '2026-09-03' });
        const standalone = workout({ id: 'standalone', localDate: '2026-09-04' });
        initial = snapshot([selectedPlan, otherPlan], [selectedWorkout, otherWorkout, standalone], selectedPlan.id);

        const result = applyTrainingScheduleMutation(initial, request({
            kind: 'shift-plan',
            planId: selectedPlan.id,
            days: 7,
        }, [{ scope: 'plan', id: selectedPlan.id, revision: selectedPlan.revision }]), NOW_MS);

        expect(result.after.plans.get(selectedPlan.id)).toMatchObject({
            startLocalDate: '2026-09-08',
            endLocalDate: '2026-10-07',
        });
        expect(result.after.workouts.get(selectedWorkout.id)?.localDate).toBe('2026-09-09');
        expect(result.after.workouts.get(otherWorkout.id)?.localDate).toBe('2026-09-03');
        expect(result.after.workouts.get(standalone.id)?.localDate).toBe('2026-09-04');
        expect(result.bulkOperation).toBe(true);
    });

    it('updates content, date, association, and plan range in one revisioned mutation', () => {
        const sourcePlan = plan({ workoutCount: 1 });
        const destinationPlan = plan({
            id: 'plan-2',
            name: 'Destination',
            lifecycle: 'paused',
            revision: 5,
            startLocalDate: '2026-09-01',
            endLocalDate: '2026-09-30',
        });
        const scheduled = workout({ planId: sourcePlan.id });
        initial = snapshot([sourcePlan, destinationPlan], [scheduled], sourcePlan.id);

        const operation = {
            kind: 'update-workout' as const,
            workoutId: scheduled.id,
            planId: destinationPlan.id,
            localDate: '2026-10-02',
            title: 'Moved and edited',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        };
        const expected = [
            { scope: 'workout' as const, id: scheduled.id, revision: scheduled.revision },
            { scope: 'plan' as const, id: sourcePlan.id, revision: sourcePlan.revision },
            { scope: 'plan' as const, id: destinationPlan.id, revision: destinationPlan.revision },
        ];

        expect(() => applyTrainingScheduleMutation(initial, request(operation, expected), NOW_MS))
            .toThrow(expect.objectContaining({ code: 'range-extension-required' }));

        const result = applyTrainingScheduleMutation(initial, request({
            ...operation,
            confirmPlanRangeExtension: true,
        }, expected), NOW_MS);

        expect(result.after.workouts.get(scheduled.id)).toMatchObject({
            planId: destinationPlan.id,
            localDate: '2026-10-02',
            title: 'Moved and edited',
            revision: scheduled.revision + 1,
        });
        expect(result.after.plans.get(sourcePlan.id)).toMatchObject({ workoutCount: 0, revision: 4 });
        expect(result.after.plans.get(destinationPlan.id)).toMatchObject({
            workoutCount: 1,
            revision: 6,
            endLocalDate: '2026-10-02',
        });
    });

    it('keeps skipped workouts current and makes deletion history-recoverable before permanent deletion', () => {
        const scheduled = workout();
        initial = snapshot([], [scheduled]);
        const skipped = applyTrainingScheduleMutation(initial, request({
            kind: 'set-workout-lifecycle', workoutId: scheduled.id, lifecycle: 'skipped',
        }, [{ scope: 'workout', id: scheduled.id, revision: scheduled.revision }]), NOW_MS);
        expect(skipped.after.workouts.get(scheduled.id)?.lifecycle).toBe('skipped');
        expect(skipped.after.state.currentWorkoutCount).toBe(1);

        const deleted = applyTrainingScheduleMutation(skipped.after, {
            mutationId: 'soft-delete',
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 8 },
                { scope: 'workout', id: scheduled.id, revision: 3 },
            ],
            operation: { kind: 'delete-workout', workoutId: scheduled.id },
        }, NOW_MS + 1);
        expect(deleted.after.workouts.get(scheduled.id)).toMatchObject({
            lifecycle: 'deleted',
            deletedAtMs: NOW_MS + 1,
        });
        expect(deleted.after.state.currentWorkoutCount).toBe(0);

        const permanentlyDeleted = applyTrainingScheduleMutation(deleted.after, {
            mutationId: 'permanent-delete',
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: 9 },
                { scope: 'workout', id: scheduled.id, revision: 4 },
            ],
            operation: {
                kind: 'permanently-delete-workout',
                workoutId: scheduled.id,
                confirmPermanentDeletion: true,
            },
        }, NOW_MS + 2);
        expect(permanentlyDeleted.after.workouts.has(scheduled.id)).toBe(false);
        expect(permanentlyDeleted.permanentlyDeletedWorkoutIds).toEqual([scheduled.id]);
    });

    it('records permanent deletion of a plan-bound workout in the plan revision stream', () => {
        const selectedPlan = plan({ workoutCount: 0 });
        const deletedWorkout = workout({
            planId: selectedPlan.id,
            lifecycle: 'deleted',
            deletedAtMs: NOW_MS - 1,
        });
        initial = snapshot([selectedPlan], [deletedWorkout], selectedPlan.id);

        const permanentlyDeleted = applyTrainingScheduleMutation(initial, request({
            kind: 'permanently-delete-workout',
            workoutId: deletedWorkout.id,
            confirmPermanentDeletion: true,
        }, [
            { scope: 'plan', id: selectedPlan.id, revision: selectedPlan.revision },
            { scope: 'workout', id: deletedWorkout.id, revision: deletedWorkout.revision },
        ]), NOW_MS);

        expect(permanentlyDeleted.after.workouts.has(deletedWorkout.id)).toBe(false);
        expect(permanentlyDeleted.affectedPlanIds).toEqual([selectedPlan.id]);
        expect(permanentlyDeleted.changedWorkoutIds).toEqual([deletedWorkout.id]);
        expect(permanentlyDeleted.after.plans.get(selectedPlan.id)).toMatchObject({
            revision: selectedPlan.revision + 1,
            workoutCount: 0,
        });
    });

    it('rejects missing or stale expected revisions', () => {
        const scheduled = workout();
        initial = snapshot([], [scheduled]);

        expect(() => applyTrainingScheduleMutation(initial, request({
            kind: 'update-workout',
            workoutId: scheduled.id,
            planId: scheduled.planId,
            localDate: scheduled.localDate,
            title: 'Changed',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        }), NOW_MS)).toThrow(expect.objectContaining({ code: 'revision-conflict' }));

        expect(() => applyTrainingScheduleMutation(initial, request({
            kind: 'update-workout',
            workoutId: scheduled.id,
            planId: scheduled.planId,
            localDate: scheduled.localDate,
            title: 'Changed',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        }, [{ scope: 'workout', id: scheduled.id, revision: 1 }]), NOW_MS))
            .toThrow(expect.objectContaining({ code: 'revision-conflict' }));
    });

    it('enforces the current workout cap without counting soft-deleted workouts', () => {
        const workouts = Array.from({ length: TRAINING_PLAN_MAX_CURRENT_WORKOUTS }, (_, index) => workout({
            id: `workout-${index}`,
        }));
        initial = snapshot([], workouts);

        expect(() => applyTrainingScheduleMutation(initial, request({
            kind: 'create-workout',
            workoutId: 'one-too-many',
            planId: null,
            localDate: '2026-09-03',
            title: 'Too many',
            structure: STRUCTURE,
            confirmPlanRangeExtension: false,
        }), NOW_MS)).toThrow(expect.objectContaining({ code: 'limit-exceeded' }));
    });

    it('checkpoints bulk shifts even when the next revision is not divisible by twenty', () => {
        const selectedPlan = plan({ revision: 8, lastCheckpointRevision: 1 });
        initial = snapshot([selectedPlan]);
        const result = applyTrainingScheduleMutation(initial, request({
            kind: 'shift-plan', planId: selectedPlan.id, days: 1,
        }, [{ scope: 'plan', id: selectedPlan.id, revision: selectedPlan.revision }]), NOW_MS);

        expect(result.after.plans.get(selectedPlan.id)).toMatchObject({
            revision: 9,
            lastCheckpointRevision: 9,
        });
    });

    it('exposes typed mutation errors for callers without leaking storage details', () => {
        expect(new TrainingScheduleMutationError('not-found', 'Missing')).toMatchObject({
            name: 'TrainingScheduleMutationError',
            code: 'not-found',
            message: 'Missing',
        });
    });
});
