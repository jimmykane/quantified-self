import { describe, expect, it } from 'vitest';
import { ActivityInterface } from '@sports-alliance/sports-lib';

import {
  buildPowerCurveSeries,
  shouldRenderPowerCurveChart,
} from './power-curve-chart-data-helper';

const POWER_CURVE_TYPE = 'PowerCurve';

type RawPoint = {
  duration?: unknown;
  power?: unknown;
  wattsPerKg?: unknown;
};

const valueObject = (value: unknown) => ({
  getValue: () => value,
});

function createActivity(options: {
  id?: string;
  creatorName?: string;
  type?: string;
  points?: RawPoint[] | null;
}): ActivityInterface {
  const id = options.id ?? 'activity-1';
  const creatorName = options.creatorName ?? 'Device';
  const type = options.type ?? 'Ride';
  const points = options.points;
  const powerCurveStat = points === null || points === undefined ? null : {
    getValue: () => points,
  };

  return {
    type,
    creator: { name: creatorName },
    getID: () => id,
    getStat: (statType: string) => {
      if (statType === POWER_CURVE_TYPE) {
        return powerCurveStat as any;
      }
      return null;
    },
  } as unknown as ActivityInterface;
}

describe('power-curve-chart-data-helper', () => {
  it('should return false when no activities are provided', () => {
    expect(shouldRenderPowerCurveChart([])).toBe(false);
  });

  it('should return false when no activity has valid power-curve points', () => {
    const activities = [
      createActivity({
        id: 'a1',
        points: [
          { duration: 0, power: 300 },
          { duration: 60, power: 0 },
        ],
      }),
      createActivity({ id: 'a2', points: null }),
    ];

    expect(shouldRenderPowerCurveChart(activities)).toBe(false);
  });

  it('should return true when at least one valid power-curve point exists', () => {
    const activities = [
      createActivity({
        id: 'a1',
        points: [
          { duration: 1, power: 900 },
        ],
      }),
    ];

    expect(shouldRenderPowerCurveChart(activities)).toBe(true);
  });

  it('should normalize data objects and numeric values, filter invalid points, and sort durations', () => {
    const activities = [
      createActivity({
        id: 'a1',
        creatorName: 'Trainer',
        points: [
          { duration: valueObject(60), power: valueObject(300), wattsPerKg: valueObject(4.0) },
          { duration: 60, power: 320, wattsPerKg: 4.2 },
          { duration: valueObject(15), power: valueObject(500) },
          { duration: '300', power: '280' },
          { duration: -1, power: 100 },
          { duration: 30, power: 0 },
          { duration: Number.NaN, power: 250 },
        ],
      }),
    ];

    const result = buildPowerCurveSeries(activities);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Ride');
    expect(result[0].points).toEqual([
      { duration: 15, power: 500 },
      { duration: 60, power: 320, wattsPerKg: 4.2 },
      { duration: 300, power: 280 },
    ]);
  });

  it('should keep max power for duplicate durations', () => {
    const activities = [
      createActivity({
        id: 'a1',
        points: [
          { duration: 120, power: 280, wattsPerKg: 3.8 },
          { duration: 120, power: 310, wattsPerKg: 4.1 },
          { duration: 120, power: 305, wattsPerKg: 4.5 },
        ],
      }),
    ];

    const result = buildPowerCurveSeries(activities);

    expect(result).toHaveLength(1);
    expect(result[0].points).toEqual([
      { duration: 120, power: 310, wattsPerKg: 4.1 },
    ]);
  });

  it('should omit activities that do not provide valid points', () => {
    const activities = [
      createActivity({
        id: 'a1',
        creatorName: 'Valid Device',
        points: [{ duration: 60, power: 300 }],
      }),
      createActivity({
        id: 'a2',
        creatorName: 'Invalid Device',
        points: [{ duration: 0, power: 200 }],
      }),
    ];

    const result = buildPowerCurveSeries(activities);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Ride');
  });

  it('should use sport labels for non-merge multi-activity charts', () => {
    const activities = [
      createActivity({ id: 'a1', creatorName: 'Power Meter A', type: 'Run', points: [{ duration: 60, power: 300 }] }),
      createActivity({ id: 'a2', creatorName: 'Power Meter B', type: 'Run', points: [{ duration: 60, power: 310 }] }),
      createActivity({ id: 'a3', creatorName: 'Power Meter C', type: 'Bike', points: [{ duration: 60, power: 320 }] }),
    ];

    const result = buildPowerCurveSeries(activities);

    expect(result.map((series) => series.label)).toEqual([
      'Run',
      'Run (2)',
      'Bike',
    ]);
  });

  it('should suffix duplicate device labels deterministically for merge events', () => {
    const activities = [
      createActivity({ id: 'a1', creatorName: 'Power Meter', points: [{ duration: 60, power: 300 }] }),
      createActivity({ id: 'a2', creatorName: 'Power Meter', points: [{ duration: 60, power: 310 }] }),
      createActivity({ id: 'a3', creatorName: 'Power Meter', points: [{ duration: 60, power: 320 }] }),
    ];

    const result = buildPowerCurveSeries(activities, { isMerge: true });

    expect(result.map((series) => series.label)).toEqual([
      'Power Meter',
      'Power Meter (2)',
      'Power Meter (3)',
    ]);
  });

  it('should fallback to activity type then positional label when creator name is missing', () => {
    const activities = [
      createActivity({ id: 'a1', creatorName: '', type: 'Run', points: [{ duration: 60, power: 280 }] }),
      createActivity({ id: 'a2', creatorName: '', type: '', points: [{ duration: 120, power: 260 }] }),
    ];

    const result = buildPowerCurveSeries(activities);

    expect(result.map((series) => series.label)).toEqual(['Run', 'Activity 2']);
  });
});
