import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDistance,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { buildDashboardCartesianPoints } from './dashboard-echarts-cartesian.helper';
import { buildAggregatedChartRows } from './aggregated-chart-row.helper';
import {
  buildDashboardTileViewModels,
} from './dashboard-tile-view-model.helper';
import type { EventStatAggregationResult } from '@shared/event-stat-aggregation.types';

function makeEvent(options: {
  id: string;
  startDate: string;
  activityTypes: ActivityTypes[];
  stats?: Record<string, number | undefined>;
  isMerge?: boolean;
}): any {
  const stats = options.stats || {};
  return {
    startDate: new Date(options.startDate),
    isMerge: options.isMerge === true,
    getID: () => options.id,
    getActivityTypesAsArray: () => [...options.activityTypes],
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
});
