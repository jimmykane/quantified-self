import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  TRAINING_PLAN_CHECKPOINT_INTERVAL,
  TRAINING_PLAN_COLORS,
  TRAINING_PLAN_MAX_CURRENT_WORKOUTS,
  TRAINING_PLAN_MAX_DAYS,
  TrainingPlanContractError,
  addDaysToTrainingLocalDate,
  countTrainingPlanDays,
  extendTrainingPlanRangeToDate,
  isTrainingLocalDateWithinPlan,
  normalizeTrainingLocalDate,
  parseDeleteTrainingPlanRequestV1,
  parseMutateTrainingScheduleRequestV1,
  parseScheduledWorkoutV1,
  parseTrainingPlanStateV1,
  parseTrainingPlanV1,
  parseTrainingPlanPhasesV1,
  shouldCheckpointTrainingPlanRevision,
  validateTrainingPlanDateRange,
  type TrainingPlanV1,
} from '@shared/training-plans';

const STRUCTURE = {
  version: 1,
  sport: ActivityTypes.Running,
  nodes: [{
    kind: 'step',
    id: 'steady',
    purpose: 'work',
    ending: { kind: 'time', seconds: 1800 },
    targets: [],
  }],
};

const PLAN: TrainingPlanV1 = {
  schemaVersion: 1,
  id: 'plan-1',
  name: 'Autumn build',
  lifecycle: 'active',
  startLocalDate: '2026-09-01',
  endLocalDate: '2026-09-30',
  revision: 2,
  lastCheckpointRevision: 1,
  workoutCount: 3,
  createdAtMs: 1,
  updatedAtMs: 2,
};

