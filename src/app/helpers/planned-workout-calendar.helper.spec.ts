import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import { buildPlannedWorkoutCalendarOverlay } from './planned-workout-calendar.helper';

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

function workout(id: string, lifecycle: ScheduledWorkoutV1['lifecycle'] = 'planned'): ScheduledWorkoutV1 {
  return {
    schemaVersion: 1,
    id,
    planId: id === 'standalone' ? null : 'plan-1',
    localDate: '2026-09-02',
    lifecycle,
    title: id,
    structure: STRUCTURE,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...(lifecycle === 'deleted' ? { deletedAtMs: 2 } : {}),
  };
}

const PLAN: TrainingPlanV1 = {
  schemaVersion: 1,
  id: 'plan-1',
  name: 'Autumn build',
  lifecycle: 'active',
  startLocalDate: '2026-09-01',
  endLocalDate: '2026-09-30',
  revision: 1,
  lastCheckpointRevision: 1,
  workoutCount: 2,
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('planned workout calendar overlay', () => {
  it('groups plan and standalone workouts separately from deleted history', () => {
    const overlay = buildPlannedWorkoutCalendarOverlay([
      workout('tempo'),
      workout('standalone'),
      workout('recovery', 'skipped'),
      workout('deleted', 'deleted'),
    ], [PLAN]);

    expect(overlay['2026-09-02'].entries.map(entry => entry.workout.id))
      .toEqual(['standalone', 'tempo', 'recovery']);
    expect(overlay['2026-09-02'].entries.map(entry => entry.planName))
      .toEqual([null, 'Autumn build', 'Autumn build']);
    expect(overlay['2026-09-02']).toMatchObject({
      overflowCount: 1,
      hasSkipped: true,
      ariaLabel: '2 planned workouts, 1 skipped workout',
    });
  });
});
