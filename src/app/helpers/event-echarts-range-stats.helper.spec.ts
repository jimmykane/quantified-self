import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataAltitude, DynamicDataLoader, XAxisTypes } from '@sports-alliance/sports-lib';
import { computeEventPanelRangeStats } from './event-echarts-range-stats.helper';

describe('event-echarts-range-stats.helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes min/avg/max for selected range', () => {
    vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockImplementation((_type: string, value: number) => ({
      getDisplayValue: () => value.toFixed(0),
      getDisplayUnit: () => 'u',
    } as any));

    const stats = computeEventPanelRangeStats({
      panel: {
        dataType: 'power',
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [
          {
            id: 's1',
            activityID: 'a1',
            activityName: 'A1',
            color: '#f00',
            streamType: 'power',
            displayName: 'Power',
            unit: 'W',
            points: [
              { x: 0, y: 100, time: 0 },
              { x: 10, y: 200, time: 0 },
              { x: 20, y: 300, time: 0 },
            ],
          },
        ],
      },
      range: { start: 5, end: 15 },
      xAxisType: XAxisTypes.Duration,
      gainAndLossThreshold: 1,
    });

    expect(stats).toHaveLength(1);
    expect(stats[0].min.value).toBe('200');
    expect(stats[0].max.value).toBe('200');
  });

  it('computes gain/loss and slope for altitude streams in distance mode', () => {
    vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockImplementation((_type: string, value: number) => ({
      getDisplayValue: () => value.toFixed(0),
      getDisplayUnit: () => 'm',
    } as any));

    const stats = computeEventPanelRangeStats({
      panel: {
        dataType: DataAltitude.type,
        displayName: 'Altitude',
        unit: 'm',
        colorGroupKey: 'Altitude',
        minX: 0,
        maxX: 100,
        series: [
          {
            id: 's1',
            activityID: 'a1',
            activityName: 'A1',
            color: '#f00',
            streamType: DataAltitude.type,
            displayName: 'Altitude',
            unit: 'm',
            points: [
              { x: 0, y: 100, time: 0 },
              { x: 50, y: 140, time: 0 },
              { x: 100, y: 120, time: 0 },
            ],
          },
        ],
      },
      range: { start: 0, end: 100 },
      xAxisType: XAxisTypes.Distance,
      gainAndLossThreshold: 1,
    });

    expect(stats).toHaveLength(1);
    expect(stats[0].gain).toBeDefined();
    expect(stats[0].loss).toBeDefined();
    expect(stats[0].slope).toBeDefined();
  });

  it('falls back to the raw numeric value when the formatter returns NaN text', () => {
    vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockImplementation(() => ({
      getDisplayValue: () => 'NaN',
      getDisplayUnit: () => 'km/h',
    } as any));

    const stats = computeEventPanelRangeStats({
      panel: {
        dataType: 'speed',
        displayName: 'Speed',
        unit: 'km/h',
        colorGroupKey: 'Speed',
        minX: 0,
        maxX: 100,
        series: [
          {
            id: 's1',
            activityID: 'a1',
            activityName: 'A1',
            color: '#f00',
            streamType: 'speed',
            displayName: 'Speed',
            unit: 'km/h',
            points: [
              { x: 0, y: 9.5, time: 0 },
              { x: 10, y: 10.5, time: 0 },
            ],
          },
        ],
      },
      range: { start: 0, end: 10 },
      xAxisType: XAxisTypes.Duration,
      gainAndLossThreshold: 1,
    });

    expect(stats).toHaveLength(1);
    expect(stats[0].min.value).toBe('9.50');
    expect(stats[0].min.unit).toBe('km/h');
    expect(stats[0].avg.value).toBe('10.00');
    expect(stats[0].max.value).toBe('10.50');
  });
});
