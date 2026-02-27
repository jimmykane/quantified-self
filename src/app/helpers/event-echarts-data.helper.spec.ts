import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityUtilities,
  DataDistance,
  DataDuration,
  DataPower,
  DynamicDataLoader,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import {
  buildEventChartPanels,
  buildEventLapMarkers,
  buildEventLegendItems
} from './event-echarts-data.helper';
import { AppDataColors } from '../services/color/app.data.colors';

describe('event-echarts-data.helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds full-resolution points for selected data types', () => {
    vi.spyOn(ActivityUtilities, 'createUnitStreamsFromStreams').mockReturnValue([] as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataTypes').mockImplementation((types: any) => types as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataType').mockImplementation((type: any) => [type] as any);
    vi.spyOn(DynamicDataLoader, 'getNonUnitBasedDataTypes').mockReturnValue([DataDistance.type]);
    vi.spyOn(DynamicDataLoader, 'getDataClassFromDataType').mockReturnValue({
      displayType: 'Power',
      type: 'Power',
      unit: 'W'
    } as any);

    const stream = {
      type: DataPower.type,
      getData: () => [100, 101, 102, 103, 104],
    } as any;
    const timeStream = {
      type: XAxisTypes.Time,
      getData: () => [0, 1, 2, 3, 4],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      type: 'Running',
      getID: () => 'a1',
      getAllStreams: () => [stream],
      getStream: (type: string) => (type === XAxisTypes.Time ? timeStream : null),
    } as any;

    const panels = buildEventChartPanels({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Duration,
      showAllData: false,
      dataTypesToUse: [DataPower.type],
      userUnitSettings: {} as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(panels).toHaveLength(1);
    expect(panels[0].colorGroupKey).toBe('Power');
    expect(panels[0].series).toHaveLength(1);
    expect(panels[0].series[0].points).toHaveLength(5);
    expect(panels[0].series[0].points.map((point) => point.x)).toEqual([0, 1, 2, 3, 4]);
    expect(panels[0].series[0].color).toBe((AppDataColors as any).Power);
  });

  it('keeps showAllData semantics and includes streams when enabled', () => {
    vi.spyOn(ActivityUtilities, 'createUnitStreamsFromStreams').mockReturnValue([] as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataTypes').mockImplementation(() => [] as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataType').mockImplementation((type: any) => [type] as any);
    vi.spyOn(DynamicDataLoader, 'getNonUnitBasedDataTypes').mockReturnValue([DataDistance.type]);
    vi.spyOn(DynamicDataLoader, 'getDataClassFromDataType').mockReturnValue({
      displayType: 'Power',
      type: 'Power',
      unit: 'W'
    } as any);

    const stream = {
      type: DataPower.type,
      getData: () => [1, 2, 3],
    } as any;
    const timeStream = {
      type: XAxisTypes.Time,
      getData: () => [0, 5, 10],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Stryd' },
      type: 'Running',
      getID: () => 'a2',
      getAllStreams: () => [stream],
      getStream: (type: string) => (type === XAxisTypes.Time ? timeStream : null),
    } as any;

    const withShowAllData = buildEventChartPanels({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Time,
      showAllData: true,
      dataTypesToUse: [],
      userUnitSettings: {} as any,
      eventColorService: {
        getActivityColor: () => '#00ff00'
      } as any,
    });

    expect(withShowAllData).toHaveLength(1);
    expect(withShowAllData[0].series[0].points).toHaveLength(3);
    expect(withShowAllData[0].series[0].points[0].time).toBe(activity.startDate.getTime());
  });

  it('builds stable legend items for activities', () => {
    const activityA = {
      creator: { name: 'Garmin' },
      getID: () => 'a',
    } as any;
    const activityB = {
      creator: { name: 'Coros' },
      getID: () => 'b',
    } as any;

    const legendItems = buildEventLegendItems([activityA, activityB], {
      getActivityColor: (_activities: any[], activity: any) => (activity.getID() === 'a' ? '#111111' : '#222222')
    } as any);

    expect(legendItems).toEqual([
      { activityID: 'a', label: 'Garmin', color: '#111111' },
      { activityID: 'b', label: 'Coros', color: '#222222' },
    ]);
  });

  it('applies deterministic multi-activity color variants per datatype panel', () => {
    vi.spyOn(ActivityUtilities, 'createUnitStreamsFromStreams').mockReturnValue([] as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataTypes').mockImplementation((types: any) => types as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataType').mockImplementation((type: any) => [type] as any);
    vi.spyOn(DynamicDataLoader, 'getNonUnitBasedDataTypes').mockReturnValue([DataDistance.type]);
    vi.spyOn(DynamicDataLoader, 'getDataClassFromDataType').mockReturnValue({
      displayType: 'Power',
      type: 'Power',
      unit: 'W'
    } as any);

    const timeStream = {
      type: XAxisTypes.Time,
      getData: () => [0, 1, 2],
    } as any;
    const stream = {
      type: DataPower.type,
      getData: () => [100, 120, 140],
    } as any;

    const activityA = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      type: 'Running',
      getID: () => 'a1',
      getAllStreams: () => [stream],
      getStream: (type: string) => (type === XAxisTypes.Time ? timeStream : null),
    } as any;
    const activityB = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Coros' },
      type: 'Running',
      getID: () => 'a2',
      getAllStreams: () => [stream],
      getStream: (type: string) => (type === XAxisTypes.Time ? timeStream : null),
    } as any;

    const panels = buildEventChartPanels({
      selectedActivities: [activityA, activityB],
      allActivities: [activityA, activityB],
      xAxisType: XAxisTypes.Duration,
      showAllData: false,
      dataTypesToUse: [DataPower.type],
      userUnitSettings: {} as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(panels).toHaveLength(1);
    expect(panels[0].series).toHaveLength(2);
    expect(panels[0].series[0].color).toBe((AppDataColors as any).Power_0);
    expect(panels[0].series[1].color).toBe((AppDataColors as any).Power_1);
  });

  it('never renders blacklisted duration/time streams', () => {
    vi.spyOn(ActivityUtilities, 'createUnitStreamsFromStreams').mockReturnValue([] as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataTypes').mockImplementation((types: any) => types as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataType').mockImplementation((type: any) => [type] as any);
    vi.spyOn(DynamicDataLoader, 'getNonUnitBasedDataTypes').mockReturnValue([DataDistance.type]);
    vi.spyOn(DynamicDataLoader, 'getDataClassFromDataType').mockImplementation((type: string) => ({
      displayType: type,
      type,
      unit: type === DataDuration.type ? 's' : 'W'
    } as any));

    const durationStream = {
      type: DataDuration.type,
      getData: () => [1, 2, 3],
    } as any;
    const powerStream = {
      type: DataPower.type,
      getData: () => [100, 101, 102],
    } as any;
    const timeStream = {
      type: XAxisTypes.Time,
      getData: () => [0, 1, 2],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      type: 'Running',
      getID: () => 'a1',
      getAllStreams: () => [durationStream, powerStream],
      getStream: (type: string) => (type === XAxisTypes.Time ? timeStream : null),
    } as any;

    const panels = buildEventChartPanels({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Duration,
      showAllData: true,
      dataTypesToUse: [DataDuration.type, DataPower.type],
      userUnitSettings: {} as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(panels.map((panel) => panel.dataType)).toEqual([DataPower.type]);
  });

  it('does not coerce null time values to zero during point mapping', () => {
    vi.spyOn(ActivityUtilities, 'createUnitStreamsFromStreams').mockReturnValue([] as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataTypes').mockImplementation((types: any) => types as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataType').mockImplementation((type: any) => [type] as any);
    vi.spyOn(DynamicDataLoader, 'getNonUnitBasedDataTypes').mockReturnValue([DataDistance.type]);
    vi.spyOn(DynamicDataLoader, 'getDataClassFromDataType').mockReturnValue({
      displayType: 'Power',
      type: 'Power',
      unit: 'W'
    } as any);

    const stream = {
      type: DataPower.type,
      getData: () => [100, 101, 102, 103, 104, 105],
    } as any;
    const timeStream = {
      type: XAxisTypes.Time,
      getData: () => [0, 1, 2, null, null, 5],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      type: 'Running',
      getID: () => 'a-null-time',
      getAllStreams: () => [stream],
      getStream: (type: string) => (type === XAxisTypes.Time ? timeStream : null),
    } as any;

    const panels = buildEventChartPanels({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Duration,
      showAllData: false,
      dataTypesToUse: [DataPower.type],
      userUnitSettings: {} as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(panels).toHaveLength(1);
    expect(panels[0].series[0].points.map((point) => point.x)).toEqual([0, 1, 2, 5]);
    expect(panels[0].series[0].points.map((point) => point.y)).toEqual([100, 101, 102, 105]);
  });

  it('maps lap markers in distance mode to nearest distance points', () => {
    const distanceStream = {
      getData: () => [0, 100, 250, 400],
    } as any;
    const timeStream = {
      getData: () => [0, 10, 20, 30],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      getID: () => 'a1',
      getLaps: () => [
        { endDate: new Date('2024-01-01T00:00:12.000Z'), type: 'auto' },
        { endDate: new Date('2024-01-01T00:00:29.000Z'), type: 'auto' },
        { endDate: new Date('2024-01-01T00:00:35.000Z'), type: 'auto' },
      ],
      getStream: (type: string) => {
        if (type === DataDistance.type) {
          return distanceStream;
        }
        if (type === XAxisTypes.Time) {
          return timeStream;
        }
        return null;
      },
    } as any;

    const markers = buildEventLapMarkers({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Distance,
      lapTypes: [] as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(markers).toHaveLength(2);
    expect(markers.map((marker) => marker.xValue)).toEqual([100, 400]);
  });
});
