import { ChartDataCategoryTypes, ChartDataValueTypes, DataDuration, TileTypes, TimeIntervals } from '@sports-alliance/sports-lib';
import { buildDashboardActivityCalendarTile } from './dashboard-activity-calendar.helper';
import { DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE } from './dashboard-special-chart-types';

describe('dashboard-activity-calendar helper', () => {
  it('builds a fixed current-month calendar tile without event filters', () => {
    const tile = buildDashboardActivityCalendarTile(3);

    expect(tile).toMatchObject({
      name: 'Activity calendar',
      type: TileTypes.Chart,
      order: 3,
      size: { columns: 1, rows: 1 },
      chartType: DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
      dataType: DataDuration.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Daily,
    });
    expect(tile.eventFilters).toBeUndefined();
  });
});
