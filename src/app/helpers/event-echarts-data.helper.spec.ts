import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityUtilities,
  DataAltitude,
  DataCadence,
  DataDistance,
  DataDuration,
  DataGradeAdjustedSpeed,
  DataHeartRate,
  DataPace,
  DataPower,
  DataSpeed,
  DynamicDataLoader,
  LapTypes,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import {
  buildEventChartPanels,
  buildEventLapMarkers,
  buildEventLegendItems,
  buildEventZoomOverviewData,
  normalizeEventLapType
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

  it('orders event panels with the canonical priority override', () => {
    vi.spyOn(ActivityUtilities, 'createUnitStreamsFromStreams').mockReturnValue([] as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataTypes').mockImplementation((types: any) => types as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataType').mockImplementation((type: any) => [type] as any);
    vi.spyOn(DynamicDataLoader, 'getNonUnitBasedDataTypes').mockReturnValue([DataDistance.type]);
    vi.spyOn(DynamicDataLoader, 'getDataClassFromDataType').mockImplementation((type: string) => ({
      displayType: type,
      type,
      unit: type === DataHeartRate.type ? 'bpm' : 'u'
    } as any));

    const streamsByType = new Map<string, any>([
      [DataAltitude.type, { type: DataAltitude.type, getData: () => [10, 11, 12] }],
      [DataCadence.type, { type: DataCadence.type, getData: () => [80, 82, 84] }],
      [DataGradeAdjustedSpeed.type, { type: DataGradeAdjustedSpeed.type, getData: () => [9.5, 9.7, 9.9] }],
      [DataHeartRate.type, { type: DataHeartRate.type, getData: () => [130, 132, 134] }],
      [DataPace.type, { type: DataPace.type, getData: () => [300, 301, 302] }],
      [DataPower.type, { type: DataPower.type, getData: () => [200, 210, 220] }],
      [DataSpeed.type, { type: DataSpeed.type, getData: () => [10, 10.2, 10.4] }],
      [XAxisTypes.Time, { type: XAxisTypes.Time, getData: () => [0, 1, 2] }],
    ]);

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      type: 'Running',
      getID: () => 'a-order',
      getAllStreams: () => [
        streamsByType.get(DataAltitude.type),
        streamsByType.get(DataCadence.type),
        streamsByType.get(DataGradeAdjustedSpeed.type),
        streamsByType.get(DataHeartRate.type),
        streamsByType.get(DataPace.type),
        streamsByType.get(DataPower.type),
        streamsByType.get(DataSpeed.type),
      ],
      getStream: (type: string) => streamsByType.get(type) ?? null,
    } as any;

    const panels = buildEventChartPanels({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Duration,
      showAllData: false,
      dataTypesToUse: [
        DataAltitude.type,
        DataCadence.type,
        DataGradeAdjustedSpeed.type,
        DataHeartRate.type,
        DataPace.type,
        DataPower.type,
        DataSpeed.type,
      ],
      userUnitSettings: {} as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(panels.map((panel) => panel.dataType)).toEqual([
      DataHeartRate.type,
      DataPace.type,
      DataSpeed.type,
      DataGradeAdjustedSpeed.type,
      DataPower.type,
      DataCadence.type,
      DataAltitude.type,
    ]);
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

  it('builds normalized lightweight zoom overview data from visible panels', () => {
    const overview = buildEventZoomOverviewData([
      {
        dataType: DataPower.type,
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 100,
        series: [
          {
            id: 'a1::power',
            activityID: 'a1',
            activityName: 'Garmin',
            color: '#ff0000',
            streamType: DataPower.type,
            displayName: 'Power',
            unit: 'W',
            points: [
              { x: 0, y: 100, time: 0 },
              { x: 50, y: 200, time: 50 },
              { x: 100, y: 150, time: 100 },
            ],
          }
        ]
      }
    ] as any, { start: 0, end: 100 }, 5);

    expect(overview).toHaveLength(5);
    expect(overview[0][0]).toBe(0);
    expect(overview[4][0]).toBe(100);
    expect(Math.max(...overview.map((point) => point[1]))).toBeGreaterThan(0);
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

  it('orders panels by canonical datatype order with event priority overrides', () => {
    vi.spyOn(ActivityUtilities, 'createUnitStreamsFromStreams').mockReturnValue([] as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataTypes').mockImplementation((types: any) => types as any);
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataTypesFromDataType').mockImplementation((type: any) => [type] as any);
    vi.spyOn(DynamicDataLoader, 'getNonUnitBasedDataTypes').mockReturnValue([DataDistance.type]);
    vi.spyOn(DynamicDataLoader, 'getDataClassFromDataType').mockImplementation((type: string) => {
      if (type === DataDistance.type) {
        return { displayType: 'Distance', type: 'Distance', unit: 'km' } as any;
      }
      if (type === DataPower.type) {
        return { displayType: 'Power', type: 'Power', unit: 'W' } as any;
      }
      return { displayType: 'Speed', type: 'Speed', unit: 'km/h' } as any;
    });

    const powerStream = {
      type: DataPower.type,
      getData: () => [100, 101, 102],
    } as any;
    const speedStream = {
      type: DataSpeed.type,
      getData: () => [10, 11, 12],
    } as any;
    const timeStream = {
      type: XAxisTypes.Time,
      getData: () => [0, 1, 2],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      type: 'Running',
      getID: () => 'a-order',
      getAllStreams: () => [powerStream, speedStream],
      getStream: (type: string) => (type === XAxisTypes.Time ? timeStream : null),
    } as any;

    const panels = buildEventChartPanels({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Duration,
      showAllData: false,
      dataTypesToUse: [DataSpeed.type, DataPower.type],
      userUnitSettings: {} as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(panels.map((panel) => panel.dataType)).toEqual([
      DataSpeed.type,
      DataPower.type,
    ]);
  });

  it('maps lap markers in distance mode to nearest distance points', () => {
    const createLapData = (
      type: string,
      rawValue: number,
      displayValue: string,
      displayUnit = ''
    ) => ({
      getType: () => type,
      getValue: () => rawValue,
      getDisplayValue: () => displayValue,
      getDisplayUnit: () => displayUnit,
    });
    const createDurationData = (seconds: number, compactValue: string) => ({
      getType: () => DataDuration.type,
      getValue: () => seconds,
      getDisplayValue: (_showDays = false, _showSeconds = true, _showMilliseconds = false, useColonFormat = false) => (
        useColonFormat ? compactValue : compactValue
      ),
      getDisplayUnit: () => '',
    });
    const distanceStream = {
      getData: () => [0, 100, 250, 400],
    } as any;
    const timeStream = {
      getData: () => [0, 10, 20, 30],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      getID: () => 'a1',
      getLaps: () => [
        {
          endDate: new Date('2024-01-01T00:00:12.000Z'),
          type: 'auto',
          getDuration: () => createDurationData(12, '00:12'),
          getDistance: () => createLapData(DataDistance.type, 1000, '1.00', 'km'),
          getStat: (type: string) => {
            switch (type) {
              case 'Average Pace':
                return createLapData(type, 300, '05:00', 'min/km');
              case 'Average Heart Rate':
                return createLapData(type, 150, '150', 'bpm');
              case 'Average Power':
                return createLapData(type, 250, '250', 'W');
              case 'Ascent':
                return createLapData(type, 10, '10', 'm');
              case 'Descent':
                return createLapData(type, 4, '4', 'm');
              case 'Average Cadence':
                return createLapData(type, 172, '172', 'spm');
              default:
                return undefined;
            }
          },
        },
        {
          endDate: new Date('2024-01-01T00:00:29.000Z'),
          type: 'auto',
          getDuration: () => createDurationData(17, '00:17'),
          getDistance: () => createLapData(DataDistance.type, 1300, '1.30', 'km'),
          getStat: () => undefined,
        },
        {
          endDate: new Date('2024-01-01T00:00:35.000Z'),
          type: 'auto',
          getDuration: () => createDurationData(6, '00:06'),
          getDistance: () => createLapData(DataDistance.type, 300, '0.30', 'km'),
          getStat: () => undefined,
        },
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
    expect(markers[0]).toEqual(expect.objectContaining({
      lapNumber: 1,
      activityID: 'a1',
      activityName: 'Garmin',
      lapType: 'Autolap',
      tooltipTitle: 'Lap 1',
      tooltipDetails: [
        { label: 'Duration', value: '00:12' },
        { label: 'Distance', value: '1.00km' },
        { label: 'Avg Pace', value: '05:00min/km' },
        { label: 'Avg Heart Rate', value: '150bpm' },
        { label: 'Avg Power', value: '250W' },
        { label: 'Ascent', value: '10m' },
        { label: 'Descent', value: '4m' },
        { label: 'Avg Cadence', value: '172spm' },
      ],
    }));
  });

  it('normalizes lap type aliases so chart lap filtering keeps auto laps visible', () => {
    expect(normalizeEventLapType('auto')).toBe('Autolap');
    expect(normalizeEventLapType('Autolap')).toBe('Autolap');

    const distanceStream = {
      getData: () => [0, 100, 250, 400],
    } as any;
    const timeStream = {
      getData: () => [0, 10, 20, 30],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      getID: () => 'a1',
      getLaps: () => [
        {
          endDate: new Date('2024-01-01T00:00:12.000Z'),
          type: 'auto',
          getDuration: () => ({
            getType: () => DataDuration.type,
            getValue: () => 12,
            getDisplayValue: () => '00:12',
            getDisplayUnit: () => '',
          }),
          getDistance: () => undefined,
          getStat: () => undefined,
        },
        {
          endDate: new Date('2024-01-01T00:00:29.000Z'),
          type: 'auto',
          getDuration: () => ({
            getType: () => DataDuration.type,
            getValue: () => 17,
            getDisplayValue: () => '00:17',
            getDisplayUnit: () => '',
          }),
          getDistance: () => undefined,
          getStat: () => undefined,
        },
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
      lapTypes: ['Autolap'] as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(markers).toHaveLength(1);
    expect(markers[0].lapType).toBe('Autolap');
    expect(markers[0].activityName).toBe('Garmin');
  });

  it('filters session end laps from chart markers even when configured', () => {
    const timeStream = {
      getData: () => [0, 12],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      getID: () => 'a1',
      getLaps: () => [
        {
          endDate: new Date('2024-01-01T00:00:12.000Z'),
          type: LapTypes.session_end,
          getDuration: () => ({
            getType: () => DataDuration.type,
            getValue: () => 12,
            getDisplayValue: () => '00:12',
            getDisplayUnit: () => '',
          }),
          getDistance: () => undefined,
          getStat: () => undefined,
        },
      ],
      getStream: (type: string) => {
        if (type === XAxisTypes.Time) {
          return timeStream;
        }
        return null;
      },
    } as any;

    const markers = buildEventLapMarkers({
      selectedActivities: [activity],
      allActivities: [activity],
      xAxisType: XAxisTypes.Time,
      lapTypes: [LapTypes.session_end] as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(markers).toEqual([]);
  });

  it('places chart lap markers using lap end index when lap dates collapse to activity start', () => {
    const distanceStream = {
      getData: () => [0, 100, 250, 400],
    } as any;
    const timeStream = {
      getData: () => [0, 10, 20, 30],
    } as any;

    const activity = {
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      creator: { name: 'Garmin' },
      getID: () => 'a1',
      getLaps: () => [
        {
          endDate: new Date('2024-01-01T00:00:00.000Z'),
          type: LapTypes.Manual,
          getEndIndex: () => 2,
          getDuration: () => ({
            getType: () => DataDuration.type,
            getValue: () => 20,
            getDisplayValue: () => '00:20',
            getDisplayUnit: () => '',
          }),
          getDistance: () => undefined,
          getStat: () => undefined,
        },
        {
          endDate: new Date('2024-01-01T00:00:00.000Z'),
          type: LapTypes.Manual,
          getEndIndex: () => 3,
          getDuration: () => ({
            getType: () => DataDuration.type,
            getValue: () => 10,
            getDisplayValue: () => '00:10',
            getDisplayUnit: () => '',
          }),
          getDistance: () => undefined,
          getStat: () => undefined,
        },
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
      lapTypes: [LapTypes.Manual] as any,
      eventColorService: {
        getActivityColor: () => '#ff0000'
      } as any,
    });

    expect(markers).toHaveLength(1);
    expect(markers[0].lapType).toBe(LapTypes.Manual);
    expect(markers[0].xValue).toBe(250);
  });
});
