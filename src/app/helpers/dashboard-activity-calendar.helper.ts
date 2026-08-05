import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDuration,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { AppDashboardChartTileSettingsInterface } from '../models/app-user.interface';
import { DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE } from './dashboard-special-chart-types';
import { getDefaultDashboardChartTileSizeForChartType } from './dashboard-tile-default-size.helper';

export function buildDashboardActivityCalendarTile(
  order: number,
  size = getDefaultDashboardChartTileSizeForChartType(DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE),
): AppDashboardChartTileSettingsInterface {
  return {
    name: 'Activity calendar',
    type: TileTypes.Chart,
    order,
    size,
    chartType: DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE as unknown as ChartTypes,
    dataType: DataDuration.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Daily,
  };
}
