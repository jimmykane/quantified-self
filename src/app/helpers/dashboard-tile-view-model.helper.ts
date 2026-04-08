import type { EventInterface } from '@sports-alliance/sports-lib';
import {
  ChartTypes,
  DataRecoveryTime,
  DateRanges,
  DaysOfTheWeek,
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
  type DashboardFormPoint,
  extendDashboardFormPointsWithZeroLoadUntil,
  resolveDashboardFormLatestPoint,
} from './dashboard-form.helper';
import { getDatesForDateRange } from './date-range-helper';
import {
  type DashboardRecoveryNowContext,
} from './dashboard-recovery-now.helper';
import {
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  isDashboardFormChartType,
  isDashboardRecoveryNowChartType,
} from './dashboard-special-chart-types';

export interface DashboardChartTileViewModel extends TileChartSettingsInterface {
  timeInterval: TimeIntervals;
  data: AggregatedChartRow[] | EventInterface[] | DashboardFormPoint[];
  recoveryNow?: DashboardRecoveryNowContext;
  absoluteLatestFormPoint?: DashboardFormPoint | null;
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
  dashboardDateRange?: {
    dateRange?: DateRanges | null;
    startDate?: number | Date | null;
    endDate?: number | Date | null;
    startOfTheWeek?: DaysOfTheWeek | null;
  } | null;
  preferences?: EventStatAggregationPreferences;
  logger?: EventStatAggregationLogger;
  derivedMetrics?: {
    formPoints?: DashboardFormPoint[] | null;
    recoveryNow?: DashboardRecoveryNowContext | null;
  } | null;
}

function logRecoveryNowDebug(
  logger: EventStatAggregationLogger | undefined,
  payload: Record<string, unknown>,
): void {
  const loggerWithOptionalLog = logger as (EventStatAggregationLogger & {
    log?: (...args: unknown[]) => void;
  }) | undefined;
  loggerWithOptionalLog?.log?.('[debug][recovery-now] dashboard_tile_recovery_context', payload);
}

function resolveEventStartDateTimeMs(event: EventInterface): number | null {
  const startDate = (event as { startDate?: unknown } | null)?.startDate;
  if (startDate instanceof Date) {
    const startTimeMs = startDate.getTime();
    return Number.isFinite(startTimeMs) ? startTimeMs : null;
  }
  if (typeof startDate === 'number' && Number.isFinite(startDate)) {
    return startDate;
  }
  if (startDate && typeof (startDate as { getTime?: () => unknown }).getTime === 'function') {
    const startTimeMs = Number((startDate as { getTime: () => unknown }).getTime());
    return Number.isFinite(startTimeMs) ? startTimeMs : null;
  }
  return null;
}

