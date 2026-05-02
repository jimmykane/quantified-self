import { describe, expect, it, vi, afterEach } from 'vitest';
import { ActivityTypes, DateRanges, DaysOfTheWeek } from '@sports-alliance/sports-lib';
import {
  AppDashboardTileEventFilterRange,
} from '../models/app-user.interface';
import {
  DASHBOARD_TILE_EVENT_RANGE_OPTIONS,
  dashboardTileEventRangeDays,
  cloneDashboardTileEventFilters,
  eventMatchesDashboardActivityTypes,
  filterDashboardTileEventsByActivityTypes,
  normalizeActivityTypes,
  normalizeDashboardEventTableFilters,
  normalizeDashboardTileEventFilters,
  resolveDashboardTileEventWindow,
  resolveLegacyDashboardTileEventFilterRange,
} from './dashboard-tile-event-filters.helper';

function makeEvent(activityTypes: ActivityTypes[]): any {
  return {
    getActivityTypesAsArray: () => [...activityTypes],
  };
}

describe('dashboard-tile-event-filters.helper', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes missing tile filters to 90d and all activities', () => {
    expect(normalizeDashboardTileEventFilters(null)).toEqual({
      range: '90d',
      activityTypes: [],
    });
  });

  it('maps legacy All dashboard ranges to 1y for tile migration', () => {
    expect(resolveLegacyDashboardTileEventFilterRange(DateRanges.all)).toBe('1y');
  });

  it('resolves duration windows for rolling ranges', () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const cases: Array<[AppDashboardTileEventFilterRange, number]> = [
      ['14d', 14],
      ['30d', 30],
      ['90d', 90],
      ['1y', 365],
      ['2y', 365 * 2],
      ['3y', 365 * 3],
      ['4y', 365 * 4],
    ];

    cases.forEach(([range, days]) => {
      const window = resolveDashboardTileEventWindow({ range, activityTypes: [] }, DaysOfTheWeek.Monday, null, nowMs);
      expect(window).toEqual({
        range,
        startMs: nowMs - (days * 24 * 60 * 60 * 1000),
        endMs: nowMs,
      });
      expect(dashboardTileEventRangeDays(range)).toBe(days);
    });
  });

  it('keeps tile range menu labels separate from button and mobile labels', () => {
    expect(DASHBOARD_TILE_EVENT_RANGE_OPTIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ range: 'thisWeek', label: 'This week', buttonLabel: 'Week', shortLabel: 'W' }),
      expect.objectContaining({ range: 'thisMonth', label: 'This month', buttonLabel: 'Month', shortLabel: 'M' }),
      expect.objectContaining({ range: '90d', label: '90d', buttonLabel: '90d', shortLabel: '90d' }),
    ]));
  });

  it('resolves this week and this month as bounded current calendar windows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const weekWindow = resolveDashboardTileEventWindow({ range: 'thisWeek', activityTypes: [] }, DaysOfTheWeek.Monday);
    const monthWindow = resolveDashboardTileEventWindow({ range: 'thisMonth', activityTypes: [] }, DaysOfTheWeek.Monday);

    expect(weekWindow.startMs).toBe(new Date('2026-04-27T00:00:00.000').getTime());
    expect(weekWindow.endMs).toBe(new Date('2026-05-03T23:59:59.999').getTime());
    expect(monthWindow.startMs).toBe(new Date('2026-04-01T00:00:00.000').getTime());
    expect(monthWindow.endMs).toBe(new Date('2026-05-01T00:00:00.000').getTime());
  });

  it('returns an unbounded window for all', () => {
    expect(resolveDashboardTileEventWindow({ range: 'all', activityTypes: [] })).toEqual({
      range: 'all',
      startMs: null,
      endMs: null,
    });
  });

  it('filters activities only when activity filters are selected', () => {
    const running = makeEvent([ActivityTypes.Running]);
    const cycling = makeEvent([ActivityTypes.Cycling]);
    const events = [running, cycling];

    expect(filterDashboardTileEventsByActivityTypes(events, [])).toEqual(events);
    expect(filterDashboardTileEventsByActivityTypes(events, [ActivityTypes.Cycling])).toEqual([cycling]);
  });

  it('normalizes activity lists and ignores invalid values', () => {
    expect(normalizeActivityTypes([
      ActivityTypes.Running,
      ActivityTypes.Running,
      'not-valid' as ActivityTypes,
    ])).toEqual([ActivityTypes.Running]);
  });

  it('matches event activity types defensively', () => {
    expect(eventMatchesDashboardActivityTypes({} as any, [ActivityTypes.Running])).toBe(false);
    expect(eventMatchesDashboardActivityTypes(makeEvent([ActivityTypes.Running]), [ActivityTypes.Running])).toBe(true);
    expect(eventMatchesDashboardActivityTypes(makeEvent([ActivityTypes.Running]), [])).toBe(true);
  });

  it('normalizes invalid event table date ranges to all', () => {
    expect(normalizeDashboardEventTableFilters({ dateRange: 999 }).dateRange).toBe(DateRanges.all);
  });

  it('clones tile event filter activity arrays', () => {
    const original = { range: '90d' as const, activityTypes: [ActivityTypes.Running] };
    const cloned = cloneDashboardTileEventFilters(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned?.activityTypes).not.toBe(original.activityTypes);
  });

  it('normalizes malformed tile filters while cloning', () => {
    expect(cloneDashboardTileEventFilters({
      range: 'legacy' as AppDashboardTileEventFilterRange,
      activityTypes: ['not-valid' as ActivityTypes, ActivityTypes.Cycling],
    })).toEqual({
      range: '90d',
      activityTypes: [ActivityTypes.Cycling],
    });
  });
});
