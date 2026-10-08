import { describe, expect, it } from 'vitest';
import {
  ActivityInterface, DataActiveLap, DataDistance, DataDuration, DataStrokeRateAvg,
  DataSwimPaceAvg, LapInterface, SwimPaceUnits,
} from '@sports-alliance/sports-lib';
import { getSwimLapAnalytics, getSwimLapDisplayMetric, getNormalizedSwolf, getSwolfColumnLabel, isRestSwimLap } from './event-swim-analytics.helper';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import { formatEventLapMetric, getAverageEventLapMetrics, getSelectedEventLapSummaryMetrics, getDefaultEventLapMetricTypes, getSelectedEventLapMetricTypes } from './event-lap-table-columns.helper';
import { EVENT_LAP_STROKES_COLUMN, EVENT_LAP_SWOLF_COLUMN } from './event-swim-analytics.helper';
import { normalizeSwimLength } from './event-swim-length.helper';

const units = getDefaultUserUnitSettings();
function lap(distance = 25, duration = 30, cadence = 20, active?: boolean): LapInterface {
  return {
    getDuration: () => new DataDuration(duration), getDistance: () => new DataDistance(distance),
    getStat: (type: string) => type === DataActiveLap.type && active !== undefined ? new DataActiveLap(active)
      : type === DataStrokeRateAvg.type ? new DataStrokeRateAvg(cadence)
        : type === DataSwimPaceAvg.type ? new DataSwimPaceAvg(100 * duration / distance) : undefined,
  } as unknown as LapInterface;
}
function length(index: number, overrides: Record<string, unknown> = {}) {
  return { index, lapIndex: 1, startDate: index * 30000, endDate: (index + 1) * 30000,
    type: 'active', timerTime: 30, elapsedTime: 30, distance: 25 * 0.9144, strokes: 10, avgCadence: 20, ...overrides };
}
function activity(laps: LapInterface[], lengths: unknown[]): ActivityInterface {
  return { getLaps: () => laps, getSwimLengths: () => lengths } as unknown as ActivityInterface;
}

