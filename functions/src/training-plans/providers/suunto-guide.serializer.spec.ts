import { ActivityTypes, DataDuration, DistanceUnits, WeightUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { WorkoutStructureValidationError,
    type WorkoutEndingV1, type WorkoutStructureV1, type WorkoutStepV1 } from '../../../../shared/planned-workout';
import { packageGuide, readGuideArchive } from '../delivery/suunto/archive';
import { serializeSuuntoGuideJsonV1, serializeSuuntoGuideV2ForRecovery, serializeSuuntoGuideV3ForRecovery, serializeSuuntoGuideV4ForRecovery, serializeSuuntoGuideV5ForRecovery, serializeSuuntoGuideV6ForRecovery, serializeSuuntoGuideV7ForRecovery, serializeSuuntoGuideV9ForRecovery,
    type SuuntoGuideFieldsStepV1 } from './suunto-guide.serializer';
import cyclingV4 from './fixtures/suunto-cycling-v4-recovery.json';
import swimmingV4 from './fixtures/suunto-swimming-v4-recovery.json';
import swimmingV6 from './fixtures/suunto-swimming-v6-recovery.json';
import { getDefaultUserUnitSettings, resolveUnitAwareDisplayStat } from '../../../../shared/unit-aware-display';
import { assessPlannedWorkoutProviderMappingV1 } from '../../../../shared/planned-workout-providers';

const options = { name: 'Synthetic intervals', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
    localDate: '2026-09-24', sourceWorkoutId: 'synthetic-repeat', allowDegraded: false };
const step: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] };
function mappedStep(sport: ActivityTypes, changes: Partial<WorkoutStepV1> = {}): SuuntoGuideFieldsStepV1 {
    return serializeSuuntoGuideJsonV1({ version: 1, sport, nodes: [{ ...step, ...changes }] }, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
}

describe('Suunto authored-target contract boundary (#773)', () => {
    it.each([
        [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 130, maximumBpm: 150 }, 'targetHeartRate', 130, 150],
        [{ kind: 'power', mode: 'absolute', minimumWatts: 180, maximumWatts: 220 }, 'targetPower', 180, 220],
        [{ kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4,
            presentation: 'pace' }, 'targetPace', 3, 4],
        [{ kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4,
            presentation: 'speed' }, 'targetSpeed', 3, 4],
        [{ kind: 'cadence', mode: 'absolute', minimumRpm: 84, maximumRpm: 96 }, 'targetCadence', 1.4, 1.6],
    ] satisfies Array<[WorkoutStepV1['targets'][number], string, number, number]>)(
        'preserves the published %s field %s and wire units', (target, type, min, max) => {
            const fields = mappedStep(ActivityTypes.Running, { targets: [target] }).fields;
            expect(fields.filter(field => field.type.startsWith('target'))).toEqual([
                expect.objectContaining({ type, min, max }),
            ]);
        });

    it.each(['max-heart-rate', 'threshold-heart-rate'] as const)(
        'freezes the saved %s snapshot into bpm, never a native watch percentage target', kind => {
            const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [{ ...step,
                targets: [{ kind: 'heart-rate', mode: 'relative', minimumPercent: 60, maximumPercent: 80,
                    reference: { kind, bpm: 200 } }] }] };
            const before = JSON.stringify(recipe);
            const result = serializeSuuntoGuideJsonV1(recipe, { ...options, allowDegraded: true });
            const fields = (result.artifact.steps[0] as SuuntoGuideFieldsStepV1).fields;
            expect(result.level).toBe('degraded');
            expect(fields.filter(field => field.type.startsWith('target'))).toEqual([
                { type: 'targetHeartRate', min: 120, max: 160, title: 'Tgt HR' },
            ]);
            expect(JSON.stringify(recipe)).toBe(before);
        });

    it.each(['stroke-rate', 'swolf', 'zone-sense', 'heart-rate-percentage'])(
        'does not approve or silently discard an uncontracted %s target', kind => {
            const invalidStep = { ...step, targets: [{ kind, mode: 'absolute', minimum: 30, maximum: 40 }] };
            const serializers = [serializeSuuntoGuideJsonV1, serializeSuuntoGuideV2ForRecovery, serializeSuuntoGuideV3ForRecovery,
                serializeSuuntoGuideV4ForRecovery, serializeSuuntoGuideV5ForRecovery, serializeSuuntoGuideV6ForRecovery, serializeSuuntoGuideV7ForRecovery, serializeSuuntoGuideV9ForRecovery];
            for (const nodes of [[invalidStep], [{ kind: 'repeat', id: 'sets', count: 2, steps: [invalidStep] }]]) {
                for (const serialize of serializers) {
                    expect(() => serialize({ version: 1, sport: ActivityTypes.Swimming, nodes },
                        { ...options, allowDegraded: true })).toThrow(WorkoutStructureValidationError);
                }
            }
        });

    it.each(['/Activity/ManualLap/0/StrokeRate/Average', '/Activity/Zones/ZoneSense/Zone1/Duration'])(
        'refuses a resource escape hatch on an otherwise valid target: %s', resource => {
            expect(() => serializeSuuntoGuideJsonV1({ version: 1, sport: ActivityTypes.Swimming,
                nodes: [{ ...step, targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120,
                    maximumBpm: 140, resource }] }] }, { ...options, allowDegraded: true }))
                .toThrow(WorkoutStructureValidationError);
        });
});

