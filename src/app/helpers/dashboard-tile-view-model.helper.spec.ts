import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAscent,
  DataDistance,
  DataRecoveryTime,
  DateRanges,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { buildDashboardCartesianPoints } from './dashboard-echarts-cartesian.helper';
import { buildAggregatedChartRows } from './aggregated-chart-row.helper';
import {
  buildDashboardTileViewModels,
} from './dashboard-tile-view-model.helper';
import {
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
} from './dashboard-special-chart-types';
import type { EventStatAggregationResult } from '@shared/event-stat-aggregation.types';

function makeEvent(options: {
  id: string;
  startDate: string;
  endDate?: string;
  durationSeconds?: number;
  activityTypes: ActivityTypes[];
  stats?: Record<string, number | undefined>;
  isMerge?: boolean;
}): any {
  const stats = options.stats || {};
  const startTimeMs = new Date(options.startDate).getTime();
  const endDate = options.endDate
    ? new Date(options.endDate)
    : (Number.isFinite(options.durationSeconds)
      ? new Date(startTimeMs + (Number(options.durationSeconds) * 1000))
      : new Date(options.startDate));

  return {
    startDate: new Date(options.startDate),
    endDate,
    isMerge: options.isMerge === true,
    getID: () => options.id,
    getActivityTypesAsArray: () => [...options.activityTypes],
    getDuration: () => ({
      getValue: () => Number.isFinite(options.durationSeconds)
        ? Number(options.durationSeconds)
        : Math.max(0, Math.round((endDate.getTime() - startTimeMs) / 1000)),
    }),
    getStat: (type: string) => {
      if (type === 'activityTypes') {
        return {
          getValue: () => options.activityTypes.map(typeValue => `${typeValue}`),
          getDisplayValue: () => `${options.activityTypes[0] || ''}`,
        };
      }
      const value = stats[type];
      if (value === undefined) {
        return null;
      }
      return {
        getValue: () => value,
      };
    },
  };
}

