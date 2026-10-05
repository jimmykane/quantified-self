import { describe, expect, it } from 'vitest';
import { serializeSuuntoStrengthGuideV1, serializeSuuntoStrengthGuideV2ForRecovery,
  serializeSuuntoStrengthGuideV3ForRecovery, serializeSuuntoStrengthGuideV4ForRecovery } from './suunto-guide.serializer';
import legacyFixture from './fixtures/suunto-strength-v2-recovery.json';
import v3Fixture from './fixtures/suunto-strength-v3-recovery.json';

const details = { version: 1, workoutId: 'lift', revision: 1, exercises: [
  { id: 'squat', name: 'Back squat', sets: [
    { id: 'one', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 },
    { id: 'two', ending: { kind: 'time', seconds: 30 } },
  ] },
] };
const options = { name: 'Gym day', owner: 'Quantified Self', url: 'https://quantified-self.io/training/plans',
  localDate: '2026-10-01', sourceWorkoutId: 'lift' };

describe('Suunto Gym Guide strength mapping', () => {
  it('keeps v3 strength recovery byte-equivalent and does not add pace/laps to HR-only screens', () => {
    const legacy = serializeSuuntoStrengthGuideV3ForRecovery(details, { ...options, allowDegraded: false }).artifact;
    expect(legacy).toEqual(v3Fixture);
    expect(serializeSuuntoStrengthGuideV4ForRecovery(details, { ...options, allowDegraded: false }).artifact).toEqual(v3Fixture);
    expect(serializeSuuntoStrengthGuideV1(details, { ...options, allowDegraded: false }).artifact).toEqual(v3Fixture);
    expect(JSON.stringify(legacy)).not.toMatch(/createManualLap|aggregate|window/);
  });
  it('freezes the exact legacy strength payload for digest-verified recovery', () => {
    const legacy = serializeSuuntoStrengthGuideV2ForRecovery(details, { ...options, allowDegraded: false });
    expect(legacy.artifact).toEqual(legacyFixture);
    const current = serializeSuuntoStrengthGuideV1(details, { ...options, allowDegraded: false });
    expect(current.artifact.steps.slice(0, 3).map(node => 'id' in node ? node.id : null))
      .toEqual(legacyFixture.steps.map(node => node.id));
    expect(current.artifact.externalId).toBe(legacyFixture.externalId);
    expect(current.artifact.steps[1]).toMatchObject({ notification: { title: 'Rest', text: 'Rest for 02m 00s' }, fields: [
      { type: 'heartRate' }, { type: 'stepDurationCountdown', value: 120 },
    ] });
  });
  it('discloses manual reps without extra approval and recommends activity 23', () => {
    const result = serializeSuuntoStrengthGuideV1(details, { ...options, allowDegraded: false });
    expect(result).toMatchObject({ level: 'degraded', requiresApproval: false });
    expect(result.issues.some(issue => issue.code === 'manual_strength_repetitions')).toBe(true);
    expect(result.artifact.activities).toEqual([23]);
    expect(result.artifact.steps).toMatchObject([
      { type: 'fields', transitions: [{ condition: { type: 'manualLap' } }] },
      { type: 'fields', transitions: [{ condition: { type: 'stepDuration', value: 120 } }] },
      { type: 'fields', transitions: [{ condition: { type: 'stepDuration', value: 30 } }] },
      { type: 'fields', title: 'Complete', notification: { title: 'Complete', text: 'Guide complete' } },
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
