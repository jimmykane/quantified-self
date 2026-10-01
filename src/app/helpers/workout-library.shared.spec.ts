import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  parseWorkoutLibraryItemV1,
  parseWorkoutLibraryPrescription,
} from '@shared/workout-library';
import { projectStrengthWorkoutToV1 } from '@shared/strength-workout';

const running = {
  version: 1,
  sport: ActivityTypes.Running,
  nodes: [{ kind: 'step', id: 'step-1', purpose: 'work',
    ending: { kind: 'time', seconds: 600 }, targets: [] }],
};

describe('Workout Library V1', () => {
  it('round-trips a complete independent recipe', () => {
    const item = parseWorkoutLibraryItemV1({
      schemaVersion: 1, id: 'library-1', title: ' Easy run ', structure: running,
      status: 'active', revision: 1, createdAtMs: 100, updatedAtMs: 100,
    });
    expect(item.title).toBe('Easy run');
    expect(parseWorkoutLibraryItemV1(JSON.parse(JSON.stringify(item)))).toEqual(item);
    expect(item).not.toHaveProperty('planId');
    expect(item).not.toHaveProperty('localDate');
  });

  it('keeps the complete strength prescription with its validated summary', () => {
    const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Squat',
      sets: [{ id: 'set-1', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80 }] }] };
    const structure = projectStrengthWorkoutToV1({ ...strength, workoutId: 'template', revision: 1 });
    expect(parseWorkoutLibraryPrescription('Strength', structure, strength).strength).toEqual(strength);
    expect(() => parseWorkoutLibraryPrescription('Strength', structure, undefined)).toThrow(/full exercise/);
  });

  it('rejects unknown fields, invalid versions and unrelated strength details', () => {
    const item = { schemaVersion: 1, id: 'library-1', title: 'Run', structure: running,
      status: 'active', revision: 1, createdAtMs: 100, updatedAtMs: 100 };
    expect(() => parseWorkoutLibraryItemV1({ ...item, providerId: 'hidden' })).toThrow(/Unknown field/);
    expect(() => parseWorkoutLibraryItemV1({ ...item, schemaVersion: 2 })).toThrow(/version/);
    expect(() => parseWorkoutLibraryPrescription('Run', running, { version: 1, exercises: [] })).toThrow(/Strength/);
  });
});