function resolveDateRangeTimeMs(value: unknown): number | null {
  if (value instanceof Date) {
    const dateTimeMs = value.getTime();
    return Number.isFinite(dateTimeMs) ? dateTimeMs : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function resolveDashboardDateRangeBounds(
  dashboardDateRange?: BuildDashboardTileViewModelsInput['dashboardDateRange'],
): { startTimeMs: number; endTimeMs: number } | null {
  if (!dashboardDateRange || dashboardDateRange.dateRange === DateRanges.all) {
    return null;
  }

  const explicitStartTimeMs = resolveDateRangeTimeMs(dashboardDateRange.startDate);
  const explicitEndTimeMs = resolveDateRangeTimeMs(dashboardDateRange.endDate);
  if (explicitStartTimeMs !== null && explicitEndTimeMs !== null) {
    return {
      startTimeMs: explicitStartTimeMs,
      endTimeMs: explicitEndTimeMs,
    };
  }

  if (dashboardDateRange.dateRange === DateRanges.custom) {
    return null;
  }

  const startOfTheWeek = dashboardDateRange.startOfTheWeek ?? DaysOfTheWeek.Monday;
  const resolvedRange = getDatesForDateRange(dashboardDateRange.dateRange, startOfTheWeek);
  const presetStartTimeMs = resolveDateRangeTimeMs(resolvedRange.startDate);
  const presetEndTimeMs = resolveDateRangeTimeMs(resolvedRange.endDate);
  if (presetStartTimeMs === null || presetEndTimeMs === null) {
    return null;
  }

  return {
    startTimeMs: presetStartTimeMs,
    endTimeMs: presetEndTimeMs,
  };
}

function applyDashboardDateRangeFilter(
  events: EventInterface[],
  dashboardDateRange?: BuildDashboardTileViewModelsInput['dashboardDateRange'],
): EventInterface[] {
  const bounds = resolveDashboardDateRangeBounds(dashboardDateRange);
  if (!bounds) {
    return events;
  }

  return events.filter((event) => {
    const eventStartTimeMs = resolveEventStartDateTimeMs(event);
    return eventStartTimeMs !== null
      && eventStartTimeMs >= bounds.startTimeMs
      && eventStartTimeMs <= bounds.endTimeMs;
  });
}

function normalizeDashboardTileEvents(
  events?: EventInterface[] | null,
): EventInterface[] {
  const normalizedEvents = [...(events || [])]
    .filter(event => (event as { isMerge?: boolean } | null)?.isMerge !== true)
    .sort((left, right) => {
      const leftTime = resolveEventStartDateTimeMs(left) ?? Number.NEGATIVE_INFINITY;
      const rightTime = resolveEventStartDateTimeMs(right) ?? Number.NEGATIVE_INFINITY;
      return leftTime - rightTime;
    });
  return normalizedEvents;
}

function applyDashboardDateRangeFilterToFormPoints(
  points: DashboardFormPoint[],
  dashboardDateRange?: BuildDashboardTileViewModelsInput['dashboardDateRange'],
): DashboardFormPoint[] {
  const bounds = resolveDashboardDateRangeBounds(dashboardDateRange);
  if (!bounds) {
    return points;
  }

  const pointsWithRangeDecay = extendDashboardFormPointsWithZeroLoadUntil(points, bounds.endTimeMs);
  return pointsWithRangeDecay.filter((point) => (
    Number.isFinite(point?.time)
    && point.time >= bounds.startTimeMs
    && point.time <= bounds.endTimeMs
  ));
}

export function buildDashboardTileViewModels(
  input: BuildDashboardTileViewModelsInput,
): DashboardTileViewModel[] {
  const normalizedEvents = normalizeDashboardTileEvents(input.events);
  const filteredEvents = applyDashboardDateRangeFilter(normalizedEvents, input.dashboardDateRange);
  const derivedFormPoints = Array.isArray(input.derivedMetrics?.formPoints) ? input.derivedMetrics?.formPoints : null;
  const derivedRecoveryNowContext = input.derivedMetrics?.recoveryNow || null;

  return (input.tiles || []).reduce<DashboardTileViewModel[]>((viewModels, tile) => {
    if (tile.type === TileTypes.Map) {
      const mapTile = tile as DashboardMapTileSettings;
      viewModels.push({
        ...mapTile,
        events: filteredEvents,
      });
      return viewModels;
    }

    if (tile.type !== TileTypes.Chart) {
      throw new Error(`Not implemented for ${tile.type}`);
    }

    const chartTile = tile as TileChartSettingsInterface;
    const requestedTimeInterval = chartTile.dataTimeInterval || TimeIntervals.Auto;
    if (isDashboardFormChartType(chartTile.chartType)) {
      const fullFormPoints = derivedFormPoints || [];
      const visibleFormPoints = applyDashboardDateRangeFilterToFormPoints(fullFormPoints, input.dashboardDateRange);
      viewModels.push({
        ...chartTile,
        timeInterval: TimeIntervals.Weekly,
        data: visibleFormPoints,
        absoluteLatestFormPoint: resolveDashboardFormLatestPoint(fullFormPoints),
      });
      return viewModels;
    }

    if (chartTile.chartType === ChartTypes.IntensityZones) {
      viewModels.push({
        ...chartTile,
        timeInterval: TimeIntervals.Auto,
        data: filteredEvents,
      });
      return viewModels;
    }

    const isLegacyRecoveryPieTile = chartTile.chartType === ChartTypes.Pie
      && chartTile.dataType === DataRecoveryTime.type;
    const isCuratedRecoveryTile = isDashboardRecoveryNowChartType(chartTile.chartType)
      || isLegacyRecoveryPieTile;
    const effectiveChartType = isLegacyRecoveryPieTile
      ? (DASHBOARD_RECOVERY_NOW_CHART_TYPE as unknown as ChartTypes)
      : chartTile.chartType;
    if (isCuratedRecoveryTile) {
      const recoveryNowContextForTile = derivedRecoveryNowContext;
      const segments = Array.isArray(recoveryNowContextForTile?.segments) ? recoveryNowContextForTile.segments : [];
      logRecoveryNowDebug(input.logger, {
        tileName: chartTile.name || null,
        chartType: `${effectiveChartType}`,
        source: derivedRecoveryNowContext ? 'derived' : 'none',
        derivedAvailable: !!derivedRecoveryNowContext,
        filteredEvents: filteredEvents.length,
        contextTotalSeconds: recoveryNowContextForTile?.totalSeconds ?? null,
        contextEndTimeMs: recoveryNowContextForTile?.endTimeMs ?? null,
        contextSegments: segments.length,
      });
      viewModels.push({
        ...chartTile,
        chartType: effectiveChartType,
        timeInterval: chartTile.dataTimeInterval || TimeIntervals.Auto,
        data: [],
        ...(recoveryNowContextForTile ? { recoveryNow: recoveryNowContextForTile } : {}),
      });
      return viewModels;
    }

    const aggregation = buildEventStatAggregation(filteredEvents, {
      dataType: chartTile.dataType,
      valueType: chartTile.dataValueType,
      categoryType: chartTile.dataCategoryType,
      requestedTimeInterval,
      preferences: input.preferences,
    }, input.logger);
    const chartRowsForTile = buildAggregatedChartRows(aggregation);

    viewModels.push({
      ...chartTile,
      chartType: effectiveChartType,
      timeInterval: aggregation.resolvedTimeInterval,
      data: chartRowsForTile,
    });
    return viewModels;
  }, []);
}

export function isDashboardChartTileViewModel(tile: DashboardTileViewModel | TileSettingsInterface): tile is DashboardChartTileViewModel {
  return tile.type === TileTypes.Chart;
}
