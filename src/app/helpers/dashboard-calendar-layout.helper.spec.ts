import { describe, expect, it } from 'vitest';
import { buildDashboardActivityCalendarTile } from './dashboard-activity-calendar.helper';
import { migrateDashboardCalendarDayContextLayout } from './dashboard-calendar-layout.helper';
import type { AppDashboardSettingsInterface } from '../models/app-user.interface';

describe('calendar day-context layout migration', () => {
  it('expands only Calendar and preserves other tiles, order, and settings', () => {
    const calendar = buildDashboardActivityCalendarTile(2, { columns: 1, rows: 1 });
    const other = { order: 1, size: { columns: 1, rows: 1 }, name: 'Other' };
    const result = migrateDashboardCalendarDayContextLayout({ tiles: [other, calendar] } as AppDashboardSettingsInterface)!;
    expect(result.tiles[0]).toBe(other);
    expect(result.tiles[1]).toMatchObject({ order: 2, name: 'Activity calendar', size: { columns: 4, rows: 1 } });
    expect(calendar.size).toEqual({ columns: 1, rows: 1 });
  });

  it('does not run again after migration, so a later manual resize is honored', () => {
    const calendar = buildDashboardActivityCalendarTile(0, { columns: 1, rows: 2 });
    expect(migrateDashboardCalendarDayContextLayout({ calendarDayContextLayoutVersion: 1, tiles: [calendar] } as AppDashboardSettingsInterface)).toBeNull();
    expect(migrateDashboardCalendarDayContextLayout({ tiles: [] } as AppDashboardSettingsInterface)).toBeNull();
  });
});
