import type { EventInterface } from '@sports-alliance/sports-lib';
import {
  ChartTypes,
  DataRecoveryTime,
  TileChartSettingsInterface,
  TileMapSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import {
  buildEventStatAggregation,
} from '@shared/event-stat-aggregation';
import type {
  EventStatAggregationLogger,
  EventStatAggregationPreferences,
} from '@shared/event-stat-aggregation.types';
import type { MapStyleName } from '../services/map/map-style.types';
import {
  buildAggregatedChartRows,
  type AggregatedChartRow,
} from './aggregated-chart-row.helper';
import {
  resolveLatestRecoveryNowContext,
  type DashboardRecoveryNowContext,
} from './dashboard-recovery-now.helper';
import { isDashboardRecoveryNowChartType } from './dashboard-special-chart-types';

export interface DashboardChartTileViewModel extends TileChartSettingsInterface {
  timeInterval: TimeIntervals;
  data: AggregatedChartRow[] | EventInterface[];
  recoveryNow?: DashboardRecoveryNowContext;
}

export type DashboardMapTileSettings = Omit<TileMapSettingsInterface, 'mapType'> & {
  mapStyle?: MapStyleName;
};

export interface DashboardMapTileViewModel extends DashboardMapTileSettings {
  events: EventInterface[];
}

export type DashboardTileViewModel = DashboardChartTileViewModel | DashboardMapTileViewModel;

interface BuildDashboardTileViewModelsInput {
  tiles: TileSettingsInterface[];
  events?: EventInterface[] | null;
  preferences?: EventStatAggregationPreferences;
  logger?: EventStatAggregationLogger;
}

function normalizeDashboardTileEvents(events?: EventInterface[] | null): EventInterface[] {
  return [...(events || [])]
    .filter(event => (event as { isMerge?: boolean } | null)?.isMerge !== true)
    .sort((left, right) => {
      const leftTime = left?.startDate instanceof Date ? left.startDate.getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right?.startDate instanceof Date ? right.startDate.getTime() : Number.NEGATIVE_INFINITY;
      return leftTime - rightTime;
    });
}

export function buildDashboardTileViewModels(
  input: BuildDashboardTileViewModelsInput,
): DashboardTileViewModel[] {
  const normalizedEvents = normalizeDashboardTileEvents(input.events);
  const latestRecoveryNowContext = resolveLatestRecoveryNowContext(normalizedEvents);

  return (input.tiles || []).reduce<DashboardTileViewModel[]>((viewModels, tile) => {
    if (tile.type === TileTypes.Map) {
      const mapTile = tile as DashboardMapTileSettings;
      viewModels.push({
        ...mapTile,
        events: normalizedEvents,
      });
      return viewModels;
    }

    if (tile.type !== TileTypes.Chart) {
      throw new Error(`Not implemented for ${tile.type}`);
    }

    const chartTile = tile as TileChartSettingsInterface;
    const requestedTimeInterval = chartTile.dataTimeInterval || TimeIntervals.Auto;
    if (chartTile.chartType === ChartTypes.IntensityZones) {
      viewModels.push({
        ...chartTile,
        timeInterval: TimeIntervals.Auto,
        data: normalizedEvents,
      });
      return viewModels;
    }

    const aggregation = buildEventStatAggregation(normalizedEvents, {
      dataType: chartTile.dataType,
      valueType: chartTile.dataValueType,
      categoryType: chartTile.dataCategoryType,
      requestedTimeInterval,
      preferences: input.preferences,
    }, input.logger);

    viewModels.push({
      ...chartTile,
      timeInterval: aggregation.resolvedTimeInterval,
      data: buildAggregatedChartRows(aggregation),
      ...((chartTile.dataType === DataRecoveryTime.type || isDashboardRecoveryNowChartType(chartTile.chartType))
        && latestRecoveryNowContext
        ? { recoveryNow: latestRecoveryNowContext }
        : {}),
    });
    return viewModels;
  }, []);
}

export function isDashboardChartTileViewModel(tile: DashboardTileViewModel | TileSettingsInterface): tile is DashboardChartTileViewModel {
  return tile.type === TileTypes.Chart;
}
