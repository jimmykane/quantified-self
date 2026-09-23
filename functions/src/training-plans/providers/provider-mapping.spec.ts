import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
    GARMIN_CYCLING_WORKOUT_SPORTS_V1,
    GARMIN_PLANNED_WORKOUT_SPORTS_V1,
    GARMIN_RUNNING_WORKOUT_SPORTS_V1,
    COROS_PLANNED_WORKOUT_SPORTS_V1,
    PLANNED_WORKOUT_PROVIDER_IDS,
    PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1,
    assessPlannedWorkoutProviderMappingV1,
    isPlannedWorkoutProviderDeliveryEnabled,
} from '../../../../shared/planned-workout-providers';
import {
    MANUAL_WORKOUT_EDITOR_SPORTS_V1,
    type WorkoutStructureV1,
} from '../../../../shared/planned-workout';
import canonicalRunningFixture from './fixtures/canonical-running-v1.json';
import expectedCorosFixture from './fixtures/coros-running-v1.json';
import expectedGarminFixture from './fixtures/garmin-running-v1.json';
import expectedSuuntoFixture from './fixtures/suunto-running-v1.json';
import expectedWahooFixture from './fixtures/wahoo-running-v1.json';
import { serializeCorosTrainingPlanV1 } from './coros-training-plan.serializer';
import {
    serializeGarminWorkoutScheduleV1,
    serializeGarminWorkoutV1,
} from './garmin-workout.serializer';
import {
    ProviderWorkoutMappingError,
    createStableProviderExternalId,
    createStableProviderIntegerId,
} from './provider-mapping';
import { serializeSuuntoGuideJsonV1 } from './suunto-guide.serializer';
import { serializeWahooPlanJsonV1 } from './wahoo-plan.serializer';

const RUNNING_FIXTURE = canonicalRunningFixture as WorkoutStructureV1;

function oneStepStructure(overrides: Partial<WorkoutStructureV1['nodes'][number]> = {}): WorkoutStructureV1 {
    return {
        version: 1,
        sport: ActivityTypes.Cycling,
        nodes: [{
            kind: 'step',
            id: 'main',
            purpose: 'work',
            ending: { kind: 'time', seconds: 600 },
            targets: [],
            ...overrides,
        } as WorkoutStructureV1['nodes'][number]],
    };
}

