import { describe, expect, it } from 'vitest';
import {
  ActivityInterface,
  DataCadence,
  DataHeartRate,
  DataPower,
} from '@sports-alliance/sports-lib';

import {
  buildBestEffortMarkers,
  buildCadencePowerPaneSeries,
  buildDecouplingPaneSeries,
  buildPowerCurvePaneSeries,
  shouldRenderPerformanceCurveChart,
} from './performance-curve-chart-data-helper';

const POWER_CURVE_TYPE = 'PowerCurve';

type StreamMap = Record<string, (number | null)[]>;

type RawPoint = {
  duration?: unknown;
  power?: unknown;
  wattsPerKg?: unknown;
};

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

describe('performance-curve-chart-data-helper', () => {
  it('should return false when no renderable pane data exists', () => {
    const activity = createActivity({ id: 'a1', powerCurve: null, streams: {} });

    expect(shouldRenderPerformanceCurveChart([activity])).toBe(false);
  });

  it('should return true when power-curve stat exists', () => {
    const activity = createActivity({
      id: 'a1',
      powerCurve: [
        { duration: 1, power: 900 },
        { duration: 60, power: 320 },
      ],
    });

    expect(shouldRenderPerformanceCurveChart([activity])).toBe(true);
    expect(buildPowerCurvePaneSeries([activity]).length).toBe(1);
  });

  it('should return true when decoupling data exists without power-curve stat', () => {
    const activity = createActivity({
      id: 'a1',
      powerCurve: null,
      streams: {
        [DataPower.type]: [200, 220, 240, 260, 250],
        [DataHeartRate.type]: [130, 132, 135, 138, 136],
      },
    });

    const decoupling = buildDecouplingPaneSeries([activity]);

    expect(decoupling).toHaveLength(1);
    expect(decoupling[0].points.length).toBeGreaterThan(1);
    expect(shouldRenderPerformanceCurveChart([activity])).toBe(true);
  });

  it('should return true when cadence-power data exists without power-curve stat', () => {
    const activity = createActivity({
      id: 'a1',
      powerCurve: null,
      streams: {
        [DataPower.type]: [210, 260, 240, 280, 295],
        [DataCadence.type]: [85, 92, 88, 95, 97],
      },
    });

    const cadencePower = buildCadencePowerPaneSeries([activity]);

    expect(cadencePower).toHaveLength(1);
    expect(cadencePower[0].points.length).toBeGreaterThan(1);
    expect(shouldRenderPerformanceCurveChart([activity])).toBe(true);
  });

  it('should create deterministic labels for decoupling series and filter invalid data', () => {
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

    const result = buildDecouplingPaneSeries(activities, { isMerge: false, rollingWindowSeconds: 120 });

    expect(result.map((series) => series.label)).toEqual(['Run', 'Run (2)']);
    expect(result[0].points.every((point) => point.efficiency > 0)).toBe(true);
  });

  it('should downsample cadence-power points and compute density in range', () => {
    const activity = createActivity({
      id: 'a1',
      streams: {
        [DataPower.type]: [240, 245, 250, 255, 260, 265, 270, 275, 280, 285],
        [DataCadence.type]: [85, 86, 84, 85, 87, 88, 89, 87, 86, 85],
      },
    });

    const result = buildCadencePowerPaneSeries([activity], { maxPointsPerSeries: 4 });

    expect(result).toHaveLength(1);
    expect(result[0].points.length).toBeLessThanOrEqual(4);
    expect(result[0].points.every((point) => point.density > 0 && point.density <= 1)).toBe(true);
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

    const decouplingSeries = buildDecouplingPaneSeries([activity]);
    const markers = buildBestEffortMarkers(decouplingSeries, {
      windowDurations: [5, 30, 60, 120],
    });

    expect(markers.map((marker) => marker.windowLabel)).toEqual(['5s', '30s', '1m']);
    expect(markers[0].power).toBeGreaterThan(0);
    expect(markers[0].endDuration).toBeGreaterThanOrEqual(markers[0].startDuration);
  });
});
