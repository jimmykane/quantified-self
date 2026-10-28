import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type {
    DeleteTrainingPlanRequestV1,
    ScheduledWorkoutV1,
    TrainingPlanV1,
} from '../../../shared/training-plans';
import { createEmptyTrainingPlanState, type TrainingScheduleSnapshotV1 } from './mutation';
import { applyTrainingPlanDeletion } from './delete-training-plan';

const NOW_MS = Date.UTC(2026, 8, 2, 13);
const STRUCTURE = {
    version: 1 as const,
    sport: ActivityTypes.Cycling,
    nodes: [{
        kind: 'step' as const,
        id: 'work',
        purpose: 'work' as const,
        ending: { kind: 'distance' as const, meters: 20_000 },
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
        revision: 4,
        lastCheckpointRevision: 1,
        workoutCount: 2,
        createdAtMs: 1,
        updatedAtMs: 4,
        ...overrides,
    };
}

function workout(id: string, overrides: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 {
    return {
        schemaVersion: 1,
        id,
        planId: 'plan-1',
        localDate: '2026-09-03',
        lifecycle: 'planned',
        title: `Workout ${id}`,
        structure: STRUCTURE,
        revision: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
        ...overrides,
    };
}

function snapshot(): TrainingScheduleSnapshotV1 {
    const workouts = [workout('workout-1'), workout('workout-2', { lifecycle: 'skipped' })];
    return {
        state: {
            ...createEmptyTrainingPlanState(0),
            activePlanId: 'plan-1',
            revision: 8,
            currentWorkoutCount: 3,
        },
        plans: new Map([
            ['plan-1', plan()],
            ['plan-2', plan({ id: 'plan-2', name: 'Other', lifecycle: 'paused', workoutCount: 0 })],
        ]),
        workouts: new Map([
            ...workouts.map(item => [item.id, item] as const),
            ['standalone', workout('standalone', { planId: null })],
        ]),
    };
}

function request(
    workoutDisposition: DeleteTrainingPlanRequestV1['workoutDisposition'],
): DeleteTrainingPlanRequestV1 {
    return {
        mutationId: `delete-plan-${workoutDisposition}`,
        planId: 'plan-1',
        expectedRevisions: [
            { scope: 'state', id: 'current', revision: 8 },
            { scope: 'plan', id: 'plan-1', revision: 4 },
        ],
        workoutDisposition,
        confirmPlanDeletion: true,
    };
}

describe('applyTrainingPlanDeletion', () => {
    it('converts current workouts to standalone while preserving IDs and total count', () => {
        const result = applyTrainingPlanDeletion(snapshot(), request('convert-to-standalone'), NOW_MS);

        expect(result.after.plans.has('plan-1')).toBe(false);
        expect(result.after.plans.has('plan-2')).toBe(true);
        expect(result.after.state).toMatchObject({
            activePlanId: null,
            revision: 9,
            currentWorkoutCount: 3,
            updatedAtMs: NOW_MS,
        });
        expect(result.after.workouts.get('workout-1')).toMatchObject({
            id: 'workout-1', planId: null, revision: 3, updatedAtMs: NOW_MS,
        });
        expect(result.after.workouts.get('workout-2')).toMatchObject({
            id: 'workout-2', planId: null, lifecycle: 'skipped', revision: 3,
        });
        expect(result.response).toMatchObject({
            removedPlanId: 'plan-1',
            convertedWorkoutIds: ['workout-1', 'workout-2'],
            permanentlyDeletedWorkoutIds: [],
        });
    });

    it('permanently removes current plan workouts and decrements the total count', () => {
        const result = applyTrainingPlanDeletion(snapshot(), request('delete-workouts'), NOW_MS);

        expect(result.after.workouts.has('workout-1')).toBe(false);
        expect(result.after.workouts.has('workout-2')).toBe(false);
        expect(result.after.workouts.has('standalone')).toBe(true);
        expect(result.after.state.currentWorkoutCount).toBe(1);
        expect(result.response.permanentlyDeletedWorkoutIds).toEqual(['workout-1', 'workout-2']);
        expect(result.response.convertedWorkoutIds).toEqual([]);
    });

    it('preserves a different active plan', () => {
        const input = snapshot();
        input.state.activePlanId = 'plan-2';
        const result = applyTrainingPlanDeletion(input, request('convert-to-standalone'), NOW_MS);
        expect(result.after.state.activePlanId).toBe('plan-2');
    });

    it('requires matching state and plan revisions', () => {
        const bad = request('delete-workouts');
        bad.expectedRevisions[0] = { scope: 'state', id: 'current', revision: 7 };
        expect(() => applyTrainingPlanDeletion(snapshot(), bad, NOW_MS))
            .toThrow(expect.objectContaining({ code: 'revision-conflict' }));
    });

    it('refuses deletion when the plan count proves the workout read was incomplete', () => {
        const input = snapshot();
        input.plans.set('plan-1', plan({ workoutCount: 3 }));
        expect(() => applyTrainingPlanDeletion(input, request('delete-workouts'), NOW_MS))
            .toThrow('workout count is inconsistent');
    });
});
