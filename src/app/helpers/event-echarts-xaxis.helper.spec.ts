import { describe, expect, it } from 'vitest';
import { ActivityTypes, DataDistance, XAxisTypes } from '@sports-alliance/sports-lib';
import {
  buildEventCanonicalXAxisScaleOptions,
  canSelectEventChartDistanceXAxis,
  clampEventRange,
  formatDurationSeconds,
  formatEventXAxisValue,
  getCanonicalEventXAxisInterval,
  normalizeEventRange,
  resolveEventChartXAxisType
} from './event-echarts-xaxis.helper';

describe('event-echarts-xaxis.helper', () => {
  it('forces time axis for multisport events', () => {
    const resolved = resolveEventChartXAxisType({ isMultiSport: () => true } as any, XAxisTypes.Distance);
    expect(resolved).toBe(XAxisTypes.Time);
  });

  it('keeps configured axis for normal events', () => {
    const resolved = resolveEventChartXAxisType({ isMultiSport: () => false } as any, XAxisTypes.Duration);
    expect(resolved).toBe(XAxisTypes.Duration);
  });

  it('falls back to duration when distance is configured and a selected indoor activity has no distance stream', () => {
    const indoorActivityWithoutDistance = {
      type: ActivityTypes.IndoorRunning,
      getStream: (streamType: string) => (streamType === XAxisTypes.Time
        ? { getData: () => [0, 30, 60] }
        : null),
      getAllStreams: () => [{ type: XAxisTypes.Time, getData: () => [0, 30, 60] }],
    } as any;

    const resolved = resolveEventChartXAxisType(
      { isMultiSport: () => false } as any,
      XAxisTypes.Distance,
      [indoorActivityWithoutDistance]
    );

    expect(resolved).toBe(XAxisTypes.Duration);
    expect(canSelectEventChartDistanceXAxis([indoorActivityWithoutDistance])).toBe(false);
  });

  it('keeps distance axis when selected indoor activities include finite distance data', () => {
    const indoorActivityWithDistance = {
      type: ActivityTypes.IndoorCycling,
      getStream: (streamType: string) => {
        if (streamType === DataDistance.type) {
          return { getData: () => [0, 100, 250] };
        }
        if (streamType === XAxisTypes.Time) {
          return { getData: () => [0, 10, 20] };
        }
        return null;
      },
      getAllStreams: () => [
        { type: DataDistance.type, getData: () => [0, 100, 250] },
        { type: XAxisTypes.Time, getData: () => [0, 10, 20] },
      ],
    } as any;

    const resolved = resolveEventChartXAxisType(
      { isMultiSport: () => false } as any,
      XAxisTypes.Distance,
      [indoorActivityWithDistance]
    );

    expect(resolved).toBe(XAxisTypes.Distance);
    expect(canSelectEventChartDistanceXAxis([indoorActivityWithDistance])).toBe(true);
  });

  it('formats duration values', () => {
    expect(formatDurationSeconds(65)).toBe('01:05');
    expect(formatDurationSeconds(3661)).toBe('01:01:01');
  });

  it('normalizes and clamps ranges', () => {
    const normalized = normalizeEventRange({ start: 20, end: 10 });
    expect(normalized).toEqual({ start: 10, end: 20 });

    const clamped = clampEventRange({ start: -10, end: 120 }, 0, 100);
    expect(clamped).toEqual({ start: 0, end: 100 });
  });

  it('formats axis values safely', () => {
    expect(formatEventXAxisValue(90, XAxisTypes.Duration)).toBe('01:30');
    expect(formatEventXAxisValue(Number.NaN, XAxisTypes.Distance)).toBe('');
  });

  it('formats time axis with optional date visibility', () => {
    const timestamp = new Date('2024-01-02T03:04:05.000Z').getTime();
    const withDate = formatEventXAxisValue(timestamp, XAxisTypes.Time, { includeDateForTime: true, locale: 'en-GB' });
    const timeOnly = formatEventXAxisValue(timestamp, XAxisTypes.Time, { includeDateForTime: false, locale: 'en-GB' });

    expect(withDate.length).toBeGreaterThan(timeOnly.length);
    expect(timeOnly).toContain(':');
  });

  it('formats time axis using the provided locale instead of a hardcoded british locale', () => {
    const timestamp = new Date('2024-03-02T15:04:05.000Z').getTime();

    const british = formatEventXAxisValue(timestamp, XAxisTypes.Time, {
      includeDateForTime: true,
      locale: 'en-GB',
    });
    const american = formatEventXAxisValue(timestamp, XAxisTypes.Time, {
      includeDateForTime: true,
      locale: 'en-US',
    });

    expect(british).not.toBe(american);
    expect(british).toContain('02 Mar');
    expect(american).toContain('Mar 02');
  });

  it('picks canonical duration and time intervals from the visible range', () => {
    expect(getCanonicalEventXAxisInterval(XAxisTypes.Duration, { start: 0, end: 120 })).toBe(15);
    expect(getCanonicalEventXAxisInterval(
      XAxisTypes.Time,
      {
        start: Date.UTC(2024, 0, 1, 10, 0, 0),
        end: Date.UTC(2024, 0, 1, 12, 0, 0),
      }
    )).toBe(15 * 60 * 1000);
  });

  it('builds fixed canonical scale options only for duration and time axes', () => {
    expect(buildEventCanonicalXAxisScaleOptions(XAxisTypes.Distance, { start: 0, end: 1000 })).toBeNull();
    expect(buildEventCanonicalXAxisScaleOptions(XAxisTypes.Duration, { start: 0, end: 120 })).toEqual({
      interval: 15,
      minInterval: 15,
      maxInterval: 15,
      splitNumber: 6,
    });
  });

  it('builds adaptive split-only mobile scale options for all event axis modes', () => {
    expect(buildEventCanonicalXAxisScaleOptions(XAxisTypes.Time, { start: 0, end: 120_000 }, true)).toEqual({
      splitNumber: 4,
    });
    expect(buildEventCanonicalXAxisScaleOptions(XAxisTypes.Duration, { start: 0, end: 120 }, true)).toEqual({
      splitNumber: 4,
    });
    expect(buildEventCanonicalXAxisScaleOptions(XAxisTypes.Distance, { start: 0, end: 1000 }, true)).toEqual({
      splitNumber: 4,
    });
  });
});
