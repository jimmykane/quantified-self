import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import type { WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { packageGuide, readGuideArchive } from '../delivery/suunto/archive';
import { serializeSuuntoGuideJsonV1 } from './suunto-guide.serializer';

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
        }]);
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
        expect(result.artifact.steps).toHaveLength(2);
        expect(result.artifact.steps[1]).toMatchObject({ type: 'fields', title: 'Cool down' });
        expect(result.artifact.steps[1]).toHaveProperty('id');
        expect(result.artifact.steps[0]).not.toHaveProperty('id');
    });
});
