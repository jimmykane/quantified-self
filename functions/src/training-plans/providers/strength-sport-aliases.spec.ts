import { guideMapping, assessSuuntoGuide } from '../delivery/suunto/mapping';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { parseWorkoutStructureV1 } from '../../../../shared/planned-workout';
import { assessPlannedWorkoutProviderMappingV1, isPlannedWorkoutProviderDeliveryEnabled } from '../../../../shared/planned-workout-providers';
import { parseStrengthWorkoutDetailsV1, projectStrengthWorkoutToV1, strengthProjectionMatchesDetails } from '../../../../shared/strength-workout';
import { serializeGarminStrengthWorkoutV1 } from './garmin-workout.serializer';
import { serializeCorosStrengthPlanV1 } from './coros-training-plan.serializer';
import { serializeWahooStrengthPlanV1 } from './wahoo-plan.serializer';
import { assessTrainingDeliveryMapping } from '../delivery/mapping';

const sports = [ActivityTypes.WeightTraining, ActivityTypes.Kettlebell, ActivityTypes.Calisthenics, ActivityTypes.CoreTraining,
  ActivityTypes.LesMillsCore, ActivityTypes.LesMillsGritStrength, ActivityTypes['LES MILLS BODYPUMP']];
const details = () => parseStrengthWorkoutDetailsV1({ version: 1, workoutId: 'fixture', revision: 1, exercises: [
  { id: 'squat', name: 'Goblet Squat', sets: [{ id: 'set', ending: { kind: 'time', seconds: 31 }, externalLoadKg: 12.5, restAfterSeconds: 17 }] },
] });
const coros = { athleteId: 123, workoutId: 456, title: 'Strength fixture', localDate: '2026-10-20',
  lastModifiedDate: '2026-10-20T12:00:00', allowDegraded: true };

describe('complete-prescription strength sport aliases', () => {
  it.each(sports)('preserves %s and requires the complete matching prescription and profile review', sport => {
    const full = details(), recipe = projectStrengthWorkoutToV1(full, sport), before = structuredClone(full);
    const workout = { schemaVersion: 1 as const, id: 'fixture', planId: null, title: 'Strength fixture', localDate: '2026-10-20',
      lifecycle: 'planned' as const, revision: 1, createdAtMs: 1, updatedAtMs: 1, structure: recipe };
    expect(recipe.sport).toBe(sport);
    expect(strengthProjectionMatchesDetails(recipe, full)).toBe(true);
    expect(parseWorkoutStructureV1(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    for (const provider of ['garmin', 'coros', 'wahoo'] as const) {
      expect(assessPlannedWorkoutProviderMappingV1(provider, recipe).level).toBe('unsupported');
      expect(assessPlannedWorkoutProviderMappingV1(provider, recipe, full)).toMatchObject({ level: 'degraded',
        issues: expect.arrayContaining([expect.objectContaining({ code: 'sport_profile_degraded', path: '$.sport' })]) });
      const wrong = structuredClone(full); wrong.exercises[0].sets[0].restAfterSeconds = 18;
      expect(assessPlannedWorkoutProviderMappingV1(provider, recipe, wrong).level).toBe('unsupported');
      expect(assessTrainingDeliveryMapping(provider, workout, 'destination', 'UTC', full).level).toBe('degraded');
      expect(assessTrainingDeliveryMapping(provider, workout, 'destination', 'UTC', { ...full, workoutId: 'foreign' }).level).toBe('unsupported');
      const changed = structuredClone(full); changed.exercises[0].sets[0].externalLoadKg = 15;
      expect(assessTrainingDeliveryMapping(provider, { ...workout, structure: projectStrengthWorkoutToV1(changed, sport) },
        'destination', 'UTC', changed).digest).not.toBe(assessTrainingDeliveryMapping(provider, workout, 'destination', 'UTC', full).digest);
    }
    const suunto = guideMapping(workout, 'destination', 'QS', full);
    expect(suunto.artifact.activities).toEqual(sport === ActivityTypes.Kettlebell ? [63] : sport === ActivityTypes.Calisthenics ? [104] : [23]);
    expect(suunto.artifact.steps.length).toBeGreaterThan(0);
    expect(assessSuuntoGuide(workout, 'destination', 'UTC', 'QS', { ...full, workoutId: 'foreign' }).level).toBe('unsupported');
    const g = serializeGarminStrengthWorkoutV1(full, { name: 'Strength fixture', sport, allowDegraded: true });
    expect(g.artifact).toMatchObject({ sport: 'STRENGTH_TRAINING', segments: [{ sport: 'STRENGTH_TRAINING', steps: [
      { durationType: 'TIME', durationValue: 31, weightValue: 12.5, exerciseName: 'GOBLET_SQUAT' },
      { durationType: 'FIXED_REST', durationValue: 17 },
    ] }] });
    expect(() => serializeGarminStrengthWorkoutV1(full, { name: 'Strength fixture', sport, allowDegraded: false })).toThrow();
    expect(serializeCorosStrengthPlanV1(full, { ...coros, sport }).artifact.Workouts[0]).toMatchObject({ WorkoutType: 'strength' });
    expect(() => serializeCorosStrengthPlanV1(full, { ...coros, sport, allowDegraded: false })).toThrow();
    const w = serializeWahooStrengthPlanV1(full, { name: 'Strength fixture', sport, allowDegraded: true });
    expect(w.requiresApproval).toBe(true);
    expect(w.artifact.header).toMatchObject({ workout_type_family: 6, workout_type_location: 0, duration_s: 48 });
    expect(w.artifact.intervals[0].name).toContain('Goblet Squat');
    expect(() => serializeWahooStrengthPlanV1(full, { name: 'Strength fixture', sport, allowDegraded: false })).toThrow();
    const reps = details(); reps.exercises[0].sets[0].ending = { kind: 'repetitions', repetitions: 8 };
    expect(() => serializeWahooStrengthPlanV1(reps, { name: 'Strength fixture', sport, allowDegraded: true })).toThrow();
    expect(isPlannedWorkoutProviderDeliveryEnabled('coros')).toBe(false);
    expect(full).toEqual(before);
  });
  it('rejects strength details disguised as an unrelated sport', () => {
    expect(() => projectStrengthWorkoutToV1(details(), ActivityTypes.Yoga)).toThrow();
  });
});
