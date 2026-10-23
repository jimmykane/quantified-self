import { describe, expect, it } from 'vitest';
import { defaultAppliedTrainingLoadPolicy, resolveEffectiveTrainingLoad, unresolvedTrainingLoadLegs,
  type TrainingLoadLeg, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { reconcileTrainingLoadLegs, trainingLoadSourceFingerprint } from './training-load-metadata';
import { browserTrainingLoadSourceFingerprint, canonicalTrainingLoadValue } from '../../../shared/training-load-source';

const leg = (activityId: string, startMs = 1000): TrainingLoadLeg => ({ activityId,
  identity: { startMs, endMs: startMs + 3600000, type: 'Walking', duration: 3600, distance: 4000 },
  evaluations: null, recordedTss: 87.3, policy: defaultAppliedTrainingLoadPolicy('Walking') });
const previous = (): TrainingLoadMetadata => ({ version: 1, revision: 5, excluded: false,
  controls: { old: { override: 0 } }, legs: { old: { ...leg('old'), policy: {
    ...defaultAppliedTrainingLoadPolicy('Walking'), method: 'HR', included: false, revision: 3, effectiveAtMs: 500 } } } });

describe('training load reconciliation', () => {
  it('retains policy and zero override across a sport change only for the reservation-certified stable leg', () => {
    const prior = previous();
    const changed = { ...leg('old'), identity: { ...leg('old').identity, type: 'Yoga' }, recordedTss: 9 };
    expect(reconcileTrainingLoadLegs(prior, [changed]).legs!.old.activityId).toBeNull();
    const next = reconcileTrainingLoadLegs(prior, [changed], new Set(['old']));
    expect(next.legs!.old).toMatchObject({ activityId: 'old', identity: { type: 'Yoga' }, recordedTss: 9 });
    expect(next.legs!.old.policy).toEqual(prior.legs!.old.policy);
    expect(next.controls).toEqual(prior.controls);
    expect(reconcileTrainingLoadLegs({ ...prior, ...next }, [changed], new Set(['old']))).toEqual(next);
  });
  it('retains the latest control and immutable policy across changed IDs, scores and dated defaults', () => {
    const prior = previous();
    prior.legacyLegs = { old: prior.legs!.old,
      other: { ...leg('other'), identity: { ...leg('other').identity, distance: 2000 } } };
    const next = reconcileTrainingLoadLegs(prior, [{ ...leg('new'), recordedTss: 7.6 }]);
    expect(Object.keys(next.legs!)).toEqual(['old']);
    expect(next.legs?.old).toMatchObject({ activityId: 'new', recordedTss: 7.6,
      policy: { method: 'HR', included: false, revision: 3 } });
    expect(next.controls).toEqual({ old: { override: 0 } });
  });
  it('refreshes HR algorithm evaluations across changed IDs and retries while preserving controls and saved policies', () => {
    const prior = previous();
    const hr = { preference: 'AUTOMATIC' as const, method: 'HR' as const, score: 70, estimated: true,
      provenance: 'calculated' as const, reasons: [], hrAlgorithm: 'THRESHOLD' as const };
    const candidate: TrainingLoadLeg = { ...leg('new'), recordedTss: 70, evaluations: { version: 1,
      automatic: hr, hr: { ...hr, preference: 'HR' }, met: { ...hr, method: 'MET', preference: 'MET', score: 9 } } };
    const next = reconcileTrainingLoadLegs(prior, [candidate]);
    expect(next.legs!.old.evaluations).toEqual(candidate.evaluations);
    expect(next.controls).toEqual(prior.controls);
    expect(next.legs!.old.policy).toEqual(prior.legs!.old.policy);
    expect(reconcileTrainingLoadLegs(JSON.parse(JSON.stringify({ ...prior, ...next })), [candidate])).toEqual(next);
    expect(resolveEffectiveTrainingLoad({}, { ...prior, ...next }, [], 'new')).toMatchObject({ status: 'excluded' });
    const included: TrainingLoadMetadata = { ...prior, ...next, controls: { old: { included: true, override: 0 } } };
    expect(resolveEffectiveTrainingLoad({}, included, [], 'new')).toMatchObject({ score: 0, method: 'OVERRIDE' });
    included.controls = { old: { included: true } };
    expect(resolveEffectiveTrainingLoad({}, included, [], 'new')).toMatchObject({ score: 70, hrAlgorithm: 'THRESHOLD' });
  });
  it.each([0, 2400])('retains saved controls when source timer recovery corrects active duration to %s', duration => {
    const prior = previous();
    const candidate = { ...leg('new'), identity: { ...leg('new').identity, duration },
      recordedTss: duration === 0 ? null : 66.7 };
    const next = reconcileTrainingLoadLegs(prior, [candidate]);
    expect(Object.keys(next.legs!)).toEqual(['old']);
    expect(next.legs!.old).toMatchObject({ activityId: 'new', identity: { duration }, recordedTss: candidate.recordedTss });
    expect(next.legs!.old.policy).toEqual(prior.legs!.old.policy);
    expect(next.controls).toEqual({ old: { override: 0 } });
    expect(reconcileTrainingLoadLegs({ ...prior, ...next }, [candidate])).toEqual(next);
  });
  it('never uses the one-unmatched-leg fallback, and retains ambiguous controls', () => {
    const next = reconcileTrainingLoadLegs(previous(), [leg('new', 2000)]);
    expect(next.legs?.old.activityId).toBeNull();
    expect(next.legs?.new.activityId).toBe('new');
    expect(next.controls.old.override).toBe(0);
    const ambiguous = reconcileTrainingLoadLegs(previous(), [leg('a'), leg('b')]);
    expect(ambiguous.legs?.old.activityId).toBeNull();
  });
  it.each([4000, 2000])('keeps uncontrolled legacy identities in matching without transferring a controlled %s-distance leg', distance => {
    const prior = previous(); prior.legs!.old.identity.distance = distance;
    const other = { ...leg('other'), identity: { ...leg('other').identity, distance: 2000 } };
    prior.legacyLegs = { old: prior.legs!.old, other };
    const next = reconcileTrainingLoadLegs(prior, [{ ...other, activityId: 'remaining' }]);
    expect(next.legs!.old.activityId).toBeNull();
    expect(next.controls).toEqual(prior.controls);
    expect(Object.keys(next.legs!).sort()).toEqual(['old', 'remaining']);
    expect(next.legs!.remaining.policy).toEqual(other.policy);
    expect(unresolvedTrainingLoadLegs({ ...prior, ...next })).toEqual(['old']);
  });
  it('does not retain uncontrolled legacy context or count it against the saved-leg bound', () => {
    const prior = previous();
    prior.legacyLegs = Object.fromEntries(Array.from({ length: 100 }, (_, index) => {
      const id = `legacy-${index}`; return [id, leg(id, 10000 + index)];
    }));
    const candidates = Array.from({ length: 100 }, (_, index) => leg(`parsed-${index}`, 20000 + index));
    const next = reconcileTrainingLoadLegs(prior, candidates);
    expect(Object.keys(next.legs!)).toHaveLength(101);
    expect(Object.values(next.legs!).filter(leg => !leg.activityId)).toEqual([{ ...prior.legs!.old, activityId: null }]);
    expect(next.controls).toEqual(prior.controls);
  });
  it('persists explicit reassociation through later reparses without duplicate identities', () => {
    const prior = previous();
    prior.legs!.old.activityId = null;
    prior.legs!.new = leg('new', 2000);
    prior.controls.old.activityId = 'new';
    const next = reconcileTrainingLoadLegs(prior, [leg('third', 2000)]);
    expect(Object.keys(next.legs!)).toEqual(['old']);
    expect(next.legs!.old).toMatchObject({ activityId: 'third', policy: { revision: 3 } });
    expect(next.controls).toEqual({ old: { override: 0 } });
  });
  it('keeps retained unmatched controls pending explicit review when their old identity reappears', () => {
    const prior = previous();
    prior.legs!.old.activityId = null;
    prior.legs!.current = leg('current', 2000);
    const reconciled = reconcileTrainingLoadLegs(prior, [leg('returned'), leg('current-new', 2000)]);
    const next = { ...prior, ...reconciled };
    expect(next.legs!.old.activityId).toBeNull();
    expect(next.legs!.returned).toMatchObject({ activityId: 'returned', policy: { revision: 0 } });
    expect(next.legs!.current.activityId).toBe('current-new');
    expect(next.controls.old).toEqual({ override: 0 });
    expect(unresolvedTrainingLoadLegs(next)).toEqual(['old']);
    expect(resolveEffectiveTrainingLoad({}, next)).toMatchObject({
      score: null, status: 'unavailable', reasons: ['activity-match-needs-review'],
    });
    const repeated = reconcileTrainingLoadLegs(next, [leg('returned'), leg('current-new', 2000)]);
    expect(repeated).toEqual(reconciled);
  });
  it('releases dismissed or explicitly reset unmatched records while retaining current saved policies', () => {
    const prior = previous(); prior.legs!.old.activityId = null;
    prior.legs!.new = leg('new', 2000); prior.resetUnmatched = true; prior.controls = {};
    expect(Object.keys(reconcileTrainingLoadLegs(prior, [leg('newer', 2000)]).legs!)).toEqual(['new']);
  });
  it('fingerprints source values consistently across Firestore dates and ignores user-owned titles', () => {
    const data = { startDate: new Date(1000), endDate: new Date(2000), stats: { b: 2, a: 1 }, name: 'old' };
    expect(trainingLoadSourceFingerprint(data)).toBe(trainingLoadSourceFingerprint({
      ...data, startDate: { toMillis: () => 1000 }, name: 'new', stats: { a: 1, b: 2 } }));
    expect(trainingLoadSourceFingerprint(data)).not.toBe(trainingLoadSourceFingerprint({ ...data, stats: { a: 3 } }));
  });
  it('matches Firestore omission of undefined array entries without changing explicit values', async () => {
    const values = [undefined, 'Example device', null, 0, false, 'Example device'];
    const data = { startDate: 1000, endDate: 2000, stats: { 'Device Names': values,
      nested: [{ names: [undefined, 'Second device'], absent: undefined }] } };
    const persisted = { ...data, stats: { 'Device Names': ['Example device', null, 0, false, 'Example device'],
      nested: [{ names: ['Second device'] }] } };
    expect(trainingLoadSourceFingerprint(data)).toBe(trainingLoadSourceFingerprint(persisted));
    expect(await browserTrainingLoadSourceFingerprint(data)).toBe(trainingLoadSourceFingerprint(persisted));
    expect(values).toEqual([undefined, 'Example device', null, 0, false, 'Example device']);
    const sparse = new Array<string | undefined>(2); sparse[1] = 'Example device';
    expect(canonicalTrainingLoadValue(sparse)).toEqual(['Example device']);
  });
  it('still distinguishes real source changes, explicit nulls and array order', () => {
    const data = { startDate: 1000, endDate: 2000, type: 'Walking', stats: {
      Distance: 1000, 'Device Names': [undefined, 'First', 'Second'] } };
    const fingerprint = trainingLoadSourceFingerprint(data);
    for (const changed of [
      { ...data, startDate: 1001 },
      { ...data, endDate: 2001 },
      { ...data, type: 'Running' },
      { ...data, stats: { ...data.stats, Distance: 1001 } },
      { ...data, stats: { ...data.stats, 'Device Names': [null, 'First', 'Second'] } },
      { ...data, stats: { ...data.stats, 'Device Names': ['Second', 'First'] } },
    ]) expect(trainingLoadSourceFingerprint(changed)).not.toBe(fingerprint);
  });
});
