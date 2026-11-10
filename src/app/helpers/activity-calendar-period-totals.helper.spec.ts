import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataAscent, DataDistance, DataDuration, DistanceUnits, ElevationUnits } from '@sports-alliance/sports-lib';
import type { EventRead } from '@shared/event-read';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildActivityCalendarViewModel, resolveActivityCalendarPrimaryRange } from './activity-calendar.helper';
import { formatActivityCalendarPeriodTotals } from './activity-calendar-period-totals.helper';
import { DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE, DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';

function event(id: string, startDate: Date, stats: Record<string, number> = {}): EventRead {
  return {
    startDate, getID: () => id,
    getActivityTypesAsArray: () => [ActivityTypes.Cycling],
    getActivityTypesAsString: () => 'Cycling',
    getStat: vi.fn((type: string) => stats[type] === undefined ? undefined : { getValue: () => stats[type] }),
  } as unknown as EventRead;
}

describe('calendar period totals', () => {
  it.each(['month', '30d'] as const)('counts only the primary %s period, retaining recorded zero and legacy TSS', view => {
    const anchorDate = new Date(2026, 9, 30);
    const range = resolveActivityCalendarPrimaryRange(view, anchorDate, 1);
    const stats = { [DataDuration.type]: 3600, [DataDistance.type]: 10_000, [DataAscent.type]: 100 };
    const model = buildActivityCalendarViewModel([
      event('before', new Date(range.startMs - 1), { ...stats, [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 999 }),
      event('first', new Date(range.startMs), { ...stats, [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 0, [DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE]: 999 }),
      event('last', new Date(range.endExclusiveMs - 1), { ...stats, [DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE]: 80 }),
      event('after', new Date(range.endExclusiveMs), { ...stats, [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 999 }),
    ], { view, anchorDate, startOfWeek: 1 });
    const totals = formatActivityCalendarPeriodTotals(model, null, 'en-US');
    expect(totals.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Activities', value: '2' }, { label: 'Time', value: '2h' },
      { label: 'Distance', value: '20.00 Km' }, { label: 'Ascent', value: '200 m' },
      { label: 'Recorded TSS', value: '80' },
    ]);
    expect(totals.every(metric => !metric.coverage)).toBe(true);
    const miles = formatActivityCalendarPeriodTotals(model, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }), 'en-US');
    expect(miles[2].value).toMatch(/mi/i);
    expect(miles[2].value).not.toBe(totals[2].value);
    expect(miles[4].value).toBe('80');
  });

  it('uses feet for period ascent while keeping recorded totals and kilometre distance unchanged', () => {
    const anchorDate = new Date(2026, 9, 15);
    const model = buildActivityCalendarViewModel([event('ride', anchorDate, { [DataAscent.type]: 30.48, [DataDistance.type]: 1000 })], { view: 'month', anchorDate });
    const feet = formatActivityCalendarPeriodTotals(model, normalizeUserUnitSettings({ elevationUnits: ElevationUnits.Feet }), 'en-US');
    const metres = formatActivityCalendarPeriodTotals(model, normalizeUserUnitSettings({ elevationUnits: ElevationUnits.Meters }), 'en-US');
    expect(feet.find(metric => metric.label === 'Ascent')?.value).toBe('100 ft');
    expect(metres.find(metric => metric.label === 'Ascent')?.value).toBe('30 m');
    expect(feet.find(metric => metric.label === 'Distance')?.value).toBe(metres.find(metric => metric.label === 'Distance')?.value);
  });
  it('keeps loading/unavailable, empty, missing and recorded zero distinct', () => {
    const anchorDate = new Date(2026, 9, 15);
    const build = (events: EventRead[]) => buildActivityCalendarViewModel(events, { view: 'month', anchorDate });
    expect(formatActivityCalendarPeriodTotals(null).map(metric => metric.value)).toEqual(['--', '--', '--', '--', '--']);
    expect(formatActivityCalendarPeriodTotals(build([])).map(metric => metric.value)).toEqual(['0', '0m', '0.0 m', '0 m', '--']);
    const missing = event('missing', anchorDate);
    expect(formatActivityCalendarPeriodTotals(build([missing])).map(metric => metric.value)).toEqual(['1', '--', '--', '--', '--']);
    const zero = event('zero', anchorDate, {
      [DataDuration.type]: 0, [DataDistance.type]: 0, [DataAscent.type]: 0, [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 0,
    });
    const partial = formatActivityCalendarPeriodTotals(build([missing, zero]));
    expect(partial.map(metric => metric.value)).toEqual(['2', '0m', '0.0 m', '0 m', '0']);
    expect(partial.slice(1).map(metric => metric.coverage)).toEqual(Array(4).fill('1/2 activities'));
    expect(vi.mocked(zero.getStat).mock.calls.every(([type]) => [
      DataDuration.type, DataDistance.type, DataAscent.type, 'Descent', 'Activity Types',
      DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE, DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE,
    ].includes(type))).toBe(true);
  });
});
