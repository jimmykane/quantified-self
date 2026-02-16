import { describe, expect, it } from 'vitest';
import {
  ActivityInterface,
  DataCadence,
  DataHeartRate,
  DataPower,
} from '@sports-alliance/sports-lib';

import { PerformanceCurveDataService } from './performance-curve-data.service';

const POWER_CURVE_TYPE = 'PowerCurve';

type StreamMap = Record<string, (number | null)[]>;

type RawPoint = {
  duration?: unknown;
  power?: unknown;
  wattsPerKg?: unknown;
};

const valueObject = (value: unknown) => ({
  getValue: () => value,
});

function createActivity(options: {
  id: string;
  type?: string;
  creatorName?: string;
  powerCurve?: RawPoint[] | null;
  streams?: StreamMap;
}): ActivityInterface {
  const streamMap = options.streams ?? {};

  return {
    type: options.type ?? 'Ride',
    creator: {
      name: options.creatorName ?? 'Device',
    },
    getID: () => options.id,
    getStat: (statType: string) => {
      if (statType === POWER_CURVE_TYPE && options.powerCurve) {
        return {
          getValue: () => options.powerCurve,
        } as any;
      }
      return null;
    },
    getStream: (streamType: string) => {
      if (!(streamType in streamMap)) {
        throw new Error(`Stream ${streamType} missing`);
      }
      return {
        getData: () => streamMap[streamType],
      } as any;
    },
  } as unknown as ActivityInterface;
}

