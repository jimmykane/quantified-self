import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { assessTrainingDeliveryMapping } from './mapping';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { projectStrengthWorkoutToV1 } from '../../../../shared/strength-workout';
import { productionDeliveryRuntime } from './runtime';
const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'w', planId: null, localDate: '2026-09-10', revision: 1,
  title: 'Easy run', lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running,
    nodes: [{ kind: 'step', id: 'a', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } };
describe('Training delivery mapping and production boundary', () => {
  it('preserves complete Garmin strength through the production wrapper and digest without affecting recipe-only delivery', () => {
    const strength = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Squat',
      sets: [{ id: 'one', ending: { kind: 'repetitions' as const, repetitions: 10 }, externalLoadKg: 10 }] }] };
    const lift = { ...workout, structure: projectStrengthWorkoutToV1(strength) };
    const transport = productionDeliveryRuntime({} as never).transport('garmin', 'owner')!;
    const result = transport.assess(lift, 'destination', 'UTC', strength);
    expect(result.level).toBe('exact');
    expect(transport.assess(lift, 'destination', 'UTC').level).toBe('unsupported');
    expect(transport.assess(lift, 'destination', 'UTC', { ...strength, workoutId: 'foreign' }).level).toBe('unsupported');
    const changed = { ...strength, exercises: [{ ...strength.exercises[0], sets: [{ ...strength.exercises[0].sets[0], externalLoadKg: 11 }] }] };
    expect(transport.assess(lift, 'destination', 'UTC', changed).digest).not.toBe(result.digest);
    const malformed = { ...strength, exercises: [{ ...strength.exercises[0], sets: [{ ...strength.exercises[0].sets[0], externalLoadKg: -1 }] }] };
    expect(transport.assess(lift, 'destination', 'UTC', malformed).level).toBe('unsupported');
    expect(transport.assess(workout, 'destination', 'UTC', strength)).toEqual(transport.assess(workout, 'destination', 'UTC'));
  });
  it.each(['garmin', 'coros', 'wahoo', 'suunto'] as const)('%s uses serializer-level assessment independently of rollout', provider => {
    const assessment = assessTrainingDeliveryMapping(provider, workout, 'destination', 'UTC');
    expect(assessment.level).toBe('exact');
    expect(assessment.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('enables every public provider transport for an ordinary authenticated owner', () => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Fixture application');
    const runtime = productionDeliveryRuntime({} as never);
    for (const provider of ['garmin', 'coros', 'wahoo', 'suunto'] as const) {
      expect(runtime.transport(provider, 'owner')).not.toBeNull();
    }
    vi.unstubAllEnvs();
  });
  it('captures serializer-specific losses, not only structure capability warnings', () => {
    const result = assessTrainingDeliveryMapping('suunto', { ...workout, title: 'Run 🏃🏽' }, 'destination', 'UTC');
    expect(result.level).toBe('degraded'); expect(result.issues.length).toBeGreaterThan(0);
  });
  it('keeps the exact authored sport while reporting Garmin family folding', () => {
    const result = assessTrainingDeliveryMapping('garmin', {
      ...workout,
      structure: { ...workout.structure, sport: ActivityTypes.MountainBiking },
    }, 'destination', 'UTC');
    expect(result.level).toBe('degraded');
    expect(result.issues).toContain('Garmin receives Mountain Biking as a Cycling workout because its Training API has no exact Mountain Biking profile.');
  });
  it('treats Downhill Cycling as an approval-bound Garmin family fold instead of unsupported', () => {
    const downhill = {
      ...workout,
      structure: { ...workout.structure, sport: ActivityTypes.DownhillCycling },
    };
    const result = assessTrainingDeliveryMapping('garmin', downhill, 'destination', 'UTC');
    expect(result.level).toBe('degraded');
    expect(result.issues).toContain('Garmin receives Downhill Cycling as a Cycling workout because its Training API has no exact Downhill Cycling profile.');
    expect(downhill.structure.sport).toBe(ActivityTypes.DownhillCycling);
  });
  it('admits an exact Garmin pool swim without changing another provider’s degradation', () => {
    const pool: ScheduledWorkoutV1 = { ...workout, structure: {
      version: 1, sport: ActivityTypes.Swimming, poolLength: { meters: 25, presentation: 'meters' },
      nodes: [{ kind: 'step', id: 'length', purpose: 'work', ending: { kind: 'distance', meters: 25 }, targets: [] }],
    } };
    const result = assessTrainingDeliveryMapping('garmin', pool, 'destination', 'UTC');
    expect(result.level).toBe('exact');
    expect(result.issues).toEqual([]);
    expect(assessTrainingDeliveryMapping('suunto', pool, 'destination', 'UTC').level).toBe('degraded');
  });
});
