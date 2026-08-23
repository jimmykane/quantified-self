import {
  ActivityUtilities,
  ActivityTypes,
  DataAirTimeRemaining,
  DataDepth,
  DataDepthFeet,
  DataDiveAscentRate,
  DataDiveAscentRateFeetPerSecond,
  DataHeartRate,
  DataNoDecompressionLimit,
  DataNextStopDepth,
  DataNextStopDepthFeet,
  DataTemperature,
  DistanceUnits,
  SwimPaceUnits,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEventDiveProfile,
  hasEventDiveProfileData,
  isDivingActivity,
} from './event-dive-profile.helper';
import { getEventChartSeriesY } from './event-echarts-data.helper';

function unitSettings(swimPaceUnit: SwimPaceUnits) {
  return {
    speedUnits: [],
    gradeAdjustedSpeedUnits: [],
    verticalSpeedUnits: [],
    paceUnits: [],
    gradeAdjustedPaceUnits: [],
    swimPaceUnits: [swimPaceUnit],
    distanceUnits: DistanceUnits.Kilometers,
    startOfTheWeek: 1,
  } as any;
}

function buildActivity(input: {
  id: string;
  type: ActivityTypes;
  depth?: Array<number | null>;
  temperature?: Array<number | null>;
  heartRate?: Array<number | null>;
  airTimeRemaining?: Array<number | null>;
  diveAscentRate?: Array<number | null>;
  noDecompressionLimit?: Array<number | null>;
  nextStopDepth?: Array<number | null>;
}) {
  const depth = input.depth || [];
  const sampleCount = Math.max(
    depth.length,
    input.temperature?.length || 0,
    input.heartRate?.length || 0,
    input.airTimeRemaining?.length || 0,
    input.diveAscentRate?.length || 0,
    input.noDecompressionLimit?.length || 0,
    input.nextStopDepth?.length || 0,
    1,
  );
  const streams: any[] = [];
  const timeStream = {
    type: XAxisTypes.Time,
    getData: () => Array.from({ length: sampleCount }, (_, index) => index),
  };
  if (depth.length > 0) {
    streams.push({ type: DataDepth.type, getData: () => depth });
  }
  if (input.temperature) {
    streams.push({ type: DataTemperature.type, getData: () => input.temperature });
  }
  if (input.heartRate) {
    streams.push({ type: DataHeartRate.type, getData: () => input.heartRate });
  }
  if (input.airTimeRemaining) {
    streams.push({ type: DataAirTimeRemaining.type, getData: () => input.airTimeRemaining });
  }
  if (input.diveAscentRate) {
    streams.push({ type: DataDiveAscentRate.type, getData: () => input.diveAscentRate });
  }
  if (input.noDecompressionLimit) {
    streams.push({ type: DataNoDecompressionLimit.type, getData: () => input.noDecompressionLimit });
  }
  if (input.nextStopDepth) {
    streams.push({ type: DataNextStopDepth.type, getData: () => input.nextStopDepth });
  }
  return {
    type: input.type,
    startDate: new Date('2026-08-01T10:00:00.000Z'),
    endDate: new Date(`2026-08-01T10:00:${String(sampleCount - 1).padStart(2, '0')}.000Z`),
    creator: { name: input.id, devices: [] },
    intensityZones: [],
    getID: () => input.id,
    getAllStreams: () => streams,
    getStream: (type: string) => type === XAxisTypes.Time
      ? timeStream
      : streams.find((stream) => stream.type === type),
  } as any;
}

const eventColorService = {
  getActivityColor: (_activities: unknown[], activity: { getID(): string }) => activity.getID() === 'a1' ? '#0088aa' : '#8855cc',
} as any;