describe('swim interval analytics', () => {
  it('adds efficiency defaults without changing an existing saved column layout', () => {
    expect(getDefaultEventLapMetricTypes('swimming')).toEqual(expect.arrayContaining([EVENT_LAP_STROKES_COLUMN, EVENT_LAP_SWOLF_COLUMN]));
    expect(getDefaultEventLapMetricTypes('running')).not.toContain(EVENT_LAP_STROKES_COLUMN);
    expect(getSelectedEventLapMetricTypes({ lapTableColumnsBySportFamily: { swimming: [DataDuration.type] } }, 'swimming')).toEqual([DataDuration.type]);
  });
  it('uses active time / distance weights in the top and selected swim averages, retaining total duration coverage', () => {
    const laps = [lap(), lap(), lap(0, 120, 0, false)];
    const swim = activity(laps, [length(1, { distance: 25 }), length(2, { lapIndex: 2, distance: 50, timerTime: 60, avgCadence: 40, strokes: 30 }),
      length(3, { lapIndex: 3, type: 'idle', distance: 0, timerTime: 120 })]);
    const types = [DataStrokeRateAvg.type, DataSwimPaceAvg.type, EVENT_LAP_SWOLF_COLUMN, EVENT_LAP_STROKES_COLUMN, DataDuration.type];
    const average = getAverageEventLapMetrics(laps, types, units, 'Swimming', swim);
    expect(average).toEqual([
      { type: DataStrokeRateAvg.type, display: '33 spm' },
      { type: DataSwimPaceAvg.type, display: '02:00 min/100m' },
      { type: EVENT_LAP_SWOLF_COLUMN, display: '43.3' },
    ]);
    const selected = getSelectedEventLapSummaryMetrics(laps, types, units, 'Swimming', swim);
    expect(selected.find(metric => metric.type === DataStrokeRateAvg.type)).toMatchObject({ availableCount: 2, selectedCount: 3, display: '33 spm' });
    expect(selected.find(metric => metric.type === DataDuration.type)).toMatchObject({ availableCount: 3 });
    expect(selected.find(metric => metric.type === EVENT_LAP_STROKES_COLUMN)).toMatchObject({ availableCount: 2, display: '20' });
  });
  it('preserves all six / ten recorded lengths of 150 / 250 yard reps and excludes recorded rest', () => {
    const laps = [lap(), lap()];
    const lengths = [...Array.from({ length: 6 }, (_, i) => length(i + 1)),
      ...Array.from({ length: 10 }, (_, i) => length(i + 7, { lapIndex: 2 })),
      length(17, { type: 'idle', lapIndex: 2, timerTime: 90, strokes: 90, avgCadence: 90, distance: 0 })];
    const analytics = getSwimLapAnalytics(activity(laps, lengths), { ...units, swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    expect(analytics.get(laps[0])).toMatchObject({ activeDuration: 180, activeDistance: 6 * 22.86 });
    expect(analytics.get(laps[0])?.strokes?.getValue()).toBe(60);
    expect(analytics.get(laps[1])?.lengths).toHaveLength(11);
    expect(analytics.get(laps[1])?.strokes?.getValue()).toBe(100);
    expect(analytics.get(laps[1])?.cadence?.getValue()).toBe(20);
    expect(analytics.get(laps[1])?.swolf?.getValue()).toBe(40);
  });
  it('uses an explicit yard / meter reference without replacing recorded SWOLF', () => {
    expect(getNormalizedSwolf(30, 22.86, 10, units)?.getValue()).toBe(43.7);
    const yards = { ...units, swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] };
    expect(getNormalizedSwolf(30, 22.86, 10, yards)?.getValue()).toBe(40);
    expect(getSwolfColumnLabel(units)).toBe('SWOLF (25 m)');
    expect(getSwolfColumnLabel(yards)).toBe('SWOLF (25 yd)');
    expect(getNormalizedSwolf(30, 25, null, units)).toBeNull();
    expect(getNormalizedSwolf(0, 25, 10, units)).toBeNull();
  });
  it('does not classify drills, unknown cadence, or recorded active rows as rest', () => {
    expect(isRestSwimLap(lap(0, 30, 0))).toBe(true);
    expect(isRestSwimLap(lap(25, 30, 0))).toBe(false);
    expect(isRestSwimLap(lap(0, 30, 0, true))).toBe(false);
    expect(isRestSwimLap(lap(25, 30, 20, false))).toBe(true);
    expect(isRestSwimLap({ getDistance: () => new DataDistance(0) } as LapInterface)).toBe(false);
    expect(isRestSwimLap(lap(0, 30, 0), [normalizeSwimLength(length(1, { type: 'unknown' }))!])).toBe(true);
    expect(isRestSwimLap(lap(0, 30, 0), [normalizeSwimLength(length(1))!])).toBe(false);
  });
  it('preserves native cadence column availability and recorded zero rates in rest rows', () => {
    const laps = [lap(), lap(0, 30, 0, false)];
    const analytics = getSwimLapAnalytics(activity(laps, [length(1)]));
    expect(getSwimLapDisplayMetric(analytics.get(laps[0]), 'Average Cadence')).toBeUndefined();
    expect(getSwimLapDisplayMetric(analytics.get(laps[1]), DataStrokeRateAvg.type)).toBeUndefined();
    expect(analytics.get(laps[1])?.isRest).toBe(true);
  });
  it('does not invent missing lengths, strokes, or active timing from combined lap totals', () => {
    const laps = [lap()];
    const result = getSwimLapAnalytics(activity(laps, [length(1, { strokes: null }), length(2, { type: 'idle' })])).get(laps[0]);
    expect(result?.strokes).toBeNull();
    expect(result?.swolf).toBeNull();
    const missing = getSwimLapAnalytics(activity(laps, [length(1, { timerTime: null, elapsedTime: null }), length(2, { type: 'idle' })])).get(laps[0]);
    expect(missing?.activeDuration).toBeNull();
    expect(missing?.pace).toBeNull();
    expect(getSwimLapAnalytics(activity(laps, [])).get(laps[0])?.lengths).toEqual([]);
  });
  it('keeps an exact 250-yard rep pace at 2:20 after summing ten lengths', () => {
    const laps = [lap()];
    const yards = { ...units, swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] };
    const swim = activity(laps, Array.from({ length: 10 }, (_, i) => length(i + 1, { timerTime: 35 })));
    const analytics = getSwimLapAnalytics(swim, yards).get(laps[0]);
    expect(analytics?.activeDistance).toBe(228.6);
    expect(formatEventLapMetric(analytics?.pace, DataSwimPaceAvg.type, yards, 'Swimming')).toBe('02:20 min/100yd');
    expect(getAverageEventLapMetrics(laps, [DataSwimPaceAvg.type], yards, 'Swimming', swim))
      .toEqual([{ type: DataSwimPaceAvg.type, display: '02:20 min/100yd' }]);
  });
  it('weights active cadence by swim time and keeps zero stroke drills', () => {
    const laps = [lap()];
    const result = getSwimLapAnalytics(activity(laps, [length(1), length(2, { timerTime: 60, avgCadence: 40 }),
      length(3, { timerTime: 30, avgCadence: 0, strokes: 0 }), length(4, { type: 'idle', avgCadence: 100 })])).get(laps[0]);
    expect(result?.cadence?.getValue()).toBe(25);
    expect(result?.activeDuration).toBe(120);
    expect(result?.strokes?.getValue()).toBe(20);
  });
  it('does not give missing stroke-rate samples the weight of a full interval in the average', () => {
    const laps = [lap(), lap()];
    const swim = activity(laps, [length(1), length(2, { timerTime: 270, avgCadence: null }),
      length(3, { lapIndex: 2, avgCadence: 40 })]);
    expect(getAverageEventLapMetrics(laps, [DataStrokeRateAvg.type], units, 'Swimming', swim))
      .toEqual([{ type: DataStrokeRateAvg.type, display: '30 spm' }]);
  });
});
