import { describe, it, expect } from 'vitest';
import { DataFeeling, DataRPE, DistanceUnits } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { eventDetailsChanges, eventDetailsWritePatch, feedbackOptions } from './event-details-form.helper';
describe('Combined event details draft', () => {
  it('patches only changed event fields and accepts an already committed retry', () => {
    const before = { name: '', description: '', rpe: 0, feeling: null };
    const changes = eventDetailsChanges(before, { ...before, rpe: 5, name: 'Run' });
    expect(eventDetailsWritePatch({ stats: { [DataRPE.type]: 0, unrelated: 99 } }, changes))
      .toEqual({ name: 'Run', [`stats.${DataRPE.type}`]: 5 });
    expect(eventDetailsWritePatch({ name: 'Run', stats: { [DataRPE.type]: 5 } }, changes)).toEqual({});
    expect(() => eventDetailsWritePatch({ name: 'Changed', stats: { [DataRPE.type]: 0 } }, changes)).toThrow('changed elsewhere');
  });
  it('rejects unrelated event fields and invalid rating writes', () => {
    for (const changes of [{ streams: { before: [], after: [] } }, { rpe: { before: 5, after: 11 } },
      { feeling: { before: 2, after: 2.5 } }]) expect(() => eventDetailsWritePatch({}, changes as never)).toThrow();
  });
  it.each([undefined, { distanceUnits: [DistanceUnits.Miles] }])('uses canonical metric options and preserves zero/fractional RPE with %j', settings => {
    const options = feedbackOptions('rpe', 2.5, settings as never);
    for (const value of [0, 2.5, 10]) expect(options.find(option => option.value === value)?.label)
      .toBe(resolveUnitAwareDisplayFromValue(DataRPE.type, value, settings as never)?.text);
    expect(feedbackOptions('feeling', 1, settings as never)[0].label)
      .toBe(resolveUnitAwareDisplayFromValue(DataFeeling.type, 1, settings as never)?.text);
  });
});