describe('PerformanceCurveDataService', () => {
  const service = new PerformanceCurveDataService();

  it('should return no availability when no activities are provided', () => {
    expect(service.getAvailability([])).toEqual({
      hasPowerCurve: false,
      hasDurability: false,
      hasCadencePower: false,
      hasAny: false,
    });
  });

  it('should return power-curve availability when power points exist', () => {
    const activity = createActivity({
      id: 'a1',
      powerCurve: [
        { duration: 1, power: 900 },
        { duration: 60, power: 320 },
      ],
    });

    const availability = service.getAvailability([activity]);

    expect(availability.hasPowerCurve).toBe(true);
    expect(availability.hasAny).toBe(true);
  });

  it('should return durability availability without power-curve stat', () => {
    const activity = createActivity({
      id: 'a1',
      powerCurve: null,
      streams: {
        [DataPower.type]: [200, 220, 240, 260, 250],
        [DataHeartRate.type]: [130, 132, 135, 138, 136],
      },
    });

    const availability = service.getAvailability([activity]);

    expect(availability.hasPowerCurve).toBe(false);
    expect(availability.hasDurability).toBe(true);
    expect(availability.hasAny).toBe(true);
  });

  it('should return cadence-power availability without power-curve stat', () => {
    const activity = createActivity({
      id: 'a1',
      powerCurve: null,
      streams: {
        [DataPower.type]: [210, 260, 240, 280, 295],
        [DataCadence.type]: [85, 92, 88, 95, 97],
      },
    });

    const availability = service.getAvailability([activity]);

    expect(availability.hasPowerCurve).toBe(false);
    expect(availability.hasCadencePower).toBe(true);
    expect(availability.hasAny).toBe(true);
  });

  it('should normalize power-curve points, filter invalid values, and sort durations', () => {
    const activities = [
      createActivity({
        id: 'a1',
        creatorName: 'Trainer',
        powerCurve: [
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

    const result = service.buildPowerCurveSeries(activities);

    expect(result).toHaveLength(1);
    expect(result[0].points).toEqual([
      { duration: 15, power: 500 },
      { duration: 60, power: 320, wattsPerKg: 4.2 },
      { duration: 300, power: 280 },
    ]);
  });

  it('should keep max power for duplicate power-curve durations', () => {
    const activities = [
      createActivity({
        id: 'a1',
        powerCurve: [
          { duration: 120, power: 280, wattsPerKg: 3.8 },
          { duration: 120, power: 310, wattsPerKg: 4.1 },
          { duration: 120, power: 305, wattsPerKg: 4.5 },
        ],
      }),
    ];

    const result = service.buildPowerCurveSeries(activities);

    expect(result[0].points).toEqual([
      { duration: 120, power: 310, wattsPerKg: 4.1 },
    ]);
  });

  it('should create deterministic sport labels for non-merge power-curve series', () => {
    const activities = [
      createActivity({ id: 'a1', creatorName: 'Power Meter A', type: 'Run', powerCurve: [{ duration: 60, power: 300 }] }),
      createActivity({ id: 'a2', creatorName: 'Power Meter B', type: 'Run', powerCurve: [{ duration: 60, power: 310 }] }),
      createActivity({ id: 'a3', creatorName: 'Power Meter C', type: 'Bike', powerCurve: [{ duration: 60, power: 320 }] }),
    ];

    const result = service.buildPowerCurveSeries(activities);

    expect(result.map((series) => series.label)).toEqual(['Run', 'Run (2)', 'Bike']);
  });

  it('should suffix duplicate device labels deterministically for merge events', () => {
    const activities = [
      createActivity({ id: 'a1', creatorName: 'Power Meter', powerCurve: [{ duration: 60, power: 300 }] }),
      createActivity({ id: 'a2', creatorName: 'Power Meter', powerCurve: [{ duration: 60, power: 310 }] }),
      createActivity({ id: 'a3', creatorName: 'Power Meter', powerCurve: [{ duration: 60, power: 320 }] }),
    ];

    const result = service.buildPowerCurveSeries(activities, { isMerge: true });

    expect(result.map((series) => series.label)).toEqual([
      'Power Meter',
      'Power Meter (2)',
      'Power Meter (3)',
    ]);
  });

  it('should build durability series and filter invalid points', () => {
    const activities = [
      createActivity({
        id: 'a1',
        type: 'Run',
        creatorName: 'Watch A',
        streams: {
          [DataPower.type]: [200, 210, 220, null, 230],
          [DataHeartRate.type]: [130, 132, 135, 136, null],
        },
      }),
      createActivity({
        id: 'a2',
        type: 'Run',
        creatorName: 'Watch B',
        streams: {
          [DataPower.type]: [180, 190, 205, 215, 220],
          [DataHeartRate.type]: [120, 121, 123, 125, 126],
        },
      }),
    ];

    const result = service.buildDurabilitySeries(activities, { isMerge: false, rollingWindowSeconds: 120 });

    expect(result.map((series) => series.label)).toEqual(['Run', 'Run (2)']);
    expect(result[0].points.every((point) => point.efficiency > 0)).toBe(true);
  });

  it('should downsample cadence-power points and keep density between 0 and 1', () => {
    const activity = createActivity({
      id: 'a1',
      streams: {
        [DataPower.type]: [240, 245, 250, 255, 260, 265, 270, 275, 280, 285],
        [DataCadence.type]: [85, 86, 84, 85, 87, 88, 89, 87, 86, 85],
      },
    });

    const result = service.buildCadencePowerSeries([activity], { maxPointsPerSeries: 4 });

    expect(result).toHaveLength(1);
    expect(result[0].points.length).toBeLessThanOrEqual(4);
    expect(result[0].points.every((point) => point.density > 0 && point.density <= 1)).toBe(true);
  });

  it('should remove singleton cadence-power bins for dense datasets', () => {
    const densePower = Array.from({ length: 350 }, (_, index) => 250 + (index % 4));
    const denseCadence = Array.from({ length: 350 }, (_, index) => 88 + (index % 3));
    // Add one isolated outlier bin that should be filtered in dense mode.
    densePower.push(520);
    denseCadence.push(40);

    const activity = createActivity({
      id: 'a1',
      streams: {
        [DataPower.type]: densePower,
        [DataCadence.type]: denseCadence,
      },
    });

    const result = service.buildCadencePowerSeries([activity]);
    const hasOutlier = result[0].points.some((point) => point.power === 520 && point.cadence === 40);

    expect(hasOutlier).toBe(false);
  });

  it('should extract best-effort markers for supported windows only', () => {
    const activity = createActivity({
      id: 'a1',
      type: 'Ride',
      streams: {
        [DataPower.type]: [
          220, 230, 240, 250, 260, 270, 280, 300, 320, 340,
          330, 320, 310, 300, 290, 280, 270, 260, 250, 240,
          230, 220, 210, 200, 195, 190, 185, 180, 175, 170,
          165, 160, 155, 150, 145, 140, 135, 130, 128, 126,
          124, 122, 120, 118, 116, 114, 112, 110, 108, 106,
          104, 102, 100, 98, 96, 94, 92, 90, 88, 86,
          84, 82, 80, 78, 76, 74, 72, 70, 68, 66,
        ],
        [DataHeartRate.type]: [
          130, 131, 132, 133, 134, 135, 136, 137, 138, 139,
          140, 141, 142, 143, 144, 145, 146, 147, 148, 149,
          150, 151, 152, 153, 154, 155, 156, 157, 158, 159,
          160, 161, 162, 163, 164, 165, 166, 167, 168, 169,
          170, 171, 172, 173, 174, 175, 176, 177, 178, 179,
          180, 181, 182, 183, 184, 185, 186, 187, 188, 189,
          190, 191, 192, 193, 194, 195, 196, 197, 198, 199,
        ],
      },
    });

    const durabilitySeries = service.buildDurabilitySeries([activity]);
    const markers = service.buildBestEffortMarkers(durabilitySeries, {
      windowDurations: [5, 30, 60, 120],
    });

    expect(markers.map((marker) => marker.windowLabel)).toEqual(['5s', '30s', '1m']);
    expect(markers[0].power).toBeGreaterThan(0);
    expect(markers[0].endDuration).toBeGreaterThanOrEqual(markers[0].startDuration);
  });

  it('should still extract a 2h marker when sparse gaps exist but duration span is sufficient', () => {
    const power: number[] = [];
    const hr: number[] = [];

    // 2h20m duration, with frequent gaps (nulls) that reduce sample count.
    for (let second = 0; second < 8400; second += 1) {
      const hasGap = second % 11 === 0 || second % 17 === 0;
      power.push(hasGap ? null as unknown as number : 240 + (second % 5));
      hr.push(hasGap ? null as unknown as number : 145 + (second % 3));
    }

    const activity = createActivity({
      id: 'a1',
      type: 'Ride',
      streams: {
        [DataPower.type]: power as unknown as (number | null)[],
        [DataHeartRate.type]: hr as unknown as (number | null)[],
      },
    });

    const durabilitySeries = service.buildDurabilitySeries([activity]);
    const markers = service.buildBestEffortMarkers(durabilitySeries, {
      windowDurations: [7200],
    });

    expect(markers.some((marker) => marker.windowLabel === '2h')).toBe(true);
  });
});
