import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { parseWorkoutPowerSettingsV1, parseWorkoutPowerProfileV1 } from '../../../shared/workout-power-settings';
import { withWorkoutPowerContext } from './day-workout-power';
import { validateDayWorkoutSuggestion } from './day-workout-validation';
import type { DayWorkoutContext } from './day-workout-context';
const profile = { sport: ActivityTypes.Running, provider: 'suunto' as const, source: 'Watch running power',
  reference: { kind: 'critical-power' as const, watts: 250 }, referenceDate: '2026-11-01', zoneUpperBoundsWatts: [150, 200, 250, 300] };
const controls = defaultDayWorkoutControls('2026-11-04', 'Europe/Athens');
const now = new Date('2026-11-04T10:00Z');
const legacy = { kind: 'power', mode: 'relative', minimumPercent: 80, maximumPercent: 90,
  reference: { kind: 'functional-threshold-power', watts: 320 } } as const;
const base = (): DayWorkoutContext => ({ evidence: { references: [legacy] }, references: [legacy],
  usedContext: [], missingContext: [], previousStrength: [] });
function database(value: unknown = { version: 1, revision: 2, profiles: [profile] }) {
  const get = vi.fn().mockResolvedValue({ get: (key: string) => key === 'workoutPower' ? value : undefined });
  const doc = vi.fn(() => ({ get }));
  return { db: { doc } as unknown as FirebaseFirestore.Firestore, get, doc };
}
describe('source-aware generation power references', () => {
  it('uses only the exact sport source even without optional Training context; preserves the canonical snapshot', async () => {
    const { db, doc } = database();
    const context = await withWorkoutPowerContext('owner', { ...controls, trainingContext: false }, now, base(), db);
    expect(doc).toHaveBeenCalledExactlyOnceWith('users/owner/config/settings');
    expect(context.powerReference).toEqual(profile);
    expect(context.evidence.powerReference).toEqual(profile);
    expect(context.references).toEqual([{ kind: 'power', mode: 'relative', minimumPercent: 100, maximumPercent: 100, reference: profile.reference }]);
    const suggestion = { kind: 'workout', title: 'Easy run', rationale: 'Use confirmed power.', structure: { version: 1,
      sport: controls.sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 600 },
        targets: [{ ...context.references[0], minimumPercent: 60, maximumPercent: 80 }] }] } };
    const validated = validateDayWorkoutSuggestion(suggestion, controls, [], context.references);
    expect(validated.draft?.structure.nodes[0]).toEqual(suggestion.structure.nodes[0]);
    expect(() => validateDayWorkoutSuggestion({ ...suggestion, structure: { ...suggestion.structure,
      nodes: [{ ...suggestion.structure.nodes[0], targets: [legacy] }] } }, controls, [], context.references)).toThrow();
    expect(JSON.stringify(validated.draft)).not.toContain('suunto');
  });
  it.each([undefined, { version: 1, revision: 1, profiles: [{ ...profile, sport: ActivityTypes.Cycling }] },
    { version: 1, revision: 1, profiles: [{ ...profile, referenceDate: '2026-11-05' }] },
    { version: 1, revision: 1, profiles: [{ ...profile, reference: { ...profile.reference, watts: 0 } }] }])(
    'withholds unverified power rather than borrowing from nearby workouts: %j', async value => {
      const { db } = database(value); // undefined explicitly represents a missing branch below
      if (value === undefined) vi.mocked(db.doc).mockReturnValue({ get: async () => ({ get: () => undefined }) } as never);
      const context = await withWorkoutPowerContext('owner', controls, now, base(), db);
      expect(context.references).toEqual([]); expect(context.powerReference).toBeUndefined();
      expect(context.missingContext.join(' ')).toMatch(/Power targets/);
    });
  it('clears an earlier source snapshot when settings cannot be verified again', async () => {
    const { db, get } = database();
    const previous = await withWorkoutPowerContext('owner', controls, now, base(), db);
    get.mockRejectedValueOnce(Error('offline'));
    const result = await withWorkoutPowerContext('owner', controls, now, previous, db);
    expect(result.powerReference).toBeUndefined(); expect(result.evidence).not.toHaveProperty('powerReference');
    expect(result.references).toEqual([]);
  });
  it('withholds power on settings failure and keeps other target kinds', async () => {
    const { db, get } = database(); get.mockRejectedValue(Error('offline'));
    const context = base(); context.references.push({ kind: 'heart-rate', mode: 'relative', minimumPercent: 60,
      maximumPercent: 80, reference: { kind: 'max-heart-rate', bpm: 180 } });
    const result = await withWorkoutPowerContext('owner', controls, now, context, db);
    expect(result.references.map(t => t.kind)).toEqual(['heart-rate']);
    expect(result.missingContext.join(' ')).toContain('could not be verified');
  });
  it('does not read power settings for strength, no-target or heart-rate requests', async () => {
    for (const selection of [...['none', 'heart-rate', 'speed'].map(target => ({ ...controls, target })),
      ...[ActivityTypes.Walking, ActivityTypes.Swimming, ActivityTypes.Hiking].map(sport => ({ ...controls, sport }))]) {
      const { db, doc } = database(); const context = base();
      expect(await withWorkoutPowerContext('owner', selection as typeof controls, now, context, db)).toBe(context);
      expect(doc).not.toHaveBeenCalled();
    }
  });
});
describe('private power settings codec', () => {
  it('defaults only an absent branch and canonically sorts exact-sport profiles', () => {
    expect(parseWorkoutPowerSettingsV1(undefined)).toEqual({ version: 1, revision: 0, profiles: [] });
    const settings = parseWorkoutPowerSettingsV1({ version: 1, revision: 1, profiles: [profile,
      { ...profile, sport: ActivityTypes.Cycling, provider: 'garmin' }] });
    expect(settings.profiles.map(p => p.sport)).toEqual([ActivityTypes.Cycling, ActivityTypes.Running]);
  });
  it.each([null, { version: 2, revision: 1, profiles: [] }, { version: 1, revision: -1, profiles: [] },
    { version: 1, revision: 1, profiles: [profile, profile] }, { version: 1, revision: 1, profiles: [], uid: 'other' }])(
    'rejects malformed settings: %j', value => expect(() => parseWorkoutPowerSettingsV1(value)).toThrow());
  it.each([{ source: '' }, { source: 'a'.repeat(81) }, { source: 'a\nb' }, { provider: 'unknown' }, { referenceDate: '2026-02-30' },
    { zoneUpperBoundsWatts: [200, 100] }, { zoneUpperBoundsWatts: [100, 100] }, { zoneUpperBoundsWatts: [0] },
    { zoneUpperBoundsWatts: [NaN] }, { reference: { kind: 'critical-power', watts: Infinity } }, { privateToken: 'no' }])(
    'rejects malformed profiles: %j', extra => expect(() => parseWorkoutPowerProfileV1({ ...profile, ...extra })).toThrow());
});
