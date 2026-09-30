import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { WorkoutStructureV1, WorkoutStepV1 } from '../../../../shared/planned-workout';
import { packageGuide, readGuideArchive } from '../delivery/suunto/archive';
import { serializeSuuntoGuideJsonV1, serializeSuuntoGuideV2ForRecovery, type SuuntoGuideFieldsStepV1 } from './suunto-guide.serializer';

const options = { name: 'Synthetic intervals', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
    localDate: '2026-09-24', sourceWorkoutId: 'synthetic-repeat', allowDegraded: false };
const step: WorkoutStepV1 = { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] };
function mappedStep(sport: ActivityTypes, changes: Partial<WorkoutStepV1> = {}): SuuntoGuideFieldsStepV1 {
    return serializeSuuntoGuideJsonV1({ version: 1, sport, nodes: [{ ...step, ...changes }] }, options).artifact.steps[0] as SuuntoGuideFieldsStepV1;
}

describe('Suunto current readings and documented notifications', () => {
    it.each([
        ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill, ActivityTypes.Walking, ActivityTypes.Hiking,
        ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming, ActivityTypes.Rowing, ActivityTypes.IndoorRowing,
    ])('shows native pace, countdown and HR for %s', sport => {
        expect(mappedStep(sport).fields).toEqual([
            { type: 'pace', title: 'Pace' }, { type: 'stepDurationCountdown', value: 60, title: 'Remain' },
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
        readings.forEach(field => expect(Object.keys(field).sort()).toEqual(['title', 'type']));
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
    it('alerts at every short/recovery/repeat boundary and finishes without a timer or lap creation', () => {
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
        flattened.forEach(node => {
            expect(node.notification).toBeDefined();
            expect(Array.from(node.notification!.title).length).toBeLessThanOrEqual(13);
            expect(Array.from(node.notification!.text).length).toBeLessThanOrEqual(54);
            node.fields.forEach(field => { if ('title' in field) expect(field.title.length).toBeLessThan(9); });
            expect(node.fields.length).toBeLessThanOrEqual(5);
        });
        expect(flattened.at(-1)).toEqual({ type: 'fields', title: 'Complete',
            fields: [{ type: 'text', value: 'Guide complete' }], notification: { title: 'Complete', text: 'Guide complete' } });
        expect(JSON.stringify(guide)).not.toMatch(/createManualLap|window|aggregate|"alerts"|"trigger"|"extensions"/);
        expect(JSON.stringify(recipe)).toBe(before);
        const legacy = serializeSuuntoGuideV2ForRecovery(recipe, options).artifact;
        expect(legacy.steps).toHaveLength(2);
        expect(JSON.stringify(legacy)).not.toContain('notification');
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
        expect(result.artifact.steps).toEqual([{
            type: 'repeat', times: 4, steps: [
                expect.objectContaining({ type: 'fields', transitions: [{ condition: { type: 'stepDuration', value: 60 } }] }),
                expect.objectContaining({ type: 'fields', transitions: [{ condition: { type: 'stepDuration', value: 60 } }] }),
            ],
        }, expect.objectContaining({ type: 'fields', title: 'Complete', notification: { title: 'Complete', text: 'Guide complete' } })]);
        expect(result.artifact.steps[0]).not.toHaveProperty('id');
        if (result.artifact.steps[0].type !== 'repeat') throw new Error('Expected repeat');
        result.artifact.steps[0].steps.forEach(step => expect(step).not.toHaveProperty('id'));
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
        expect(result.artifact.steps).toHaveLength(3);
        expect(result.artifact.steps[1]).toMatchObject({ type: 'fields', title: 'Cool down' });
        expect(result.artifact.steps[1]).toHaveProperty('id');
        expect(result.artifact.steps[0]).not.toHaveProperty('id');
    });
});
