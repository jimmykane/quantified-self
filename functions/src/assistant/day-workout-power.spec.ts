import { describe, expect, it, vi } from 'vitest';
import { DERIVED_METRIC_SCHEMA_VERSION } from '../../../shared/derived-metrics';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import { parseWorkoutPowerSettingsV1, parseWorkoutPowerProfileV1, sharedWorkoutFtpReference, importedWorkoutFtpReference, WORKOUT_IMPORTED_FTP_MAX_AGE_MS, parseWorkoutPowerReferenceV1 } from '../../../shared/workout-power-settings';
import { dayWorkoutPowerReferenceUsed, withWorkoutPowerContext } from './day-workout-power';
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
  it('attributes power targets inside repeat blocks only to their matching sport and reference', () => {
    const target = { kind: 'power', mode: 'relative', minimumPercent: 60, maximumPercent: 80, reference: profile.reference } as const;
    const suggestion = validateDayWorkoutSuggestion({ kind: 'workout', title: 'Power intervals', rationale: 'Use the confirmed source.',
      structure: { version: 1, sport: controls.sport, nodes: [{ kind: 'repeat', id: 'block', count: 2,
        steps: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [target] }] }] } }, controls, [], [target]);
    expect(dayWorkoutPowerReferenceUsed(suggestion, profile)).toEqual(profile);
    expect(dayWorkoutPowerReferenceUsed(suggestion, { ...profile, sport: ActivityTypes.Cycling })).toBeUndefined();
    expect(dayWorkoutPowerReferenceUsed(suggestion, { ...profile, reference: { ...profile.reference, watts: 300 } })).toBeUndefined();
    expect(dayWorkoutPowerReferenceUsed(suggestion, { ...profile, reference: { ...profile.reference, kind: 'functional-threshold-power' } })).toBeUndefined();
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
  it.each([ActivityTypes.Walking, ActivityTypes.Swimming, ActivityTypes.Hiking])('withholds unverified nearby power references for %s in auto mode', async sport => {
    const { db, doc } = database(), selected = { ...controls, sport };
    const result = await withWorkoutPowerContext('owner', selected, now, base(), db);
    expect(doc).not.toHaveBeenCalled();
    expect(result.references).toEqual([]); expect(result.evidence.references).toEqual([]);
    const suggestion = { kind: 'workout', title: 'Easy session', rationale: 'Use effort.', structure: { version: 1, sport,
      nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [legacy] }] } };
    expect(() => validateDayWorkoutSuggestion(suggestion, selected, [], result.references)).toThrow();
  });
  it('does not read power settings for strength, no-target or heart-rate requests', async () => {
    for (const selection of [...['none', 'heart-rate', 'speed', 'garmin-power-zone'].map(target => ({ ...controls, target })),
      ...[ActivityTypes.Walking, ActivityTypes.Swimming, ActivityTypes.Hiking].map(sport => ({ ...controls, sport }))]) {
      const { db, doc } = database(); const context = base();
      const result = await withWorkoutPowerContext('owner', selection as typeof controls, now, context, db);
      expect(result.references).toEqual([]); expect(result.evidence.references).toEqual([]);
      expect(result).not.toHaveProperty('powerReference');
      expect(doc).not.toHaveBeenCalled();
    }
  });
});
describe('private power settings codec', () => {
  it.each([...Array.from({ length: 32 }, (_, code) => code), 0x7f])(
    'rejects source names with ASCII control code %i, including before trimming', code => {
      const control = String.fromCharCode(code);
      for (const source of [`Watch${control}power`, `${control}Watch power`, `Watch power${control}`]) {
        expect(() => parseWorkoutPowerProfileV1({ ...profile, source })).toThrow();
      }
    });
  it('preserves printable ASCII boundaries and Unicode source names while trimming spaces', () => {
    const source = ' !Watch ~ Ελληνικά café 👟';
    expect(parseWorkoutPowerProfileV1({ ...profile, source: ` ${source} ` }).source).toBe(source.trim());
    expect(parseWorkoutPowerProfileV1({ ...profile, source: 'a'.repeat(80) }).source).toBe('a'.repeat(80));
  });
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


describe('shared dated FTP for generation', () => {
  const policy = { method: 'AUTOMATIC', included: true, functionalThresholdPower: 280, revision: 3,
    effectiveAt: now.getTime() - 1000 };
  function sharedDatabase(saved: unknown = { version: 1, revision: 0, profiles: [] }, current: unknown = policy) {
    const historyGet = vi.fn().mockResolvedValue({ docs: [{ data: () => policy }] });
    const limit = vi.fn(() => ({ get: historyGet }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const collection = vi.fn(() => ({ where }));
    const policyGet = vi.fn().mockResolvedValue({ data: () => current });
    const settingsGet = vi.fn().mockResolvedValue({ get: () => saved });
    const doc = vi.fn((path: string) => path.endsWith('/config/settings') ? { get: settingsGet }
      : { get: policyGet, collection });
    return { db: { doc } as unknown as FirebaseFirestore.Firestore, doc, policyGet, settingsGet, historyGet, collection, where, orderBy, limit };
  }
  it.each([ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.TrailRunning, ActivityTypes.MountainBiking])(
    'uses the matching family FTP for %s without optional Training context or inferred source identity', async sport => {
      const { db, doc } = sharedDatabase();
      const result = await withWorkoutPowerContext('owner', { ...controls, sport, trainingContext: false }, now, base(), db);
      const family = sport === ActivityTypes.Cycling || sport === ActivityTypes.MountainBiking ? 'cycling' : 'running';
      expect(doc.mock.calls.map(([path]) => path)).toEqual(['users/owner/config/settings', `users/owner/trainingLoadPolicies/${family}`]);
      expect(result.powerReference).toEqual({ kind: 'training-ftp', sport, family, revision: 3,
        effectiveAtMs: policy.effectiveAt, reference: { kind: 'functional-threshold-power', watts: 280 } });
      expect(result.references).toEqual([{ kind: 'power', mode: 'relative', minimumPercent: 100, maximumPercent: 100,
        reference: { kind: 'functional-threshold-power', watts: 280 } }]);
      expect(result.powerReference).not.toHaveProperty('provider'); expect(result.powerReference).not.toHaveProperty('source');
    });
  it('freezes a matching reference in generated targets and review provenance across later FTP edits', async () => {
    const database = sharedDatabase();
    const before = await withWorkoutPowerContext('owner', controls, now, base(), database.db);
    const target = { ...before.references[0], minimumPercent: 60, maximumPercent: 80 };
    const suggestion = validateDayWorkoutSuggestion({ kind: 'workout', title: 'Power', rationale: 'Shared FTP', structure: {
      version: 1, sport: controls.sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [target] }] } }, controls, [], before.references);
    expect(dayWorkoutPowerReferenceUsed(suggestion, before.powerReference)).toEqual(before.powerReference);
    database.policyGet.mockResolvedValueOnce({ data: () => ({ ...policy, functionalThresholdPower: 300, revision: 4 }) });
    const next = await withWorkoutPowerContext('owner', controls, now, base(), database.db);
    expect(next.powerReference?.reference.watts).toBe(300);
    expect(before.powerReference?.reference.watts).toBe(280);
    expect(suggestion.draft?.structure.nodes[0]).toMatchObject({ targets: [{ reference: { watts: 280 } }] });
    expect(JSON.stringify(suggestion.draft)).not.toContain('effectiveAtMs');
  });
  it.each(['critical-power', 'functional-threshold-power'] as const)('preserves an explicit %s source override', async kind => {
    const saved = { version: 1, revision: 2, profiles: [{ ...profile, reference: { kind, watts: 250 } }] };
    const database = sharedDatabase(saved);
    const result = await withWorkoutPowerContext('owner', controls, now, base(), database.db);
    expect(result.powerReference).toEqual(saved.profiles[0]); expect(database.policyGet).not.toHaveBeenCalled();
  });
  it('does not silently switch to shared FTP when an explicit override cannot be verified', async () => {
    for (const extra of [{ referenceDate: '2999-01-01' }, { reference: { kind: 'critical-power', watts: 0 } }]) {
      const database = sharedDatabase({ version: 1, revision: 2, profiles: [{ ...profile, ...extra }] });
      const result = await withWorkoutPowerContext('owner', controls, now, base(), database.db);
      expect(result.powerReference).toBeUndefined(); expect(result.references).toEqual([]);
      expect(database.policyGet).not.toHaveBeenCalled();
    }
  });
  it('resolves the prior dated revision if a concurrent save happened after generation began', async () => {
    const database = sharedDatabase(undefined, { ...policy, effectiveAt: now.getTime() + 1, revision: 4, functionalThresholdPower: 300 });
    const result = await withWorkoutPowerContext('owner', controls, now, base(), database.db);
    expect(result.powerReference).toMatchObject({ revision: 3, reference: { watts: 280 } });
    expect(database.collection).toHaveBeenCalledExactlyOnceWith('revisions');
    expect(database.where).toHaveBeenCalledWith('effectiveAt', '<=', expect.objectContaining({ toMillis: expect.any(Function) }));
    expect(database.orderBy).toHaveBeenCalledWith('effectiveAt', 'desc'); expect(database.limit).toHaveBeenCalledWith(1);
  });
  it('uses a valid FTP even when the separate load inclusion setting is disabled', async () => {
    const database = sharedDatabase(undefined, { ...policy, included: false });
    expect((await withWorkoutPowerContext('owner', controls, now, base(), database.db)).powerReference?.reference.watts).toBe(280);
  });
  it.each([undefined, { ...policy, functionalThresholdPower: undefined }, { ...policy, functionalThresholdPower: 0 },
    { ...policy, functionalThresholdPower: Infinity }, { ...policy, functionalThresholdPower: 4000 },
    { ...policy, revision: 0 }, { ...policy, effectiveAt: undefined }, { ...policy, effectiveAt: 'invalid' }])(
    'withholds missing or invalid shared FTP without reviving older cleared values: %j', async current => {
      const database = sharedDatabase(); database.policyGet.mockResolvedValueOnce({ data: () => current });
      const result = await withWorkoutPowerContext('owner', controls, now, base(), database.db);
      expect(result.powerReference).toBeUndefined(); expect(result.references).toEqual([]); expect(database.historyGet).not.toHaveBeenCalled();
    });
  it('fails closed on a shared policy read error', async () => {
    const database = sharedDatabase(); database.policyGet.mockRejectedValueOnce(Error('offline'));
    const result = await withWorkoutPowerContext('owner', controls, now, base(), database.db);
    expect(result.powerReference).toBeUndefined(); expect(result.references).toEqual([]);
    expect(result.missingContext.join(' ')).toContain('could not be verified');
  });
  it('validates private shared snapshots without accepting source metadata or a different reference kind', () => {
    const snapshot = sharedWorkoutFtpReference(controls.sport, policy, now.getTime())!;
    expect(parseWorkoutPowerReferenceV1(snapshot)).toEqual(snapshot);
    for (const extra of [{ source: 'private' }, { family: 'cycling' }, { kind: 'other' }, { effectiveAtMs: NaN },
      { reference: { kind: 'critical-power', watts: 280 } }]) expect(() => parseWorkoutPowerReferenceV1({ ...snapshot, ...extra })).toThrow();
  });
});


describe('recent imported FTP fallback', () => {
  const seen = now.getTime() - 2 * 86400000;
  const ftp = { kind: 'ftp-setting', value: 205, sourceKey: 'garmin enduro 3', provenance: 'imported-activity-stat',
    firstSeenAtMs: seen, lastSeenAtMs: seen, observationCount: 2 };
  const capacity = (patch: Record<string, unknown> = {}, snapshotPatch: Record<string, unknown> = {}) => ({
    status: 'ready', schemaVersion: DERIVED_METRIC_SCHEMA_VERSION, metricKind: 'training_capacity',
    payload: { dayBoundary: 'UTC', asOfDayMs: Date.parse('2026-11-03'), disciplines: [{ discipline: 'cycling', ftpSetting: { ...ftp, ...patch } }] },
    ...snapshotPatch,
  });
  const cycling = { ...controls, sport: ActivityTypes.Cycling, target: 'power' as const };
  function importedDatabase(policy?: unknown, settings?: unknown, snapshot: unknown = capacity()) {
    const capacityGet = vi.fn(async () => ({ data: () => snapshot }));
    const policyGet = vi.fn(async () => ({ data: () => policy }));
    const doc = vi.fn((path: string) => {
      if (path === 'users/owner/config/settings') return { get: async () => ({ get: () => settings }) };
      if (path === 'users/owner/trainingLoadPolicies/cycling') return { get: policyGet };
      if (path === 'users/owner/derivedMetrics/training_capacity') return { get: capacityGet };
      throw Error('Unexpected read');
    });
    return { db: { doc } as unknown as FirebaseFirestore.Firestore, doc, capacityGet, policyGet };
  }
  it('reuses yesterday’s ready summary and validates the exact imported reference in the prescription', async () => {
    const db = importedDatabase();
    const context = await withWorkoutPowerContext('owner', cycling, now, base(), db.db);
    expect(db.doc.mock.calls.map(([path]) => path)).toEqual(['users/owner/config/settings',
      'users/owner/trainingLoadPolicies/cycling', 'users/owner/derivedMetrics/training_capacity']);
    expect(db.capacityGet).toHaveBeenCalledOnce();
    expect(context.powerReference).toEqual({ kind: 'imported-ftp', sport: ActivityTypes.Cycling, family: 'cycling',
      source: ftp.sourceKey, lastSeenAtMs: seen, reference: { kind: 'functional-threshold-power', watts: 205 } });
    expect(context.evidence.powerReference).toEqual(context.powerReference);
    const draft = { kind: 'workout', title: 'Ride', rationale: 'Use recent imported FTP.', structure: { version: 1,
      sport: cycling.sport, nodes: [{ kind: 'step', id: 'ride', purpose: 'work', ending: { kind: 'time', seconds: 600 },
        targets: [{ ...context.references[0], minimumPercent: 60, maximumPercent: 80 }] }] } };
    const validated = validateDayWorkoutSuggestion(draft, cycling, [], context.references);
    expect(dayWorkoutPowerReferenceUsed(validated, context.powerReference)).toEqual(context.powerReference);
    expect(JSON.stringify(validated.draft)).not.toMatch(/garmin|lastSeenAtMs|imported-ftp/);
    expect(() => validateDayWorkoutSuggestion({ ...draft, structure: { ...draft.structure, nodes: [{ ...draft.structure.nodes[0], targets: [legacy] }] } }, cycling, [], context.references)).toThrow();
    const frozen = JSON.stringify(context.powerReference);
    db.capacityGet.mockResolvedValueOnce({ data: () => capacity({ value: 230 }) });
    expect((await withWorkoutPowerContext('owner', cycling, now, base(), db.db)).powerReference?.reference.watts).toBe(230);
    expect(JSON.stringify(context.powerReference)).toBe(frozen);
  });
  it.each(['auto', 'power'] as const)('respects Recent activities being off with %s targets without reading capacity', async target => {
    const db = importedDatabase();
    const result = await withWorkoutPowerContext('owner', { ...cycling, target, activityContext: false }, now, base(), db.db);
    expect(result.powerReference).toBeUndefined(); expect(result.references).toEqual([]);
    expect(db.capacityGet).not.toHaveBeenCalled();
    expect(result.missingContext.join(' ')).toContain('Imported FTP is turned off with Recent activities');
  });
  it('preserves explicit and shared references even with Recent activities off and never reads capacity unnecessarily', async () => {
    for (const override of [false, true]) {
      const db = importedDatabase({ method: 'AUTOMATIC', included: true, functionalThresholdPower: 280,
        revision: 2, effectiveAt: seen }, override ? { version: 1, revision: 1, profiles: [{ ...profile, sport: cycling.sport }] } : undefined);
      expect((await withWorkoutPowerContext('owner', { ...cycling, activityContext: false }, now, base(), db.db)).powerReference?.reference.watts).toBe(override ? 250 : 280);
      expect(db.capacityGet).not.toHaveBeenCalled();
    }
  });
  it.each([0, null, Infinity, 4000])('never bypasses invalid saved FTP %j with an imported value', async watts => {
    const db = importedDatabase({ method: 'AUTOMATIC', included: true, functionalThresholdPower: watts, revision: 2, effectiveAt: seen });
    expect((await withWorkoutPowerContext('owner', cycling, now, base(), db.db)).powerReference).toBeUndefined();
    expect(db.capacityGet).not.toHaveBeenCalled();
  });
  it('fails closed on an unavailable capacity read without failing generation', async () => {
    const db = importedDatabase(); db.capacityGet.mockRejectedValueOnce(Error('offline'));
    const context = await withWorkoutPowerContext('owner', cycling, now, base(), db.db);
    expect(context.references).toEqual([]); expect(context.powerReference).toBeUndefined();
    expect(context.missingContext.join(' ')).toContain('could not be verified');
  });
  it('accepts the 90-day boundary, rejects older observations and never borrows another family', () => {
    const boundary = now.getTime() - WORKOUT_IMPORTED_FTP_MAX_AGE_MS;
    expect(importedWorkoutFtpReference(cycling.sport, capacity({ firstSeenAtMs: boundary, lastSeenAtMs: boundary }), now.getTime())).not.toBeNull();
    expect(importedWorkoutFtpReference(cycling.sport, capacity({ firstSeenAtMs: boundary - 1, lastSeenAtMs: boundary - 1 }), now.getTime())).toBeNull();
    expect(importedWorkoutFtpReference(ActivityTypes.Running, capacity(), now.getTime())).toBeNull();
    expect(importedWorkoutFtpReference(ActivityTypes.Rowing, capacity(), now.getTime())).toBeNull();
    expect(importedWorkoutFtpReference(ActivityTypes.MountainBiking, capacity(), now.getTime())).toMatchObject({ family: 'cycling' });
  });
  it.each([{ value: 0 }, { value: 3001 }, { value: Infinity }, { value: '205' }, { kind: 'vo2-max' },
    { provenance: 'session-estimate' }, { firstSeenAtMs: seen + 1 }, { lastSeenAtMs: now.getTime() + 1 },
    { lastSeenAtMs: now.getTime() - 1 }, { lastSeenAtMs: '2026-11-02' }, { observationCount: 0 },
    { sourceKey: 'private\nlabel' }, { sourceKey: 'a'.repeat(81) }])('rejects malformed, future or inconsistent observation %j', patch => {
      expect(importedWorkoutFtpReference(cycling.sport, capacity(patch), now.getTime())).toBeNull();
    });
  it.each([{ status: 'pending' }, { status: 'error' }, { schemaVersion: DERIVED_METRIC_SCHEMA_VERSION - 1 },
    { metricKind: 'power_curve' }, { payload: null },
    { payload: { dayBoundary: 'UTC', asOfDayMs: now.getTime() + 86400000, disciplines: [{ discipline: 'cycling', ftpSetting: ftp }] } },
    { payload: { dayBoundary: 'UTC', asOfDayMs: Date.parse('2026-11-03'), disciplines: Array(2).fill({ discipline: 'cycling', ftpSetting: ftp }) } }])(
    'rejects unready, incompatible or ambiguous snapshots %j', patch => {
      expect(importedWorkoutFtpReference(cycling.sport, capacity({}, patch), now.getTime())).toBeNull();
    });
  it('replays a strict imported snapshot without rechecking freshness or inventing zones/providers', () => {
    const reference = importedWorkoutFtpReference(cycling.sport, capacity(), now.getTime())!;
    expect(parseWorkoutPowerReferenceV1(JSON.parse(JSON.stringify(reference)))).toEqual(reference);
    expect(importedWorkoutFtpReference(cycling.sport, capacity({ sourceKey: null }), now.getTime())).toMatchObject({ source: null });
    for (const patch of [{ family: 'running' }, { reference: { kind: 'critical-power', watts: 205 } },
      { lastSeenAtMs: '2026-11-02' }, { zoneUpperBoundsWatts: [100] }, { provider: 'garmin' }]) {
      expect(() => parseWorkoutPowerReferenceV1({ ...reference, ...patch })).toThrow();
    }
  });
});
