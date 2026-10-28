import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import {
  selectCalendarVisibleScheduledWorkouts,
  type CurrentTrainingScheduleV1,
} from './training-plans.service';

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

function workout(id: string, overrides: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 {
  return {
    schemaVersion: 1,
    id,
    planId: null,
    localDate: '2026-09-02',
    lifecycle: 'planned',
    title: id,
    structure: STRUCTURE,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

const PLAN: TrainingPlanV1 = {
  schemaVersion: 1,
  id: 'active-plan',
  name: 'Active',
  lifecycle: 'active',
  startLocalDate: '2026-09-01',
  endLocalDate: '2026-09-30',
  revision: 1,
  lastCheckpointRevision: 1,
  workoutCount: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('calendar-visible planned workouts', () => {
  it('keeps standalone and active-plan workouts separate from inactive and deleted data', () => {
    const schedule: CurrentTrainingScheduleV1 = {
      state: {
        schemaVersion: 1,
        activePlanId: PLAN.id,
        revision: 1,
        currentWorkoutCount: 4,
        updatedAtMs: 1,
      },
      plans: [PLAN, { ...PLAN, id: 'paused-plan', lifecycle: 'paused' }],
      workouts: [
        workout('standalone'),
        workout('active', { planId: PLAN.id }),
        workout('skipped', { planId: PLAN.id, lifecycle: 'skipped', localDate: '2026-09-03' }),
        workout('inactive', { planId: 'paused-plan' }),
        workout('deleted', { lifecycle: 'deleted', deletedAtMs: 2 }),
      ],
    };

    expect(selectCalendarVisibleScheduledWorkouts(schedule).map(item => item.id))
      .toEqual(['active', 'standalone', 'skipped']);
  });

  it('applies an inclusive local-date range without changing stored order', () => {
    const schedule: CurrentTrainingScheduleV1 = {
      state: { schemaVersion: 1, activePlanId: null, revision: 1, currentWorkoutCount: 3, updatedAtMs: 1 },
      plans: [],
      workouts: [
        workout('later', { localDate: '2026-09-04' }),
        workout('earlier', { localDate: '2026-09-01' }),
        workout('middle', { localDate: '2026-09-03' }),
      ],
    };

    expect(selectCalendarVisibleScheduledWorkouts(schedule, '2026-09-02', '2026-09-04').map(item => item.id))
      .toEqual(['middle', 'later']);
    expect(schedule.workouts.map(item => item.id)).toEqual(['later', 'earlier', 'middle']);
  });
});
