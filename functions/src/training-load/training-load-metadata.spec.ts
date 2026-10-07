import { describe, expect, it } from 'vitest';
import { defaultAppliedTrainingLoadPolicy, resolveEffectiveTrainingLoad, unresolvedTrainingLoadLegs,
  type TrainingLoadLeg, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { reconcileTrainingLoadLegs, trainingLoadSourceFingerprint } from './training-load-metadata';

const leg = (activityId: string, startMs = 1000): TrainingLoadLeg => ({ activityId,
  identity: { startMs, endMs: startMs + 3600000, type: 'Walking', duration: 3600, distance: 4000 },
  evaluations: null, recordedTss: 87.3, policy: defaultAppliedTrainingLoadPolicy('Walking') });
const previous = (): TrainingLoadMetadata => ({ version: 1, revision: 5, excluded: false,
  controls: { old: { override: 0 } }, legs: { old: { ...leg('old'), policy: {
    ...defaultAppliedTrainingLoadPolicy('Walking'), method: 'HR', included: false, revision: 3, effectiveAtMs: 500 } } } });

describe('training load reconciliation', () => {
  it('retains the latest control and immutable policy across changed IDs, scores and dated defaults', () => {
    const next = reconcileTrainingLoadLegs(previous(), [{ ...leg('new'), recordedTss: 7.6 }]);
    expect(next.legs?.old).toMatchObject({ activityId: 'new', recordedTss: 7.6,
      policy: { method: 'HR', included: false, revision: 3 } });
    expect(next.controls).toEqual({ old: { override: 0 } });
  });
  it('never uses the one-unmatched-leg fallback, and retains ambiguous controls', () => {
    const next = reconcileTrainingLoadLegs(previous(), [leg('new', 2000)]);
    expect(next.legs?.old.activityId).toBeNull();
    expect(next.legs?.new.activityId).toBe('new');
    expect(next.controls.old.override).toBe(0);
    const ambiguous = reconcileTrainingLoadLegs(previous(), [leg('a'), leg('b')]);
    expect(ambiguous.legs?.old.activityId).toBeNull();
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
});
