import { describe, expect, it } from 'vitest';
import { assessPlannedWorkoutProviderMappingV1 } from '../../../../shared/planned-workout-providers';
import { projectStrengthWorkoutToV1 } from '../../../../shared/strength-workout';
import { wahooFixtureStrengthDetails } from '../delivery/test-support/wahoo-http-fixture';
import { serializeWahooPlanJsonV1, serializeWahooStrengthPlanV1 } from './wahoo-plan.serializer';

describe('Wahoo timed Gym recipe (#783)', () => {
  const options = { name: 'Synthetic timed strength', allowDegraded: false };
  it('preserves five timed holds, every rest including the final rest, names and the production-required envelope', () => {
    const details = wahooFixtureStrengthDetails();
    const result = serializeWahooStrengthPlanV1(details, options);
    expect(result).toMatchObject({ level: 'degraded', requiresApproval: false,
      artifact: { header: { workout_type_family: 6, workout_type_location: 0, version: '1.0.0', duration_s: 300 } } });
    expect(result.artifact.header.description).toContain('no native rep or load tracking');
    expect(result.artifact.intervals).toHaveLength(10);
    expect(result.artifact.intervals.map(i => i.exit_trigger_value)).toEqual(Array(10).fill(30));
    expect(result.artifact.intervals.map(i => i.intensity_type)).toEqual(Array(5).fill(['active', 'rest']).flat());
    expect(result.artifact.intervals[8].name).toBe('Plank hold — set 5/5');
    expect(result.artifact.intervals[9].name).toBe('Rest after Plank hold — set 5/5');
    for (const interval of result.artifact.intervals) expect(interval.targets).toEqual([{ type: 'rpe', low: 1, high: 10 }]);
    expect(JSON.parse(JSON.stringify(result.artifact))).toEqual(result.artifact);
  });
  it('preserves exercise order, Unicode names and zero/fractional kilogram instruction loads without native load fields', () => {
    const details = wahooFixtureStrengthDetails();
    details.exercises[0].sets = details.exercises[0].sets.slice(0, 2);
    details.exercises[0].sets[0].externalLoadKg = 0;
    details.exercises[0].sets[1].externalLoadKg = 2.5;
    details.exercises.push({ id: 'other', name: '保持 🏋️', sets: [{ id: 'other-1', ending: { kind: 'time', seconds: 17 } }] });
    const result = serializeWahooStrengthPlanV1(details, options);
    expect(result.artifact.intervals.map(i => i.name)).toEqual([
      'Plank hold — set 1/2 — load guidance: 0.0 kg', 'Rest after Plank hold — set 1/2',
      'Plank hold — set 2/2 — load guidance: 2.5 kg', 'Rest after Plank hold — set 2/2', '保持 🏋️ — set 1/1',
    ]);
    expect(JSON.stringify(result.artifact)).not.toContain('externalLoadKg');
  });
  it('requires review only for actual instruction rounding and never mutates the canonical prescription', () => {
    const details = wahooFixtureStrengthDetails();
    details.exercises[0].sets[0].externalLoadKg = 2.25;
    const before = structuredClone(details);
    expect(() => serializeWahooStrengthPlanV1(details, options)).toThrow(/explicit degradation approval/);
    const result = serializeWahooStrengthPlanV1(details, { ...options, allowDegraded: true });
    expect(result.requiresApproval).toBe(true);
    expect(result.artifact.intervals[0].name).toContain('2.3 kg');
    expect(details).toEqual(before);
  });
  it('rejects reps even after a long prefix of rounded loads and never treats the v1 summary as a full recipe', () => {
    const details = wahooFixtureStrengthDetails();
    details.exercises[0].sets = Array.from({ length: 50 }, (_, i) => ({ id: `hold-${i}`,
      ending: i === 49 ? { kind: 'repetitions', repetitions: 8 } : { kind: 'time', seconds: 30 }, externalLoadKg: 2.25 }));
    const assessment = assessPlannedWorkoutProviderMappingV1('wahoo', projectStrengthWorkoutToV1(details), details);
    expect(assessment.level).toBe('unsupported');
    expect(assessment.issues[0]).toMatchObject({ severity: 'unsupported', code: 'unsupported_ending' });
    expect(() => serializeWahooStrengthPlanV1(details, { ...options, allowDegraded: true })).toThrow(/cannot be represented/);
    expect(() => serializeWahooPlanJsonV1(projectStrengthWorkoutToV1(details), { ...options, location: 'indoor' })).toThrow();
  });
});
