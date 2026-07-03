import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAscent,
  DataDistance,
  DataRecoveryTime,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { buildDashboardCartesianPoints } from './dashboard-echarts-cartesian.helper';
import { buildAggregatedChartRows } from './aggregated-chart-row.helper';
import {
  buildDashboardTileViewModels,
} from './dashboard-tile-view-model.helper';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
} from './dashboard-special-chart-types';
import type { EventStatAggregationResult } from '@shared/event-stat-aggregation.types';
import { POWER_CURVE_STAT_TYPE } from '@shared/power-curve';

function makeEvent(options: {
  id: string;
  startDate: string;
  endDate?: string;
  durationSeconds?: number;
  activityTypes: ActivityTypes[];
  stats?: Record<string, unknown>;
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

  it('should resolve 90d auto date custom charts to weekly buckets', () => {
    const tile = {
      type: TileTypes.Chart,
      order: 1,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      eventFilters: { range: '90d', activityTypes: [] },
      size: { columns: 1, rows: 1 },
    } as any;

    const viewModels = buildDashboardTileViewModels({
      tiles: [tile],
      events: [
        makeEvent({
          id: 'run-jan',
          startDate: '2024-01-01T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataDistance.type]: 10 },
        }),
        makeEvent({
          id: 'run-mar',
          startDate: '2024-03-10T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataDistance.type]: 20 },
        }),
      ],
    });

    expect((viewModels[0] as any).timeInterval).toBe(TimeIntervals.Weekly);
  });

  it('should preserve explicit monthly buckets for 90d custom charts', () => {
    const tile = {
      type: TileTypes.Chart,
      order: 1,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Monthly,
      eventFilters: { range: '90d', activityTypes: [] },
      size: { columns: 1, rows: 1 },
    } as any;

    const viewModels = buildDashboardTileViewModels({
      tiles: [tile],
      events: [
        makeEvent({
          id: 'run-jan',
          startDate: '2024-01-01T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataDistance.type]: 10 },
        }),
        makeEvent({
          id: 'run-mar',
          startDate: '2024-03-10T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataDistance.type]: 20 },
        }),
      ],
    });

    expect((viewModels[0] as any).timeInterval).toBe(TimeIntervals.Monthly);
  });

  it('should build Power Curve tiles from per-tile filtered events', () => {
    const fallbackEvent = makeEvent({
      id: 'fallback-best',
      startDate: '2024-02-01T10:00:00.000Z',
      activityTypes: [ActivityTypes.Cycling],
      stats: {
        [POWER_CURVE_STAT_TYPE]: [{ duration: 300, power: 999 }],
      },
    });
    const cyclingEvent = makeEvent({
      id: 'cycling-event',
      startDate: '2024-03-01T10:00:00.000Z',
      activityTypes: [ActivityTypes.Cycling],
      stats: {
        [POWER_CURVE_STAT_TYPE]: [
          { duration: 60, power: 400 },
          { duration: 300, power: 320 },
        ],
      },
    });
    const runningEvent = makeEvent({
      id: 'running-event',
      startDate: '2024-03-02T10:00:00.000Z',
      activityTypes: [ActivityTypes.Running],
      stats: {
        [POWER_CURVE_STAT_TYPE]: [{ duration: 300, power: 500 }],
      },
    });

    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 7,
        chartType: DASHBOARD_POWER_CURVE_CHART_TYPE as any,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Weekly,
        eventFilters: { range: '1y', activityTypes: [ActivityTypes.Cycling] },
        size: { columns: 1, rows: 1 },
      }] as any,
      events: [fallbackEvent],
      tileEventsByOrder: {
        7: [cyclingEvent, runningEvent],
      },
    });

    const powerCurve = (viewModels[0] as any).powerCurve;
    expect((viewModels[0] as any).chartType).toBe(DASHBOARD_POWER_CURVE_CHART_TYPE);
    expect((viewModels[0] as any).timeInterval).toBe(TimeIntervals.Auto);
    expect(powerCurve.matchedEventCount).toBe(1);
    expect(powerCurve.latestEventId).toBe('cycling-event');
    expect(powerCurve.summaryPoints).toEqual([
      { duration: 60, power: 400 },
      { duration: 300, power: 320 },
    ]);
    expect(powerCurve.series).toHaveLength(1);
    expect(powerCurve.series[0].seriesKey).toBe('latestAndBest');
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

  it('should return empty form chart data when derived form points are missing', () => {
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
          stats: { 'Training Stress Score': 20 },
        }),
      ],
    });

    const formChart = viewModels[0] as any;
    expect(formChart.timeInterval).toBe(TimeIntervals.Weekly);
    expect(formChart.data).toEqual([]);
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
    expect(formChart.timeInterval).toBe(TimeIntervals.Weekly);
    expect(formChart.data).toEqual([]);
  });

  it('should prefer precomputed derived form points when provided', () => {
    const precomputedPoints = [
      {
        time: Date.UTC(2024, 0, 1),
        trainingStressScore: 50,
        ctl: 1,
        atl: 5,
        formSameDay: -4,
        formPriorDay: null,
      },
    ];
    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: DASHBOARD_FORM_CHART_TYPE as any,
        dataType: 'Training Stress Score',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [
        makeEvent({
          id: 'stress-event',
          startDate: '2024-01-01T10:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { 'Training Stress Score': 20 },
        }),
      ],
      derivedMetrics: {
        formPoints: precomputedPoints as any,
      },
    });

    expect((viewModels[0] as any).data).toEqual(precomputedPoints);
  });

  it('should keep full derived form points while preserving absolute latest form point metadata', () => {
    const derivedPoints = [
      {
        time: Date.UTC(2024, 0, 2),
        trainingStressScore: 20,
        ctl: 1.5,
        atl: 2.5,
        formSameDay: -1,
        formPriorDay: null,
      },
      {
        time: Date.UTC(2024, 2, 5),
        trainingStressScore: 30,
        ctl: 2.1,
        atl: 3.5,
        formSameDay: -1.4,
        formPriorDay: -1,
      },
    ];
    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: DASHBOARD_FORM_CHART_TYPE as any,
        dataType: 'Training Stress Score',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [
        makeEvent({
          id: 'january',
          startDate: '2024-01-02T12:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { 'Training Stress Score': 20 },
        }),
        makeEvent({
          id: 'march',
          startDate: '2024-03-05T12:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { 'Training Stress Score': 30 },
        }),
      ],
      derivedMetrics: {
        formPoints: derivedPoints as any,
      },
    });

    expect((viewModels[0] as any).data).toEqual(derivedPoints);
    expect((viewModels[0] as any).absoluteLatestFormPoint).toEqual(derivedPoints[1]);
  });

  it('should not clip derived form points to event tile windows', () => {
    const beforeWeekTimeMs = Date.UTC(2024, 0, 1);
    const insideWeekTimeMs = Date.UTC(2024, 0, 8);
    const derivedPoints = [
      {
        time: beforeWeekTimeMs,
        trainingStressScore: 20,
        ctl: 1.5,
        atl: 2.5,
        formSameDay: -1,
        formPriorDay: null,
      },
      {
        time: insideWeekTimeMs,
        trainingStressScore: 30,
        ctl: 2.1,
        atl: 3.5,
        formSameDay: -1.4,
        formPriorDay: -1,
      },
    ];

    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: DASHBOARD_FORM_CHART_TYPE as any,
        dataType: 'Training Stress Score',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [],
      derivedMetrics: {
        formPoints: derivedPoints as any,
      },
    });

    const formData = (viewModels[0] as any).data as Array<{ time: number; trainingStressScore: number }>;
    expect(formData).toEqual(derivedPoints);
    expect((viewModels[0] as any).absoluteLatestFormPoint).toEqual(derivedPoints[1]);
  });

  it('should preserve persisted display settings on derived curated chart view models', () => {
    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE as any,
        dataType: 'Training Stress Score',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Weekly,
        size: { columns: 1, rows: 1 },
        displaySettings: { derivedChartRange: '12w' },
      } as any],
      events: [],
      derivedMetrics: {
        intensityDistribution: { weeks: [] } as any,
      },
    });

    expect((viewModels[0] as any).displaySettings).toEqual({ derivedChartRange: '12w' });
  });

  it('should not synthesize zero-load form decay points', () => {
    const derivedPoints = [
      {
        time: Date.UTC(2024, 0, 2),
        trainingStressScore: 20,
        ctl: 1.5,
        atl: 2.5,
        formSameDay: -1,
        formPriorDay: null,
      },
      {
        time: Date.UTC(2024, 0, 3),
        trainingStressScore: 30,
        ctl: 2.1,
        atl: 3.5,
        formSameDay: -1.4,
        formPriorDay: -1,
      },
    ];

    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: DASHBOARD_FORM_CHART_TYPE as any,
        dataType: 'Training Stress Score',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [],
      derivedMetrics: {
        formPoints: derivedPoints as any,
      },
    });

    const formData = (viewModels[0] as any).data as Array<{ time: number; trainingStressScore: number }>;
    expect(formData).toEqual(derivedPoints);
    expect((viewModels[0] as any).absoluteLatestFormPoint).toEqual(derivedPoints[1]);
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

  it('should keep custom recovery data-type tiles free from curated recovery context', () => {
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

    const recoveryTile = viewModels[0] as DashboardChartTileViewModel;
    expect(recoveryTile.recoveryNow).toBeUndefined();
  });

  it('should treat legacy pie recovery tiles as curated recovery tiles and use derived recovery context', () => {
    const derivedRecoveryContext = {
      totalSeconds: 9000,
      endTimeMs: Date.UTC(2024, 2, 5, 9, 0, 0),
      segments: [
        {
          totalSeconds: 1800,
          endTimeMs: Date.UTC(2024, 0, 1, 9, 0, 0),
        },
        {
          totalSeconds: 7200,
          endTimeMs: Date.UTC(2024, 2, 5, 9, 0, 0),
        },
      ],
    };
    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: ChartTypes.Pie,
        dataType: DataRecoveryTime.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Monthly,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [
        makeEvent({
          id: 'legacy-recovery-1',
          startDate: '2024-01-01T08:00:00.000Z',
          endDate: '2024-01-01T09:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataRecoveryTime.type]: 1800 },
        }),
        makeEvent({
          id: 'legacy-recovery-2',
          startDate: '2024-03-05T08:00:00.000Z',
          endDate: '2024-03-05T09:00:00.000Z',
          activityTypes: [ActivityTypes.Running],
          stats: { [DataRecoveryTime.type]: 7200 },
        }),
      ],
      derivedMetrics: {
        recoveryNow: derivedRecoveryContext as any,
      },
    });

    const recoveryTile = viewModels[0] as DashboardChartTileViewModel;
    expect(recoveryTile.chartType).toBe(DASHBOARD_RECOVERY_NOW_CHART_TYPE);
    expect(recoveryTile.recoveryNow).toEqual(derivedRecoveryContext);
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

  it('should keep curated recovery context undefined when derived context is missing', () => {
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
    const olderEvent = makeEvent({
      id: 'e-recovery-curated-older',
      startDate: new Date(Date.UTC(2024, 0, 1, 12, 0, 0)).toISOString(),
      endDate: new Date(Date.UTC(2024, 0, 1, 13, 0, 0)).toISOString(),
      activityTypes: [ActivityTypes.Running],
      stats: { [DataRecoveryTime.type]: 1800 },
    });
    const latestEvent = makeEvent({
      id: 'e-recovery-curated-latest',
      startDate: new Date(Date.UTC(2024, 2, 5, 8, 0, 0)).toISOString(),
      endDate: new Date(Date.UTC(2024, 2, 5, 9, 0, 0)).toISOString(),
      activityTypes: [ActivityTypes.Running],
      stats: { [DataRecoveryTime.type]: 7200 },
    });

    const viewModels = buildDashboardTileViewModels({
      tiles,
      events: [olderEvent, latestEvent],
    });
    const recoveryTile = viewModels[0] as DashboardChartTileViewModel;

    expect(recoveryTile.recoveryNow).toBeUndefined();
    expect(recoveryTile.data).toEqual([]);
  });

  it('should use derived recovery context for curated recovery charts', () => {
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

    const derivedRecoveryContext = {
      totalSeconds: 9000,
      endTimeMs: Date.UTC(2024, 2, 5, 9, 0, 0),
      segments: [
        {
          totalSeconds: 1800,
          endTimeMs: Date.UTC(2024, 0, 2, 9, 0, 0),
        },
        {
          totalSeconds: 7200,
          endTimeMs: Date.UTC(2024, 2, 5, 9, 0, 0),
        },
      ],
    };

    const viewModels = buildDashboardTileViewModels({
      tiles,
      events: [oldEvent, recentEvent],
      derivedMetrics: {
        recoveryNow: derivedRecoveryContext as any,
      },
    });
    const recoveryTile = viewModels[0] as DashboardChartTileViewModel;

    expect(recoveryTile.recoveryNow).toEqual(derivedRecoveryContext);
  });

  it('should not attach derived-style recovery context to custom charts', () => {
    const tiles = [
      {
        type: TileTypes.Chart,
        chartType: ChartTypes.LinesVertical,
        dataType: DataRecoveryTime.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Auto,
        order: 0,
        size: { columns: 1, rows: 1 },
      } as any,
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
    });

    expect((viewModels[0] as any).recoveryNow).toBeUndefined();
  });

  it('should prefer derived recovery context for curated recovery chart types only', () => {
    const derivedRecoveryContext = {
      totalSeconds: 999,
      endTimeMs: Date.UTC(2024, 0, 10, 9, 0, 0),
      segments: [
        {
          totalSeconds: 999,
          endTimeMs: Date.UTC(2024, 0, 10, 9, 0, 0),
        },
      ],
    };
    const events = [
      makeEvent({
        id: 'event',
        startDate: '2024-01-02T08:00:00.000Z',
        endDate: '2024-01-02T09:00:00.000Z',
        activityTypes: [ActivityTypes.Running],
        stats: { [DataRecoveryTime.type]: 1800 },
      }),
    ];
    const viewModels = buildDashboardTileViewModels({
      tiles: [
        {
          type: TileTypes.Chart,
          chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE as any,
          dataType: DataRecoveryTime.type,
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Auto,
          order: 0,
          size: { columns: 1, rows: 1 },
        } as any,
        {
          type: TileTypes.Chart,
          chartType: ChartTypes.LinesVertical,
          dataType: DataRecoveryTime.type,
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Auto,
          order: 1,
          size: { columns: 1, rows: 1 },
        } as any,
      ],
      events,
      derivedMetrics: {
        recoveryNow: derivedRecoveryContext as any,
      },
    });

    expect((viewModels[0] as any).recoveryNow).toEqual(derivedRecoveryContext);
    expect((viewModels[1] as any).recoveryNow).toBeUndefined();
  });

  it('should map derived ACWR context for KPI chart tiles', () => {
    const viewModels = buildDashboardTileViewModels({
      tiles: [{
        type: TileTypes.Chart,
        order: 0,
        chartType: DASHBOARD_ACWR_KPI_CHART_TYPE as any,
        dataType: 'Training Stress Score',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Weekly,
        size: { columns: 1, rows: 1 },
      } as any],
      events: [],
      derivedMetrics: {
        acwr: {
          latestDayMs: Date.UTC(2026, 0, 1),
          acuteLoad7: 200,
          chronicLoad28: 180,
          ratio: 1.11,
          trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 1.0 }],
        } as any,
      },
    });

    expect((viewModels[0] as any).acwr?.ratio).toBe(1.11);
    expect((viewModels[0] as any).timeInterval).toBe(TimeIntervals.Weekly);
    expect((viewModels[0] as any).data).toEqual([]);
  });

  it('should compose current-state KPI chart tiles from derived metric contexts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 8, 12)));

    const freshnessForecast = {
      generatedAtMs: Date.UTC(2026, 0, 8),
      points: [
        {
          dayMs: Date.UTC(2026, 0, 10),
          trainingStressScore: 0,
          ctl: 40,
          atl: 38,
          formSameDay: 2,
          formPriorDay: -1,
          isForecast: true,
        },
      ],
    };
    const intensityDistribution = {
      weeks: [],
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestEasyPercent: 68,
      latestModeratePercent: 18,
      latestHardPercent: 14,
    };

    const viewModels = buildDashboardTileViewModels({
      tiles: [
        {
          type: TileTypes.Chart,
          order: 0,
          chartType: DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 1,
          chartType: DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 2,
          chartType: DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 3,
          chartType: DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 4,
          chartType: DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
      ] as any,
      events: [],
      derivedMetrics: {
        formPoints: [
          {
            time: Date.UTC(2026, 0, 6),
            trainingStressScore: 84,
            ctl: 42,
            atl: 50,
            formSameDay: -8,
            formPriorDay: -4,
          },
        ] as any,
        formNow: { latestDayMs: Date.UTC(2026, 0, 8), value: -6, trend8Weeks: [] } as any,
        rampRate: { rampRate: 1.6, trend8Weeks: [] } as any,
        formPlus7d: { value: 4, trend8Weeks: [] } as any,
        easyPercent: { value: 68, trend8Weeks: [] } as any,
        hardPercent: { value: 14, trend8Weeks: [] } as any,
        freshnessForecast: freshnessForecast as any,
        intensityDistribution: intensityDistribution as any,
      },
    });

    expect((viewModels[0] as any).chartType).toBe(DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE);
    expect((viewModels[0] as any).formNow?.value).toBe(-6);
    expect((viewModels[0] as any).rampRate?.rampRate).toBe(1.6);
    expect((viewModels[0] as any).fitnessCtl?.value).toBeCloseTo(40.0238, 4);
    expect((viewModels[0] as any).fatigueAtl?.value).toBeCloseTo(36.7347, 4);
    expect((viewModels[1] as any).fitnessCtl?.value).toBeCloseTo(40.0238, 4);
    expect((viewModels[2] as any).fatigueAtl?.value).toBeCloseTo(36.7347, 4);
    expect((viewModels[3] as any).formNow?.value).toBe(-6);
    expect((viewModels[3] as any).formPlus7d?.value).toBe(4);
    expect((viewModels[3] as any).freshnessForecast).toEqual(freshnessForecast);
    expect((viewModels[4] as any).easyPercent?.value).toBe(68);
    expect((viewModels[4] as any).hardPercent?.value).toBe(14);
    expect((viewModels[4] as any).intensityDistribution).toEqual(intensityDistribution);

    vi.useRealTimers();
  });

  it('should map derived KPI and curated contexts to dedicated special chart tiles', () => {
    const viewModels = buildDashboardTileViewModels({
      tiles: [
        {
          type: TileTypes.Chart,
          order: 0,
          chartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 1,
          chartType: DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 2,
          chartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 3,
          chartType: DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 4,
          chartType: DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 5,
          chartType: DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 6,
          chartType: DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 7,
          chartType: DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 2, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 8,
          chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 2, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 9,
          chartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 2, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 10,
          chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE as any,
          dataType: 'SleepDuration',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Daily,
          size: { columns: 2, rows: 1 },
        },
      ] as any,
      events: [],
      sleepSessions: [{
        id: 'sleep-1',
        startTimeMs: Date.UTC(2026, 0, 2, 21),
        endTimeMs: Date.UTC(2026, 0, 3, 5),
        sleepDate: '2026-01-03',
        durationSeconds: 8 * 3600,
        stageDurationsSeconds: { light: 4 * 3600, deep: 2 * 3600, rem: 90 * 60 },
        source: { provider: 'GarminAPI', sourceSessionKey: 'garmin-sleep-1' },
      } as any],
      derivedMetrics: {
        rampRate: { rampRate: 2.8, trend8Weeks: [] } as any,
        monotonyStrain: { strain: 630, trend8Weeks: [] } as any,
        formNow: { value: -2, trend8Weeks: [] } as any,
        formPlus7d: { value: 3, trend8Weeks: [] } as any,
        easyPercent: { value: 64, trend8Weeks: [] } as any,
        hardPercent: { value: 14, trend8Weeks: [] } as any,
        efficiencyDelta4w: { deltaAbs: 0.12, deltaPct: 6, trend8Weeks: [] } as any,
        freshnessForecast: { generatedAtMs: Date.now(), points: [] } as any,
        intensityDistribution: { weeks: [], latestWeekStartMs: null } as any,
        efficiencyTrend: { points: [], latestWeekStartMs: null } as any,
      },
    });

    expect((viewModels[0] as any).rampRate?.rampRate).toBe(2.8);
    expect((viewModels[1] as any).monotonyStrain?.strain).toBe(630);
    expect((viewModels[2] as any).formNow?.value).toBe(-2);
    expect((viewModels[3] as any).formPlus7d?.value).toBe(3);
    expect((viewModels[4] as any).easyPercent?.value).toBe(64);
    expect((viewModels[5] as any).hardPercent?.value).toBe(14);
    expect((viewModels[6] as any).efficiencyDelta4w?.deltaPct).toBe(6);
    expect((viewModels[7] as any).freshnessForecast).toBeTruthy();
    expect((viewModels[8] as any).intensityDistribution).toBeTruthy();
    expect((viewModels[9] as any).efficiencyTrend).toBeTruthy();
    expect((viewModels[10] as any).sleepTrend?.points).toHaveLength(1);
    expect((viewModels[10] as any).timeInterval).toBe(TimeIntervals.Daily);
  });

  it('should derive Fitness CTL and Fatigue ATL KPI contexts from Form points', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 8, 12)));

    const viewModels = buildDashboardTileViewModels({
      tiles: [
        {
          type: TileTypes.Chart,
          order: 0,
          chartType: DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
        {
          type: TileTypes.Chart,
          order: 1,
          chartType: DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE as any,
          dataType: 'Training Stress Score',
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Weekly,
          size: { columns: 1, rows: 1 },
        },
      ] as any,
      events: [],
      derivedMetrics: {
        formPoints: [
          {
            time: Date.UTC(2026, 0, 6),
            trainingStressScore: 84,
            ctl: 12,
            atl: 20,
            formSameDay: -8,
            formPriorDay: -4,
          },
        ] as any,
      },
    });

    expect((viewModels[0] as any).chartType).toBe(DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE);
    expect((viewModels[0] as any).fitnessCtl?.latestDayMs).toBe(Date.UTC(2026, 0, 8));
    expect((viewModels[0] as any).fitnessCtl?.value).toBeCloseTo(11.4354, 4);
    expect((viewModels[1] as any).chartType).toBe(DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE);
    expect((viewModels[1] as any).fatigueAtl?.latestDayMs).toBe(Date.UTC(2026, 0, 8));
    expect((viewModels[1] as any).fatigueAtl?.value).toBeCloseTo(14.6939, 4);

    vi.useRealTimers();
  });
});
