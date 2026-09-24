import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  formatStrengthLoadKg,
  parseStrengthWorkoutDetailsV1,
  parseStrengthWorkoutDraftV1,
  projectStrengthWorkoutToV1,
  strengthProjectionMatchesDetails,
} from '../../../shared/strength-workout';

const details = {
  version: 1,
  workoutId: 'strength-1',
  revision: 2,
  exercises: [
    { id: 'squat', name: 'Back squat', sets: [
      { id: 'squat-1', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 },
      { id: 'squat-2', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80 },
    ] },
    { id: 'plank', name: 'Plank', sets: [
      { id: 'plank-1', ending: { kind: 'time', seconds: 45 } },
    ] },
  ],
};

describe('strength prescription contract', () => {
  it('round-trips a strict exercise/set prescription and projects a valid old-client V1 summary', () => {
    const parsed = parseStrengthWorkoutDetailsV1(details);
    expect(parseStrengthWorkoutDetailsV1(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    const projected = projectStrengthWorkoutToV1(parsed);
    expect(projected.sport).toBe(ActivityTypes.StrengthTraining);
    expect(projected.nodes).toHaveLength(4);
    expect(projected.nodes[0]).toMatchObject({ id: 'set-squat-1', ending: { kind: 'repetitions', repetitions: 5 } });
    expect(projected.nodes[1]).toMatchObject({ id: 'rest-squat-1', ending: { kind: 'time', seconds: 120 } });
    expect(strengthProjectionMatchesDetails(projected, parsed)).toBe(true);
    expect(strengthProjectionMatchesDetails({ ...projected, nodes: projected.nodes.slice(0, 1) }, parsed)).toBe(false);
  });

  it('rejects unknown fields, invalid load, duplicate IDs, and oversized projected recipes', () => {
    expect(() => parseStrengthWorkoutDraftV1({ version: 1, exercises: details.exercises, providerId: 'x' })).toThrow('Unknown field');
    expect(() => parseStrengthWorkoutDetailsV1({ ...details, exercises: [{ id: 'x', name: 'Lift', sets: [
      { id: 'a', ending: { kind: 'repetitions', repetitions: 0 } },
    ] }] })).toThrow('repetitions');
    expect(() => parseStrengthWorkoutDetailsV1({ ...details, exercises: [{ id: 'x', name: 'Lift', sets: [
      { id: 'a', ending: { kind: 'time', seconds: 30 }, externalLoadKg: Number.NaN },
    ] }] })).toThrow('externalLoadKg');
    expect(() => parseStrengthWorkoutDetailsV1({ ...details, exercises: [{ id: 'x', name: 'Lift', sets: [
      { id: 'x', ending: { kind: 'time', seconds: 30 } },
    ] }] })).toThrow('Duplicate ID');
    expect(() => parseStrengthWorkoutDetailsV1({ ...details, exercises: [
      { id: 'x', name: 'Lift', sets: Array.from({ length: 50 }, (_, index) => ({
        id: `set-${index}`, ending: { kind: 'repetitions', repetitions: 5 }, restAfterSeconds: 30,
      })) },
      { id: 'y', name: 'Lift', sets: [{ id: 'extra', ending: { kind: 'time', seconds: 30 } }] },
    ] })).toThrow('100 nodes');
  });

  it('uses Sports Lib weight formatting with account units', () => {
    expect(formatStrengthLoadKg(80)).toContain('kg');
    expect(formatStrengthLoadKg(80)).toBe('80.0 kg');
  });
});
