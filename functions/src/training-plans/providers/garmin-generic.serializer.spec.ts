import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { parseWorkoutStructureV1, type WorkoutStructureV1, type WorkoutTargetV1 } from '../../../../shared/planned-workout';
import { GARMIN_GENERIC_WORKOUT_SPORTS_V1, assessPlannedWorkoutProviderMappingV1 } from '../../../../shared/planned-workout-providers';
import { serializeGarminWorkoutV1 } from './garmin-workout.serializer';
import { ProviderWorkoutMappingError } from './provider-mapping';

function recipe(sport: ActivityTypes): WorkoutStructureV1 {
    return { version: 1, sport, nodes: [
        { kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 30 }, targets: [] },
        { kind: 'repeat', id: 'set', count: 3, steps: [
            { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 500 },
                targets: [{ kind: 'speed', mode: 'absolute', presentation: 'pace', minimumMetersPerSecond: 1, maximumMetersPerSecond: 2 }] },
            { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 20 }, targets: [] },
        ] },
        { kind: 'step', id: 'finish', purpose: 'cooldown', ending: { kind: 'manual' }, targets: [] },
    ] };
}

describe('Garmin explicit Generic fallback', () => {
    it.each(GARMIN_GENERIC_WORKOUT_SPORTS_V1)('preserves %s while disclosing Generic and requiring approval', sport => {
        const structure = recipe(sport);
        const before = JSON.stringify(structure);
        expect(parseWorkoutStructureV1(JSON.parse(before))).toEqual(structure);
        const assessment = assessPlannedWorkoutProviderMappingV1('garmin', structure);
        expect(assessment).toMatchObject({ level: 'degraded', issues: [{ code: 'sport_profile_degraded', path: '$.sport' }] });
        expect(assessment.issues[0].message).toContain('Generic workout, not its native sport profile');
        expect(assessment.issues[0].message).toContain('only on some devices');
        expect(() => serializeGarminWorkoutV1(structure, { name: 'Authored workout', allowDegraded: false }))
            .toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));
        const result = serializeGarminWorkoutV1(structure, {
            name: 'Authored workout', description: 'Keep these instructions.', allowDegraded: true,
        });
        expect(result.level).toBe('degraded');
        expect(result.artifact).toMatchObject({ sport: 'GENERIC', workoutName: 'Authored workout',
            segments: [{ sport: 'GENERIC', steps: [
                { durationType: 'TIME', durationValue: 30, targetType: 'OPEN' },
                { repeatValue: 3, skipLastRestStep: false, steps: [
                    { durationType: 'DISTANCE', durationValue: 500, durationValueType: 'METER',
                        targetType: 'PACE', targetValueLow: 1, targetValueHigh: 2 },
                    { durationType: 'FIXED_REST', durationValue: 20 },
                ] },
                { durationType: 'OPEN', durationValue: null },
            ] }] });
        expect(result.artifact.description).toBe(`Quantified Self sport: ${sport}. Delivered as Garmin Generic; device support varies.\n\nKeep these instructions.`);
        expect(result.artifact).not.toHaveProperty('poolLength');
        expect(result.artifact).not.toHaveProperty('poolLengthUnit');
        expect(JSON.stringify(structure)).toBe(before);
        expect(JSON.parse(JSON.stringify(result.artifact))).toEqual(result.artifact);
    });

    it.each([
        [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 110, maximumBpm: 130 }, 'HEART_RATE', 110, 130],
        [{ kind: 'power', mode: 'absolute', minimumWatts: 100, maximumWatts: 150 }, 'POWER', 100, 150],
        [{ kind: 'cadence', mode: 'absolute', minimumRpm: 20, maximumRpm: 30 }, 'CADENCE', 20, 30],
        [{ kind: 'speed', mode: 'absolute', presentation: 'speed', minimumMetersPerSecond: 1, maximumMetersPerSecond: 2 }, 'SPEED', 1, 2],
    ] as const)('preserves a single %s target in canonical units', (target, type, low, high) => {
        const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Rowing, nodes: [
            { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [target] },
        ] };
        expect(serializeGarminWorkoutV1(structure, { name: 'Single target', allowDegraded: true }).artifact.segments[0].steps[0])
            .toMatchObject({ targetType: type, targetValueLow: low, targetValueHigh: high, secondaryTargetType: null });
    });

    it('discloses relative-target freezing as well as Generic, preserving the referenced scalar', () => {
        const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.IndoorRowing, nodes: [
            { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [
                { kind: 'power', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
                    reference: { kind: 'functional-threshold-power', watts: 300 } },
            ] },
        ] };
        const result = serializeGarminWorkoutV1(structure, { name: 'Relative rowing', allowDegraded: true });
        expect(result.issues.map(issue => issue.code)).toEqual(['sport_profile_degraded', 'relative_target_degraded']);
        expect(result.artifact.segments[0].steps[0]).toMatchObject({ targetType: 'POWER', targetValueLow: 240, targetValueHigh: 270 });
        expect(structure.nodes[0]).toMatchObject({ targets: [{ mode: 'relative', reference: { watts: 300 } }] });
    });

    it.each(GARMIN_GENERIC_WORKOUT_SPORTS_V1)('does not silently drop unsupported %s prescriptions', sport => {
        const targets: WorkoutTargetV1[] = [
            { kind: 'heart-rate', mode: 'absolute', minimumBpm: 110, maximumBpm: 130 },
            { kind: 'power', mode: 'absolute', minimumWatts: 100, maximumWatts: 150 },
        ];
        for (const step of [
            { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'repetitions', repetitions: 5 }, targets: [] },
            { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'kilojoules', kilojoules: 10 }, targets: [] },
            { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets },
        ]) {
            expect(() => serializeGarminWorkoutV1({ version: 1, sport, nodes: [step] }, {
                name: 'Unsupported prescription', allowDegraded: true,
            })).toThrow(ProviderWorkoutMappingError);
        }
    });

    it('does not map unrelated activity-catalog sports through a Generic catch-all', () => {
        expect(assessPlannedWorkoutProviderMappingV1('garmin', recipe(ActivityTypes.Yoga)))
            .toMatchObject({ level: 'unsupported', issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_sport' })]) });
        expect(() => serializeGarminWorkoutV1(recipe(ActivityTypes.Yoga), { name: 'Yoga', allowDegraded: true }))
            .toThrow(ProviderWorkoutMappingError);
    });

    it('counts the authored-sport prefix against the description limit without splitting Unicode', () => {
        const result = serializeGarminWorkoutV1(recipe(ActivityTypes.Walking), {
            name: 'Long description', description: '🚶'.repeat(1024), allowDegraded: true,
        });
        expect(Array.from(result.artifact.description)).toHaveLength(1024);
        expect(result.artifact.description).toMatch(/^Quantified Self sport: Walking\./);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'description_truncated', path: '$.description' }));
        expect(result.artifact.description.endsWith('🚶')).toBe(true);
    });
});