describe('Suunto v7 sport and prescription screen matrix (pool recovery; other sports unchanged)', () => {
    const hr = { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 } as const;
    const power = { kind: 'power', mode: 'absolute', minimumWatts: 150.5, maximumWatts: 180.25 } as const;
    const pace = { kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 1.1,
        maximumMetersPerSecond: 1.3, presentation: 'pace' } as const;
    const cadence = { kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 } as const;
    const prescriptions: Array<{ targets: WorkoutStepV1['targets']; running: string[]; cycling: string[]; swimming: string[] }> = [
        { targets: [], running: ['pace', 'heartRate'], cycling: ['power', 'heartRate', 'cadence', 'speed'], swimming: ['pace', 'strokeRate', 'swolf', 'heartRate'] },
        { targets: [hr], running: ['heartRate', 'pace'], cycling: ['heartRate', 'power', 'cadence', 'speed'], swimming: ['heartRate', 'pace', 'strokeRate', 'swolf'] },
        { targets: [pace], running: ['pace', 'heartRate'], cycling: ['pace', 'heartRate', 'power', 'cadence', 'speed'], swimming: ['pace', 'heartRate', 'strokeRate', 'swolf'] },
        { targets: [power], running: ['power', 'heartRate', 'pace'], cycling: ['power', 'heartRate', 'cadence', 'speed'], swimming: ['heartRate', 'pace', 'strokeRate', 'swolf'] },
        { targets: [cadence], running: ['cadence', 'heartRate', 'pace'], cycling: ['cadence', 'heartRate', 'power', 'speed'], swimming: ['heartRate', 'pace', 'strokeRate', 'swolf'] },
        { targets: [power, hr], running: ['power', 'heartRate', 'pace'], cycling: ['power', 'heartRate', 'cadence', 'speed'], swimming: ['heartRate', 'pace', 'strokeRate', 'swolf'] },
        { targets: [hr, pace], running: ['heartRate', 'pace'], cycling: ['heartRate', 'pace', 'power', 'cadence', 'speed'], swimming: ['heartRate', 'pace', 'strokeRate', 'swolf'] },
        { targets: [cadence, power], running: ['cadence', 'power', 'heartRate', 'pace'], cycling: ['cadence', 'power', 'heartRate', 'speed'], swimming: ['heartRate', 'pace', 'strokeRate', 'swolf'] },
    ];
    const sports = [[ActivityTypes.Running, 'running'], [ActivityTypes.Cycling, 'cycling'],
        [ActivityTypes.Swimming, 'swimming']] as const;
    const endings = [{ kind: 'time', seconds: 90.5 }, { kind: 'distance', meters: 1609.344 }, { kind: 'manual' }] as const;
    const cases = sports.flatMap(([sport, key]) => prescriptions.flatMap(prescription => endings.flatMap(ending =>
        [undefined, 'Stay relaxed'].map(note => ({ sport, prescription, readings: prescription[key], ending, note })))));
    it.each(cases)('preserves $sport prescription $prescription.targets with $ending and note=$note', ({ sport, prescription, readings, ending, note }) => {
        const recipe = { version: 1, sport, nodes: [{ ...step, ending, targets: prescription.targets, ...(note ? { note } : {}) }] };
        const before = JSON.stringify(recipe);
        const result = serializeSuuntoGuideV7ForRecovery(recipe, options);
        if (sport !== ActivityTypes.Swimming) expect(serializeSuuntoGuideJsonV1(recipe, options)).toEqual(result);
        const mapped = result.artifact.steps[0] as SuuntoGuideFieldsStepV1;
        const mandatory = serializeSuuntoGuideV2ForRecovery(recipe, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
        const measured = mapped.fields.filter(field => !field.type.startsWith('target') && field.type !== 'text'
            && !field.type.endsWith('Countdown'));
        expect(measured.map(field => field.type)).toEqual(readings.slice(0, 5 - mandatory.fields.length));
        expect(new Set(measured.map(field => field.type)).size).toBe(measured.length);
        expect(mapped.fields.length).toBeLessThanOrEqual(5);
        expect(mapped.fields.filter(field => field.type.startsWith('target')).map(field => ({ ...field, title: '' })))
            .toEqual(mandatory.fields.filter(field => field.type.startsWith('target')).map(field => ({ ...field, title: '' })));
        expect(mapped.fields.filter(field => field.type === 'text')).toEqual(mandatory.fields.filter(field => field.type === 'text'));
        expect(mapped.transitions).toEqual(mandatory.transitions);
        if (ending.kind !== 'manual') expect(mapped.fields[1]).toMatchObject({ type: ending.kind === 'time'
            ? 'stepDurationCountdown' : 'stepDistanceCountdown', value: ending.kind === 'time' ? ending.seconds : ending.meters });
        for (const field of measured) {
            if (field.type === 'pace' || field.type === 'strokeRate' || field.type === 'swolf' || (field.type === 'power' && sport === ActivityTypes.Cycling)) {
                expect(field).toEqual({ type: field.type, title: field.type === 'pace' ? 'Avg pace' : field.type === 'power' ? 'Avg pwr' : field.type === 'swolf' ? 'Avg SWOLF' : 'Avg strk',
                    window: 'manualLap', aggregate: 'average' });
            } else expect(Object.keys(field).sort()).toEqual(['title', 'type']);
        }
        expect(measured.every(field => !('value' in field))).toBe(true); // Missing sensors are never fabricated samples.
        expect(result.level).toBe('exact');
        expect(JSON.stringify(recipe)).toBe(before);
    });
    it.each([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])('uses swimming-only stroke rate for %s', sport => {
        expect(mappedStep(sport).fields).toEqual([
            { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
            { type: 'stepDurationCountdown', value: 60, title: sport === ActivityTypes.Swimming ? 'Time rem' : 'Remain' },
            { type: 'strokeRate', title: 'Avg strk', window: 'manualLap', aggregate: 'average' },
            ...(sport === ActivityTypes.Swimming ? [{ type: 'swolf', title: 'AvgSWOLF', window: 'manualLap', aggregate: 'average' }] : []),
            { type: 'heartRate', title: 'HR' },
        ]);
    });
    it.each([ActivityTypes.Rowing, ActivityTypes.IndoorRowing, ActivityTypes.Running, ActivityTypes.Cycling])(
        'does not introduce swimming stroke rate into %s', sport => {
            expect(mappedStep(sport).fields.some(field => field.type === 'strokeRate')).toBe(false);
        });
    it.each(sports)('keeps long Unicode manual text ahead of every optional reading for %s', (sport) => {
        const note = '泳'.repeat(45);
        const result = serializeSuuntoGuideJsonV1({ version: 1, sport, nodes: [{ ...step, ending: { kind: 'manual' }, note }] },
            { ...options, allowDegraded: true });
        const mapped = result.artifact.steps[0] as SuuntoGuideFieldsStepV1;
        expect(mapped.fields).toEqual([{ type: 'text', value: note }]);
        expect(mapped.notification!.text).toBe(note);
        expect(JSON.stringify(result.artifact)).not.toContain('createManualLap');
        expect(result.issues.map(issue => issue.code)).toEqual(['device_character_support_unverified']);
    });
    it.each([[ActivityTypes.Cycling, cyclingV4], [ActivityTypes.Swimming, swimmingV4]] as const)(
        'keeps exact frozen v4 %s payloads for recovery', (sport, fixture) => {
            const recipe = { version: 1, sport, nodes: [
                { ...step, id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 90 } },
                { kind: 'repeat', id: 'intervals', count: 3, steps: [
                    { ...step, ending: { kind: 'distance', meters: 100 } },
                    { ...step, id: 'recover', purpose: 'recovery', ending: { kind: 'manual' }, note: 'Stay relaxed' },
                ] },
            ] };
            const legacy = serializeSuuntoGuideV4ForRecovery(recipe, { ...options, name: 'Sport fixture', sourceWorkoutId: 'sport-fixture' }).artifact;
            expect(legacy).toEqual(fixture);
            expect(JSON.stringify(legacy)).not.toContain('strokeRate');
        });
});

describe('Pool SWOLF measured screen (#773)', () => {
    it('keeps the instruction and countdown with native average pace, stroke rate and SWOLF', () => {
        const mapped = mappedStep(ActivityTypes.Swimming, { note: 'Aim 30-40 cycles/min' });
        expect(mapped.fields).toEqual([
            { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
            { type: 'stepDurationCountdown', value: 60, title: 'Time rem' },
            { type: 'text', value: 'Aim 30-40 cycles/min' },
            { type: 'strokeRate', title: 'Avg strk', window: 'manualLap', aggregate: 'average' },
            { type: 'swolf', title: 'AvgSWOLF', window: 'manualLap', aggregate: 'average' },
        ]);
        expect(mapped.notification).toEqual({ title: 'Work', text: 'Aim 30-40 cycles/min' });
    });
    it.each([ActivityTypes.OpenWaterSwimming, ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill,
        ActivityTypes.Cycling, ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling, ActivityTypes.EBiking,
        ActivityTypes.Handcycle, ActivityTypes.Walking, ActivityTypes.Hiking,
        ActivityTypes.Rowing, ActivityTypes.IndoorRowing, ActivityTypes.StrengthTraining])(
        'does not add pool SWOLF to %s or change its v6 payload', sport => {
            const recipe = { version: 1, sport, nodes: [{ ...step, note: 'Stay relaxed' }] };
            const current = serializeSuuntoGuideJsonV1(recipe, options);
            expect(current.artifact).toEqual(serializeSuuntoGuideV6ForRecovery(recipe, options).artifact);
            expect(JSON.stringify(current.artifact)).not.toContain('swolf');
        });
    it('does not evict an authored HR target, its current reading or a note to fit SWOLF', () => {
        const mapped = mappedStep(ActivityTypes.Swimming, { note: 'Keep it easy', targets: [
            { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 },
        ] });
        expect(mapped.fields).toEqual([
            { type: 'heartRate', title: 'HR' },
            { type: 'stepDurationCountdown', value: 60, title: 'Time rem' },
            { type: 'targetHeartRate', min: 120, max: 140, title: 'Tgt HR' },
            { type: 'text', value: 'Keep it easy' },
            { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
        ]);
    });
    it('freezes the pre-change v6 early-Lap/repeat pool payload exactly', () => {
        const recipe = { version: 1, sport: ActivityTypes.Swimming, nodes: [
            { ...step, id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 90, allowEarlyLap: true }, note: 'Easy swim' },
            { kind: 'repeat', id: 'intervals', count: 2, steps: [
                { ...step, ending: { kind: 'distance', meters: 100 } },
                { ...step, id: 'recover', purpose: 'recovery', ending: { kind: 'manual' }, note: 'Stay relaxed' },
            ] },
            { ...step, id: 'cooldown', purpose: 'cooldown', ending: { kind: 'time', seconds: 30 } },
        ] };
        const fixtureOptions = { ...options, name: 'Pool screen fixture', sourceWorkoutId: 'synthetic-pool-v6' };
        expect(serializeSuuntoGuideV6ForRecovery(recipe, fixtureOptions).artifact).toEqual(swimmingV6);
        const current = serializeSuuntoGuideJsonV1(recipe, fixtureOptions).artifact;
        expect(current.steps).toHaveLength(swimmingV6.steps.length);
        current.steps.forEach((mapped, index) => {
            const legacy = swimmingV6.steps[index];
            if (mapped.type !== 'fields') throw new Error('Early-Lap fixture must use standalone screens');
            expect(mapped).toMatchObject({ id: legacy.id, type: legacy.type, title: legacy.title,
                ...(legacy.transitions ? { transitions: legacy.transitions } : {}),
                notification: legacy.notification });
            expect(mapped.createManualLap).toBe('createManualLap' in legacy ? legacy.createManualLap : undefined);
        });
        expect(JSON.stringify(current)).toContain('swolf');
        expect(JSON.stringify(swimmingV6)).not.toContain('swolf');
    });
});

describe('Suunto current readings and documented notifications', () => {
    it.each([
        ['work', 90, 'Work', 'For 01m 30s'], ['warmup', 5, 'Warm up', 'For 05s'],
        ['cooldown', 65, 'Cool down', 'For 01m 05s'], ['recovery', 30, 'Recovery', 'Recover for 30s'],
        ['rest', 120, 'Rest', 'Rest for 02m 00s'], ['other', 3600, 'Next', 'For 01h 00m 00s'],
    ] as const)('uses phase-aware %s notifications for %s seconds', (purpose, seconds, title, text) => {
        const mapped = mappedStep(ActivityTypes.Running, { purpose, ending: { kind: 'time', seconds } });
        expect(mapped.notification).toEqual({ title, text });
        expect(mapped.fields).toContainEqual({ type: 'stepDurationCountdown', value: seconds, title: 'Remain' });
        expect(mapped.transitions).toEqual([{ condition: { type: 'stepDuration', value: seconds } }]);
    });
    it('uses the same Sports Lib duration in metric and imperial settings without dropping seconds', () => {
        const metric = getDefaultUserUnitSettings();
        const imperial = { ...metric, distanceUnits: DistanceUnits.Miles, weightUnits: WeightUnits.Pounds };
        for (const settings of [metric, imperial]) {
            const duration = resolveUnitAwareDisplayStat(new DataDuration(90), settings)!.text;
            expect(mappedStep(ActivityTypes.Cycling, { ending: { kind: 'time', seconds: 90 } }).notification!.text).toBe(`For ${duration}`);
        }
    });
    it.each([ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming, ActivityTypes.Rowing])(
        'keeps %s distance notification unit-neutral and manual guidance actionable', sport => {
            expect(mappedStep(sport, { ending: { kind: 'distance', meters: 100 } }).notification)
                .toEqual({ title: 'Work', text: 'Follow distance countdown' });
            expect(mappedStep(sport, { ending: { kind: 'manual' } }).notification)
                .toEqual({ title: 'Work', text: [ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming].includes(sport)
                    ? 'Swim now. Press Lap to finish this interval.' : 'Press lap when ready' });
        });
    it('does not round fractional intervals or omit day-length seconds in generated durations', () => {
        for (const seconds of [0.5, 1.5, 86400, 86401, Number.MAX_VALUE]) {
            const mapped = mappedStep(ActivityTypes.Running, { ending: { kind: 'time', seconds } });
            expect(mapped.notification!.text).toBe('Follow time countdown');
            expect(mapped.fields).toContainEqual({ type: 'stepDurationCountdown', value: seconds, title: 'Remain' });
            expect(mapped.transitions).toEqual([{ condition: { type: 'stepDuration', value: seconds } }]);
        }
    });
    it.each([{ kind: 'time', seconds: 90 }, { kind: 'distance', meters: 100 }, { kind: 'manual' }] as const)(
        'preserves authored instructions instead of generated text for %s', ending => {
            expect(mappedStep(ActivityTypes.Running, { ending, note: 'Stay relaxed - easy breathing' }).notification!.text)
                .toBe('Stay relaxed - easy breathing');
        });
    it.each([
        ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill, ActivityTypes.Walking, ActivityTypes.Hiking,
        ActivityTypes.Rowing, ActivityTypes.IndoorRowing,
    ])('shows native block-average pace, countdown and current HR for %s', sport => {
        expect(mappedStep(sport).fields).toEqual([
            { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
            { type: 'stepDurationCountdown', value: 60, title: 'Remain' },
            { type: 'heartRate', title: 'HR' },
        ]);
    });
    it.each([ActivityTypes.Cycling, ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling, ActivityTypes.EBiking,
        ActivityTypes.Handcycle])('shows lap-average power, HR, cadence and speed for %s', sport => {
        expect(mappedStep(sport).fields.map(field => field.type)).toEqual(['power', 'stepDurationCountdown', 'heartRate', 'cadence', 'speed']);
    });
    it('only adds HR to a strength screen and preserves manual transitions and full text', () => {
        const short = mappedStep(ActivityTypes.StrengthTraining, { ending: { kind: 'manual' }, note: 'Squat - set 1 - 5 reps - 80 kg' });
        expect(short.fields.map(field => field.type)).toEqual(['heartRate', 'text']);
        expect(short.transitions).toEqual([{ condition: { type: 'manualLap' } }]);
        const long = 'Keep shoulders down and move through a full range';
        expect(Array.from(long).length).toBeGreaterThan(40);
        expect(mappedStep(ActivityTypes.StrengthTraining, { ending: { kind: 'manual' }, note: long }).fields)
            .toEqual([{ type: 'text', value: long }]);
        expect(short.notification!.text).toBe('Squat - set 1 - 5 reps - 80 kg');
    });
    it('reserves all authored content before optional readings and places the primary counterpart first', () => {
        const targets: WorkoutStepV1['targets'] = [
            { kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 },
            { kind: 'power', mode: 'absolute', minimumWatts: 150, maximumWatts: 180 },
        ];
        const mapped = mappedStep(ActivityTypes.Cycling, { targets, note: 'Stay seated' });
        expect(mapped.fields.map(field => field.type)).toEqual(['cadence', 'stepDurationCountdown', 'targetCadence', 'targetPower', 'text']);
        expect(mapped.fields).toContainEqual({ type: 'targetCadence', min: 80 / 60, max: 90 / 60, title: 'Tgt cad' });
        expect(mapped.fields).toContainEqual({ type: 'text', value: 'Stay seated' });
    });
    it('does not invent cadence/stroke or power sensor mappings for non-running/cycling sports', () => {
        const cadence = mappedStep(ActivityTypes.Swimming, { targets: [
            { kind: 'cadence', mode: 'absolute', minimumRpm: 40, maximumRpm: 50 },
        ] });
        expect(cadence.fields.map(field => field.type)).toEqual(['heartRate', 'stepDurationCountdown', 'targetCadence', 'pace', 'strokeRate']);
        const power = mappedStep(ActivityTypes.Rowing, { targets: [
            { kind: 'power', mode: 'absolute', minimumWatts: 150, maximumWatts: 180 },
        ] });
        expect(power.fields.map(field => field.type)).toEqual(['heartRate', 'stepDurationCountdown', 'targetPower', 'pace']);
    });
    it.each([
        [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 }, 'heartRate'],
        [{ kind: 'power', mode: 'absolute', minimumWatts: 150, maximumWatts: 180 }, 'power'],
        [{ kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4, presentation: 'pace' }, 'pace'],
        [{ kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4, presentation: 'speed' }, 'speed'],
        [{ kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 }, 'cadence'],
    ] as const)('deduplicates readings for primary %s', (target, type) => {
        const mapped = mappedStep(ActivityTypes.Cycling, { targets: [target] });
        expect(mapped.fields[0].type).toBe(type);
        expect(mapped.fields.filter(field => field.type === type)).toHaveLength(1);
        expect(mapped.fields).toHaveLength(5);
        const readings = mapped.fields.filter(field => ['heartRate', 'power', 'pace', 'speed', 'cadence'].includes(field.type));
        readings.forEach(field => expect(Object.keys(field).sort()).toEqual('window' in field
            ? ['aggregate', 'title', 'type', 'window'] : ['title', 'type']));
    });
    it('preserves distance transitions, text-only manual fallback and bounded Unicode notifications', () => {
        expect(mappedStep(ActivityTypes.Swimming, { ending: { kind: 'distance', meters: 100 } }).transitions)
            .toEqual([{ condition: { type: 'stepDistance', value: 100 } }]);
        expect(mappedStep(ActivityTypes.Running, { ending: { kind: 'manual' } }).fields)
            .toContainEqual({ type: 'text', value: 'Press lap' });
        const result = serializeSuuntoGuideJsonV1({ version: 1, sport: ActivityTypes.Running,
            nodes: [{ ...step, note: '🚴'.repeat(55) }] }, { ...options, allowDegraded: true });
        const mapped = result.artifact.steps[0] as SuuntoGuideFieldsStepV1;
        expect(Array.from(mapped.notification!.text)).toHaveLength(54);
        expect(Array.from((mapped.fields.find(field => field.type === 'text') as { value: string }).value)).toHaveLength(40);
        expect(result.issues.map(issue => issue.code)).toContain('device_character_support_unverified');
        expect(() => serializeSuuntoGuideJsonV1({ version: 1, sport: ActivityTypes.Running,
            nodes: [{ ...step, note: '🚴'.repeat(55) }] }, options)).toThrow('explicit degradation approval');
    });
    it('alerts at every short/recovery/repeat boundary and closes the last lap without adding a timer', () => {
        const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [
            { ...step, purpose: 'warmup', ending: { kind: 'time', seconds: 10 } },
            { kind: 'repeat', id: 'repeat', count: 3, steps: [
                { ...step, id: 'rep', ending: { kind: 'time', seconds: 5 } },
                { ...step, id: 'rest', purpose: 'recovery', ending: { kind: 'time', seconds: 5 } },
            ] },
        ] };
        const before = JSON.stringify(recipe);
        const guide = serializeSuuntoGuideJsonV1(recipe, options).artifact;
        const flattened = guide.steps.flatMap(node => node.type === 'repeat' ? node.steps : [node]);
        expect(flattened.slice(0, 3).map(node => node.notification)).toEqual([
            { title: 'Warm up', text: 'For 10s' }, { title: 'Work', text: 'For 05s' },
            { title: 'Recovery', text: 'Recover for 05s' },
        ]);
        flattened.forEach(node => {
            expect(node.notification).toBeDefined();
            expect(Array.from(node.notification!.title).length).toBeLessThanOrEqual(13);
            expect(Array.from(node.notification!.text).length).toBeLessThanOrEqual(54);
            node.fields.forEach(field => { if ('title' in field) expect(field.title.length).toBeLessThan(9); });
            expect(node.fields.length).toBeLessThanOrEqual(5);
        });
        expect(flattened.at(-1)).toEqual({ type: 'fields', title: 'Complete',
            fields: [{ type: 'text', value: 'Guide complete' }], notification: { title: 'Complete', text: 'Guide complete' },
            createManualLap: true });
        expect(JSON.stringify(guide)).not.toMatch(/"alerts"|"trigger"|"extensions"|"window":"step"/);
        expect(flattened.map(node => node.createManualLap ?? false)).toEqual([false, true, true, true]);
        expect(JSON.stringify(recipe)).toBe(before);
        const legacy = serializeSuuntoGuideV2ForRecovery(recipe, options).artifact;
        expect(legacy.steps).toHaveLength(2);
        expect(JSON.stringify(legacy)).not.toContain('notification');
    });
});

describe('Suunto block-average pace lap boundaries', () => {
    const endings: WorkoutEndingV1[] = [{ kind: 'time', seconds: 75 }, { kind: 'distance', meters: 400 }, { kind: 'manual' }];
    const cases = [ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.Swimming].flatMap(sport =>
        [null, ...endings].flatMap(prefix => endings.flatMap(last => [1, 3, 100].map(count => ({ sport, prefix, last, count })))));
    it.each(cases)('aligns $sport blocks for prefix=$prefix, repeat end=$last, count=$count', ({ sport, prefix, last, count }) => {
        const first: WorkoutStepV1 = { ...step, id: 'first', ending: { kind: 'time', seconds: 15 } };
        const recovery: WorkoutStepV1 = { ...step, id: 'recovery', purpose: 'recovery', ending: last };
        const cooldown: WorkoutStepV1 = { ...step, id: 'cooldown', purpose: 'cooldown', ending: { kind: 'manual' } };
        const recipe: WorkoutStructureV1 = { version: 1, sport, nodes: [
            ...(prefix ? [{ ...step, id: 'warmup', purpose: 'warmup' as const, ending: prefix }] : []),
            { kind: 'repeat', id: 'repeat', count, steps: [first, recovery] }, cooldown,
        ] };
        const before = JSON.stringify(recipe);
        const guide = serializeSuuntoGuideJsonV1(recipe, options).artifact;
        const played = guide.steps.flatMap(node => node.type === 'repeat'
            ? Array.from({ length: node.times }, () => node.steps).flat() : [node]);
        const prescribed = recipe.nodes.flatMap(node => node.kind === 'repeat'
            ? Array.from({ length: node.count }, () => node.steps).flat() : [node]);
        expect(played).toHaveLength(prescribed.length + 1);
        played.forEach((mapped, index) => {
            const previous = index ? prescribed[index - 1] : null;
            expect(mapped.createManualLap ?? false).toBe(!!previous && previous.ending.kind !== 'manual');
            if (index === prescribed.length) {
                expect(mapped.transitions).toBeUndefined();
                expect(mapped.fields).toEqual([{ type: 'text', value: 'Guide complete' }]);
                return;
            }
            const ending = prescribed[index].ending;
            expect(mapped.transitions).toEqual([{ condition: ending.kind === 'time'
                ? { type: 'stepDuration', value: ending.seconds } : ending.kind === 'distance'
                    ? { type: 'stepDistance', value: ending.meters } : { type: 'manualLap' } }]);
            expect(mapped.fields).toContainEqual({ type: sport === ActivityTypes.Cycling ? 'power' : 'pace',
                title: sport === ActivityTypes.Cycling ? 'Avg pwr' : 'Avg pace', window: 'manualLap', aggregate: 'average' });
            expect(mapped.notification).toBeDefined();
        });
        const repeats = guide.steps.filter(node => node.type === 'repeat');
        expect(repeats.length).toBeLessThanOrEqual(2);
        expect(repeats.reduce((sum, node) => sum + node.times, 0)).toBe(count);
        repeats.forEach(node => { expect(node).not.toHaveProperty('id'); node.steps.forEach(child => expect(child).not.toHaveProperty('id')); });
        expect(JSON.stringify(recipe)).toBe(before);
    });
    it('does not add recorded lap boundaries when no average-pace reading fits', () => {
        const recipe = { version: 1, sport: ActivityTypes.Running, nodes: [
            { ...step, targets: [
                { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 },
                { kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 3, maximumMetersPerSecond: 4, presentation: 'pace' },
            ], note: 'Full prescription' }, { ...step, id: 'manual', ending: { kind: 'manual' }, note: 'A'.repeat(45) },
        ] };
        const guide = serializeSuuntoGuideJsonV1(recipe, options).artifact;
        expect(JSON.stringify(guide)).not.toMatch(/createManualLap|aggregate|window/);
        expect((guide.steps[0] as SuuntoGuideFieldsStepV1).fields.map(field => field.type))
            .toEqual(['heartRate', 'stepDurationCountdown', 'targetHeartRate', 'targetPace', 'text']);
    });
    it('handles adjacent single-child repeats and a terminal lap-button step without duplicate laps', () => {
        const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [
            { kind: 'repeat', id: 'automatic', count: 100, steps: [step] },
            { kind: 'repeat', id: 'manual', count: 100, steps: [
                { ...step, id: 'manual-step', ending: { kind: 'manual' } },
            ] },
        ] };
        const guide = serializeSuuntoGuideJsonV1(recipe, options).artifact;
        const played = guide.steps.flatMap(node => node.type === 'repeat'
            ? Array.from({ length: node.times }, () => node.steps).flat() : [node]);
        expect(guide.steps).toHaveLength(5);
        expect(played).toHaveLength(201);
        expect(played.map(step => step.createManualLap ?? false)).toEqual([
            false, ...Array.from({ length: 100 }, () => true), ...Array.from({ length: 100 }, () => false),
        ]);
        expect(played.at(-1)).toMatchObject({ title: 'Complete' });
        expect(played.at(-1)).not.toHaveProperty('createManualLap');
        guide.steps.filter(node => node.type === 'repeat').forEach(node =>
            node.steps.forEach(child => expect(child).not.toHaveProperty('id')));
    });
    it('keeps long manual text intact while aligning subsequent average-pace blocks', () => {
        const recipe = { version: 1, sport: ActivityTypes.Running, nodes: [
            step, { ...step, id: 'manual', ending: { kind: 'manual' }, note: 'A'.repeat(45) },
            { ...step, id: 'later', ending: { kind: 'distance', meters: 1000 } },
        ] };
        const guide = serializeSuuntoGuideJsonV1(recipe, options).artifact;
        const steps = guide.steps as SuuntoGuideFieldsStepV1[];
        expect(steps[1].fields).toEqual([{ type: 'text', value: 'A'.repeat(45) }]);
        expect(steps.map(step => step.createManualLap ?? false)).toEqual([false, true, false, true]);
        expect(steps[2].fields[0]).toEqual({ type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' });
    });
});

describe('Suunto Guide repeat step IDs', () => {
    it('packages a terminal repeat without forbidden step IDs or changing the authored recipe', async () => {
        const structure: WorkoutStructureV1 = {
            version: 1,
            sport: ActivityTypes.Running,
            nodes: [{ kind: 'repeat', id: 'intervals', count: 4, steps: [
                { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] },
                { kind: 'step', id: 'rest', purpose: 'recovery', ending: { kind: 'time', seconds: 60 }, targets: [] },
            ] }],
        };
        const before = JSON.stringify(structure);
        const result = serializeSuuntoGuideJsonV1(structure, {
            name: 'Synthetic intervals', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-24', sourceWorkoutId: 'synthetic-repeat', allowDegraded: false,
        });

        expect(result.level).toBe('exact');
        const expectedChildren = [
                expect.objectContaining({ type: 'fields', transitions: [{ condition: { type: 'stepDuration', value: 60 } }] }),
                expect.objectContaining({ type: 'fields', transitions: [{ condition: { type: 'stepDuration', value: 60 } }] }),
        ];
        expect(result.artifact.steps).toEqual([
            { type: 'repeat', times: 1, steps: expectedChildren },
            { type: 'repeat', times: 3, steps: expectedChildren },
            expect.objectContaining({ type: 'fields', title: 'Complete', notification: { title: 'Complete', text: 'Guide complete' } }),
        ]);
        result.artifact.steps.filter(node => node.type === 'repeat').forEach(node => {
            expect(node).not.toHaveProperty('id');
            node.steps.forEach(step => expect(step).not.toHaveProperty('id'));
        });
        expect((await readGuideArchive(await packageGuide(result.artifact))).steps).toEqual(result.artifact.steps);
        expect(JSON.stringify(structure)).toBe(before);
    });

    it('keeps a stable ID on standalone steps after a repeat', () => {
        const structure: WorkoutStructureV1 = {
            version: 1,
            sport: ActivityTypes.Running,
            nodes: [
                { kind: 'repeat', id: 'intervals', count: 4, steps: [
                    { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] },
                ] },
                { kind: 'step', id: 'cooldown', purpose: 'cooldown', ending: { kind: 'time', seconds: 300 }, targets: [] },
            ],
        };
        const result = serializeSuuntoGuideJsonV1(structure, {
            name: 'Synthetic intervals', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
            localDate: '2026-09-24', sourceWorkoutId: 'synthetic-repeat-cooldown', allowDegraded: false,
        });
        expect(result.artifact.steps).toHaveLength(4);
        expect(result.artifact.steps[2]).toMatchObject({ type: 'fields', title: 'Cool down' });
        expect(result.artifact.steps[2]).toHaveProperty('id');
        expect(result.artifact.steps[0]).not.toHaveProperty('id');
    });
});