describe('training-plan date contracts', () => {
  it('accepts real local dates and performs UTC-stable date arithmetic', () => {
    expect(normalizeTrainingLocalDate('2024-02-29')).toBe('2024-02-29');
    expect(addDaysToTrainingLocalDate('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDaysToTrainingLocalDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(countTrainingPlanDays('2026-09-01', '2026-09-30')).toBe(30);
  });

  it('rejects impossible, reversed, and overlong ranges', () => {
    expect(() => normalizeTrainingLocalDate('2026-02-30')).toThrow(TrainingPlanContractError);
    expect(() => countTrainingPlanDays('2026-09-02', '2026-09-01')).toThrow(TrainingPlanContractError);
    expect(() => validateTrainingPlanDateRange(
      '2026-01-01',
      addDaysToTrainingLocalDate('2026-01-01', TRAINING_PLAN_MAX_DAYS),
    ))
      .toThrow(TrainingPlanContractError);
  });

  it('extends only the required plan boundary and revalidates the maximum', () => {
    expect(extendTrainingPlanRangeToDate(PLAN, '2026-08-30')).toEqual({
      startLocalDate: '2026-08-30',
      endLocalDate: '2026-09-30',
    });
    expect(extendTrainingPlanRangeToDate(PLAN, '2026-10-02')).toEqual({
      startLocalDate: '2026-09-01',
      endLocalDate: '2026-10-02',
    });
    expect(isTrainingLocalDateWithinPlan('2026-09-15', PLAN)).toBe(true);
    expect(isTrainingLocalDateWithinPlan('2026-10-01', PLAN)).toBe(false);
  });
});

describe('training-plan persisted contracts', () => {
  it('normalizes bounded phase metadata and preserves legacy plans', () => {
    const phase = { id: 'base', name: ' Base ', startLocalDate: '2026-09-01', endLocalDate: '2026-09-10', color: 'green' };
    const phases = parseTrainingPlanPhasesV1({ version: 1, items: [
      { ...phase, id: 'taper', name: 'Taper', startLocalDate: '2026-09-20', endLocalDate: '2026-09-20' }, phase,
    ] });
    expect(phases.items.map(item => item.id)).toEqual(['base', 'taper']);
    expect(phases.items[0].name).toBe('Base');
    expect(parseTrainingPlanV1({ ...PLAN, phases }).phases).toEqual(phases);
    expect(parseTrainingPlanV1(PLAN)).not.toHaveProperty('phases');
    expect(() => parseTrainingPlanV1({ ...PLAN, phases: { version: 1, items: [{ ...phase, startLocalDate: '2026-08-31' }] } })).toThrow();
  });

  it('rejects control characters while preserving tabs and line breaks only in descriptions', () => {
    const phase = { id: 'base', name: 'Base', startLocalDate: '2026-09-01', endLocalDate: '2026-09-10' };
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      const character = String.fromCharCode(code);
      expect(() => parseTrainingPlanPhasesV1({ version: 1, items: [{ ...phase, name: `Base${character}stage` }] })).toThrow();
      const value = { version: 1, items: [{ ...phase, description: `First${character}second` }] };
      if ([9, 10, 13].includes(code)) expect(parseTrainingPlanPhasesV1(value).items[0].description).toBe(`First${character}second`);
      else expect(() => parseTrainingPlanPhasesV1(value)).toThrow();
    }
  });

  it('rejects invalid, overlapping, duplicate, oversized and unknown phase data', () => {
    const phase = { id: 'base', name: 'Base', startLocalDate: '2026-09-01', endLocalDate: '2026-09-10' };
    for (const item of [{ ...phase, color: '#fff' }, { ...phase, startLocalDate: '2026-02-30' },
      { ...phase, name: '\u0000' }, { ...phase, description: 'a'.repeat(1001) }, { ...phase, extra: true }]) {
      expect(() => parseTrainingPlanPhasesV1({ version: 1, items: [item] })).toThrow();
    }
    expect(() => parseTrainingPlanPhasesV1({ version: 2, items: [] })).toThrow();
    expect(() => parseTrainingPlanPhasesV1({ version: 1, items: [phase, phase] })).toThrow();
    expect(() => parseTrainingPlanPhasesV1({ version: 1, items: [phase,
      { ...phase, id: 'build', startLocalDate: '2026-09-10', endLocalDate: '2026-09-20' }] })).toThrow();
    expect(() => parseTrainingPlanPhasesV1({ version: 1, items: Array.from({ length: 33 }, (_, i) => ({ ...phase, id: `p-${i}` })) })).toThrow();
    const unicode = Array.from({ length: 20 }, (_, i) => ({ ...phase, id: `p-${i}`,
      startLocalDate: `2026-09-${String(i + 1).padStart(2, '0')}`,
      endLocalDate: `2026-09-${String(i + 1).padStart(2, '0')}`, description: '界'.repeat(1000) }));
    expect(() => parseTrainingPlanPhasesV1({ version: 1, items: unicode })).toThrow('32 KiB');
    expect(parseTrainingPlanPhasesV1({ version: 1, items: [] })).toEqual({ version: 1, items: [] });
  });

  it.each(TRAINING_PLAN_COLORS)('round-trips the named plan color %s without changing the recipe contract', color => {
    const colored = { ...PLAN, color };
    expect(parseTrainingPlanV1(JSON.parse(JSON.stringify(colored)))).toEqual(colored);
    const operation = { kind: 'set-plan-color', planId: PLAN.id, color };
    expect(parseMutateTrainingScheduleRequestV1({ mutationId: 'color', expectedRevisions: [], operation }).operation).toEqual(operation);
    const create = { kind: 'create-plan', planId: PLAN.id, name: PLAN.name, color,
      startLocalDate: PLAN.startLocalDate, endLocalDate: PLAN.endLocalDate, activate: false };
    expect(parseMutateTrainingScheduleRequestV1({ mutationId: 'create', expectedRevisions: [], operation: create }).operation).toEqual(create);
  });

  it.each([null, '', '#ffffff', 'url(https://example.com)', 'toString', 5, {}])('rejects untrusted plan colors %s', color => {
    expect(() => parseTrainingPlanV1({ ...PLAN, color })).toThrow(TrainingPlanContractError);
    expect(() => parseMutateTrainingScheduleRequestV1({ mutationId: 'color', expectedRevisions: [],
      operation: { kind: 'set-plan-color', planId: PLAN.id, color } })).toThrow(TrainingPlanContractError);
    expect(() => parseMutateTrainingScheduleRequestV1({ mutationId: 'create', expectedRevisions: [],
      operation: { kind: 'create-plan', planId: PLAN.id, name: PLAN.name, color,
        startLocalDate: PLAN.startLocalDate, endLocalDate: PLAN.endLocalDate, activate: false } })).toThrow(TrainingPlanContractError);
  });

  it('strictly parses state and plans', () => {
    expect(parseTrainingPlanStateV1({
      schemaVersion: 1,
      activePlanId: 'plan-1',
      revision: 4,
      currentWorkoutCount: 3,
      updatedAtMs: 10,
    })).toEqual({
      schemaVersion: 1,
      activePlanId: 'plan-1',
      revision: 4,
      currentWorkoutCount: 3,
      updatedAtMs: 10,
    });
    expect(parseTrainingPlanV1(PLAN)).toEqual(PLAN);
    expect(() => parseTrainingPlanV1({ ...PLAN, providerId: 'garmin' })).toThrow(TrainingPlanContractError);
  });

  it('rejects persisted workout counts above the canonical account limit', () => {
    expect(() => parseTrainingPlanStateV1({
      schemaVersion: 1,
      activePlanId: null,
      revision: 4,
      currentWorkoutCount: TRAINING_PLAN_MAX_CURRENT_WORKOUTS + 1,
      updatedAtMs: 10,
    })).toThrow(TrainingPlanContractError);
    expect(() => parseTrainingPlanV1({
      ...PLAN,
      workoutCount: TRAINING_PLAN_MAX_CURRENT_WORKOUTS + 1,
    })).toThrow(TrainingPlanContractError);
  });

  it('keeps standalone workouts first-class and normalizes their structure', () => {
    const workout = parseScheduledWorkoutV1({
      schemaVersion: 1,
      id: 'workout-1',
      planId: null,
      localDate: '2026-09-02',
      lifecycle: 'planned',
      title: ' Easy run ',
      structure: { ...STRUCTURE, sport: 'run' },
      revision: 1,
      createdAtMs: 5,
      updatedAtMs: 5,
    });

    expect(workout.planId).toBeNull();
    expect(workout.title).toBe('Easy run');
    expect(workout.structure.sport).toBe(ActivityTypes.Running);
  });

  it('requires deletedAtMs exactly for soft-deleted workouts', () => {
    const base = {
      schemaVersion: 1,
      id: 'workout-1',
      planId: null,
      localDate: '2026-09-02',
      title: 'Easy run',
      structure: STRUCTURE,
      revision: 1,
      createdAtMs: 5,
      updatedAtMs: 5,
    };
    expect(() => parseScheduledWorkoutV1({ ...base, lifecycle: 'deleted' })).toThrow(TrainingPlanContractError);
    expect(() => parseScheduledWorkoutV1({ ...base, lifecycle: 'planned', deletedAtMs: 7 })).toThrow(TrainingPlanContractError);
    expect(parseScheduledWorkoutV1({ ...base, lifecycle: 'deleted', deletedAtMs: 7 }).deletedAtMs).toBe(7);
  });
});

describe('training schedule mutation contracts', () => {
  it('parses standalone workout creation with explicit range-confirmation state', () => {
    const request = parseMutateTrainingScheduleRequestV1({
      mutationId: 'client:123',
      expectedRevisions: [{ scope: 'state', id: 'current', revision: 0 }],
      operation: {
        kind: 'create-workout',
        workoutId: 'workout-1',
        planId: null,
        localDate: '2026-09-03',
        title: 'Steady run',
        structure: STRUCTURE,
        confirmPlanRangeExtension: false,
      },
    });

    expect(request.operation).toMatchObject({ kind: 'create-workout', planId: null });
  });

  it('parses standalone-to-plan and plan-to-plan moves without changing workout identity', () => {
    const request = parseMutateTrainingScheduleRequestV1({
      mutationId: 'move-1',
      expectedRevisions: [
        { scope: 'workout', id: 'workout-1', revision: 2 },
        { scope: 'plan', id: 'plan-2', revision: 5 },
      ],
      operation: {
        kind: 'move-workout',
        workoutId: 'workout-1',
        planId: 'plan-2',
        localDate: '2026-10-01',
        confirmPlanRangeExtension: true,
      },
    });

    expect(request.operation).toEqual({
      kind: 'move-workout',
      workoutId: 'workout-1',
      planId: 'plan-2',
      localDate: '2026-10-01',
      confirmPlanRangeExtension: true,
    });
  });

  it('rejects duplicate revision expectations and reused copy IDs', () => {
    expect(() => parseMutateTrainingScheduleRequestV1({
      mutationId: 'duplicate-revisions',
      expectedRevisions: [
        { scope: 'plan', id: 'plan-1', revision: 1 },
        { scope: 'plan', id: 'plan-1', revision: 1 },
      ],
      operation: { kind: 'rename-plan', planId: 'plan-1', name: 'New name' },
    })).toThrow(TrainingPlanContractError);

    expect(() => parseMutateTrainingScheduleRequestV1({
      mutationId: 'bad-copy',
      expectedRevisions: [],
      operation: {
        kind: 'copy-workout',
        sourceWorkoutId: 'same',
        workoutId: 'same',
        planId: null,
        localDate: '2026-09-03',
        confirmPlanRangeExtension: false,
      },
    })).toThrow(TrainingPlanContractError);
  });

  it('requires explicit permanent-deletion confirmation', () => {
    expect(() => parseMutateTrainingScheduleRequestV1({
      mutationId: 'delete-forever',
      expectedRevisions: [],
      operation: {
        kind: 'permanently-delete-workout',
        workoutId: 'workout-1',
        confirmPermanentDeletion: false,
      },
    })).toThrow(TrainingPlanContractError);
  });

  it.each(['delete-workout', 'permanently-delete-workout'] as const)('strictly parses optional past-provider cleanup on %s', kind => {
    const operation = { kind, workoutId: 'workout-1', removePastProviderCopies: true,
      ...(kind === 'permanently-delete-workout' ? { confirmPermanentDeletion: true } : {}) };
    expect(parseMutateTrainingScheduleRequestV1({ mutationId: 'cleanup', expectedRevisions: [], operation }).operation)
      .toMatchObject(operation);
    expect(() => parseMutateTrainingScheduleRequestV1({ mutationId: 'invalid', expectedRevisions: [],
      operation: { ...operation, removePastProviderCopies: 'yes' } })).toThrow(TrainingPlanContractError);
  });

  it('parses both explicit plan-deletion dispositions and rejects silent deletion', () => {
    const base = {
      mutationId: 'delete-plan-1',
      planId: 'plan-1',
      expectedRevisions: [
        { scope: 'state', id: 'current', revision: 4 },
        { scope: 'plan', id: 'plan-1', revision: 3 },
      ],
      confirmPlanDeletion: true,
    };
    expect(parseDeleteTrainingPlanRequestV1({
      ...base, workoutDisposition: 'convert-to-standalone',
    }).workoutDisposition).toBe('convert-to-standalone');
    expect(parseDeleteTrainingPlanRequestV1({
      ...base, workoutDisposition: 'delete-workouts',
    }).workoutDisposition).toBe('delete-workouts');
    expect(parseDeleteTrainingPlanRequestV1({ ...base, workoutDisposition: 'delete-workouts',
      removePastProviderCopies: true }).removePastProviderCopies).toBe(true);
    expect(() => parseDeleteTrainingPlanRequestV1({ ...base, workoutDisposition: 'delete-workouts',
      removePastProviderCopies: 'yes' })).toThrow(TrainingPlanContractError);
    expect(() => parseDeleteTrainingPlanRequestV1({
      ...base, workoutDisposition: 'delete-workouts', confirmPlanDeletion: false,
    })).toThrow('Explicit plan-deletion confirmation');
  });
});

describe('training plan checkpoint policy', () => {
  it('checkpoints the first, every twentieth, and bulk revisions', () => {
    expect(shouldCheckpointTrainingPlanRevision(1)).toBe(true);
    expect(shouldCheckpointTrainingPlanRevision(TRAINING_PLAN_CHECKPOINT_INTERVAL)).toBe(true);
    expect(shouldCheckpointTrainingPlanRevision(21)).toBe(false);
    expect(shouldCheckpointTrainingPlanRevision(21, true)).toBe(true);
  });
});
