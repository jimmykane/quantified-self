import {
  ActivityUtilities,
  ActivityTypes,
  DataDepth,
  DataDepthFeet,
  DataDepthMax,
  DataHeartRate,
  DataTemperature,
  DistanceUnits,
  SwimPaceUnits,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEventDiveProfile,
  buildEventDiveProfileChartOption,
  hasEventDiveProfileData,
  isDivingActivity,
} from './event-dive-profile.helper';

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
  maximumDepth?: number;
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
  const stats = new Map<string, DataDepthMax>();
  if (input.maximumDepth !== undefined) {
    stats.set(DataDepthMax.type, new DataDepthMax(input.maximumDepth));
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
    getStat: (type: string) => stats.get(type),
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

  it('requires finite non-negative depth samples instead of only a maximum-depth stat', () => {
    const statOnly = buildActivity({ id: 'stat', type: ActivityTypes.Mermaiding, maximumDepth: 4.2 });
    const invalidStream = buildActivity({ id: 'invalid', type: ActivityTypes.Snorkeling, depth: [null, -1] });
    const usableStream = buildActivity({ id: 'usable', type: ActivityTypes.FreeDiving, depth: [0, null, 2.4] });

    expect(hasEventDiveProfileData([statOnly, invalidStream])).toBe(false);
    expect(hasEventDiveProfileData([statOnly, usableStream])).toBe(true);
  });

  it('uses the deepest valid value across summary stats and unit-converted streams', () => {
    const activities = [
      buildActivity({
        id: 'a1',
        type: ActivityTypes.Snorkeling,
        depth: [0, 1, null, 3.2],
        maximumDepth: 2,
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
    expect(model!.maximumDepth).toBeCloseTo(10.499, 3);
    expect(model!.temperaturePanel?.series).toHaveLength(1);
    expect(model!.heartRatePanel?.series).toHaveLength(1);
  });

  it('keeps a larger summary maximum visible on the inverted zero-top chart with opt-in overlays', () => {
    const activity = buildActivity({
      id: 'a1',
      type: ActivityTypes.FreeDiving,
      depth: [0, 1.5, null, 4.25],
      maximumDepth: 5,
      temperature: [22, 21.5, null, 21],
      heartRate: [88, 92, null, 98],
    });
    const model = buildEventDiveProfile({
      activities: [activity],
      userUnitSettings: unitSettings(SwimPaceUnits.MinutesPer100Meter),
      eventColorService,
    });
    expect(model?.maximumDepth).toBe(5);

    const depthOnlyOption = buildEventDiveProfileChartOption({
      model: model!,
      showTemperature: false,
      showHeartRate: false,
      darkTheme: false,
      isMobile: false,
      useAnimations: false,
    }) as any;
    expect(depthOnlyOption.yAxis).toHaveLength(1);
    expect(depthOnlyOption.yAxis[0]).toMatchObject({ inverse: true, min: 0 });
    expect(depthOnlyOption.series).toHaveLength(1);
    expect(depthOnlyOption.series[0].connectNulls).toBe(false);
    expect(depthOnlyOption.series[0].data).toContainEqual([2, null]);
    expect(depthOnlyOption.yAxis[0].max).toBeGreaterThan(5);
    expect(depthOnlyOption.series[0].markLine.data).toEqual([{ yAxis: 5 }]);

    const overlayOption = buildEventDiveProfileChartOption({
      model: model!,
      showTemperature: true,
      showHeartRate: true,
      darkTheme: true,
      isMobile: true,
      useAnimations: true,
    }) as any;
    expect(overlayOption.yAxis).toHaveLength(3);
    expect(overlayOption.series).toHaveLength(3);

    const tooltipSeries = overlayOption.series as Array<{
      id: string;
      name: string;
      data: Array<[number, number | null]>;
    }>;
    const tooltipHtml = overlayOption.tooltip.formatter(tooltipSeries.map((series) => ({
      axisValue: 3,
      seriesId: series.id,
      seriesName: series.name,
      marker: '<span></span>',
      value: series.data[3],
    })));
    expect(tooltipHtml).toContain(`4.25 ${model!.depthPanel.unit}`);
    expect(tooltipHtml).toContain(`21.00 ${model!.temperaturePanel!.unit}`);
    expect(tooltipHtml).toContain(`98 ${model!.heartRatePanel!.unit}`);
  });
});