describe('dashboard-tile-view-model.helper', () => {
  it('should build chart rows compatible with the existing cartesian point helper', () => {
    const aggregation: EventStatAggregationResult = {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Daily,
      buckets: [
        {
          bucketKey: Date.UTC(2024, 0, 1),
          time: Date.UTC(2024, 0, 1),
          totalCount: 2,
          aggregateValue: 20,
          seriesValues: { Running: 5, Cycling: 15 },
          seriesCounts: { Running: 1, Cycling: 1 },
        },
        {
          bucketKey: Date.UTC(2024, 0, 2),
          time: Date.UTC(2024, 0, 2),
          totalCount: 1,
          aggregateValue: 10,
          seriesValues: { Running: 10 },
          seriesCounts: { Running: 1 },
        },
      ],
    };

    const rows = buildAggregatedChartRows(aggregation);
    const points = buildDashboardCartesianPoints({
      data: rows,
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      chartDataTimeInterval: TimeIntervals.Daily,
    });

    expect(rows[0].Running).toBe(5);
    expect(rows[0]['Running-Count']).toBe(1);
    expect(points).toHaveLength(2);
    expect(points[0].value).toBe(20);
    expect(points[1].value).toBe(10);
  });

  it('should build chart tile view models with resolved interval without mutating configured tiles', () => {
    const tile = {
      type: TileTypes.Chart,
      order: 1,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    } as any;

    const viewModels = buildDashboardTileViewModels({
      tiles: [tile],
      events: [
        makeEvent({
          id: 'run-2',
          startDate: '2024-01-03T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataDistance.type]: 10 },
        }),
        makeEvent({
          id: 'run-1',
          startDate: '2024-01-01T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataDistance.type]: 5 },
        }),
      ],
    });

    expect(viewModels).toHaveLength(1);
    expect((viewModels[0] as any).timeInterval).toBe(TimeIntervals.Daily);
    expect(tile.dataTimeInterval).toBe(TimeIntervals.Auto);
  });

  it('should keep intensity-zones tiles as raw sorted event passthrough', () => {
    const events = [
      makeEvent({
        id: 'merge',
        startDate: '2024-01-02T10:00:00.000Z',
        activityTypes: [ActivityTypes.Running],
        isMerge: true,
      }),
      makeEvent({
        id: 'later',
        startDate: '2024-01-03T10:00:00.000Z',
        activityTypes: [ActivityTypes.Running],
      }),
      makeEvent({
        id: 'earlier',
        startDate: '2024-01-01T10:00:00.000Z',
        activityTypes: [ActivityTypes.Running],
      }),
    ];

    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: ChartTypes.IntensityZones,
        dataType: DataDistance.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.ActivityType,
        size: { columns: 1, rows: 1 },
      } as any],
      events,
    });

    const data = (viewModels[0] as any).data;
    expect(data).toHaveLength(2);
    expect(data[0].getID()).toBe('earlier');
    expect(data[1].getID()).toBe('later');
  });

  it('should build form chart tiles as contiguous daily CTL/ATL/TSB points from dashboard events', () => {
    const formTile = {
      type: TileTypes.Chart,
      order: 0,
      chartType: DASHBOARD_FORM_CHART_TYPE as any,
      dataType: 'Training Stress Score',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Monthly,
      size: { columns: 1, rows: 1 },
    } as any;

    const viewModels = buildDashboardTileViewModels({
      tiles: [formTile],
      events: [
        makeEvent({
          id: 'e-1',
          startDate: '2024-01-01T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { 'Training Stress Score': 40 },
        }),
        makeEvent({
          id: 'e-2',
          startDate: '2024-01-03T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { 'Power Training Stress Score': 20 },
        }),
      ],
    });

    const formChart = viewModels[0] as any;
    expect(formChart.timeInterval).toBe(TimeIntervals.Daily);
    expect(Array.isArray(formChart.data)).toBe(true);
    expect(formChart.data).toHaveLength(3);
    expect(formChart.data.map((point: any) => point.trainingStressScore)).toEqual([40, 0, 20]);
    expect(formChart.data.every((point: any) => typeof point.ctl === 'number')).toBe(true);
    expect(formChart.data.every((point: any) => typeof point.atl === 'number')).toBe(true);
    expect(formChart.data.every((point: any) => typeof point.formSameDay === 'number')).toBe(true);
    expect(formChart.data[0].formPriorDay).toBeNull();
  });

  it('should return empty form data when dashboard events have no training stress score stats', () => {
    const formTile = {
      type: TileTypes.Chart,
      order: 0,
      chartType: DASHBOARD_FORM_CHART_TYPE as any,
      dataType: 'Training Stress Score',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Monthly,
      size: { columns: 1, rows: 1 },
    } as any;

    const viewModels = buildDashboardTileViewModels({
      tiles: [formTile],
      events: [
        makeEvent({
          id: 'e-1',
          startDate: '2024-01-01T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataDistance.type]: 8 },
        }),
        makeEvent({
          id: 'e-2',
          startDate: '2024-01-03T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: {},
        }),
      ],
    });

    const formChart = viewModels[0] as any;
    expect(formChart.timeInterval).toBe(TimeIntervals.Daily);
    expect(formChart.data).toEqual([]);
  });

  it('should build map tiles from filtered sorted events and preserve mixed tile ordering and sizes', () => {
    const tiles = [
      {
        type: TileTypes.Map,
        order: 0,
        clusterMarkers: true,
        mapTheme: 'normal',
        showHeatMap: true,
        size: { columns: 2, rows: 1 },
      },
      {
        type: TileTypes.Chart,
        order: 1,
        chartType: ChartTypes.ColumnsHorizontal,
        dataType: DataDistance.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.ActivityType,
        size: { columns: 1, rows: 1 },
      },
    ] as any[];
    const events = [
      makeEvent({
        id: 'later',
        startDate: '2024-01-02T10:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 15 },
      }),
      makeEvent({
        id: 'earlier',
        startDate: '2024-01-01T10:00:00.000Z',
        activityTypes: [ActivityTypes.Running],
        stats: { [DataDistance.type]: 5 },
      }),
    ];

    const viewModels = buildDashboardTileViewModels({
      tiles,
      events,
    });

    expect(viewModels.map(tile => tile.order)).toEqual([0, 1]);
    expect(viewModels[0].size).toEqual({ columns: 2, rows: 1 });
    expect((viewModels[0] as any).events.map((event: any) => event.getID())).toEqual(['earlier', 'later']);
  });

  it('should apply aggregation preferences when building chart tile data', () => {
    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: ChartTypes.ColumnsHorizontal,
        dataType: DataAscent.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.ActivityType,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [
        makeEvent({
          id: 'run',
          startDate: '2024-01-01T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataAscent.type]: 120 },
        }),
        makeEvent({
          id: 'ride',
          startDate: '2024-01-02T10:00:00.000Z',
          activityTypes: [ActivityTypes.Cycling],
          stats: { [DataAscent.type]: 300 },
        }),
      ],
      preferences: {
        removeAscentForEventTypes: [ActivityTypes.Running],
      },
    });

    const rows = (viewModels[0] as any).data;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(ActivityTypes.Cycling);
    expect(rows[0].Total).toBe(300);
  });

  it('should not mutate the caller event array while normalizing tile events', () => {
    const first = makeEvent({
      id: 'later',
      startDate: '2024-01-03T10:00:00.000Z',
      activityTypes: [ActivityTypes.Running],
      stats: { [DataDistance.type]: 10 },
    });
    const second = makeEvent({
      id: 'earlier',
      startDate: '2024-01-01T10:00:00.000Z',
      activityTypes: [ActivityTypes.Running],
      stats: { [DataDistance.type]: 5 },
    });
    const events = [first, second];

    buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: ChartTypes.ColumnsVertical,
        dataType: DataDistance.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
        size: { columns: 1, rows: 1 },
      } as any],
      events,
    });

    expect(events[0]).toBe(first);
    expect(events[1]).toBe(second);
  });

  it('should attach aggregated recovery context to recovery chart tiles from all recovery-enabled events', () => {
    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: ChartTypes.LinesVertical,
        dataType: DataRecoveryTime.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [
        makeEvent({
          id: 'first',
          startDate: '2024-01-01T08:00:00.000Z',
          endDate: '2024-01-01T09:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataRecoveryTime.type]: 1800 },
        }),
        makeEvent({
          id: 'second',
          startDate: '2024-01-02T08:00:00.000Z',
          endDate: '2024-01-02T09:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataRecoveryTime.type]: 3600 },
        }),
      ],
    });

    const recoveryTile = viewModels[0] as any;
    expect(recoveryTile.recoveryNow).toEqual({
      totalSeconds: 5400,
      endTimeMs: Date.UTC(2024, 0, 2, 9, 0, 0),
      segments: [
        {
          totalSeconds: 1800,
          endTimeMs: Date.UTC(2024, 0, 1, 9, 0, 0),
        },
        {
          totalSeconds: 3600,
          endTimeMs: Date.UTC(2024, 0, 2, 9, 0, 0),
        },
      ],
    });
  });

  it('should keep recovery context undefined for non-recovery chart tiles', () => {
    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: ChartTypes.ColumnsVertical,
        dataType: DataDistance.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [
        makeEvent({
          id: 'recovery-event',
          startDate: '2024-01-02T08:00:00.000Z',
          endDate: '2024-01-02T09:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: {
            [DataRecoveryTime.type]: 3600,
            [DataDistance.type]: 10,
          },
        }),
      ],
    });

    expect((viewModels[0] as any).recoveryNow).toBeUndefined();
  });

  it('should attach recovery context for curated recovery chart types even when dataType differs', () => {
    const tiles = [
      {
        type: TileTypes.Chart,
        chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE as any,
        dataType: 'Distance',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Auto,
        order: 0,
        size: { columns: 1, rows: 1 },
        name: 'Recovery',
      } as TileChartSettingsInterface,
    ];
    const events = [
      makeEvent({
        id: 'e-recovery-curated',
        startDate: new Date(Date.UTC(2024, 0, 1, 12, 0, 0)).toISOString(),
        endDate: new Date(Date.UTC(2024, 0, 1, 13, 0, 0)).toISOString(),
        activityTypes: [ActivityTypes.Running],
        stats: { [DataRecoveryTime.type]: 7200 },
      }),
    ];

    const viewModels = buildDashboardTileViewModels({ tiles, events });
    const recoveryTile = viewModels[0] as DashboardChartTileViewModel;

    expect(recoveryTile.recoveryNow).toEqual({
      totalSeconds: 7200,
      endTimeMs: Date.UTC(2024, 0, 1, 13, 0, 0),
      segments: [
        {
          totalSeconds: 7200,
          endTimeMs: Date.UTC(2024, 0, 1, 13, 0, 0),
        },
      ],
    });
  });

  it('should resolve recovery context from events inside the provided dashboard date range', () => {
    const tiles = [
      {
        type: TileTypes.Chart,
        chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE as any,
        dataType: DataRecoveryTime.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Auto,
        order: 0,
        size: { columns: 1, rows: 1 },
        name: 'Recovery',
      } as TileChartSettingsInterface,
    ];
    const oldEvent = makeEvent({
      id: 'old-event',
      startDate: '2024-01-02T08:00:00.000Z',
      endDate: '2024-01-02T09:00:00.000Z',
      activityTypes: [ActivityTypes.Running],
      stats: { [DataRecoveryTime.type]: 1800 },
    });
    const recentEvent = makeEvent({
      id: 'recent-event',
      startDate: '2024-03-05T08:00:00.000Z',
      endDate: '2024-03-05T09:00:00.000Z',
      activityTypes: [ActivityTypes.Running],
      stats: { [DataRecoveryTime.type]: 7200 },
    });

    const viewModels = buildDashboardTileViewModels({
      tiles,
      events: [oldEvent, recentEvent],
      dashboardDateRange: {
        dateRange: DateRanges.custom,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-31T23:59:59.999Z'),
      },
    });
    const recoveryTile = viewModels[0] as DashboardChartTileViewModel;

    expect(recoveryTile.recoveryNow).toEqual({
      totalSeconds: 1800,
      endTimeMs: Date.UTC(2024, 0, 2, 9, 0, 0),
      segments: [
        {
          totalSeconds: 1800,
          endTimeMs: Date.UTC(2024, 0, 2, 9, 0, 0),
        },
      ],
    });
  });
});
