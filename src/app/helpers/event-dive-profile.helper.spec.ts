import {
  ActivityUtilities,
  ActivityTypes,
  DataDepth,
  DataDepthFeet,
  DataHeartRate,
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
}) {
  const depth = input.depth || [];
  const sampleCount = Math.max(depth.length, input.temperature?.length || 0, input.heartRate?.length || 0, 1);
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
      if (!unitTypes.includes(DataDepthFeet.type)) {
        return [];
      }
      return streams
        .filter((stream) => stream.type === DataDepth.type)
        .map((stream) => ({
          type: DataDepthFeet.type,
          getData: () => stream.getData().map((value: number | null) => value === null ? null : value * 3.28084),
        })) as any;
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
    expect(model!.temperaturePanel?.series).toHaveLength(1);
    expect(model!.heartRatePanel?.series).toHaveLength(1);
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