describe('Suunto athlete-authored early Lap boundaries', () => {
  it.each(['time', 'distance'] as const)('preserves %s countdown and branches without duplicate laps across repeat passes', kind => {
    const ending: WorkoutEndingV1 = kind === 'time' ? { kind, seconds: 90.25, allowEarlyLap: true }
      : { kind, meters: 400.125, allowEarlyLap: true };
    const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'repeat', id: 'intervals', count: 3, steps: [
        { ...step, ending }, { ...step, id: 'recovery', purpose: 'recovery', ending: { kind: 'time', seconds: 30 } },
      ] }, { ...step, id: 'finish', ending } ] };
    const original = JSON.stringify(recipe);
    const guide = serializeSuuntoGuideJsonV1(recipe, options).artifact;
    expect(JSON.stringify(recipe)).toBe(original);
    expect(guide.steps.every(node => node.type === 'fields')).toBe(true);
    const screens = guide.steps as SuuntoGuideFieldsStepV1[];
    for (const screen of screens.filter(node => node.transitions?.length === 2)) {
      expect(screen.transitions![1].condition).toEqual({ type: 'or', conditions: [
        kind === 'time' ? { type: 'stepDuration', value: 90.25 } : { type: 'stepDistance', value: 400.125 }, { type: 'manualLap' }] });
      const [button, automatic] = screen.transitions!.map(t => screens.find(s => s.id === t.stepId)!);
      expect(button).not.toHaveProperty('createManualLap');
      expect(automatic.createManualLap).toBe(true);
      expect(button.fields).toEqual(automatic.fields);
      expect(button.transitions).toEqual(automatic.transitions);
    }
    // Walk both paths and prove exactly seven prescribed occurrences + completion.
    for (const pressLap of [false, true]) {
      let current = screens[0]; const played: SuuntoGuideFieldsStepV1[] = [];
      while (current) {
        played.push(current);
        const transition = current.transitions?.[pressLap ? 0 : current.transitions.length - 1];
        current = screens.find(node => node.id === transition?.stepId)!;
      }
      expect(played).toHaveLength(8);
      expect(played.at(-1)?.title).toBe('Complete');
      expect(played.slice(1).map(node => node.createManualLap ?? false)).toEqual(
        pressLap ? [false, true, false, true, false, true, false] : Array(7).fill(true));
    }
  });
  it('keeps false/absent legacy payloads identical and rejects early Lap from old recovery versions', () => {
    const legacy = { version: 1, sport: ActivityTypes.Running, nodes: [step] };
    expect(serializeSuuntoGuideJsonV1({ ...legacy, nodes: [{ ...step, ending: { kind: 'time', seconds: 60, allowEarlyLap: false } }] }, options).artifact)
      .toEqual(serializeSuuntoGuideJsonV1(legacy, options).artifact);
    expect(() => serializeSuuntoGuideV4ForRecovery({ ...legacy, nodes: [{ ...step, ending: { kind: 'time', seconds: 60, allowEarlyLap: true } }] }, options)).toThrow();
  });
  it('fails closed beyond the documented provider screen bound', () => {
    expect(() => serializeSuuntoGuideJsonV1({ version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'repeat', id: 'many', count: 100, steps: Array.from({ length: 10 }, (_, i) => ({
        ...step, id: `work-${i}`, ending: { kind: 'time', seconds: 60, allowEarlyLap: true } })) }] }, options)).toThrow('1000-screen');
  });
  it('accepts compact repeats when prescribed fields leave no manual-lap average', () => {
    const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running,
      nodes: [{ kind: 'repeat', id: 'many', count: 100, steps: Array.from({ length: 10 }, (_, i) => ({
        ...step, id: `work-${i}`, ending: { kind: 'time', seconds: 60, allowEarlyLap: true }, note: 'Stay relaxed',
        targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 },
          { kind: 'cadence', mode: 'absolute', minimumRpm: 80, maximumRpm: 90 }],
      })) }] };
    expect(assessPlannedWorkoutProviderMappingV1('suunto', recipe).level).toBe('exact');
    const guide = serializeSuuntoGuideJsonV1(recipe, options).artifact;
    expect(guide.steps).toHaveLength(2);
    expect(guide.steps[0]).toMatchObject({ type: 'repeat', times: 100 });
    if (guide.steps[0].type !== 'repeat') throw new Error('Expected compact repeat');
    expect(guide.steps[0].steps.flatMap(screen => screen.fields).some(field => 'window' in field)).toBe(false);
    expect(JSON.stringify(guide)).not.toContain('createManualLap');
    // One selected average elsewhere requires boundaries across all occurrences.
    expect(() => serializeSuuntoGuideJsonV1({ ...recipe, nodes: [...recipe.nodes,
      { ...step, id: 'average' }] }, options)).toThrow('1000-screen');
  });
  it('accepts exactly 1000 expanded screens and rejects one more', () => {
    const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'repeat', id: 'many', count: 90, steps: Array.from({ length: 10 }, (_, i) => ({
        ...step, id: `work-${i}`, ending: { kind: 'time', seconds: 60, ...(i === 0 ? { allowEarlyLap: true } : {}) },
      })) }, ...Array.from({ length: 9 }, (_, i) => ({ ...step, id: `finish-${i}` })),
    ] };
    expect(assessPlannedWorkoutProviderMappingV1('suunto', recipe).level).toBe('exact');
    expect(serializeSuuntoGuideJsonV1(recipe, options).artifact.steps).toHaveLength(1000);
    const tooLarge = { ...recipe, nodes: [...recipe.nodes, { ...step, id: 'extra' }] };
    expect(assessPlannedWorkoutProviderMappingV1('suunto', tooLarge).level).toBe('unsupported');
    expect(() => serializeSuuntoGuideJsonV1(tooLarge, options)).toThrow('1000-screen');
  });
});


describe('v5 recovery remains frozen', () => {
  it('recreates historical screens exactly for false and absent permissions, and rejects true', () => {
    const recipe = { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'step', id: 'work', purpose: 'work',
      ending: { kind: 'time', seconds: 90.123 }, targets: [] }] };
    const options = { name: 'Frozen', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans', localDate: '2026-10-05', sourceWorkoutId: 'fixture', externalId: 'fixture', allowDegraded: true };
    const old = serializeSuuntoGuideV5ForRecovery(recipe, options).artifact;
    expect(serializeSuuntoGuideJsonV1(recipe, options).artifact).toEqual(old);
    const explicit = { ...recipe, nodes: [{ ...recipe.nodes[0], ending: { ...recipe.nodes[0].ending, allowEarlyLap: false } }] };
    expect(serializeSuuntoGuideV5ForRecovery(explicit, options).artifact).toEqual(old);
    expect(() => serializeSuuntoGuideV5ForRecovery({ ...explicit, nodes: [{ ...explicit.nodes[0],
      ending: { ...explicit.nodes[0].ending, allowEarlyLap: true } }] }, options)).toThrow();
  });
});
