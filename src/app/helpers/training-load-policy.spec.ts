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
  it('requires reparse when explicit reassociation changes CSS, while still honoring zero overrides', () => {
    const data = metadata();
    data.legs!.old = { ...data.legs!.walk, activityId: null,
      policy: { ...data.legs!.walk.policy, family: 'swimming', swimThresholdSpeed: 1 } };
    data.controls.old = { activityId: 'walk' };
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').reasons).toEqual(['reparse-required']);
    data.controls.old.override = 0;
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').score).toBe(0);
  });
  it('selects stored swim pace, retains old-evaluation compatibility and keeps overrides/exclusion/reset precedence', () => {
    const data = metadata(); const leg = data.legs!.walk;
    const automatic = { preference: 'AUTOMATIC' as const, method: 'HR' as const, score: 30, estimated: false,
      provenance: 'calculated' as const, reasons: [] };
    leg.evaluations = { version: 1, automatic, hr: { ...automatic, preference: 'HR' }, met: { ...automatic, preference: 'MET' } };
    leg.policy.method = 'SWIM_PACE';
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').reasons).toEqual(['reparse-required']);
    leg.evaluations.swimPace = { ...automatic, preference: 'SWIM_PACE', method: 'SWIM_PACE', score: 100 };
    expect(resolveEffectiveTrainingLoad(source, JSON.parse(JSON.stringify(data)), activities, 'walk').score).toBe(100);
    data.controls.walk = { override: 0 };
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').score).toBe(0);
    data.controls.walk = { included: false };
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').status).toBe('excluded');
    data.controls = {};
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').score).toBe(100);
  });
  it('carries the selected HR algorithm through private load resolution without labelling overrides or multisport totals', () => {
    const data = metadata();
    const candidate = { preference: 'AUTOMATIC' as const, method: 'HR' as const, score: 70,
      estimated: true, provenance: 'calculated' as const, reasons: [], hrAlgorithm: 'THRESHOLD' as const };
    data.legs!.ride.evaluations = { version: 1, automatic: candidate, hr: { ...candidate, preference: 'HR' },
      met: { ...candidate, preference: 'MET', method: 'MET', score: 9 } };
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'ride')).toMatchObject({ score: 70, hrAlgorithm: 'THRESHOLD' });
    expect(resolveEffectiveTrainingLoad(source, JSON.parse(JSON.stringify(data)), activities, 'ride')).toMatchObject({ hrAlgorithm: 'THRESHOLD' });
    expect(resolveEffectiveTrainingLoad(source, data)).not.toHaveProperty('hrAlgorithm');
    data.controls.walk = { included: false };
    expect(resolveEffectiveTrainingLoad(source, data)).toMatchObject({ score: 70, hrAlgorithm: 'THRESHOLD' });
    for (const control of [{ override: 0 }, { included: false }, { method: 'MET' as const }]) {
      data.controls.ride = control;
      expect(resolveEffectiveTrainingLoad(source, data, activities, 'ride')).not.toHaveProperty('hrAlgorithm');
    }
    data.controls = {};
    delete (candidate as { hrAlgorithm?: string }).hrAlgorithm;
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'ride')).not.toHaveProperty('hrAlgorithm');
  });
  it('keeps pending imports unavailable consistently while honoring whole-workout exclusion', () => {
    const data = metadata(); data.sourceWritePending = true; data.controls.walk = { override: 0 };
    expect(resolveEffectiveTrainingLoad(source, data)).toMatchObject({ score: null, reasons: ['source-updating'] });
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk')).toMatchObject({ score: null, reasons: ['source-updating'] });
    data.excluded = true;
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk')).toMatchObject({ score: 0, status: 'excluded' });
    data.excluded = false; data.sourceWritePending = false;
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk')).toMatchObject({ score: 0, status: 'available' });
  });
  it('sums fractional leg scores without applying the editor display precision to the model', () => {
    const data = metadata(); data.legs!.walk.recordedTss = 0.04; data.legs!.ride.recordedTss = 9.02;
    expect(resolveEffectiveTrainingLoad(source, data).score).toBeCloseTo(9.06, 10);
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').score).toBe(0.04);
  });
  it('keeps a multisport total identical when stored leg records return in a different order', () => {
    const data = metadata();
    const leg = data.legs!.walk;
    data.legs = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`leg-${index}`, {
      ...leg, activityId: `activity-${index}`, recordedTss: index === 99 ? 9999 : 0.1,
    }]));
    const parsed = resolveEffectiveTrainingLoad(source, data);
    const restored = resolveEffectiveTrainingLoad(source, {
      ...data, legs: Object.fromEntries(Object.entries(data.legs).reverse()),
    });
    expect(parsed.score).toBeCloseTo(10008.9, 8);
    expect(restored.score).toBe(parsed.score);
  });
  it('keeps the unavailable-workout reason stable when unavailable legs return in another order', () => {
    const data = metadata();
    data.legs!.walk.recordedTss = null; data.legs!.ride.recordedTss = null;
    data.controls.walk = { method: 'HR' };
    const original = resolveEffectiveTrainingLoad(source, data);
    expect(original.status).toBe('unavailable');
    expect(resolveEffectiveTrainingLoad(source, {
      ...data, legs: Object.fromEntries(Object.entries(data.legs!).reverse()),
    })).toEqual(original);
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
  it.each([
    {}, { method: 'AUTOMATIC' as const }, { included: true },
    { method: 'AUTOMATIC' as const, included: true },
  ])('retains a legacy parent score for neutral saved preferences: %j', control => {
    // The editor also saves these preferences when only copying defaults to future workouts.
    const data: TrainingLoadMetadata = { version: 1, revision: 1, excluded: false, controls: { walk: control } };
    expect(resolveEffectiveTrainingLoad(source, data, activities)).toMatchObject({ score: 200, method: 'RECORDED' });
    expect(resolveEffectiveTrainingLoad(source, data, activities, 'walk').score).toBe(87.3);
    expect(resolveEffectiveTrainingLoad({}, data, activities)).toMatchObject({ score: null, status: 'unavailable' });
    data.controls.walk = { ...control, override: 0 };
    expect(resolveEffectiveTrainingLoad(source, data, activities).score).toBe(50);
    data.controls.walk = { ...control, included: false };
    expect(resolveEffectiveTrainingLoad(source, data, activities).score).toBe(50);
    data.controls.walk = { ...control, method: 'HR' };
    expect(resolveEffectiveTrainingLoad(source, data, activities)).toMatchObject({ score: 50, status: 'partial' });
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