describe('event-dive-profile.helper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(ActivityUtilities, 'createUnitStreamsFromStreams').mockImplementation((streams: any[], _type, unitTypes) => {
      const unitConversions = [
        { sourceType: DataDepth.type, unitType: DataDepthFeet.type, factor: 3.28084 },
        { sourceType: DataNextStopDepth.type, unitType: DataNextStopDepthFeet.type, factor: 3.28084 },
        {
          sourceType: DataDiveAscentRate.type,
          unitType: DataDiveAscentRateFeetPerSecond.type,
          factor: 3.28084,
        },
      ];
      return unitConversions.flatMap(({ sourceType, unitType, factor }) => (
        !unitTypes.includes(unitType)
          ? []
          : streams
            .filter((stream) => stream.type === sourceType)
            .map((stream) => ({
              type: unitType,
              getData: () => stream.getData().map((value: number | null) => (
                value === null ? null : value * factor
              )),
            }))
      )) as any;
    });
  });

  it('recognizes every canonical Diving-group activity and rejects unrelated sports', () => {
    const divingTypes = [
      ActivityTypes.Diving,
      ActivityTypes.ScubaDiving,
      ActivityTypes.FreeDiving,
      ActivityTypes.Snorkeling,
      ActivityTypes.Mermaiding,
    ];

    divingTypes.forEach((type, index) => {
      expect(isDivingActivity(buildActivity({ id: `d${index}`, type, depth: [0, 1] }))).toBe(true);
    });
    expect(isDivingActivity(buildActivity({ id: 'run', type: ActivityTypes.Running, depth: [0, 1] }))).toBe(false);
  });

  it('requires finite non-negative depth samples', () => {
    const noDepth = buildActivity({ id: 'no-depth', type: ActivityTypes.Mermaiding });
    const invalidStream = buildActivity({ id: 'invalid', type: ActivityTypes.Snorkeling, depth: [null, -1] });
    const usableStream = buildActivity({ id: 'usable', type: ActivityTypes.FreeDiving, depth: [0, null, 2.4] });

    expect(hasEventDiveProfileData([noDepth, invalidStream])).toBe(false);
    expect(hasEventDiveProfileData([noDepth, usableStream])).toBe(true);
  });

  it('builds the pinned depth panel and optional standard-chart overlays in preferred units', () => {
    const activities = [
      buildActivity({
        id: 'a1',
        type: ActivityTypes.Snorkeling,
        depth: [0, 1, null, 3.2],
        temperature: [24, 23.8, null, 23.5],
        heartRate: [90, 94, null, 101],
        airTimeRemaining: [420, 390, 360, 4_294_961_197],
        diveAscentRate: [0.02, 0.03, null, 0.04],
        noDecompressionLimit: [1800, 1740, 1680, 1620],
        nextStopDepth: [6, 6, 3, 3],
      }),
      buildActivity({ id: 'a2', type: ActivityTypes.Mermaiding, depth: [0, -1, 2.5, 2.8] }),
      buildActivity({ id: 'run', type: ActivityTypes.Running, depth: [0, 9] }),
    ];

    const model = buildEventDiveProfile({
      activities,
      userUnitSettings: unitSettings(SwimPaceUnits.MinutesPer100Yard),
      eventColorService,
    });

    expect(model).not.toBeNull();
    expect(model!.activities.map((activity) => activity.getID())).toEqual(['a1', 'a2']);
    expect(model!.depthPanel.dataType).toBe(DataDepthFeet.type);
    expect(model!.depthPanel.series).toHaveLength(2);
    expect(model!.overlayPanels.map((panel) => panel.dataType)).toHaveLength(6);
    expect(model!.overlayPanels.map((panel) => panel.dataType)).toEqual(expect.arrayContaining([
      DataTemperature.type,
      DataHeartRate.type,
      DataNoDecompressionLimit.type,
      DataAirTimeRemaining.type,
      DataNextStopDepthFeet.type,
      DataDiveAscentRateFeetPerSecond.type,
    ]));
    expect(model!.overlayPanels.map((panel) => panel.dataType)).not.toEqual(expect.arrayContaining([
      DataNextStopDepth.type,
      DataDiveAscentRate.type,
    ]));
    expect(model!.overlayPanels.every((panel) => panel.series.length === 1)).toBe(true);
    expect(getEventChartSeriesY(
      model!.overlayPanels.find((panel) => panel.dataType === DataAirTimeRemaining.type)!.series[0],
      3,
    )).toBe(4_294_961_197);
  });

  it('keeps missing and invalid depth samples as gaps for the standard chart panel', () => {
    const activity = buildActivity({
      id: 'a1',
      type: ActivityTypes.FreeDiving,
      depth: [0, 1.5, null, 4.25],
      temperature: [22, 21.5, null, 21],
      heartRate: [88, 92, null, 98],
    });
    const model = buildEventDiveProfile({
      activities: [activity],
      userUnitSettings: unitSettings(SwimPaceUnits.MinutesPer100Meter),
      eventColorService,
    });
    const depthSeries = model!.depthPanel.series[0];
    expect(getEventChartSeriesY(depthSeries, 0)).toBe(0);
    expect(getEventChartSeriesY(depthSeries, 1)).toBe(1.5);
    expect(getEventChartSeriesY(depthSeries, 2)).toBeNull();
    expect(getEventChartSeriesY(depthSeries, 3)).toBe(4.25);
  });
});
