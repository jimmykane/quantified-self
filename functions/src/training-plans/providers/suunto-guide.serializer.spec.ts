import { ActivityTypes, DataDuration, DistanceUnits, WeightUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { WorkoutEndingV1, WorkoutStructureV1, WorkoutStepV1 } from '../../../../shared/planned-workout';
import { packageGuide, readGuideArchive } from '../delivery/suunto/archive';
import { serializeSuuntoGuideJsonV1, serializeSuuntoGuideV2ForRecovery,
    type SuuntoGuideFieldsStepV1 } from './suunto-guide.serializer';
import { getDefaultUserUnitSettings, resolveUnitAwareDisplayStat } from '../../../../shared/unit-aware-display';

const options = { name: 'Synthetic intervals', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
    localDate: '2026-09-24', sourceWorkoutId: 'synthetic-repeat', allowDegraded: false };
const step: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] };
function mappedStep(sport: ActivityTypes, changes: Partial<WorkoutStepV1> = {}): SuuntoGuideFieldsStepV1 {
    return serializeSuuntoGuideJsonV1({ version: 1, sport, nodes: [{ ...step, ...changes }] }, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
}

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
    it.each([ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.Swimming, ActivityTypes.Rowing])(
        'keeps %s distance notification unit-neutral and manual guidance actionable', sport => {
            expect(mappedStep(sport, { ending: { kind: 'distance', meters: 100 } }).notification)
                .toEqual({ title: 'Work', text: 'Follow distance countdown' });
            expect(mappedStep(sport, { ending: { kind: 'manual' } }).notification)
                .toEqual({ title: 'Work', text: 'Press lap when ready' });
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
        ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming, ActivityTypes.Rowing, ActivityTypes.IndoorRowing,
    ])('shows native block-average pace, countdown and current HR for %s', sport => {
        expect(mappedStep(sport).fields).toEqual([
            { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
            { type: 'stepDurationCountdown', value: 60, title: 'Remain' },
            { type: 'heartRate', title: 'HR' },
        ]);
    });
    it.each([ActivityTypes.Cycling, ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling, ActivityTypes.EBiking,
        ActivityTypes.Handcycle])('shows current power, HR and speed for %s', sport => {
        expect(mappedStep(sport).fields.map(field => field.type)).toEqual(['power', 'stepDurationCountdown', 'heartRate', 'speed']);
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
        expect(cadence.fields.map(field => field.type)).toEqual(['heartRate', 'stepDurationCountdown', 'targetCadence', 'pace']);
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
        readings.forEach(field => expect(Object.keys(field).sort()).toEqual(field.type === 'pace'
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
    const cases = [null, ...endings].flatMap(prefix => endings.flatMap(last => [1, 3, 100].map(count =>
        ({ prefix, last, count }))));
    it.each(cases)('aligns every block for prefix=$prefix, repeat end=$last, count=$count', ({ prefix, last, count }) => {
        const first: WorkoutStepV1 = { ...step, id: 'first', ending: { kind: 'time', seconds: 15 } };
        const recovery: WorkoutStepV1 = { ...step, id: 'recovery', purpose: 'recovery', ending: last };
        const cooldown: WorkoutStepV1 = { ...step, id: 'cooldown', purpose: 'cooldown', ending: { kind: 'manual' } };
        const recipe: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [
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
            expect(mapped.fields).toContainEqual({ type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' });
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
