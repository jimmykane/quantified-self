import { describe, expect, it } from 'vitest';
import { ActivityTypes, DataAscent, DataDistance, EventImporterJSON } from '@sports-alliance/sports-lib';
import { applyActivityAscentCorrection, applyCorrectedEventAscent, readAscentCorrection,
  applySavedActivityAscent, carryActivityAscentCorrection, type AscentCorrectedActivity, validActivityAscent } from '@shared/activity-ascent';

describe('activity ascent corrections', () => {
  function activity(ascent = 100): AscentCorrectedActivity {
    const result = EventImporterJSON.getActivityFromJSON({ startDate: 0, endDate: 3600000,
      type: ActivityTypes.Running, creator: { name: 'Test' }, laps: [], intensityZones: [],
      stats: {}, streams: {} }) as AscentCorrectedActivity;
    result.addStat(new DataAscent(ascent));
    result.addStat(new DataDistance(10000));
    return result;
  }
  it.each([-1, NaN, Infinity, '20', null, 1000001])('rejects invalid ascent %s', value => {
    expect(validActivityAscent(value)).toBe(false);
  });
  it('accepts recorded zero and rejects unexpected metadata fields', () => {
    expect(readAscentCorrection({ value: 0, sourceValue: 100 })).toEqual({ value: 0, sourceValue: 100 });
    expect(readAscentCorrection({ value: 5, sourceValue: null })).toEqual({ value: 5, sourceValue: null });
    expect(readAscentCorrection({ value: 5, sourceValue: 10, private: 'payload' })).toBeNull();
  });
  it('retains a correction while remembering the latest imported ascent for reset', () => {
    const target = activity(250);
    applyActivityAscentCorrection(target, { value: 75, sourceValue: 100 }, true);
    expect(target.getStat(DataAscent.type)?.getValue()).toBe(75);
    expect(target.ascentCorrection).toEqual({ value: 75, sourceValue: 250 });
    expect(target.getStat(DataDistance.type)?.getValue()).toBe(10000);
    applyActivityAscentCorrection(target, target.ascentCorrection);
    expect(target.ascentCorrection?.sourceValue).toBe(250);
  });
  it('updates only the parent ascent total across its activities', () => {
    const parent = EventImporterJSON.getEventFromJSON({ name: 'Workout', startDate: 0, endDate: 7200000, stats: {}, activities: [] });
    const first = activity(), second = activity(200);
    parent.addActivities([first, second]);
    parent.addStat(new DataDistance(20000));
    applyActivityAscentCorrection(first, { value: 0, sourceValue: 100 });
    applyCorrectedEventAscent(parent);
    expect(parent.getStat(DataAscent.type)?.getValue()).toBe(200);
    expect(parent.getStat(DataDistance.type)?.getValue()).toBe(20000);
  });
  it('patches a committed correction in place and clears absent imported ascent on reset', () => {
    const parent = EventImporterJSON.getEventFromJSON({ name: 'Workout', startDate: 0, endDate: 3600000, stats: {}, activities: [] });
    const target = activity(); target.setID('hike'); parent.addActivity(target); parent.addStat(new DataDistance(10000));
    applySavedActivityAscent(parent, { activityId: target.getID(), ascent: 0, eventAscent: 0,
      correction: { value: 0, sourceValue: null } });
    expect(parent.getActivities()[0]).toBe(target);
    expect(target.getStat(DataAscent.type)?.getValue()).toBe(0);
    expect(parent.getStat(DataAscent.type)?.getValue()).toBe(0);
    expect(target.ascentCorrection).toEqual({ value: 0, sourceValue: null });
    applySavedActivityAscent(parent, { activityId: target.getID(), ascent: null, eventAscent: null, correction: null });
    expect(target.getStat(DataAscent.type)).toBeFalsy(); expect(parent.getStat(DataAscent.type)).toBeFalsy();
    expect(target.ascentCorrection).toBeUndefined();
    expect(target.getStat(DataDistance.type)?.getValue()).toBe(10000);
    expect(parent.getStat(DataDistance.type)?.getValue()).toBe(10000);
  });
  it('does not transfer a correction through the last-unmatched hydration fallback', () => {
    const existing = activity(), replacement = activity(250);
    applyActivityAscentCorrection(existing, { value: 75, sourceValue: 100 });
    replacement.startDate = new Date(1000);
    carryActivityAscentCorrection(existing, replacement);
    expect(replacement.ascentCorrection).toBeUndefined();
    expect(replacement.getStat(DataAscent.type)?.getValue()).toBe(250);
    replacement.startDate = existing.startDate;
    carryActivityAscentCorrection(existing, replacement);
    expect(replacement.getStat(DataAscent.type)?.getValue()).toBe(75);
  });
});
