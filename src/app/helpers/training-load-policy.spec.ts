import { describe, expect, it } from 'vitest';
import { defaultAppliedTrainingLoadPolicy, resolveEffectiveTrainingLoad, validTrainingLoadOverride,
  type TrainingLoadMetadata } from '@shared/training-load-policy';

const activities = [
  { id: 'walk', type: 'Walking', stats: { 'Training Stress Score': 87.3 } },
  { id: 'ride', type: 'Cycling', stats: { 'Training Stress Score': 50 } },
];
const source = { stats: { 'Training Stress Score': 200 } };
function metadata(): TrainingLoadMetadata {
  return { version: 1, revision: 1, excluded: false, controls: {}, legs: Object.fromEntries(activities.map(activity => [activity.id, {
    activityId: activity.id, identity: { startMs: 0, endMs: 3600000, type: activity.type, duration: 3600, distance: null },
    recordedTss: activity.stats['Training Stress Score'], policy: defaultAppliedTrainingLoadPolicy(activity.type), evaluations: null,
  }])) };
}
describe('modeled Training load', () => {
  it('sums fractional leg scores without applying the editor display precision to the model', () => {
    const data = metadata(); data.legs!.walk.recordedTss = 0.04; data.legs!.ride.recordedTss = 9.02;
    expect(resolveEffectiveTrainingLoad(source, data).score).toBeCloseTo(9.06, 10);
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').score).toBe(0.04);
  });
  it('does not fall back to recorded scores for a stale leg outside the saved source revision', () => {
    expect(resolveEffectiveTrainingLoad(source, metadata(),
      [{ id: 'stale', type: 'Walking', stats: { 'Training Stress Score': 999 } }], 'stale'))
      .toMatchObject({ score: null, status: 'unavailable', reasons: ['source-updating'] });
  });
  it('retains historical numeric-string scores and releases ambiguity only on explicit reset', () => {
    expect(resolveEffectiveTrainingLoad({ stats: { 'Training Stress Score': '0' } }).score).toBe(0);
    const value = metadata(); value.legs!.old = { ...value.legs!.walk, activityId: null }; value.controls.old = { override: 4 };
    expect(resolveEffectiveTrainingLoad(source, value).status).toBe('unavailable');
    value.controls = {}; value.resetUnmatched = true;
    expect(resolveEffectiveTrainingLoad(source, value).score).toBe(137.3);
  });
  it('preserves legacy parent statistics until a control exists, and never distributes parent TSS', () => {
    expect(resolveEffectiveTrainingLoad(source).score).toBe(200);
    expect(resolveEffectiveTrainingLoad(source, metadata()).score).toBe(137.3);
    expect(source.stats['Training Stress Score']).toBe(200);
    expect(resolveEffectiveTrainingLoad(source, { version: 1, revision: 1, excluded: false,
      controls: { walk: { override: 0 } } }, activities).score).toBe(50);
  });
  it('accepts valid zero, distinguishes exclusion and unavailable, and retains volume inputs', () => {
    const data = metadata();
    data.controls.walk = { override: 0 };
    data.controls.ride = { included: false };
    expect(resolveEffectiveTrainingLoad(source, data)).toMatchObject({ score: 0, status: 'available' });
    data.excluded = true;
    expect(resolveEffectiveTrainingLoad(source, data)).toMatchObject({ score: 0, status: 'excluded' });
    expect(activities).toHaveLength(2);
    expect([0, 9999, -1, 10000, NaN, '9'].map(validTrainingLoadOverride)).toEqual([true, true, false, false, false, false]);
  });
  it('reset restores the saved policy, and missing cached HR/MET requires reparse', () => {
    const data = metadata();
    data.legs!.walk.policy.included = false;
    data.controls.walk = { included: true, override: 9 };
    expect(resolveEffectiveTrainingLoad(source, data).score).toBe(59);
    delete data.controls.walk;
    expect(resolveEffectiveTrainingLoad(source, data).score).toBe(50);
    data.controls.ride = { method: 'HR' };
    expect(resolveEffectiveTrainingLoad(source, data)).toMatchObject({ score: null, reasons: ['reparse-required'] });
  });
  it('retains unmatched controls and fails closed until explicit reassociation or dismissal', () => {
    const data = metadata();
    data.legs!.old = { ...data.legs!.walk, activityId: null };
    data.controls.old = { override: 3 };
    expect(resolveEffectiveTrainingLoad(source, data)).toMatchObject({ status: 'unavailable', reasons: ['activity-match-needs-review'] });
    data.controls.old.activityId = 'walk';
    expect(resolveEffectiveTrainingLoad(source, data).score).toBe(53);
    data.controls.old = { dismissed: true };
    expect(resolveEffectiveTrainingLoad(source, data).score).toBe(137.3);
  });
});