describe('planned-workout provider proof fixtures', () => {
    it('enables public delivery for every implemented provider', () => {
        expect(Object.values(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1)).toHaveLength(4);
        for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
            expect(isPlannedWorkoutProviderDeliveryEnabled(provider)).toBe(true);
            expect(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[provider]).toMatchObject({
                implementationState: 'enabled', deliveryEnabled: true, unresolvedGates: [],
            });
        }
        expect(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1.suunto.profile?.sports)
            .toEqual(MANUAL_WORKOUT_EDITOR_SPORTS_V1);
        expect(GARMIN_PLANNED_WORKOUT_SPORTS_V1).toEqual([
            ActivityTypes.Running,
            ActivityTypes.TrailRunning,
            ActivityTypes.Treadmill,
            ActivityTypes.IndoorRunning,
            ActivityTypes.VirtualRunning,
            ActivityTypes.Cycling,
            ActivityTypes.MountainBiking,
            ActivityTypes.IndoorCycling,
            ActivityTypes.VirtualCycling,
            ActivityTypes.EBiking,
            ActivityTypes.Handcycle,
            ActivityTypes.Velomobile,
            ActivityTypes['Enduro MTB'],
            ActivityTypes.DownhillCycling,
        ]);
        expect(GARMIN_PLANNED_WORKOUT_SPORTS_V1).toEqual(expect.arrayContaining(
            MANUAL_WORKOUT_EDITOR_SPORTS_V1.filter(sport => sport !== ActivityTypes.Swimming),
        ));
        expect(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1.garmin.profile?.sports)
            .toBe(GARMIN_PLANNED_WORKOUT_SPORTS_V1);
        expect(PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1.coros.profile?.sports)
            .toBe(COROS_PLANNED_WORKOUT_SPORTS_V1);
    });

    it('matches the redacted Garmin workout and separate schedule contracts exactly', () => {
        const result = serializeGarminWorkoutV1(RUNNING_FIXTURE, {
            name: 'Fixture intervals',
            description: 'Redacted provider contract fixture.',
            allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        expect(result.issues).toEqual([]);
        expect(result.artifact).toEqual(expectedGarminFixture);
        expect(serializeGarminWorkoutScheduleV1(123456789, '2026-09-03')).toEqual({
            workoutId: 123456789,
            date: '2026-09-03',
        });
    });

    it('matches the redacted COROS training-plan contract exactly', () => {
        expect(() => serializeCorosTrainingPlanV1(RUNNING_FIXTURE, {
            athleteId: 24680,
            sourceWorkoutId: 'fixture-workout-001',
            title: 'Fixture intervals',
            description: 'Redacted provider contract fixture.',
            localDate: '2026-09-03',
            lastModifiedDate: '2026-09-02T12:00:00.000',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));

        const result = serializeCorosTrainingPlanV1(RUNNING_FIXTURE, {
            athleteId: 24680,
            sourceWorkoutId: 'fixture-workout-001',
            title: 'Fixture intervals',
            description: 'Redacted provider contract fixture.',
            localDate: '2026-09-03',
            lastModifiedDate: '2026-09-02T12:00:00.000',
            allowDegraded: true,
        });
        expect(result.level).toBe('degraded');
        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'purpose_degraded',
            path: '$.nodes[1].steps[1].purpose',
        }));
        expect(result.artifact).toEqual(expectedCorosFixture);
    });

    it('matches the redacted Wahoo plan.json fixture exactly', () => {
        const result = serializeWahooPlanJsonV1(RUNNING_FIXTURE, {
            name: 'Fixture intervals',
            description: 'Redacted provider contract fixture.',
            location: 'outdoor',
            allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        expect(result.issues).toEqual([]);
        expect(result.artifact).toEqual(expectedWahooFixture);
    });

    it('matches the redacted Suunto Guide fixture exactly', () => {
        const result = serializeSuuntoGuideJsonV1(RUNNING_FIXTURE, {
            name: 'Fixture intervals',
            description: 'Redacted provider contract fixture.',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'fixture-workout-001',
            allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        expect(result.issues).toEqual([]);
        expect(result.artifact).toEqual(expectedSuuntoFixture);
    });

    it.each([
        [ActivityTypes.Running, [1]],
        [ActivityTypes.TrailRunning, [22]],
        [ActivityTypes.Treadmill, [53]],
        [ActivityTypes.Cycling, [2]],
        [ActivityTypes.MountainBiking, [10]],
        [ActivityTypes.IndoorCycling, [52]],
        [ActivityTypes.EBiking, [105, 106]],
        [ActivityTypes.Handcycle, [109]],
        [ActivityTypes.Swimming, [21]],
    ] as const)('maps canonical %s to Suunto activity recommendations', (sport, activities) => {
        const result = serializeSuuntoGuideJsonV1({ ...oneStepStructure(), sport }, {
            name: `${sport} workout`,
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: `suunto-${sport}`,
            allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        expect(result.artifact.activities).toEqual(activities);
    });

    it.each([
        [ActivityTypes.Running, 'RUNNING', 'exact'],
        [ActivityTypes.TrailRunning, 'RUNNING', 'degraded'],
        [ActivityTypes.Treadmill, 'RUNNING', 'degraded'],
        [ActivityTypes.IndoorRunning, 'RUNNING', 'degraded'],
        [ActivityTypes.VirtualRunning, 'RUNNING', 'degraded'],
        [ActivityTypes.Cycling, 'CYCLING', 'exact'],
        [ActivityTypes.MountainBiking, 'CYCLING', 'degraded'],
        [ActivityTypes.IndoorCycling, 'CYCLING', 'degraded'],
        [ActivityTypes.VirtualCycling, 'CYCLING', 'degraded'],
        [ActivityTypes.EBiking, 'CYCLING', 'degraded'],
        [ActivityTypes.Handcycle, 'CYCLING', 'degraded'],
        [ActivityTypes.Velomobile, 'CYCLING', 'degraded'],
        [ActivityTypes['Enduro MTB'], 'CYCLING', 'degraded'],
        [ActivityTypes.DownhillCycling, 'CYCLING', 'degraded'],
    ] as const)('maps canonical %s to Garmin %s with truthful fidelity', (sport, garminSport, level) => {
        const structure = { ...oneStepStructure(), sport };
        const result = serializeGarminWorkoutV1(structure, {
            name: `${sport} workout`,
            allowDegraded: true,
        });

        expect(result.level).toBe(level);
        expect(result.artifact.sport).toBe(garminSport);
        expect(result.artifact.segments[0].sport).toBe(garminSport);
        expect(result.issues.some(issue => issue.code === 'sport_profile_degraded')).toBe(level === 'degraded');
    });

    it('keeps Garmin family folds explicit and separate from the authored workout sport', () => {
        expect(GARMIN_RUNNING_WORKOUT_SPORTS_V1).toContain(ActivityTypes.VirtualRunning);
        expect(GARMIN_CYCLING_WORKOUT_SPORTS_V1).toContain(ActivityTypes.DownhillCycling);
        const structure = { ...oneStepStructure(), sport: ActivityTypes.DownhillCycling };
        const before = structuredClone(structure);
        const result = serializeGarminWorkoutV1(structure, {
            name: 'Downhill session',
            allowDegraded: true,
        });

        expect(structure).toEqual(before);
        expect(structure.sport).toBe(ActivityTypes.DownhillCycling);
        expect(result.artifact.sport).toBe('CYCLING');
        expect(result.level).toBe('degraded');
        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'sport_profile_degraded',
            message: expect.stringContaining('Downhill Cycling'),
        }));
    });

    it('requires approval for a Garmin family fold while keeping other unproved mappings unsupported', () => {
        const mountainBike = { ...oneStepStructure(), sport: ActivityTypes.MountainBiking };
        const swimming = { ...oneStepStructure(), sport: ActivityTypes.Swimming };
        expect(assessPlannedWorkoutProviderMappingV1('suunto', mountainBike).level).toBe('exact');
        expect(assessPlannedWorkoutProviderMappingV1('garmin', mountainBike)).toMatchObject({
            level: 'degraded',
            issues: [expect.objectContaining({ code: 'sport_profile_degraded' })],
        });
        expect(assessPlannedWorkoutProviderMappingV1('garmin', swimming)).toMatchObject({
            level: 'unsupported',
            issues: [expect.objectContaining({ code: 'unsupported_sport' })],
        });
        expect(assessPlannedWorkoutProviderMappingV1('wahoo', swimming)).toMatchObject({
            level: 'unsupported',
            issues: [expect.objectContaining({ code: 'unsupported_sport' })],
        });
        expect(() => serializeGarminWorkoutV1(mountainBike, {
            name: 'MTB workout',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));
        expect(assessPlannedWorkoutProviderMappingV1('coros', mountainBike)).toMatchObject({
            level: 'degraded',
            issues: [expect.objectContaining({ code: 'sport_profile_degraded' })],
        });
        expect(assessPlannedWorkoutProviderMappingV1('wahoo', mountainBike)).toMatchObject({
            level: 'unsupported',
            issues: [expect.objectContaining({ code: 'unsupported_sport' })],
        });
    });

    it('maps target-free pool swimming to COROS and Suunto without claiming unsupported targets', () => {
        const swimming: WorkoutStructureV1 = {
            version: 1,
            sport: ActivityTypes.Swimming,
            nodes: [{
                kind: 'repeat', id: 'set', count: 4,
                steps: [{
                    kind: 'step', id: 'lengths', purpose: 'work',
                    ending: { kind: 'distance', meters: 25 }, targets: [],
                }],
            }],
        };
        expect(assessPlannedWorkoutProviderMappingV1('coros', swimming).level).toBe('exact');
        expect(assessPlannedWorkoutProviderMappingV1('suunto', swimming).level).toBe('exact');
        const coros = serializeCorosTrainingPlanV1(swimming, {
            athleteId: 24680, sourceWorkoutId: 'pool-test', title: 'Pool test',
            localDate: '2026-09-24', lastModifiedDate: '2026-09-23T12:00:00', allowDegraded: false,
        });
        expect(coros.artifact.Workouts[0].WorkoutType).toBe('swim');
        expect(coros.artifact.Workouts[0].Structure[0]).toMatchObject({
            Type: 'Repetition', Steps: [{ Length: { Unit: 'Meter', Value: 25 }, IntensityTarget: [] }],
        });
        const suunto = serializeSuuntoGuideJsonV1(swimming, {
            name: 'Pool test', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-24', sourceWorkoutId: 'pool-test', allowDegraded: false,
        });
        expect(suunto.artifact.activities).toEqual([21]);
        expect(suunto.artifact.steps[0]).toMatchObject({ type: 'repeat' });
        const targeted: WorkoutStructureV1 = {
            ...swimming,
            nodes: [{
                kind: 'step', id: 'targeted', purpose: 'work',
                ending: { kind: 'distance', meters: 100 },
                targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 }],
            }],
        };
        expect(assessPlannedWorkoutProviderMappingV1('coros', targeted)).toMatchObject({
            level: 'unsupported', issues: [expect.objectContaining({ code: 'unsupported_target' })],
        });
    });

    it.each([
        [ActivityTypes.Running, 'run', 'exact'],
        [ActivityTypes.TrailRunning, 'trailRun', 'exact'],
        [ActivityTypes.Treadmill, 'run', 'degraded'],
        [ActivityTypes.Cycling, 'bike', 'exact'],
        [ActivityTypes.MountainBiking, 'bike', 'degraded'],
        [ActivityTypes.IndoorCycling, 'bike', 'degraded'],
        [ActivityTypes.EBiking, 'bike', 'degraded'],
        [ActivityTypes.Handcycle, 'bike', 'degraded'],
    ] as const)('maps canonical %s to COROS %s with truthful fidelity', (sport, workoutType, level) => {
        const result = serializeCorosTrainingPlanV1({ ...oneStepStructure(), sport }, {
            athleteId: 24680,
            workoutId: 13579,
            title: `${sport} workout`,
            localDate: '2026-09-03',
            lastModifiedDate: '2026-09-02T12:00:00',
            allowDegraded: true,
        });
        expect(result.level).toBe(level);
        expect(result.artifact.Workouts[0].WorkoutType).toBe(workoutType);
        expect(result.artifact.Workouts[0].Id).toBe(13579);
        expect(result.issues.some(issue => issue.code === 'sport_profile_degraded')).toBe(level === 'degraded');
    });

    it('rejects cadence targets for every COROS cycling-family profile', () => {
        for (const sport of [ActivityTypes.Cycling, ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling,
            ActivityTypes.EBiking, ActivityTypes.Handcycle]) {
            const assessment = assessPlannedWorkoutProviderMappingV1('coros', {
                ...oneStepStructure({
                    targets: [{ kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 }],
                }),
                sport,
            });
            expect(assessment).toMatchObject({
                level: 'unsupported',
                issues: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_target' })]),
            });
        }
    });

    it('maps Wahoo native relative FTP targets through the header', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'ftp',
            purpose: 'work',
            ending: { kind: 'kilojoules', kilojoules: 120 },
            targets: [{
                kind: 'power',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 105,
                reference: { kind: 'functional-threshold-power', watts: 300 },
            }],
        });
        const result = serializeWahooPlanJsonV1(structure, {
            name: 'FTP work',
            location: 'indoor',
            allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        expect(result.artifact.header.ftp).toBe(300);
        expect(result.artifact.intervals[0]).toMatchObject({
            exit_trigger_type: 'kj2',
            exit_trigger_value: 120,
            targets: [{ type: 'ftp', low: 0.9, high: 1.05 }],
        });
    });

    it('requires approval before rounding Wahoo integer header references', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'fractional-ftp',
            purpose: 'work',
            ending: { kind: 'time', seconds: 600 },
            targets: [{
                kind: 'power',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 100,
                reference: { kind: 'functional-threshold-power', watts: 299.5 },
            }],
        });

        expect(() => serializeWahooPlanJsonV1(structure, {
            name: 'Fractional FTP',
            location: 'indoor',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));

        const approved = serializeWahooPlanJsonV1(structure, {
            name: 'Fractional FTP',
            location: 'indoor',
            allowDegraded: true,
        });
        expect(approved.level).toBe('degraded');
        expect(approved.issues).toContainEqual(expect.objectContaining({ code: 'relative_reference_rounded' }));
        expect(approved.artifact.header.ftp).toBe(300);
    });

    it('does not claim universal device support for Wahoo relative heart-rate targets', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'threshold-heart-rate',
            purpose: 'work',
            ending: { kind: 'time', seconds: 600 },
            targets: [{
                kind: 'heart-rate',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 100,
                reference: { kind: 'threshold-heart-rate', bpm: 170 },
            }],
        });

        expect(() => serializeWahooPlanJsonV1(structure, {
            name: 'Threshold HR',
            location: 'indoor',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));

        const approved = serializeWahooPlanJsonV1(structure, {
            name: 'Threshold HR',
            location: 'indoor',
            allowDegraded: true,
        });
        expect(approved.issues).toContainEqual(expect.objectContaining({
            code: 'relative_target_device_support_limited',
        }));
        expect(approved.artifact.header.threshold_hr).toBe(170);
        expect(approved.artifact.intervals[0].targets).toEqual([
            { type: 'threshold_hr', low: 0.9, high: 1 },
        ]);
    });

    it('requires explicit approval before Wahoo freezes a critical-power target', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'critical',
            purpose: 'work',
            ending: { kind: 'time', seconds: 300 },
            targets: [{
                kind: 'power',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 110,
                reference: { kind: 'critical-power', watts: 250 },
            }],
        });

        expect(() => serializeWahooPlanJsonV1(structure, {
            name: 'Critical power',
            location: 'indoor',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({
            code: 'degradation-confirmation-required',
        } satisfies Partial<ProviderWorkoutMappingError>));

        const approved = serializeWahooPlanJsonV1(structure, {
            name: 'Critical power',
            location: 'indoor',
            allowDegraded: true,
        });
        expect(approved.level).toBe('degraded');
        expect(approved.artifact.intervals[0].targets).toEqual([
            { type: 'watts', low: 225, high: 275 },
        ]);
    });

    it('requires explicit approval before Garmin freezes a relative target snapshot', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'ftp',
            purpose: 'work',
            ending: { kind: 'time', seconds: 300 },
            targets: [{
                kind: 'power',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 110,
                reference: { kind: 'functional-threshold-power', watts: 250 },
            }],
        });

        expect(() => serializeGarminWorkoutV1(structure, {
            name: 'FTP work',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));

        const approved = serializeGarminWorkoutV1(structure, {
            name: 'FTP work',
            allowDegraded: true,
        });
        expect(approved.issues).toContainEqual(expect.objectContaining({ code: 'relative_target_degraded' }));
        expect(approved.artifact.segments[0].steps[0]).toMatchObject({
            targetType: 'POWER',
            targetValueLow: 225,
            targetValueHigh: 275,
        });
    });

    it('uses COROS native threshold snapshots and gates lossy integer rounding', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'threshold-speed',
            purpose: 'work',
            ending: { kind: 'distance', meters: 1000.4 },
            targets: [{
                kind: 'speed',
                mode: 'relative',
                minimumPercent: 89.5,
                maximumPercent: 100.4,
                presentation: 'pace',
                reference: { kind: 'threshold-speed', metersPerSecond: 4.2 },
            }],
        });
        const options = {
            athleteId: 24680,
            sourceWorkoutId: 'coros-threshold',
            title: 'Threshold work',
            localDate: '2026-09-03',
            lastModifiedDate: '2026-09-02T12:00:00',
        };

        expect(() => serializeCorosTrainingPlanV1(structure, {
            ...options,
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));

        const approved = serializeCorosTrainingPlanV1(structure, {
            ...options,
            allowDegraded: true,
        });
        expect(approved.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'ending_value_rounded' }),
            expect.objectContaining({ code: 'target_percentage_rounded' }),
        ]));
        expect(approved.artifact.Workouts[0].Structure[0]).toMatchObject({
            Length: { Unit: 'Meter', Value: 1000 },
            ThresholdSpeed: 4.2,
            IntensityTarget: {
                Unit: 'PercentOfThresholdSpeed',
                MinValue: 90,
                MaxValue: 100,
            },
        });
    });

    it('keeps an approved tiny COROS step positive after integer rounding', () => {
        const structure = oneStepStructure({
            ending: { kind: 'time', seconds: 0.1 },
        });
        const result = serializeCorosTrainingPlanV1(structure, {
            athleteId: 24680,
            sourceWorkoutId: 'coros-tiny-step',
            title: 'Tiny step',
            localDate: '2026-09-03',
            lastModifiedDate: '2026-09-02T12:00:00',
            allowDegraded: true,
        });

        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ending_value_rounded' }));
        expect(result.artifact.Workouts[0].Structure[0]).toMatchObject({
            Length: { Unit: 'Second', Value: 1 },
        });
    });

    it('rejects COROS athlete IDs outside the provider signed-int range', () => {
        expect(() => serializeCorosTrainingPlanV1(oneStepStructure(), {
            athleteId: 2_147_483_648,
            sourceWorkoutId: 'coros-athlete-overflow',
            title: 'Overflow',
            localDate: '2026-09-03',
            lastModifiedDate: '2026-09-02T12:00:00',
            allowDegraded: false,
        })).toThrow('positive signed 32-bit integer');
    });

    it('rejects provider-specific target combinations that the contracts cannot carry', () => {
        const runningWithTwoTargets: WorkoutStructureV1 = {
            ...oneStepStructure({
                targets: [
                    { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 },
                    { kind: 'power', mode: 'absolute', minimumWatts: 200, maximumWatts: 240 },
                ],
            }),
            sport: ActivityTypes.Running,
        };
        const cyclingCadence = oneStepStructure({
            targets: [{ kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 }],
        });

        expect(assessPlannedWorkoutProviderMappingV1('garmin', runningWithTwoTargets)).toMatchObject({
            level: 'unsupported',
            issues: [expect.objectContaining({ code: 'unsupported_target' })],
        });
        expect(assessPlannedWorkoutProviderMappingV1('garmin', {
            ...runningWithTwoTargets,
            sport: ActivityTypes.MountainBiking,
        })).toMatchObject({
            level: 'degraded',
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'sport_profile_degraded' }),
                expect.objectContaining({ code: 'multiple_targets_degraded' }),
            ]),
        });
        expect(assessPlannedWorkoutProviderMappingV1('coros', cyclingCadence)).toMatchObject({
            level: 'unsupported',
            issues: [expect.objectContaining({ code: 'unsupported_target' })],
        });
    });

    it('freezes Suunto relative targets and converts cadence from rpm to hertz only with approval', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'cadence',
            purpose: 'work',
            ending: { kind: 'manual' },
            targets: [{
                kind: 'cadence',
                mode: 'relative',
                minimumPercent: 90,
                maximumPercent: 110,
                reference: { kind: 'preferred-cadence', rpm: 90 },
            }],
        });

        expect(() => serializeSuuntoGuideJsonV1(structure, {
            name: 'Cadence',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'cadence-workout',
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));

        const approved = serializeSuuntoGuideJsonV1(structure, {
            name: 'Cadence',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'cadence-workout',
            allowDegraded: true,
        });
        expect(approved.level).toBe('degraded');
        expect(approved.artifact.steps[0]).toMatchObject({
            type: 'fields',
            fields: [{ type: 'targetCadence', min: 1.35, max: 1.65 }],
            transitions: [{ condition: { type: 'manualLap' } }],
        });
    });

    it.each(['Tempo — steady run', 'Sample — interval session'])('adapts cosmetic watch text without approval: %s', name => {
        const structure = oneStepStructure({ kind: 'step', id: 'work', purpose: 'work',
            ending: { kind: 'time', seconds: 600 }, targets: [], note: '“Steady” — don’t rush…' });
        const before = JSON.stringify(structure);
        const result = serializeSuuntoGuideJsonV1(structure, {
            name, owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-03', sourceWorkoutId: 'cosmetic-workout', allowDegraded: false,
        });
        expect(result.level).toBe('exact'); expect(result.issues).toEqual([]);
        expect(result.artifact.name).toBe(name.replace('—', '-'));
        expect(result.artifact.description).toBe(name);
        expect(Array.from(result.artifact.shortDescription).length).toBeLessThanOrEqual(23);
        expect(result.artifact.steps[0]).toMatchObject({ fields: expect.arrayContaining([
            { type: 'text', value: '"Steady" - don\'t rush...' },
        ]) });
        expect(JSON.stringify(structure)).toBe(before);
    });

    it('keeps genuine Suunto instruction, title and explicit-subtitle losses behind approval', () => {
        const structure = oneStepStructure({ kind: 'step', id: 'work', purpose: 'work',
            ending: { kind: 'time', seconds: 600 }, targets: [], note: 'x'.repeat(39) + '…' });
        const result = serializeSuuntoGuideJsonV1(structure, {
            name: 'x'.repeat(61), shortDescription: 'Explicit subtitle that is too long', owner: 'Quantified Self',
            url: 'https://quantified-self.io/training/plans', localDate: '2026-09-03',
            sourceWorkoutId: 'long-workout', allowDegraded: true,
        });
        expect(result.level).toBe('degraded');
        expect(result.issues.map(issue => [issue.code, issue.path])).toEqual(expect.arrayContaining([
            ['text_truncated', '$.name'], ['text_truncated', '$.shortDescription'],
            ['text_truncated_for_metrics', '$.nodes[0].note'],
        ]));
    });

    it('preserves Unicode and exact ownership rather than guessing, and does not repeat derived-text warnings', () => {
        const structure = oneStepStructure({ kind: 'step', id: 'work', purpose: 'work',
            ending: { kind: 'time', seconds: 600 }, targets: [] });
        const result = serializeSuuntoGuideJsonV1(structure, {
            name: 'Café 🚴', description: 'App-only description — Ελληνικά', owner: 'Coach — App',
            url: 'https://quantified-self.io/training/plans', localDate: '2026-09-03',
            sourceWorkoutId: 'unicode-title', allowDegraded: true,
        });
        expect(result.artifact.owner).toBe('Coach — App');
        expect(result.artifact.name).toBe('Café 🚴');
        expect(result.artifact.description).toBe('App-only description — Ελληνικά');
        expect(result.issues.map(issue => issue.path)).toEqual(['$.name', '$.owner']);
    });

    it('does not claim exact Suunto rendering outside the guaranteed watch character set', () => {
        const structure = oneStepStructure({
            kind: 'step',
            id: 'unicode-note',
            purpose: 'work',
            ending: { kind: 'time', seconds: 600 },
            targets: [],
            note: 'Push steady 🚴',
        });
        const options = {
            name: 'Unicode guidance',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'unicode-workout',
        };

        expect(() => serializeSuuntoGuideJsonV1(structure, {
            ...options,
            allowDegraded: false,
        })).toThrow(expect.objectContaining({ code: 'degradation-confirmation-required' }));

        const approved = serializeSuuntoGuideJsonV1(structure, {
            ...options,
            allowDegraded: true,
        });
        expect(approved.issues).toContainEqual(expect.objectContaining({
            code: 'device_character_support_unverified',
            path: '$.nodes[0].note',
        }));
        expect(approved.artifact.steps[0]).toMatchObject({
            type: 'fields',
            fields: expect.arrayContaining([{ type: 'text', value: 'Push steady 🚴' }]),
        });
    });

    it('rejects endings that cannot be truthfully mapped', () => {
        const repetitions = oneStepStructure({
            kind: 'step',
            id: 'strength',
            purpose: 'work',
            ending: { kind: 'repetitions', repetitions: 12 },
            targets: [],
        });

        expect(() => serializeWahooPlanJsonV1(repetitions, {
            name: 'Repetitions',
            location: 'indoor',
            allowDegraded: true,
        })).toThrow(expect.objectContaining({ code: 'unsupported' }));
        expect(() => serializeSuuntoGuideJsonV1(repetitions, {
            name: 'Repetitions',
            owner: 'Quantified Self',
            url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-03',
            sourceWorkoutId: 'repetitions',
            allowDegraded: true,
        })).toThrow(expect.objectContaining({ code: 'unsupported' }));
    });

    it('creates stable opaque provider IDs within the strict Suunto limit', () => {
        const first = createStableProviderExternalId('suunto', 'internal-workout-id');
        expect(first).toBe(createStableProviderExternalId('suunto', 'internal-workout-id'));
        expect(first).not.toContain('internal-workout-id');
        expect(first.length).toBeLessThanOrEqual(64);
        expect(createStableProviderExternalId('wahoo', 'internal-workout-id')).not.toBe(first);

        const integerId = createStableProviderIntegerId('coros', 'internal-workout-id');
        expect(integerId).toBe(createStableProviderIntegerId('coros', 'internal-workout-id'));
        expect(Number.isSafeInteger(integerId)).toBe(true);
        expect(integerId).toBeGreaterThan(0);
        expect(integerId).toBeLessThanOrEqual(2_147_483_647);
    });
});
