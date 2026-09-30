import { describe, expect, it } from 'vitest';
import { serializeSuuntoStrengthGuideV1 } from './suunto-guide.serializer';

const details = { version: 1, workoutId: 'lift', revision: 1, exercises: [
  { id: 'squat', name: 'Back squat', sets: [
    { id: 'one', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 },
    { id: 'two', ending: { kind: 'time', seconds: 30 } },
  ] },
] };
const options = { name: 'Gym day', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
  localDate: '2026-10-01', sourceWorkoutId: 'lift' };

describe('Suunto Gym Guide strength mapping', () => {
  it('discloses manual reps without extra approval and recommends activity 23', () => {
    const result = serializeSuuntoStrengthGuideV1(details, { ...options, allowDegraded: false });
    expect(result).toMatchObject({ level: 'degraded', requiresApproval: false });
    expect(result.issues.some(issue => issue.code === 'manual_strength_repetitions')).toBe(true);
    expect(result.artifact.activities).toEqual([23]);
    expect(result.artifact.steps).toMatchObject([
      { type: 'fields', transitions: [{ condition: { type: 'manualLap' } }] },
      { type: 'fields', transitions: [{ condition: { type: 'stepDuration', value: 120 } }] },
      { type: 'fields', transitions: [{ condition: { type: 'stepDuration', value: 30 } }] },
    ]);
    expect(JSON.stringify(result.artifact)).toContain('5 reps');
    expect(JSON.stringify(result.artifact)).toContain('80 kg');
  });
  it('still requires approval for additional loss of long exercise instructions', () => {
    const long = { ...details, exercises: [{ ...details.exercises[0], name: 'A'.repeat(80) }] };
    expect(() => serializeSuuntoStrengthGuideV1(long, { ...options, allowDegraded: false }))
      .toThrow('explicit degradation approval');
    const result = serializeSuuntoStrengthGuideV1(long, { ...options, allowDegraded: true });
    expect(result).toMatchObject({ level: 'degraded', requiresApproval: true });
    expect(result.issues.some(issue => issue.code !== 'manual_strength_repetitions')).toBe(true);
  });
});
